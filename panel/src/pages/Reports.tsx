import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../components/Toast';
import { fmtDuration, startOfDay, toLocalInput } from '../lib/format';

interface Row {
  device: string; user: string; team: string; day: string;
  productive: number; unproductive: number; neutral: number;
}
interface Team { id: string; name: string; }

export function Reports() {
  const d7 = new Date(); d7.setDate(d7.getDate() - 7);
  const [from, setFrom] = useState(toLocalInput(startOfDay(d7)));
  const [to, setTo] = useState(toLocalInput(new Date()));
  const [teamId, setTeamId] = useState('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => { api.get<Team[]>('/api/teams').then(setTeams).catch(() => {}); }, []);

  function qs() {
    const p = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    if (teamId) p.set('teamId', teamId);
    return p.toString();
  }

  async function run() {
    try {
      const r = await api.get<{ rows: Row[] }>(`/api/reports/productivity?${qs()}`);
      setRows(r.rows);
    } catch { toast('No se pudo generar el informe.', true); }
  }

  async function exportCsv() {
    try {
      const r = await api.get<{ csv: string }>(`/api/reports/productivity?${qs()}&format=csv`);
      const blob = new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `vigia-productividad-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { toast('No se pudo exportar.', true); }
  }

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  return (
    <>
      <h1>Informes de productividad</h1>
      <div className="card row">
        <div><label>Desde</label><input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label>Hasta</label><input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div>
          <label>Grupo</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Todos</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button className="primary" onClick={run}>Generar</button>
        <button onClick={exportCsv}>Exportar CSV</button>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr><th>Día</th><th>Equipo</th><th>Usuario</th><th>Grupo</th><th>Reparto</th><th>Productivo</th><th>Improductivo</th><th>Neutro</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const total = r.productive + r.unproductive + r.neutral || 1;
              return (
                <tr key={i}>
                  <td>{r.day}</td>
                  <td>{r.device}</td>
                  <td>{r.user}</td>
                  <td>{r.team}</td>
                  <td style={{ minWidth: 160 }}>
                    <div className="bar">
                      <span className="productive" style={{ width: `${(r.productive / total) * 100}%` }} />
                      <span className="unproductive" style={{ width: `${(r.unproductive / total) * 100}%` }} />
                      <span className="neutral" style={{ width: `${(r.neutral / total) * 100}%` }} />
                    </div>
                  </td>
                  <td>{fmtDuration(r.productive)}</td>
                  <td>{fmtDuration(r.unproductive)}</td>
                  <td>{fmtDuration(r.neutral)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">Sin datos en el rango.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
