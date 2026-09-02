"""Icono permanente en la bandeja del sistema + pantalla de consentimiento.

Requisito de diseño (ver docs/COMPLIANCE.md): el usuario debe poder ver en todo
momento que el equipo está supervisado. No elimines el icono ni la pantalla de
aviso.

El aviso de consentimiento usa:
  - Windows: MessageBox nativo (user32) — sin dependencias, robusto en el .exe.
  - Linux/macOS: Tkinter si está; si no, consola.
"""
from __future__ import annotations

import sys
import threading

from PIL import Image, ImageDraw

try:
    import pystray
    _HAS_TRAY = True
except Exception:  # pragma: no cover
    _HAS_TRAY = False

IS_WINDOWS = sys.platform.startswith("win")


def _icon_image() -> Image.Image:
    img = Image.new("RGB", (64, 64), "#12314f")
    d = ImageDraw.Draw(img)
    d.ellipse((14, 14, 50, 50), outline="#e8f0fb", width=4)
    d.ellipse((27, 27, 37, 37), fill="#e8f0fb")
    return img


CONSENT_FALLBACK = (
    "Este equipo pertenece a la empresa y su actividad está supervisada: "
    "capturas de pantalla periódicas, aplicación y ventana en uso, y actividad "
    "de teclado y ratón. Los datos se conservan un tiempo limitado y solo el "
    "personal autorizado puede consultarlos."
)


class Tray:
    def __init__(self, status_text_getter, on_quit=None):
        self._get_status = status_text_getter
        self._on_quit = on_quit
        self._icon = None
        self._thread = None

    def _menu(self):
        return pystray.Menu(
            pystray.MenuItem(lambda item: self._get_status(), None, enabled=False),
            pystray.MenuItem("Este equipo está supervisado por la empresa", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Ver aviso de supervisión", self._show_notice),
        )

    def _show_notice(self, *_):
        show_consent_dialog("Aviso de supervisión", CONSENT_FALLBACK, require_accept=False)

    def start(self):
        if not _HAS_TRAY:
            return
        self._icon = pystray.Icon("vigia", _icon_image(), "viewer Agent · supervisión activa", self._menu())
        self._thread = threading.Thread(target=self._icon.run, name="vigia-tray", daemon=True)
        self._thread.start()

    def update_tooltip(self, text: str):
        if self._icon:
            self._icon.title = f"viewer Agent · {text}"

    def stop(self):
        try:
            if self._icon:
                self._icon.stop()
        except Exception:
            pass


# --------------------------------------------------------------------------- #
#  Diálogo de consentimiento
# --------------------------------------------------------------------------- #
def _consent_windows(title: str, body: str, require_accept: bool) -> bool:
    import ctypes

    MB_OK = 0x0
    MB_YESNO = 0x4
    MB_ICONWARNING = 0x30
    MB_ICONINFORMATION = 0x40
    MB_DEFBUTTON2 = 0x100
    MB_SYSTEMMODAL = 0x1000
    MB_SETFOREGROUND = 0x10000
    MB_TOPMOST = 0x40000
    IDYES = 6

    if require_accept:
        flags = MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2
        text = (
            body
            + "\n\n¿Confirmas que has sido informado de esta supervisión?\n"
            "  •  Sí  = acepto y el equipo continúa supervisado.\n"
            "  •  No  = el agente se cerrará y no enviará datos."
        )
    else:
        flags = MB_OK | MB_ICONINFORMATION
        text = body
    flags |= MB_SYSTEMMODAL | MB_SETFOREGROUND | MB_TOPMOST

    res = ctypes.windll.user32.MessageBoxW(None, text, title, flags)
    return (res == IDYES) if require_accept else True


def _consent_tk(title: str, body: str, require_accept: bool) -> bool:
    import tkinter as tk
    from tkinter import ttk

    result = {"ok": not require_accept}
    root = tk.Tk()
    root.title(title)
    root.resizable(False, False)
    try:
        root.attributes("-topmost", True)
    except Exception:
        pass

    frm = ttk.Frame(root, padding=20)
    frm.grid()
    ttk.Label(frm, text=title, font=("", 13, "bold")).grid(sticky="w")
    tk.Message(frm, text=body, width=460, justify="left").grid(pady=(10, 16), sticky="w")

    btns = ttk.Frame(frm)
    btns.grid(sticky="e")

    def accept():
        result["ok"] = True
        root.destroy()

    def decline():
        result["ok"] = False
        root.destroy()

    if require_accept:
        ttk.Button(btns, text="No acepto", command=decline).grid(row=0, column=0, padx=6)
        ttk.Button(btns, text="Acepto y continúo", command=accept).grid(row=0, column=1)
    else:
        ttk.Button(btns, text="Entendido", command=accept).grid(row=0, column=0)

    root.update_idletasks()
    w, h = root.winfo_width(), root.winfo_height()
    x = (root.winfo_screenwidth() - w) // 2
    y = (root.winfo_screenheight() - h) // 3
    root.geometry(f"+{x}+{y}")
    root.mainloop()
    return result["ok"]


def show_consent_dialog(title: str, body: str, require_accept: bool) -> bool:
    """Muestra el aviso. Devuelve True si se acepta (o si no se requiere aceptar)."""
    if IS_WINDOWS:
        try:
            return _consent_windows(title, body, require_accept)
        except Exception:
            pass
    else:
        try:
            return _consent_tk(title, body, require_accept)
        except Exception:
            pass

    # Último recurso: consola.
    print("\n=== " + title + " ===\n" + body + "\n")
    if require_accept:
        try:
            return input("Escribe ACEPTO para continuar: ").strip().upper() == "ACEPTO"
        except Exception:
            return False
    return True
