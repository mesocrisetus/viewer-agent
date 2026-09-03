import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Device } from '../api';
import { live } from '../lib/live';
import { agoLabel, fmtDateTime } from '../lib/format';

const STATUS_ORDER: Record<string, number> = { online: 0, idle: 1, offline: 2 };

export function LiveGrid() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [hideOffline, setHideOffline] = useState(false);
  const frames = useRef<Map<string, string>>(new Map());
  const [, force] = useState(0);

  useEffect(() => {
    const load = () => api.get<Device[]>('/api/devices').then(setDevices).catch(() => {});
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  // Todos los equipos (menos los deshabilitados a propósito), ordenados: en línea primero.
  const shown = useMemo(() => {
    return devices
      .filter((d) => !d.disabled && (!hideOffline || d.status !== 'offline'))
      .sort((a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        (a.label || a.hostname).localeCompare(b.label || b.hostname),
      );
  }, [devices, hideOffline]);

  // Suscribirse al directo solo de los que tienen agente conectado.
  const liveIds = devices.filter((d) => d.liveAvailable && !d.disabled).map((d) => d.id);
  useEffect(() => {
    liveIds.forEach((id) => live.subscribe(id));
    const off = live.onFrame((deviceId, jpegB64, _ts, monitor) => {
      if (monitor !== 0) return; // en la rejilla, solo la pantalla principal
      frames.current.set(deviceId, `data:image/jpeg;base64,${jpegB64}`);
      force((n) => n + 1);
    });
    return () => {
      liveIds.forEach((id) => live.unsubscribe(id));
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveIds.join(',')]);

  const counts = useMemo(() => {
    const c = { online: 0, idle: 0, offline: 0 };
    for (const d of devices) if (!d.disabled) c[d.status as 'online' | 'idle' | 'offline']++;
    return c;
  }, [devices]);

  return (
    <>
      <div className="row between" style={{ alignItems: 'center' }}>
        <h1>Pantallas en vivo</h1>
        <label className="row" style={{ alignItems: 'center', margin: 0 }}>
          <input type="checkbox" checked={hideOffline} onChange={(e) => setHideOffline(e.target.checked)} />
          &nbsp;ocultar desconectados
        </label>
      </div>
      <p className="muted">
        <b style={{ color: 'var(--ok)' }}>{counts.online} en línea</b>
        {' · '}<span style={{ color: 'var(--warn)' }}>{counts.idle} inactivos</span>
        {' · '}<span>{counts.offline} desconectados</span>
        {'  — abrir un equipo lo amplía y registra que lo estás viendo.'}
      </p>

      {shown.length === 0 && <div className="card">No hay equipos.</div>}

      <div className="live-grid" style={{ marginTop: 16 }}>
        {shown.map((d) => {
          const frame = frames.current.get(d.id);
          const isLive = d.liveAvailable && d.status !== 'offline';
          return (
            <Link className={`live-tile ${d.status === 'offline' ? 'off' : ''}`} key={d.id} to={`/devices/${d.id}`}>
              {frame ? (
                <img src={frame} alt={d.label || d.hostname} />
              ) : (
                <div style={{ aspectRatio: '16/10', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 12, color: '#8a97a5' }}>
                  {isLive ? 'conectando…'
                    : d.status === 'idle' ? 'sin señal reciente'
                    : (<span>desconectado<br /><small>visto {d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : 'nunca'}</small></span>)}
                </div>
              )}
              <span className={`tile-status ${d.status}`}>{d.status}</span>
              <div className="cap">
                <span>
                  {d.label || d.hostname}{d.label ? '' : ` · ${d.username || 's/ usuario'}`}
                  {d.monitorCount > 1 && <span className="badge" style={{ marginLeft: 6 }}>🖵 {d.monitorCount}</span>}
                </span>
                <span className="muted">{agoLabel(d.lastSeenAt)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
