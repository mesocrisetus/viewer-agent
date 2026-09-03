"""Orquestador del agente: alta, consentimiento, bucles de captura y envío."""
from __future__ import annotations

import datetime as dt
import getpass
import platform
import socket
import sys
import threading
import time

from . import AGENT_VERSION
from .api import Api, ApiError
from .buffer import Buffer
from .capture import ScreenCapturer, count_monitors
from .config import BUFFER_PATH, DATA_DIR, LOG_PATH, LocalConfig, State
from .input_monitor import InputMonitor
from .platform_window import get_active_window
from .tray import Tray, show_consent_dialog, CONSENT_FALLBACK
from .ws_client import ControlChannel

try:
    import psutil
except Exception:
    psutil = None


class AlreadyRunning(Exception):
    """Ya hay otra instancia del agente en este equipo."""


def acquire_single_instance():
    """Garantiza una sola instancia por equipo. Devuelve un objeto a conservar
    vivo (mutex / fichero) o lanza AlreadyRunning."""
    if sys.platform.startswith("win"):
        import ctypes

        h = ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\ViewerAgentSingleton")
        if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
            raise AlreadyRunning()
        return h
    # POSIX: lock exclusivo sobre un fichero
    import fcntl

    lock_path = DATA_DIR / "agent.lock"
    fh = open(lock_path, "w")
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise AlreadyRunning()
    return fh


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _os_key() -> str:
    s = platform.system().lower()
    if s.startswith("win"):
        return "windows"
    if s == "darwin":
        return "macos"
    return "linux"


