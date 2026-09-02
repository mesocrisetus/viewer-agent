#!/usr/bin/env bash
# =============================================================================
#  viewer Agent · autoinstalador para Ubuntu
#  Levanta el servidor completo (PostgreSQL + API + panel) con Docker.
#
#  Uso:
#     sudo bash deploy/autoinstall.sh
#
#  Modo no interactivo (todo por variables de entorno):
#     sudo PUBLIC_URL=https://vigilancia.miempresa.com \
#          ADMIN_EMAIL=admin@miempresa.com ADMIN_PASS='ClaveFuerte123' \
#          bash deploy/autoinstall.sh --yes
# =============================================================================
set -euo pipefail

YES=0
[ "${1:-}" = "--yes" ] && YES=1

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ! \033[0m%s\n' "$*"; }
die()  { printf '\033[1;31m  x %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Ejecuta con sudo."

# --- localizar la raíz del proyecto (carpeta que contiene deploy/ y server/) ---
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
[ -f "$ROOT/deploy/docker-compose.yml" ] || die "No encuentro deploy/docker-compose.yml (¿ejecutas dentro del repo?)."
cd "$ROOT/deploy"

# --------------------------------------------------------------------------- #
say "1/5 · Docker"
if ! command -v docker >/dev/null 2>&1; then
  say "Instalando Docker..."
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  ok "Docker instalado"
else
  ok "Docker ya está ($(docker --version))"
fi
docker compose version >/dev/null 2>&1 || die "Falta el plugin 'docker compose'."

# --------------------------------------------------------------------------- #
say "2/5 · Configuración (.env)"
rand() { openssl rand -hex "${1:-24}"; }

if [ -f .env ] && [ "$YES" -eq 0 ]; then
  read -rp "  Ya existe deploy/.env. ¿Sobrescribir? [s/N] " a
  [ "${a,,}" = "s" ] || { ok "Se conserva el .env actual"; SKIP_ENV=1; }
fi

if [ "${SKIP_ENV:-0}" -ne 1 ]; then
  if [ "$YES" -eq 0 ]; then
    read -rp "  Dirección pública del panel (ej. https://vigilancia.miempresa.com o http://IP): " PUBLIC_URL
    read -rp "  Correo del administrador inicial: " ADMIN_EMAIL
    read -rsp "  Contraseña del administrador inicial: " ADMIN_PASS; echo
  fi
  PUBLIC_URL="${PUBLIC_URL:-http://localhost}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@viewer.local}"
  ADMIN_PASS="${ADMIN_PASS:-$(rand 8)}"
  DB_PASS="$(rand 24)"
  JWT="$(rand 32)"
  SERVER_NAME="$(printf '%s' "$PUBLIC_URL" | sed -E 's#^https?://##; s#/.*$##')"

  cat > .env <<EOF
# Generado por autoinstall.sh el $(date -Is)
POSTGRES_USER=viewer
POSTGRES_PASSWORD=$DB_PASS
POSTGRES_DB=viewer
DATABASE_URL=postgresql://viewer:$DB_PASS@db:5432/viewer?schema=public

PORT=8080
HOST=0.0.0.0
JWT_SECRET=$JWT
PANEL_ORIGIN=$PUBLIC_URL
DATA_DIR=/data
AGENT_DIST_DIR=/agent
MAX_UPLOAD_MB=8

SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_PASSWORD=$ADMIN_PASS

PANEL_SERVER_NAME=$SERVER_NAME
EOF
  chmod 600 .env
  ok ".env creado (PANEL_ORIGIN=$PUBLIC_URL)"
fi

# --------------------------------------------------------------------------- #
say "3/5 · Construir y levantar"
docker compose up -d --build
ok "Contenedores arrancados"

# --------------------------------------------------------------------------- #
say "4/5 · Esperar a que el servidor responda"
URL_LOCAL="http://localhost:${HTTP_PORT:-80}/health"
for i in $(seq 1 60); do
  if curl -fsS "$URL_LOCAL" >/dev/null 2>&1; then ok "Servidor sano"; HEALTHY=1; break; fi
  sleep 2
done
[ "${HEALTHY:-0}" -eq 1 ] || warn "El servidor aún no responde; revisa 'docker compose logs -f server'."

# --------------------------------------------------------------------------- #
say "5/5 · Listo"
ADMIN_EMAIL="$(grep -E '^SEED_ADMIN_EMAIL=' .env | cut -d= -f2-)"
PANEL_ORIGIN="$(grep -E '^PANEL_ORIGIN=' .env | cut -d= -f2-)"
cat <<EOF

  ────────────────────────────────────────────────────────────
   Panel:     $PANEL_ORIGIN
   Usuario:   $ADMIN_EMAIL
   Contraseña: (la que introdujiste / está en deploy/.env)
  ────────────────────────────────────────────────────────────

  Siguientes pasos:
   · Abre el panel y cambia la contraseña del administrador.
   · Ajustes → «Dirección pública del servidor»: confírmala si tus
     equipos se conectan desde fuera de la empresa.
   · Descargar cliente → «Descargar instalador (.exe)» para Windows.

  HTTPS: pon un proxy TLS delante (Caddy / Traefik) o monta un
  certificado en el servicio nginx (ver deploy/README.md).

  Gestión:
   docker compose -f "$ROOT/deploy/docker-compose.yml" ps
   docker compose -f "$ROOT/deploy/docker-compose.yml" logs -f server
   docker compose -f "$ROOT/deploy/docker-compose.yml" restart
EOF
