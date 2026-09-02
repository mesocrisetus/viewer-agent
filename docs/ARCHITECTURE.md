# Arquitectura

```
┌──────────────────────────┐        HTTPS / WSS         ┌───────────────────────────────┐
│  Agente (equipo usuario)  │ ────────────────────────▶ │  Servidor (Ubuntu, Docker)     │
│                          │  /agent/enroll            │                               │
│  · captura de pantalla    │  /agent/screenshots (REST)│  Fastify (TypeScript)          │
│  · app/ventana activa     │  /agent/activity   (REST) │   ├─ rutas /agent/*  (ingesta) │
│  · actividad teclado/ratón│  /agent/keyboard   (REST) │   ├─ rutas /api/*    (panel)   │
│  · icono de bandeja       │  /agent/ws  (control+live)│   ├─ WS /agent/ws  (control)   │
│  · buffer local (SQLite)  │                           │   └─ WS /ws/live   (panel)     │
└──────────────────────────┘                           │                               │
                                                       │  Prisma ─▶ PostgreSQL          │
┌──────────────────────────┐        HTTPS / WSS         │  Disco   ─▶ /data/screenshots  │
│  Panel (navegador admin)  │ ────────────────────────▶ │  node-cron ─▶ retención        │
│  React + Vite             │  /api/*  y  /ws/live      │                               │
└──────────────────────────┘                           └───────────────────────────────┘
```

## Flujo de vídeo en vivo

1. El admin abre la vista de un equipo → el panel manda `{type:"subscribe",deviceId}`
   por `/ws/live`.
2. El servidor cuenta suscriptores por equipo. Al pasar de 0 a 1 manda
   `live_start` al agente por `/agent/ws` (si el agente está conectado).
3. El agente captura a `liveFps` y envía `{type:"frame", jpegB64}` por su WS.
4. El servidor reenvía cada fotograma a todos los suscriptores de ese equipo.
5. Al bajar a 0 suscriptores → `live_stop` al agente.

Los fotogramas del directo **no se guardan**; la grabación consultable son las
capturas periódicas (`screenshotIntervalSec`).

## Modelo de datos (Prisma)

- **Admin** — cuentas del panel. `role`: `admin` | `viewer`.
- **Team** — agrupación de equipos.
- **EnrollToken** — token de alta de un solo uso, opcionalmente ligado a un
  `Team` y con caducidad.
- **Device** — un equipo supervisado. `status` derivado de `lastSeenAt`.
  `consentAcceptedAt` registra la aceptación del aviso.
- **Screenshot** — metadatos de cada captura; el binario va a disco en
  `/data/screenshots/<deviceId>/<YYYY-MM-DD>/<epoch>_<monitor>.jpg` con
  miniatura `..._thumb.jpg`.
- **ActivitySample** — intervalo con una app/ventana activa y contadores de
  teclado/ratón. La categoría de productividad se calcula al ingerir aplicando
  las `ProductivityRule`.
- **KeyboardEvent** — `kind` `activity` (métrica) o `text` (contenido, solo si
  `textCapture`).
- **ProductivityRule** — `matchType` `app` | `domain` | `title_regex`,
  `pattern`, `category` `productive` | `unproductive` | `neutral`, `priority`.
- **Alert** — `type` `agent_offline` | `forbidden_app`, con `acknowledgedAt`.
- **Setting** — clave/valor; fuente del objeto `config` y de la retención.

## Clasificación de productividad

Al recibir un `ActivitySample` el servidor evalúa las reglas por `priority`
descendente:

1. `title_regex` — regex (sin distinción de mayúsculas) sobre `windowTitle`.
2. `domain` — coincidencia de sufijo sobre `url` (host).
3. `app` — igualdad (normalizada) sobre `appName`.

La primera que casa fija la categoría. Si ninguna casa → `neutral`. Al editar
reglas se incrementa `Setting.rulesVersion` y se puede lanzar una
reclasificación de las muestras del día en curso.

## Retención

`node-cron` cada hora:

- borra `Screenshot` (y sus ficheros + miniaturas) con `capturedAt < now - retentionDays`.
- borra `ActivitySample` y `KeyboardEvent` con la misma antigüedad.
- borra `Alert` resueltas de más de 90 días.

`retentionDays` sale de `Setting` (por defecto 30). El rango es configurable
desde el panel; bajarlo aplica en la siguiente pasada.

## Seguridad (estado del MVP)

Implementado:

- Contraseñas de admin con `bcrypt`.
- Sesión del panel por JWT (cabecera `Authorization: Bearer`), expiración 12 h.
- Secreto de dispositivo aleatorio por equipo, verificado en cada petición.
- El agente no recibe nunca credenciales del panel ni claves de terceros.
- CORS restringido al origen del panel.
- Límite de tamaño de subida y de nº de ficheros por lote.

Trabajo restante antes de producción:

- Rotación del `deviceSecret` y firma HMAC del cuerpo de las peticiones del
  agente.
- Rate limiting por dispositivo e IP.
- Cifrado en reposo del volumen de capturas (LUKS o cifrado a nivel de app).
- 2FA para administradores.
- Auditoría de accesos del panel (quién ha visto qué equipo y cuándo).
- Firma del binario del agente por plataforma.
- Registro de reclasificación masiva como trabajo en segundo plano con cola.
