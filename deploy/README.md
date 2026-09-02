# Despliegue en Ubuntu

## Requisitos

- Ubuntu 22.04 / 24.04 con **Docker** y **Docker Compose v2**.
- Un dominio apuntando al servidor (p. ej. `vigia.miempresa.com`) para poder
  poner HTTPS.

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER && newgrp docker
```

## Puesta en marcha

```bash
cd vigia/deploy
cp .env.example .env
nano .env          # ajusta claves, dominio y correo del admin

docker compose up -d --build
```

Esto levanta tres servicios:

| Servicio | Qué hace |
|----------|----------|
| `db`     | PostgreSQL 16 con volumen persistente `db-data` |
| `server` | API + relay de vídeo + retención. Aplica migraciones y crea el admin inicial al arrancar |
| `nginx`  | Sirve el panel compilado y hace de proxy inverso (`/api`, `/agent`, `/ws`, `/download`) |

### Puerto de acceso

Nginx publica en el puerto **`HTTP_PORT`** de `.env` (por defecto **`8471`**, poco
común para no chocar con Apache/nginx/IIS que ya usen el 80). Todo — panel,
API y agentes — pasa por ese único puerto.

- **Ábrelo en el firewall del servidor** (entrante, TCP). Con `ufw`:
  `sudo ufw allow 8471/tcp`  (`autoinstall.sh` lo hace solo si `ufw` está activo).
- Si hay router/NAT delante, **redirige** ese puerto a la máquina.
- `PANEL_ORIGIN` debe incluir el puerto: `http://tu-dominio-o-ip:8471`.

El panel queda en `http://TU_DOMINIO:8471/`. Entra con el correo y la contraseña
de `SEED_ADMIN_*` y **cámbiala** (Usuarios del panel → crea otra cuenta y borra
la de arranque, o cambia su contraseña).

## Almacenamiento de grabaciones

Las capturas se guardan en `vigia/deploy/data/` **en el host** (montado como
`/data` en el contenedor). No están dentro de ninguna imagen: sobreviven a
`docker compose up --build` y a cualquier actualización. Haz copia de seguridad
de esa carpeta y del volumen `db-data`.

Estimación de espacio: con captura cada 30 s, ~40 KB por imagen y un monitor,
un equipo genera ~115 MB/día ≈ 3,5 GB/mes. Para 100 equipos y 30 días de
retención, reserva ~350 GB. Ajusta `screenshotIntervalSec`, `jpegQuality` y
`retentionDays` en Ajustes según tu disco.

## HTTPS

Opción sencilla: pon un [Caddy](https://caddyserver.com/) o Traefik delante del
servicio `nginx` y deja que gestione los certificados. Opción manual: monta tus
certificados en `nginx` (ver comentario en `docker-compose.yml`) y añade el
bloque `listen 443 ssl` en `nginx.conf`.

Recuerda apuntar `PANEL_ORIGIN` (en `.env`) al `https://` real, o el panel no
podrá llamar a la API por CORS.

## Servidor con IP pública (agentes dentro y fuera de la empresa)

Los agentes se conectan siempre a **una sola URL** y se reconectan solos con
reintento exponencial, así que un portátil que sale de la oficina sigue
funcionando en cuanto recupera acceso a esa URL. Para que funcione dentro y
fuera:

1. **Usa un dominio público** (p. ej. `vigia.tuempresa.com`) que resuelva a la
   IP pública del servidor, y ábrelo también desde la red interna (si tu router
   no hace *hairpin NAT*, añade una entrada de DNS interno con la IP local).
2. **Abre el puerto** `HTTP_PORT` (por defecto 8471) del servidor hacia Internet
   —y el 443 si pones HTTPS delante—. El WebSocket de
   control y de vídeo va por el mismo 443 (`/agent/`), no hace falta abrir nada
   más.
3. **HTTPS obligatorio de facto**: el agente envía capturas de pantalla; no lo
   expongas a Internet en HTTP plano. Pon Caddy delante (2 líneas de config) o
   un certificado en `nginx`.
4. **`PANEL_ORIGIN`** en `.env` = la URL pública (`https://vigia.tuempresa.com`).
5. **Genera los instaladores abriendo el panel por la URL pública.** El
   instalador de Windows y el `config.json` graban dentro *la dirección con la
   que abriste el panel* (cabecera `Host` / `X-Forwarded-*`). Si lo generas
   desde `http://localhost` los agentes solo funcionarán en esa máquina.
6. Opcional pero recomendable: restringe el acceso al **panel** (`/`, `/api/`,
   `/ws/`) por lista de IP o VPN en `nginx.conf`, y deja abierto solo `/agent/`
   a Internet.

## Actualizar

```bash
git pull            # o copia la nueva versión del código
docker compose up -d --build
```

Las migraciones nuevas se aplican solas al arrancar `server`.

## Binarios del agente en la página de descargas

Compila el agente en cada sistema (ver `agent/README.md`) y copia los
ejecutables a `vigia/agent/dist/`. El servicio `server` monta `../agent` en
`/agent` y la página **Descargar cliente** del panel los listará.

## Servicio sin Docker (alternativa)

Si prefieres systemd nativo: instala Node 20 y PostgreSQL, en `server/` haz
`npm ci && npx prisma migrate deploy && npm run build && npm run seed`, y crea
una unidad que ejecute `node dist/index.js` con las variables de entorno de
`.env`. Sirve `panel/dist` con el Nginx del sistema usando `deploy/nginx.conf`
como base (cambiando `proxy_pass` a `http://127.0.0.1:8080`).