class Agent:
    def __init__(self, cfg: LocalConfig):
        self.cfg = cfg
        self.state = State.load()
        self.api = Api(cfg.base_url, verify_tls=cfg.verify_tls)
        self.buffer = Buffer(BUFFER_PATH)
        self.inputs = InputMonitor()
        self.capturer: ScreenCapturer | None = None
        self.ctrl: ControlChannel | None = None
        self._stop = threading.Event()
        self._remote_lock = threading.Lock()
        self._last_shot = 0.0
        self._cur_window = None
        self._cur_window_since = time.time()
        self._cur_started_iso = _now_iso()

    # ---------------- logging ----------------
    def log(self, msg: str) -> None:
        line = f"{_now_iso()}  {msg}"
        print(line, flush=True)
        try:
            with open(LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except Exception:
            pass

    # ---------------- remote config ----------------
    @property
    def remote(self) -> dict:
        with self._remote_lock:
            return dict(self.state.remote)

    def _apply_remote(self, remote: dict) -> None:
        if not remote:
            return
        with self._remote_lock:
            self.state.remote.update(remote)
            self.state.save()
        self.inputs.set_text_capture(bool(self.state.remote.get("textCapture")))
        self.log(
            f"Config actualizada: capturas cada {self.state.remote.get('screenshotIntervalSec')}s, "
            f"texto={'sí' if self.state.remote.get('textCapture') else 'no'}, "
            f"pausa={'sí' if self.state.remote.get('paused') else 'no'}"
        )

    # ---------------- enrolamiento ----------------
    def ensure_enrolled(self) -> None:
        if self.state.enrolled:
            self.api.set_credentials(self.state.device_id, self.state.device_secret)
            return
        if not self.cfg.enroll_token:
            raise SystemExit("config.json: falta 'enrollToken' y el equipo no está dado de alta.")
        payload = {
            "enrollToken": self.cfg.enroll_token,
            "hostname": socket.gethostname(),
            "os": _os_key(),
            "osVersion": platform.version(),
            "username": _current_user(),
            "agentVersion": AGENT_VERSION,
            "monitorCount": count_monitors(),
        }
        self.log("Dando de alta el equipo...")
        # Reintenta ante fallos de red; NO reintenta si el token es inválido.
        last_net_err: Exception | None = None
        for attempt in range(1, 7):
            if self._stop.is_set():
                return
            try:
                res = self.api.enroll(payload)
                break
            except ApiError as e:  # token inválido / ya usado -> permanente
                raise SystemExit(
                    "TOKEN_USADO: El código de alta de este instalador ya se ha "
                    "usado o ha caducado. Genera un instalador nuevo desde el "
                    "panel (Descargar cliente) para este equipo."
                ) from e
            except Exception as e:  # red caída, servidor no disponible...
                last_net_err = e
                self.log(f"Alta: sin conexión con el servidor (intento {attempt}/6): {e}")
                self._stop.wait(min(30, 5 * attempt))
        else:
            raise SystemExit(
                f"SIN_SERVIDOR: No se pudo contactar con el servidor "
                f"({self.cfg.server_url}). Revisa la conexión y vuelve a intentarlo. "
                f"Detalle: {last_net_err}"
            )

        self.state.device_id = res["deviceId"]
        self.state.device_secret = res["deviceSecret"]
        self.state.remote = {**self.state.remote, **(res.get("config") or {})}
        self.state.save()
        self.api.set_credentials(self.state.device_id, self.state.device_secret)
        self._consent_text = res.get("consentText") or CONSENT_FALLBACK
        self.log(f"Alta correcta. deviceId={self.state.device_id}")

    def ensure_consent(self) -> None:
        if self.state.consented:
            # Ya aceptado en este equipo: reconfírmalo al servidor por si su
            # registro se ha perdido (idempotente).
            try:
                self.api.send_consent(self.state.consent_accepted_at, _current_user())
            except Exception:
                pass
            return
        text = getattr(self, "_consent_text", CONSENT_FALLBACK)
        accepted = show_consent_dialog(
            "Aviso de supervisión del equipo", text, require_accept=True
        )
        if not accepted:
            self.log("El usuario no aceptó el aviso de supervisión. El agente no enviará datos.")
            raise SystemExit(3)
        now = _now_iso()
        self.state.consent_accepted_at = now
        self.state.save()
        try:
            self.api.send_consent(now, _current_user())
        except Exception as e:
            self.log(f"No se pudo confirmar el consentimiento al servidor (se reintentará): {e}")

    # ---------------- bucles ----------------
    def _rotate_activity_sample(self, force: bool = False) -> None:
        """Cierra la muestra de ventana activa en curso y la encola."""
        win = get_active_window()
        key = (win.app_name, win.window_title)
        prev_key = (
            (self._cur_window.app_name, self._cur_window.window_title)
            if self._cur_window else None
        )
        changed = key != prev_key
        if self._cur_window is None:
            self._cur_window = win
            self._cur_window_since = time.time()
            self._cur_started_iso = _now_iso()
            return
        if changed or force:
            drained = self.inputs.drain()
            ended_iso = _now_iso()
            sample = {
                "startedAt": self._cur_started_iso,
                "endedAt": ended_iso,
                "appName": self._cur_window.app_name or "",
                "windowTitle": self._cur_window.window_title or "",
                "url": self._cur_window.url or "",
                "keyboardCount": drained["keys"],
                "mouseCount": drained["mouse"],
                "idleSec": int(min(self.inputs.idle_seconds(), 3600)),
            }
            if sample["appName"] or sample["windowTitle"]:
                self.buffer.put("activity", sample)
            if drained["keys"] or drained["special"]:
                self.buffer.put("keyboard", {
                    "at": ended_iso,
                    "kind": "activity",
                    "keysCount": drained["keys"],
                    "specialKeys": drained["special"],
                })
            if drained["text"]:
                self.buffer.put("keyboard", {
                    "at": ended_iso,
                    "kind": "text",
                    "keysCount": len(drained["text"]),
                    "specialKeys": [],
                    "textChunk": drained["text"][:4000],
                })
            self._cur_window = win
            self._cur_window_since = time.time()
            self._cur_started_iso = ended_iso

    def _activity_loop(self) -> None:
        while not self._stop.is_set():
            try:
                if not self.remote.get("paused"):
                    flush = int(self.remote.get("activityFlushSec") or 30)
                    self._rotate_activity_sample(force=(time.time() - self._cur_window_since) >= flush)
            except Exception as e:
                self.log(f"activity_loop: {e}")
            self._stop.wait(3)

    def _screenshot_loop(self) -> None:
        self.capturer = ScreenCapturer()
        while not self._stop.is_set():
            try:
                r = self.remote
                interval = int(r.get("screenshotIntervalSec") or 0)
                if interval > 0 and not r.get("paused") and (time.time() - self._last_shot) >= interval:
                    n = self.capturer.monitors()
                    for m in range(n):
                        try:
                            jpeg = self.capturer.grab_jpeg(
                                m, int(r.get("maxImageEdgePx") or 1600), int(r.get("jpegQuality") or 55)
                            )
                        except IndexError:
                            break  # pantalla desconectada a mitad; se recalcula en la próxima vuelta
                        self.buffer.put("screenshot_inline", {"capturedAt": _now_iso(), "monitor": m,
                                                              "b64": _b64(jpeg)})
                    self._last_shot = time.time()
            except Exception as e:
                self.log(f"screenshot_loop: {e}")
            self._stop.wait(2)

    def _live_loop(self) -> None:
        cap = ScreenCapturer()
        while not self._stop.is_set():
            try:
                if self.ctrl and self.ctrl.live_wanted and not self.remote.get("paused"):
                    n = max(1, cap.monitors())
                    # Con muchas pantallas, baja fps y resolución para no saturar.
                    fps = max(1, min(self.ctrl.live_fps, 10))
                    edge = 1280
                    if n >= 3:
                        fps = max(1, fps // 2)
                        edge = 1024
                    for m in range(n):
                        if not self.ctrl.live_wanted or self._stop.is_set():
                            break
                        try:
                            jpeg = cap.grab_jpeg(m, edge, self.ctrl.live_quality)
                        except IndexError:
                            break  # pantalla desconectada; se recalcula n en la próxima vuelta
                        self.ctrl.send_frame(jpeg, _now_iso(), monitor=m)
                    self._stop.wait(1.0 / fps)
                else:
                    self._stop.wait(0.5)
            except Exception as e:
                self.log(f"live_loop: {e}")
                self._stop.wait(1)

    def _uploader_loop(self) -> None:
        auth_fails = 0
        hb = 0
        while not self._stop.is_set():
            sent_any = False
            try:
                sent_any |= self._flush_activity()
                sent_any |= self._flush_keyboard()
                sent_any |= self._flush_screenshots()
                auth_fails = 0
            except Exception as e:
                msg = str(e)
                if "401" in msg or "Unauthorized" in msg:
                    auth_fails += 1
                    if auth_fails in (1, 5, 20):
                        self.log(
                            "El servidor rechaza las credenciales de este equipo "
                            "(401). ¿Se ha eliminado del panel? Reinstala desde "
                            "«Descargar cliente» para volver a darlo de alta."
                        )
                else:
                    self.log(f"uploader: {e}")
            if self.ctrl:
                hb += 1
                if hb % 3 == 1:  # re-cuenta pantallas cada ~15 s (barato, mss nuevo)
                    try:
                        self.ctrl.set_monitor_count(count_monitors())
                    except Exception:
                        pass
                self.ctrl.heartbeat(self.buffer.count(), *_sysload())
            # backoff progresivo si el servidor rechaza las credenciales
            wait = 1 if sent_any else 5
            if auth_fails > 3:
                wait = min(300, 15 * auth_fails)
            self._stop.wait(wait)

    def _flush_activity(self) -> bool:
        batch = self.buffer.peek_batch("activity", 100)
        if not batch:
            return False
        self.api.post_activity([p for _, p in batch])
        self.buffer.delete([i for i, _ in batch])
        return True

    def _flush_keyboard(self) -> bool:
        batch = self.buffer.peek_batch("keyboard", 200)
        if not batch:
            return False
        self.api.post_keyboard([p for _, p in batch])
        self.buffer.delete([i for i, _ in batch])
        return True

    def _flush_screenshots(self) -> bool:
        batch = self.buffer.peek_batch("screenshot_inline", 5)
        if not batch:
            return False
        for i, p in batch:
            self.api.post_screenshot(p["capturedAt"], int(p.get("monitor", 0)), _unb64(p["b64"]))
            self.buffer.delete([i])
        return True

    # ---------------- arranque ----------------
    def run(self) -> None:
        try:
            self._lock = acquire_single_instance()
        except AlreadyRunning:
            self.log("Ya hay otra instancia del agente en marcha; esta se cierra.")
            return

        self.log(f"viewer Agent {AGENT_VERSION} · {platform.platform()}")
        self.ensure_enrolled()
        self.ensure_consent()

        self.inputs.set_text_capture(bool(self.remote.get("textCapture")))
        self.inputs.start()

        tray = Tray(status_text_getter=lambda: self._status_line())
        tray.start()

        self.ctrl = ControlChannel(
            self.cfg.base_url, self.state.device_id, self.state.device_secret,
            self.cfg.verify_tls, on_config=self._apply_remote, log=self.log,
            monitor_count=count_monitors(),
        )
        self.ctrl.start()

        threads = [
            threading.Thread(target=self._activity_loop, name="vigia-activity", daemon=True),
            threading.Thread(target=self._screenshot_loop, name="vigia-shots", daemon=True),
            threading.Thread(target=self._live_loop, name="vigia-live", daemon=True),
            threading.Thread(target=self._uploader_loop, name="vigia-upload", daemon=True),
        ]
        for t in threads:
            t.start()

        try:
            while not self._stop.is_set():
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            self.shutdown()
            tray.stop()

    def _status_line(self) -> str:
        r = self.remote
        if r.get("paused"):
            return "Supervisión en pausa"
        return f"Supervisión activa · pendientes de enviar: {self.buffer.count()}"

    def shutdown(self) -> None:
        self._stop.set()
        try:
            self._rotate_activity_sample(force=True)
        except Exception:
            pass
        self.inputs.stop()
        if self.ctrl:
            self.ctrl.close()
        if self.capturer:
            self.capturer.close()
        self.log("Agente detenido.")


def _current_user() -> str:
    try:
        return getpass.getuser()
    except Exception:
        return ""


def _sysload():
    if not psutil:
        return (0.0, 0.0)
    try:
        return (psutil.cpu_percent(interval=None), psutil.virtual_memory().percent)
    except Exception:
        return (0.0, 0.0)


def _b64(data: bytes) -> str:
    import base64
    return base64.b64encode(data).decode("ascii")


def _unb64(s: str) -> bytes:
    import base64
    return base64.b64decode(s)
