"""Empaqueta el agente como ejecutable con PyInstaller.

Ejecutar en CADA sistema operativo objetivo (PyInstaller no compila cruzado):

    pip install pyinstaller -r requirements.txt
    python build/build.py

IMPORTANTE: se ejecuta con el mismo intérprete que corre este script, así que
lánzalo con el Python del venv donde instalaste requirements.txt:

    .venv/Scripts/python build/build.py     (Windows)
    .venv/bin/python build/build.py          (Linux/macOS)

Resultado en agent/dist/:
  · Windows: vigia-agent-windows.exe  (es a la vez el instalador -si se renombra
    a vigia-setup.<...>.exe- y el propio agente; la instalación se auto-eleva)
  · Linux:   vigia-agent-linux
  · macOS:   vigia-agent-macos

Copia el resultado a la carpeta agent/dist/ que el servidor tiene montada
(../agent -> /agent en Docker) para que el panel lo ofrezca en «Descargar
cliente».
"""
from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
NAME = "viewer-agent"
ICON = Path(__file__).resolve().parent / "icon.ico"

# Dependencias de terceros que se empaquetan completas (submódulos + datos +
# binarios + hidden-imports). --collect-all es contundente pero elimina los
# "ModuleNotFoundError" por análisis estático incompleto.
COLLECT_ALL = [
    "requests", "urllib3", "certifi", "charset_normalizer", "idna",
    "websocket", "mss", "pynput", "pystray", "psutil", "PIL",
]


def main() -> int:
    # PyInstaller DEBE ejecutarse con el MISMO intérprete que corre este script
    # (el del venv con las dependencias). Si se llama al 'pyinstaller' del PATH,
    # puede ser el de otra instalación de Python sin requests/mss/... y entonces
    # --collect-all no encuentra nada -> "No module named 'requests'" en el .exe.
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print(f"PyInstaller no está en este intérprete ({sys.executable}).")
        print("Instálalo aquí:  " + sys.executable + " -m pip install pyinstaller -r requirements.txt")
        return 1

    missing = []
    for mod in ("requests", "mss", "pynput", "pystray", "psutil", "websocket", "PIL"):
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    if missing:
        print(f"Faltan dependencias en {sys.executable}: {', '.join(missing)}")
        print("Instálalas:  " + sys.executable + " -m pip install -r requirements.txt")
        return 1

    sysname = platform.system().lower()
    args = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--name", NAME,
        "--onefile",
        "--paths", str(ROOT),
        "--collect-submodules", "vigia_agent",
    ]
    if ICON.exists():
        args += ["--icon", str(ICON)]
    for pkg in COLLECT_ALL:
        args += ["--collect-all", pkg]

    if sysname == "windows":
        # --windowed: sin ventana de consola (el icono de bandeja sigue visible).
        # SIN --uac-admin a propósito: el .exe corre de-elevado y solo la fase de
        #   instalación se re-lanza con permisos (ShellExecute "runas"), usando
        #   código que toca únicamente stdlib. Bajo elevación, la carga de
        #   paquetes de terceros del bundle onefile puede fallar ("No module
        #   named 'requests'"), así que el agente completo nunca corre elevado.
        # Se excluye Tkinter/Tcl: el aviso de consentimiento usa MessageBox.
        args += [
            "--windowed",
            "--exclude-module", "tkinter",
            "--exclude-module", "_tkinter",
            "--exclude-module", "PIL.ImageTk",
        ]
    else:
        args += ["--hidden-import", "PIL._tkinter_finder"]

    args.append(str(ROOT / "pyi_entry.py"))

    print(">>", " ".join(args))
    rc = subprocess.call(args, cwd=str(ROOT))
    if rc != 0:
        return rc

    dist = ROOT / "dist"
    tag = {"windows": "windows", "darwin": "macos", "linux": "linux"}.get(sysname, sysname)
    src = dist / (f"{NAME}.exe" if sysname == "windows" else NAME)
    if not src.exists():
        cand = sorted(dist.glob(f"{NAME}*"))
        src = cand[0] if cand else None
    if src and src.exists():
        target = dist / f"{NAME}-{tag}{src.suffix}"
        if src.resolve() != target.resolve():
            if target.exists():
                target.unlink()
            src.rename(target)
        print(f"Listo: {target}  ({target.stat().st_size // (1024*1024)} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
