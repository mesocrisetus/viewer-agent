import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDuration } from '../lib/format';

interface Overview {
  devices: number;
  online: number;
  idle: number;
  offline: number;
  openAlerts: number;
  last24h: { productive: number; unproductive: number; neutral: number };
}

export function Dashboard() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const load = () => api.get<Overview>('/api/overview').then(setOv).catch(() => setErr('No se pudo cargar el resumen.'));
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  if (err) return <div className="card">{err}</div>;
  if (!ov) return <div className="card">Cargando…</div>;

  const total = ov.last24h.productive + ov.last24h.unproductive + ov.last24h.neutral || 1;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;

  return (
    <>
      <h1>Resumen</h1>
      <div className="grid cols-4" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="stat">{ov.devices}</div>
          <div className="stat-label">Equipos dados de alta</div>
        </div>
        <div className="card">
          <div className="stat" style={{ color: 'var(--ok)' }}>{ov.online}</div>
          <div className="stat-label">En línea ahora</div>
        </div>
        <div className="card">
          <div className="stat" style={{ color: 'var(--warn)' }}>{ov.idle}</div>
          <div className="stat-label">Inactivos</div>
        </div>
        <div className="card">
          <Link to="/alerts"><div className="stat" style={{ color: ov.openAlerts ? 'var(--bad)' : undefined }}>{ov.openAlerts}</div></Link>
          <div className="stat-label">Alertas sin revisar</div>
        </div>
      </div>

      <h2>Productividad · últimas 24 h</h2>
      <div className="card">
        <div className="bar" style={{ height: 16 }}>
          <span className="productive" style={{ width: pct(ov.last24h.productive) }} />
          <span className="unproductive" style={{ width: pct(ov.last24h.unproductive) }} />
          <span className="neutral" style={{ width: pct(ov.last24h.neutral) }} />
        </div>
        <div className="row" style={{ marginTop: 12, gap: 24 }}>
          <span><span className="badge productive">Productivo</span> {fmtDuration(ov.last24h.productive)}</span>
          <span><span className="badge unproductive">Improductivo</span> {fmtDuration(ov.last24h.unproductive)}</span>
          <span><span className="badge neutral">Neutro</span> {fmtDuration(ov.last24h.neutral)}</span>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 20 }}>
        <Link to="/live">Ver pantallas en vivo →</Link>
      </p>
    </>
  );
}
