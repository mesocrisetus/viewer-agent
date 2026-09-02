const TOKEN_KEY = 'vigia.token';

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}
export function setToken(t: string): void {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
}

/** URL a un GET protegido para usar en <img src> o window.open (no pueden poner cabeceras). */
export function authedUrl(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(getToken())}`;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  if (res.status === 401) {
    setToken('');
    if (!location.pathname.startsWith('/login')) location.assign('/login');
    throw new ApiError(401, 'no_autorizado');
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    try { code = (await res.json()).error ?? code; } catch { /* noop */ }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? await res.json() : (await res.text())) as T;
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => req<T>('PUT', p, b),
  patch: <T>(p: string, b?: unknown) => req<T>('PATCH', p, b),
  del: <T>(p: string) => req<T>('DELETE', p),
};

// ---- tipos compartidos ----
export type DeviceStatus = 'online' | 'idle' | 'offline';
export type Category = 'productive' | 'unproductive' | 'neutral';

export interface Device {
  id: string;
  hostname: string;
  os: string;
  osVersion: string;
  username: string;
  agentVersion: string;
  monitorCount: number;
  team: { id: string; name: string } | null;
  enrolledAt: string;
  lastSeenAt: string | null;
  consentAcceptedAt: string | null;
  disabled: boolean;
  paused: boolean;
  status: DeviceStatus;
  liveAvailable: boolean;
}

export interface Rule {
  id: string;
  matchType: 'app' | 'domain' | 'title_regex';
  pattern: string;
  category: Category;
  priority: number;
  forbidden: boolean;
  createdAt: string;
}

export interface AlertRow {
  id: string;
  deviceId: string;
  type: string;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
  device?: { hostname: string; username: string };
}
