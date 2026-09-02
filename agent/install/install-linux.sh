#!/usr/bin/env bash
# Instalador del agente Vigía para Linux (X11).
# Crea un servicio de usuario systemd que arranca con la sesión.
# No oculta el proceso: se llama "vigia-agent" y muestra icono de bandeja.
set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$AGENT_DIR"

if [ ! -f config.json ]; then
  echo "Falta config.json. Copia config.example.json a config.json y rellénalo." >&2
  exit 1
fi

command -v python3 >/dev/null || { echo "Instala Python 3.10+"; exit 1; }
if ! command -v xdotool >/dev/null && ! command -v xprop >/dev/null; then
  echo "Aviso: instala 'xdotool' (o 'x11-utils') para detectar la ventana activa." >&2
fi

echo "Creando entorno virtual..."
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/vigia-agent.service" <<EOF
[Unit]
Description=Agente de supervision Vigia
After=graphical-session.target

[Service]
Type=simple
WorkingDirectory=$AGENT_DIR
ExecStart=$AGENT_DIR/.venv/bin/python -m vigia_agent
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now vigia-agent.service
loginctl enable-linger "$USER" >/dev/null 2>&1 || true

echo "Instalado. Estado:  systemctl --user status vigia-agent.service"
