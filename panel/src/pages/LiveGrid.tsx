import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Device } from '../api';
import { live } from '../lib/live';
import { agoLabel } from '../lib/format';

export function LiveGrid() {
  const [devices, setDevices] = useState<Device[]>([]);
  const frames = useRef<Map<string, string>>(new Map());
  const [, force] = useState(0);

  useEffect(() => {
    api.get<Device[]>('/api/devices').then(setDevices).catch(() => {});
    const iv = setInterval(() => api.get<Device[]>('/api/devices').then(setDevices).catch(() => {}), 20000);
    return () => clearInterval(iv);
  }, []);

  const liveIds = devices.filter((d) => d.liveAvailable && !d.disabled).map((d) => d.id);

  useEffect(() => {
    liveIds.forEach((id) => live.subscribe(id));
    const off = live.onFrame((deviceId, jpegB64, _ts, monitor) => {
      if (monitor !== 0) return; // en la rejilla se muestra solo la pantalla principal
      frames.current.set(deviceId, `data:image/jpeg;base64,${jpegB64}`);
      force((n) => n + 1);
    });
    return () => {
      liveIds.forEach((id) => live.unsubscribe(id));
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveIds.join(',')]);

  return (
    <>
      <h1>Pantallas en vivo</h1>
      <p className="muted">
        Se muestran los equipos con el agente conectado. Abrir un equipo lo amplía y
        registra que lo estás viendo.
      </p>
      {liveIds.length === 0 && <div className="card">Ningún equipo conectado ahora mismo.</div>}
      <div className="live-grid" style={{ marginTop: 16 }}>
        {devices
          .filter((d) => d.liveAvailable && !d.disabled)
          .map((d) => (
            <Link className="live-tile" key={d.id} to={`/devices/${d.id}`}>
              {frames.current.get(d.id) ? (
                <img src={frames.current.get(d.id)} alt={d.hostname} />
              ) : (
                <div style={{ aspectRatio: '16/10', display: 'grid', placeItems: 'center', color: '#667' }}>
                  esperando imagen…
                </div>
              )}
              <div className="cap">
                <span>
                  {d.hostname} · {d.username || 's/ usuario'}
                  {d.monitorCount > 1 && <span className="badge" style={{ marginLeft: 6 }}>🖵 {d.monitorCount}</span>}
                </span>
                <span className="muted">{agoLabel(d.lastSeenAt)}</span>
              </div>
            </Link>
          ))}
      </div>
    </>
  );
}
