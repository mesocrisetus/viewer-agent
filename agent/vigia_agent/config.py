"""Carga y persistencia de la configuración local del agente.

Orden de resolución de la configuración (server + token):
  1. `--config <ruta>` en la línea de comandos.
  2. `config.json` junto al ejecutable / en la carpeta del proyecto.
  3. `config.json` en la carpeta de instalación del sistema
     (Windows: %ProgramData%\\ViewerAgent).
  4. Config embebida en el NOMBRE del ejecutable:
     `viewer-setup.<base64url({"s":serverUrl,"t":token})>.exe`
     (así el instalador que se descarga del panel ya trae dentro la URL y el
     token, sin ficheros sueltos).
"""
from __future__ import annotations

import base64
import json
import os
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

# Nombre del producto visible para el usuario.
PRODUCT_NAME = "viewer Agent"
# Nombre sin espacios para carpetas / tarea / servicio.
APP_ID = "ViewerAgent"
APP_NAME = APP_ID  # compat: carpeta de instalación
SETUP_PREFIX = "viewer-setup."


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def exe_path() -> Path:
    return Path(sys.executable if is_frozen() else __file__).resolve()


def portable_dir() -> Path:
    """Carpeta 'junto al ejecutable' (modo portable / desarrollo)."""
    if is_frozen():
        return exe_path().parent
    return Path(__file__).resolve().parent.parent


def install_dir() -> Path:
    """Carpeta de instalación para todos los usuarios del equipo."""
    if sys.platform.startswith("win"):
        root = os.environ.get("ProgramData", r"C:\ProgramData")
        return Path(root) / APP_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    return Path(
        os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))
    ) / APP_NAME.lower()


def _running_installed() -> bool:
    """True si el ejecutable actual vive dentro de la carpeta de instalación."""
    try:
        return is_frozen() and install_dir() in exe_path().parents
    except Exception:
        return False


# Carpeta donde se guardan estado, buffer y log.
DATA_DIR = install_dir() if _running_installed() else portable_dir()
try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    DATA_DIR = portable_dir()

CONFIG_PATH = DATA_DIR / "config.json"
STATE_PATH = DATA_DIR / "state.json"
BUFFER_PATH = DATA_DIR / "buffer.sqlite3"
LOG_PATH = DATA_DIR / "vigia-agent.log"

# Config remota por defecto (hasta que el servidor manda la suya).
DEFAULT_REMOTE = {
    "screenshotIntervalSec": 30,
    "activityFlushSec": 30,
    "liveFps": 4,
    "jpegQuality": 55,
    "maxImageEdgePx": 1600,
    "textCapture": False,
    "idleThresholdSec": 60,
    "rulesVersion": 1,
    "paused": False,
}


@dataclass
class LocalConfig:
    server_url: str
    enroll_token: str = ""
    verify_tls: bool = True

    @property
    def base_url(self) -> str:
        return self.server_url.rstrip("/")

    def to_json(self) -> str:
        return json.dumps(
            {"serverUrl": self.server_url, "enrollToken": self.enroll_token,
             "verifyTls": self.verify_tls},
            indent=2,
        )


def _from_mapping(raw: dict) -> LocalConfig | None:
    url = str(raw.get("serverUrl", "")).strip()
    if not url:
        return None
    return LocalConfig(
        server_url=url,
        enroll_token=str(raw.get("enrollToken", "")).strip(),
        verify_tls=bool(raw.get("verifyTls", True)),
    )


def config_from_exe_name(path: Path | None = None) -> LocalConfig | None:
    """Decodifica la config embebida en `vigia-setup.<base64url>.exe`."""
    name = (path or exe_path()).name
    low = name.lower()
    if not low.startswith(SETUP_PREFIX):
        return None
    token = name[len(SETUP_PREFIX):]
    for suffix in (".exe", ".bin", ""):
        if token.lower().endswith(suffix) and suffix:
            token = token[: -len(suffix)]
            break
    token = token.strip().strip(".")
    if not token:
        return None
    try:
        pad = "=" * (-len(token) % 4)
        data = base64.urlsafe_b64decode(token + pad)
        raw = json.loads(data.decode("utf-8"))
    except Exception:
        return None
    # claves cortas {s,t,v} o largas
    return _from_mapping({
        "serverUrl": raw.get("s") or raw.get("serverUrl", ""),
        "enrollToken": raw.get("t") or raw.get("enrollToken", ""),
        "verifyTls": raw.get("v", raw.get("verifyTls", True)),
    })


def find_local_config(explicit_path: str | None = None) -> tuple[LocalConfig | None, str]:
    """Devuelve (config, origen)."""
    if explicit_path:
        p = Path(explicit_path)
        if p.exists():
            cfg = _from_mapping(json.loads(p.read_text(encoding="utf-8")))
            if cfg:
                return cfg, f"--config {p}"
    for folder in (portable_dir(), install_dir()):
        p = folder / "config.json"
        if p.exists():
            try:
                cfg = _from_mapping(json.loads(p.read_text(encoding="utf-8")))
                if cfg:
                    return cfg, str(p)
            except Exception:
                pass
    cfg = config_from_exe_name()
    if cfg:
        return cfg, "nombre del ejecutable"
    return None, ""


def load_local_config(explicit_path: str | None = None) -> LocalConfig:
    cfg, origin = find_local_config(explicit_path)
    if not cfg:
        raise SystemExit(
            "No se encontró configuración. Descarga el instalador desde el panel "
            "(sección «Descargar cliente») o crea un config.json con serverUrl y "
            "enrollToken junto al programa."
        )
    return cfg


@dataclass
class State:
    device_id: str = ""
    device_secret: str = ""
    consent_accepted_at: str = ""
    remote: dict = field(default_factory=lambda: dict(DEFAULT_REMOTE))

    @classmethod
    def load(cls) -> "State":
        if STATE_PATH.exists():
            try:
                data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
                st = cls()
                st.device_id = data.get("device_id", "")
                st.device_secret = data.get("device_secret", "")
                st.consent_accepted_at = data.get("consent_accepted_at", "")
                st.remote = {**DEFAULT_REMOTE, **(data.get("remote") or {})}
                return st
            except Exception:
                pass
        return cls()

    def save(self) -> None:
        tmp = STATE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        os.replace(tmp, STATE_PATH)

    @property
    def enrolled(self) -> bool:
        return bool(self.device_id and self.device_secret)

    @property
    def consented(self) -> bool:
        return bool(self.consent_accepted_at)
