import { getToken } from '../api';

type FrameHandler = (deviceId: string, jpegB64: string, ts: string, monitor: number) => void;
type StatusHandler = (deviceId: string, online: boolean) => void;

/**
 * Conexión única al relay de vídeo en vivo del servidor. Varias vistas del
 * panel comparten esta conexión y se suscriben/desuscriben por deviceId.
 */
class LiveClient {
  private ws: WebSocket | null = null;
  private subs = new Map<string, number>();
  private frameHandlers = new Set<FrameHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: number | null = null;

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws/live?token=${encodeURIComponent(getToken())}`;
  }

  private ensure(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.ws = new WebSocket(this.url());
    this.ws.onopen = () => {
      for (const id of this.subs.keys()) this.send({ type: 'subscribe', deviceId: id });
    };
    this.ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'frame') {
        for (const h of this.frameHandlers) h(msg.deviceId, msg.jpegB64, msg.ts, msg.monitor ?? 0);
      } else if (msg.type === 'status') {
        for (const h of this.statusHandlers) h(msg.deviceId, msg.online);
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      if (this.subs.size > 0 && this.reconnectTimer == null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.ensure();
        }, 2000);
      }
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  subscribe(deviceId: string): void {
    this.ensure();
    const n = (this.subs.get(deviceId) ?? 0) + 1;
    this.subs.set(deviceId, n);
    if (n === 1) this.send({ type: 'subscribe', deviceId });
  }

  unsubscribe(deviceId: string): void {
    const n = (this.subs.get(deviceId) ?? 0) - 1;
    if (n <= 0) {
      this.subs.delete(deviceId);
      this.send({ type: 'unsubscribe', deviceId });
    } else {
      this.subs.set(deviceId, n);
    }
    if (this.subs.size === 0) {
      this.ws?.close();
      this.ws = null;
    }
  }

  onFrame(h: FrameHandler): () => void {
    this.frameHandlers.add(h);
    return () => this.frameHandlers.delete(h);
  }
  onStatus(h: StatusHandler): () => void {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }
}

export const live = new LiveClient();
