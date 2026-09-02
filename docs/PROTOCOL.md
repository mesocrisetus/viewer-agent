# Protocolo agente ↔ servidor

Todo el tráfico va sobre HTTPS / WSS en producción. Dos planos:

- **Plano de datos por lotes** (REST): capturas, muestras de actividad, eventos
  de teclado. Tolerante a cortes: el agente encola en local y reintenta.
- **Plano de control y vídeo en vivo** (WebSocket persistente `/agent/ws`):
  configuración en caliente, orden de empezar/parar el directo y los fotogramas
  del directo.

## Autenticación del agente

En el alta el agente recibe `deviceId` (UUID) y `deviceSecret` (aleatorio de 32
bytes en base64url). En cada petición REST envía:

```
X-Device-Id: <deviceId>
X-Device-Secret: <deviceSecret>
```

En el WebSocket, el primer mensaje tras conectar es `hello` con esos dos
valores. El servidor cierra la conexión con código 4001 si no cuadran.

`deviceSecret` no caduca en el MVP. Endurecimiento previsto: rotación y firma
HMAC del cuerpo (ver `ARCHITECTURE.md`).

## REST

### `POST /agent/enroll`

Sin autenticación de dispositivo; requiere un token de alta válido y no usado.

```jsonc
// Petición
{
  "enrollToken": "3b2b1f...",
  "hostname": "PC-CONTA-04",
  "os": "windows",              // "windows" | "linux" | "macos"
  "osVersion": "11 (26100)",
  "username": "maria",          // usuario del sistema operativo
  "agentVersion": "0.1.0"
}

// Respuesta 200
{
  "deviceId": "e0b9...",
  "deviceSecret": "K7h2...",
  "config": { /* ver GET config abajo */ },
  "consentText": "Este equipo está supervisado por..."
}
```

Si el token no existe, está caducado o ya se usó → `403 { "error": "invalid_token" }`.

### `POST /agent/consent`

```jsonc
{ "acceptedAt": "2026-09-01T09:12:03Z", "username": "maria" }
```

Marca `Device.consentAcceptedAt`. El agente no envía datos hasta que esto se ha
confirmado al menos una vez (se cachea en local).

### `POST /agent/screenshots`  (`multipart/form-data`)

| Campo        | Tipo   | Notas |
|--------------|--------|-------|
| `capturedAt` | texto  | ISO 8601 |
| `monitor`    | texto  | índice del monitor (0 = principal) |
| `image`      | fichero| JPEG, lado mayor ≤ 1600 px, calidad según config |

Respuesta `200 { "ok": true }`. Máx. 20 ficheros por petición (el agente agrupa
el backlog).

### `POST /agent/activity`

```jsonc
{
  "samples": [
    {
      "startedAt": "2026-09-01T09:10:00Z",
      "endedAt":   "2026-09-01T09:10:30Z",
      "appName":   "chrome",
      "windowTitle":"Panel de pedidos - Google Chrome",
      "url":       "admin.miempresa.com",   // solo host, opcional
      "keyboardCount": 42,
      "mouseCount": 13,
      "idleSec": 0
    }
  ]
}
```

### `POST /agent/keyboard`

```jsonc
{
  "events": [
    { "at": "2026-09-01T09:10:05Z", "kind": "activity", "keysCount": 30, "specialKeys": ["Enter","Backspace"] }
    // si el servidor tiene textCapture=true, además:
    // { "at": "...", "kind": "text", "keysCount": 12, "textChunk": "hola equipo" }
  ]
}
```

## WebSocket `/agent/ws`

### agente → servidor

```jsonc
{ "type": "hello", "deviceId": "...", "deviceSecret": "..." , "agentVersion": "0.1.0" }
{ "type": "heartbeat", "queued": 3, "cpu": 12.4, "mem": 38.1 }
{ "type": "frame", "sessionId": "...", "ts": "2026-09-01T09:10:05.230Z", "jpegB64": "..." }
{ "type": "live_ended", "sessionId": "...", "reason": "stopped" }
```

### servidor → agente

```jsonc
{ "type": "config", "config": { ... } }          // al conectar y cuando cambia
{ "type": "live_start", "sessionId": "...", "fps": 4, "quality": 55 }
{ "type": "live_stop", "sessionId": "..." }
{ "type": "ping" }                                // el agente responde con heartbeat
```

## Objeto `config`

```jsonc
{
  "screenshotIntervalSec": 30,   // 0 = desactivar capturas periódicas
  "activityFlushSec": 30,
  "liveFps": 4,
  "jpegQuality": 55,
  "maxImageEdgePx": 1600,
  "textCapture": false,          // captura de texto completo del teclado
  "idleThresholdSec": 60,
  "rulesVersion": 7,             // el agente no necesita las reglas; el servidor clasifica
  "paused": false               // "modo pausa" activado desde el panel
}
```

## Códigos de cierre WebSocket

| Código | Motivo |
|--------|--------|
| 4001   | credenciales de dispositivo inválidas |
| 4003   | dispositivo deshabilitado desde el panel |
| 4000   | mensaje mal formado |
