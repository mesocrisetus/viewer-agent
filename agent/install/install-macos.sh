#!/usr/bin/env bash
# Instalador del agente Vigía para macOS.
# Crea un LaunchAgent que arranca con la sesión del usuario.
#
# macOS pedirá conceder permisos a la app que ejecute el agente (normalmente
# Terminal o el Python empaquetado):
#   - Preferencias > Privacidad y seguridad > Grabación de pantalla
#   - Preferencias > Privacidad y seguridad > Accesibilidad  (para la ventana activa)
# El agente no funciona hasta que se concedan.
set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$AGENT_DIR"

if [ ! -f config.json ]; then
  echo "Falta config.json. Copia config.example.json a config.json y rellénalo." >&2
  exit 1
fi

command -v python3 >/dev/null || { echo "Instala Python 3.10+ (brew install python)"; exit 1; }

echo "Creando entorno virtual..."
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt

PLIST="$HOME/Library/LaunchAgents/local.vigia.agent.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.vigia.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$AGENT_DIR/.venv/bin/python</string>
    <string>-m</string>
    <string>vigia_agent</string>
  </array>
  <key>WorkingDirectory</key><string>$AGENT_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$AGENT_DIR/vigia-agent.err.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"

echo "Instalado. Concede los permisos de Grabación de pantalla y Accesibilidad si se solicitan."
