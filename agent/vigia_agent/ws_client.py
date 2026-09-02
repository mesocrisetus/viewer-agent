"""Canal de control y vídeo en vivo (WebSocket persistente /agent/ws)."""
from __future__ import annotations

import base64
import json
import threading
import time

from websocket import WebSocketApp


class ControlChannel:
    def __init__(self, base_url: str, device_id: str, device_secret: str, verify_tls: bool,
                 on_config, log):
        self._url = base_url.rstrip("/").replace("http://", "ws://").replace("https://", "wss://") + "/agent/ws"
        self._device_id = device_id
        self._device_secret = device_secret
        self._verify = verify_tls
        self._on_config = on_config
        self._log = log

        self._ws: WebSocketApp | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

        self._live = threading.Event()
        self._live_session = ""
        self._live_fps = 4
        self._live_quality = 55
        self._connected = threading.Event()

    # ---- ciclo de vida ----
    def start(self) -> None:
        self._thread = threading.Thread(target=self._run_forever, name="vigia-ws", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        try:
            if self._ws:
                self._ws.close()
        except Exception:
            pass

    def _run_forever(self) -> None:
        backoff = 2
        while not self._stop.is_set():
            try:
                self._ws = WebSocketApp(
                    self._url,
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_close=self._on_close,
                    on_error=self._on_error,
                )
                sslopt = None if self._verify else {"cert_reqs": 0}
                self._ws.run_forever(ping_interval=25, ping_timeout=10, sslopt=sslopt)
            except Exception as e:
                self._log(f"WS error: {e}")
            self._connected.clear()
            self._live.clear()
            if self._stop.is_set():
                break
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)

    # ---- callbacks ----
    def _on_open(self, ws) -> None:
        self._connected.set()
        ws.send(json.dumps({
            "type": "hello",
            "deviceId": self._device_id,
            "deviceSecret": self._device_secret,
        }))
        self._log("Canal de control conectado.")

    def _on_message(self, ws, raw) -> None:
        try:
            msg = json.loads(raw)
        except Exception:
            return
        t = msg.get("type")
        if t == "config" and callable(self._on_config):
            self._on_config(msg.get("config") or {})
        elif t == "live_start":
            self._live_session = msg.get("sessionId", "")
            self._live_fps = int(msg.get("fps") or self._live_fps)
            self._live_quality = int(msg.get("quality") or self._live_quality)
            self._live.set()
            self._log("Directo solicitado por un administrador.")
        elif t == "live_stop":
            self._live.clear()
            self._log("Directo finalizado.")
        elif t == "ping":
            self._safe_send({"type": "heartbeat", "queued": 0})

    def _on_close(self, ws, code, reason) -> None:
        self._connected.clear()
        self._live.clear()
        self._log(f"Canal de control cerrado ({code}).")

    def _on_error(self, ws, error) -> None:
        self._log(f"Canal de control: {error}")

    # ---- API para el agente ----
    def _safe_send(self, obj: dict) -> None:
        try:
            if self._ws and self._connected.is_set():
                self._ws.send(json.dumps(obj))
        except Exception:
            pass

    def heartbeat(self, queued: int, cpu: float = 0.0, mem: float = 0.0) -> None:
        self._safe_send({"type": "heartbeat", "queued": queued, "cpu": cpu, "mem": mem})

    @property
    def live_wanted(self) -> bool:
        return self._live.is_set()

    @property
    def live_fps(self) -> int:
        return self._live_fps

    @property
    def live_quality(self) -> int:
        return self._live_quality

    def send_frame(self, jpeg: bytes, ts: str) -> None:
        if not self._live.is_set():
            return
        self._safe_send({
            "type": "frame",
            "sessionId": self._live_session,
            "ts": ts,
            "jpegB64": base64.b64encode(jpeg).decode("ascii"),
        })
