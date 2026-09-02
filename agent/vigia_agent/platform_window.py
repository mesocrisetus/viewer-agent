"""Detección de la aplicación y ventana activa por sistema operativo.

Sin dependencias nativas pesadas:
  - Windows: ctypes + user32/psutil.
  - macOS: osascript (AppleScript).
  - Linux (X11): xdotool / xprop si están instalados.
"""
from __future__ import annotations

import platform
import re
import shutil
import subprocess
from dataclasses import dataclass

SYSTEM = platform.system().lower()

_BROWSERS = {"chrome", "firefox", "msedge", "edge", "safari", "brave", "opera", "chromium", "vivaldi"}
_DOMAIN_RE = re.compile(r"\b([a-z0-9-]+\.)+[a-z]{2,}\b", re.I)


@dataclass
class ActiveWindow:
    app_name: str = ""
    window_title: str = ""
    url: str = ""


def _run(cmd: list[str], timeout: float = 1.5) -> str:
    try:
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, check=False
        )
        return (out.stdout or "").strip()
    except Exception:
        return ""


# ---------------- Windows ----------------
def _active_windows() -> ActiveWindow:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return ActiveWindow()

    length = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    title = buf.value or ""

    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    app = ""
    try:
        import psutil

        app = psutil.Process(pid.value).name()
    except Exception:
        app = ""
    return ActiveWindow(app_name=app, window_title=title, url=_guess_url(app, title))


# ---------------- macOS ----------------
_MAC_SCRIPT = (
    'tell application "System Events"\n'
    ' set frontApp to name of first application process whose frontmost is true\n'
    "end tell\n"
    "set winTitle to \"\"\n"
    "try\n"
    ' tell application "System Events" to tell process frontApp\n'
    "  set winTitle to name of front window\n"
    " end tell\n"
    "end try\n"
    'return frontApp & "||" & winTitle'
)


def _active_macos() -> ActiveWindow:
    out = _run(["osascript", "-e", _MAC_SCRIPT], timeout=2.0)
    if "||" not in out:
        return ActiveWindow()
    app, title = out.split("||", 1)
    app = app.strip()
    title = title.strip()
    return ActiveWindow(app_name=app, window_title=title, url=_guess_url(app, title))


# ---------------- Linux (X11) ----------------
def _active_linux() -> ActiveWindow:
    if shutil.which("xdotool"):
        wid = _run(["xdotool", "getactivewindow"])
        if wid:
            title = _run(["xdotool", "getwindowname", wid])
            pid = _run(["xdotool", "getwindowpid", wid])
            app = ""
            if pid:
                try:
                    import psutil

                    app = psutil.Process(int(pid)).name()
                except Exception:
                    app = ""
            if not app:
                cls = _run(["xdotool", "getwindowclassname", wid])
                app = cls or ""
            return ActiveWindow(app_name=app, window_title=title, url=_guess_url(app, title))
    if shutil.which("xprop"):
        root = _run(["xprop", "-root", "_NET_ACTIVE_WINDOW"])
        m = re.search(r"0x[0-9a-f]+", root)
        if m:
            info = _run(["xprop", "-id", m.group(0), "WM_NAME", "WM_CLASS"])
            title_m = re.search(r'WM_NAME\(\w+\) = "(.*)"', info)
            class_m = re.search(r'WM_CLASS\(\w+\) = ".*?", "(.*?)"', info)
            return ActiveWindow(
                app_name=(class_m.group(1) if class_m else ""),
                window_title=(title_m.group(1) if title_m else ""),
                url="",
            )
    return ActiveWindow()


def _guess_url(app: str, title: str) -> str:
    """Heurística: si es un navegador, intenta sacar un dominio del título.

    Los navegadores rara vez muestran la URL completa en el título, así que
    esto acierta solo cuando el sitio aparece por nombre. Es 'mejor esfuerzo';
    las reglas por título cubren el resto.
    """
    base = (app or "").lower().replace(".exe", "")
    if not any(b in base for b in _BROWSERS):
        return ""
    m = _DOMAIN_RE.search(title or "")
    return m.group(0).lower() if m else ""


def get_active_window() -> ActiveWindow:
    try:
        if SYSTEM.startswith("win"):
            return _active_windows()
        if SYSTEM == "darwin":
            return _active_macos()
        return _active_linux()
    except Exception:
        return ActiveWindow()
