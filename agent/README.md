# Agente Vigía

Cliente de **monitorización declarada** que se instala en los equipos
supervisados. Muestra un icono permanente en la bandeja del sistema y exige
aceptar el aviso de supervisión en el primer arranque. No incluye ninguna
técnica de ocultación ni de evasión.

## Qué registra

| Dato | Detalle |
|------|---------|
| Capturas de pantalla | JPEG cada `screenshotIntervalSec` (config del servidor), un fichero por monitor. |
| Aplicación / ventana activa | Nombre del proceso y título de la ventana, por intervalos. |
| Actividad de teclado | Pulsaciones por intervalo y teclas especiales. **El texto completo NO se registra** salvo que el servidor active `textCapture`. |
| Actividad de ratón | Clics y muestreo de movimiento. |
| Inactividad | Segundos sin actividad de teclado/ratón. |
| Vídeo en vivo | Solo mientras un administrador está mirando; esos fotogramas no se guardan. |

## Instalación en Windows (recomendada) — un solo .exe, sin Python

1. En el panel: **Descargar cliente → Windows · instalador todo-en-uno**, pon
   una etiqueta y descarga el `.exe`.
2. Cópialo al equipo y ábrelo (doble clic).
3. Windows pide permiso de administrador (UAC) → **Sí**.
4. El programa se copia a `C:\ProgramData\Vigia\`, se registra como tarea
   programada que arranca con la sesión, y queda en ejecución. La persona ve el
   aviso de supervisión y el icono de bandeja.

La URL del servidor y el token de alta van **embebidos en el nombre del
fichero** (`vigia-setup.<...>.exe`); no hace falta ningún fichero de
configuración aparte. No renombres el `.exe` antes de ejecutarlo.

**Desinstalar:** `"C:\ProgramData\Vigia\vigia-agent.exe" --uninstall`
(o desde «Programas y características»).

## Instalación en Linux / macOS (con Python)

```bash
cp config.example.json config.json      # pon serverUrl y enrollToken
bash install/install-linux.sh           # crea servicio de usuario systemd
bash install/install-macos.sh           # crea un LaunchAgent
```

Requisitos por sistema:

- **Windows 10/11**: nada (el `.exe` es autónomo). Solo para *compilarlo* hace
  falta Python 3.10+.
- **Linux (X11)**: Python 3.10+ y `xdotool` (o `x11-utils`) para la ventana
  activa. En Wayland la detección de ventana es limitada.
- **macOS**: Python 3.10+. Conceder **Grabación de pantalla** y **Accesibilidad**
  a la app que ejecuta el agente.

## Compilar los ejecutables

En una máquina de cada sistema operativo objetivo (PyInstaller no compila
cruzado). **Usa el Python del entorno virtual** donde instalaste las
dependencias — `build.py` empaqueta con ese mismo intérprete:

```bash
python -m venv .venv
.venv\Scripts\python -m pip install pyinstaller -r requirements.txt   # Windows
.venv\Scripts\python build\build.py                                    # Windows
# Linux/macOS:
#   .venv/bin/python -m pip install pyinstaller -r requirements.txt
#   .venv/bin/python build/build.py
```

Resultado en `agent/dist/`:

| SO | Fichero | Notas |
|----|---------|-------|
| Windows | `vigia-agent-windows.exe` | ~22 MB; es a la vez instalador y agente. Corre de-elevado; solo la instalación pide UAC |
| Linux | `vigia-agent-linux` | |
| macOS | `vigia-agent-macos` | |

Copia el resultado a la carpeta `agent/dist/` que el servidor tiene montada
(`../agent` → `/agent` en Docker) y aparecerá en «Descargar cliente». El
instalador de Windows del panel sirve ese mismo `.exe` renombrado con la config
embebida.

## Ficheros que crea junto al agente

| Fichero | Contenido |
|---------|-----------|
| `state.json` | credenciales del equipo y última config recibida |
| `buffer.sqlite3` | cola de envíos pendientes (tolerancia a cortes) |
| `vigia-agent.log` | registro de actividad del propio agente |

## Desinstalar

- Windows: `schtasks /Delete /TN VigiaAgent /F` y borra la carpeta.
- Linux: `systemctl --user disable --now vigia-agent.service` y borra la carpeta.
- macOS: `launchctl unload ~/Library/LaunchAgents/local.vigia.agent.plist` y borra la carpeta.

Desde el panel, deshabilita el equipo para que el servidor rechace su conexión.
