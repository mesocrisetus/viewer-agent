"""Punto de entrada.

Uso normal (con Python):   python -m vigia_agent
Ejecutable descargado:     doble clic en vigia-setup.<...>.exe  -> se autoinstala
Gestión (Windows):         viewer-agent.exe --install | --uninstall

IMPORTANTE: este módulo NO importa el agente (ni requests/mss/pynput...) en la
cabecera. Las rutas --install / --uninstall solo tocan stdlib + config +
installer_win, para que funcionen también con permisos de administrador (donde
la carga de paquetes de terceros del bundle de PyInstaller puede fallar).
"""
from __future__ import annotations

import argparse
import sys

from .config import SETUP_PREFIX, exe_path, is_frozen, load_local_config


def _looks_like_setup() -> bool:
    return is_frozen() and exe_path().name.lower().startswith(SETUP_PREFIX)


def _alert(text: str, error: bool = False) -> None:
    """Aviso visible. En Windows frozen (--windowed) no hay consola: MessageBox."""
    print(text)
    if sys.platform.startswith("win"):
        try:
            import ctypes

            icon = 0x10 if error else 0x40  # ICONERROR / ICONINFORMATION
            ctypes.windll.user32.MessageBoxW(None, text, "viewer Agent", icon | 0x40000)
        except Exception:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(prog="viewer-agent", add_help=True)
    parser.add_argument("--install", action="store_true", help="instala el agente (Windows)")
    parser.add_argument("--uninstall", action="store_true", help="desinstala el agente (Windows)")
    parser.add_argument("--config", metavar="RUTA", help="ruta a un config.json concreto")
    parser.add_argument("--run", action="store_true", help="fuerza ejecución (no instalar)")
    args = parser.parse_args()

    if args.uninstall:
        from .installer_win import uninstall
        return uninstall()

    # El .exe recién descargado (vigia-setup.*) se autoinstala al abrirlo.
    if args.install or (_looks_like_setup() and not args.run):
        from .installer_win import install
        return install(args.config)

    # --- ejecución del agente ---
    try:
        cfg = load_local_config(args.config)
    except SystemExit as e:
        # Sin configuración. Caso típico: han descargado el binario suelto en vez
        # del instalador del panel.
        if is_frozen():
            _alert(
                "Este archivo no es el instalador.\n\n"
                "Abre el panel, ve a «Descargar cliente» y pulsa el "
                "botón «Descargar instalador (.exe)». Ese fichero "
                "(viewer-setup-....exe) trae dentro la dirección del servidor y "
                "el código de alta, y se instala solo al abrirlo.",
                error=True,
            )
        else:
            print(str(e))
        return 2

    from .agent import Agent
    try:
        Agent(cfg).run()
    except SystemExit as e:
        # Mensajes controlados del agente: se muestran legibles, sin traceback.
        msg = str(e.code if isinstance(e.code, str) else e) or ""
        if msg.startswith("TOKEN_USADO:"):
            _alert(msg[len("TOKEN_USADO:"):].strip(), error=True)
        elif msg.startswith("SIN_SERVIDOR:"):
            _alert(msg[len("SIN_SERVIDOR:"):].strip(), error=True)
        elif msg:
            _alert(msg, error=True)
        return 2
    except KeyboardInterrupt:
        return 0
    except Exception as e:  # nunca mostrar el diálogo crudo de PyInstaller
        import traceback

        try:
            from .config import LOG_PATH

            with open(LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write("\n--- ERROR NO CONTROLADO ---\n")
                traceback.print_exc(file=fh)
        except Exception:
            pass
        _alert(
            "El agente viewer Agent ha encontrado un problema y se cerrará.\n\n"
            f"{type(e).__name__}: {e}\n\n"
            "Si el problema persiste, reinstala desde el panel.",
            error=True,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
