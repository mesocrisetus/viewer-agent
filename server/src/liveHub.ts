import { nanoid } from 'nanoid';
import type { WebSocket } from '@fastify/websocket';

/**
 * Relé de vídeo en vivo. Un agente conectado por /agent/ws puede recibir la
 * orden de emitir; sus fotogramas se reenvían a todos los administradores
 * suscritos a ese dispositivo por /ws/live.
 */

type AgentConn = {
  socket: WebSocket;
  deviceId: string;
  sessionId: string | null;
  alive: boolean;
};

type AdminConn = {
  socket: WebSocket;
  subscriptions: Set<string>;
};

const agents = new Map<string, AgentConn>(); // deviceId -> conn
const admins = new Set<AdminConn>();
const subscribers = new Map<string, Set<AdminConn>>(); // deviceId -> admins

export function registerAgent(deviceId: string, socket: WebSocket): AgentConn {
  const existing = agents.get(deviceId);
  if (existing && existing.socket !== socket) {
    try { existing.socket.close(4000, 'reemplazado por nueva conexión'); } catch {}
  }
  const conn: AgentConn = { socket, deviceId, sessionId: null, alive: true };
  agents.set(deviceId, conn);
  // Si ya había admins esperando, arranca el directo.
  if ((subscribers.get(deviceId)?.size ?? 0) > 0) startLive(deviceId);
  return conn;
}

export function unregisterAgent(deviceId: string, socket: WebSocket) {
  const conn = agents.get(deviceId);
  if (conn && conn.socket === socket) {
    agents.delete(deviceId);
    broadcastStatus(deviceId, false);
  }
}

export function agentOnline(deviceId: string): boolean {
  return agents.has(deviceId);
}

function sendAgent(deviceId: string, msg: unknown) {
  const conn = agents.get(deviceId);
  if (!conn) return;
  try { conn.socket.send(JSON.stringify(msg)); } catch {}
}

function startLive(deviceId: string) {
  const conn = agents.get(deviceId);
  if (!conn) return;
  if (!conn.sessionId) conn.sessionId = nanoid(10);
  sendAgent(deviceId, { type: 'live_start', sessionId: conn.sessionId });
}

function stopLive(deviceId: string) {
  const conn = agents.get(deviceId);
  if (!conn || !conn.sessionId) return;
  sendAgent(deviceId, { type: 'live_stop', sessionId: conn.sessionId });
  conn.sessionId = null;
}

/** Llamado desde /agent/ws cuando llega un fotograma. */
export function relayFrame(deviceId: string, ts: string, jpegB64: string, monitor = 0) {
  const subs = subscribers.get(deviceId);
  if (!subs || subs.size === 0) {
    stopLive(deviceId);
    return;
  }
  const payload = JSON.stringify({ type: 'frame', deviceId, ts, monitor, jpegB64 });
  for (const admin of subs) {
    try { admin.socket.send(payload); } catch {}
  }
}

export function pushConfigToAgent(deviceId: string, config: unknown) {
  sendAgent(deviceId, { type: 'config', config });
}

// ---- lado administrador ----

export function registerAdmin(socket: WebSocket): AdminConn {
  const conn: AdminConn = { socket, subscriptions: new Set() };
  admins.add(conn);
  return conn;
}

export function adminSubscribe(conn: AdminConn, deviceId: string) {
  conn.subscriptions.add(deviceId);
  let set = subscribers.get(deviceId);
  if (!set) { set = new Set(); subscribers.set(deviceId, set); }
  const was = set.size;
  set.add(conn);
  try {
    conn.socket.send(JSON.stringify({ type: 'status', deviceId, online: agentOnline(deviceId) }));
  } catch {}
  if (was === 0) startLive(deviceId);
}

export function adminUnsubscribe(conn: AdminConn, deviceId: string) {
  conn.subscriptions.delete(deviceId);
  const set = subscribers.get(deviceId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) {
    subscribers.delete(deviceId);
    stopLive(deviceId);
  }
}

export function unregisterAdmin(conn: AdminConn) {
  for (const deviceId of conn.subscriptions) adminUnsubscribe(conn, deviceId);
  admins.delete(conn);
}

function broadcastStatus(deviceId: string, online: boolean) {
  const subs = subscribers.get(deviceId);
  if (!subs) return;
  const payload = JSON.stringify({ type: 'status', deviceId, online });
  for (const admin of subs) {
    try { admin.socket.send(payload); } catch {}
  }
}

export function notifyAgentConnected(deviceId: string) {
  broadcastStatus(deviceId, true);
}
