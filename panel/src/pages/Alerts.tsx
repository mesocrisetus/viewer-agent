import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AlertRow } from '../api';
import { fmtDateTime } from '../lib/format';

const TYPE_LABEL: Record<string, string> = {
  agent_offline: 'Agente desconectado',
  forbidden_app: 'Aplicación no permitida',
};

export function Alerts() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);

  const load = () =>
    api.get<AlertRow[]>(`/api/alerts${onlyOpen ? '?open=true' : ''}`).then(setRows).catch(() => {});
  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [onlyOpen]);

  async function ack(id: string) {
    await api.post(`/api/alerts/${id}/ack`);
    load();
  }

  return (
    <>
      <div className="row between">
        <h1>Alertas</h1>
        <label className="row" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          &nbsp;solo sin revisar
        </label>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Momento</th><th>Tipo</th><th>Equipo</th><th>Detalle</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{fmtDateTime(a.createdAt)}</td>
                <td>{TYPE_LABEL[a.type] ?? a.type}</td>
                <td><Link to={`/devices/${a.deviceId}`}>{a.device?.hostname ?? a.deviceId.slice(0, 8)}</Link></td>
                <td>{a.message}</td>
                <td>{a.acknowledgedAt ? <span className="badge">revisada</span> : <span className="badge unproductive">abierta</span>}</td>
                <td>{!a.acknowledgedAt && <button onClick={() => ack(a.id)}>Marcar revisada</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Sin alertas.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
