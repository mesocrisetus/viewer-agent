# viewer Agent

Plataforma interna de monitorización de puestos de trabajo. Réplica funcional de
las capacidades principales de Kickidler, para desplegar en un servidor Ubuntu
propio.

> **Monitorización declarada.** El agente muestra un icono permanente en la
> bandeja del sistema y exige aceptar un aviso de supervisión en el primer
> arranque. No incluye ocultación de procesos, evasión de antivirus ni ninguna
> técnica para que la persona supervisada no sepa que está activo. Antes de
> desplegarlo lee [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md).

## Componentes

| Carpeta    | Qué es | Stack |
|------------|--------|-------|
| `server/`  | API de ingesta + API del panel + relay de vídeo en vivo + trabajos de retención | Node.js 20+, TypeScript, Fastify, Prisma, PostgreSQL |
| `panel/`   | Panel web de administración (pantallas en vivo, reproducción, reglas de productividad, informes, usuarios, descargas) | React 18, Vite, TypeScript |
| `agent/`   | Cliente que se instala en los equipos supervisados | Python 3.10+, `mss`+`pynput`+`pystray`, empaquetado con PyInstaller |
| `deploy/`  | `docker-compose`, `autoinstall.sh` para Ubuntu, plantillas `.env`, guía | Docker |
| `docs/`    | Arquitectura, protocolo agente-servidor, cumplimiento normativo | — |

## Despliegue en Ubuntu (una orden)

```bash
sudo bash deploy/autoinstall.sh
```

Instala Docker si falta, pregunta la dirección pública y el administrador
inicial, construye y levanta todo, y te da la URL del panel. Detalle y modo no
interactivo en [`deploy/README.md`](deploy/README.md).

## Cliente Windows

En el panel → **Descargar cliente → Descargar instalador (.exe)**. Un solo
fichero (`viewer-setup.….exe`, ~22 MB) que lleva dentro la dirección del
servidor y un código de alta **reutilizable**: sirve para todos los equipos y
para reinstalaciones. Doble clic → aviso de Windows (UAC) → Sí. Se instala en
`C:\ProgramData\ViewerAgent`, arranca con la sesión y añade sus propias
exclusiones en Windows Defender.

Para Kaspersky (no admite exclusiones por comando): ejecuta
[`agent/install/av-exclusions.ps1`](agent/install/av-exclusions.ps1) en el
equipo, o añade la carpeta y el proceso a la Zona de confianza por directiva de
Kaspersky Security Center.

### Compilar el ejecutable

En un equipo Windows con Python 3.10+, **usando el Python del entorno virtual**:

```bash
cd agent
python -m venv .venv
.venv\Scripts\python -m pip install pyinstaller -r requirements.txt
.venv\Scripts\python build\build.py
```

Copia `agent/dist/viewer-agent-windows.exe` a la carpeta `agent/dist/` del
servidor (montada como `/agent` en Docker) y aparecerá en «Descargar cliente».

## Roles del panel

| Rol | Puede |
|-----|-------|
| **Administrador** | Todo: equipos, reglas, ajustes, usuarios, descargas |
| **Solo lectura** | Ver pantallas en vivo, grabaciones, actividad, informes y alertas. No modifica nada |

Se gestionan en **Usuarios del panel** (solo administradores).

## Direcciones (local vs IP pública)

Los equipos que trabajan desde casa se conectan por la IP/dominio público del
servidor. En **Ajustes → «Dirección pública del servidor»** fija esa dirección;
los instaladores que generes la llevarán grabada. Si se deja vacío se usa la
dirección con la que abriste el panel.

## Documentación

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — arquitectura y trabajo restante
- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — protocolo agente ↔ servidor
- [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) — cumplimiento y despliegue responsable
- [`deploy/README.md`](deploy/README.md) — despliegue en Ubuntu, HTTPS, backups
