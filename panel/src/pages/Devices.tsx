import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, authedUrl, type Device } from '../api';
import { toast } from '../components/Toast';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../auth';

interface Token {
  id: string; token: string; label: string; createdAt: string;
  expiresAt: string | null; usedAt: string | null; reusable: boolean;
  useCount: number; team: { name: string } | null;
}
interface Team { id: string; name: string; _count: { devices: number }; }

export function Devices() {
  const { canWrite } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tLabel, setTLabel] = useState('');
  const [tTeam, setTTeam] = useState('');
  const [tReusable, setTReusable] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [purgeDays, setPurgeDays] = useState(30);

  const load = () => {
    api.get<Device[]>('/api/devices').then(setDevices).catch(() => {});
    api.get<Token[]>('/api/enroll-tokens').then(setTokens).catch(() => {});
    api.get<Team[]>('/api/teams').then(setTeams).catch(() => {});
  };
  useEffect(load, []);

  async function createToken() {
    if (!tLabel.trim()) return;
    try {
      await api.post('/api/enroll-tokens', { label: tLabel, teamId: tTeam || undefined, reusable: tReusable });
      setTLabel('');
      toast('Token de alta creado.');
      load();
    } catch { toast('No se pudo crear el token.', true); }
  }
  async function createTeam() {
    if (!teamName.trim()) return;
    try { await api.post('/api/teams', { name: teamName }); setTeamName(''); load(); }
    catch { toast('No se pudo crear el grupo.', true); }
  }
  async function assignTeam(d: Device, teamId: string) {
    try { await api.patch(`/api/devices/${d.id}`, { teamId: teamId || null }); load(); }
    catch { toast('No se pudo asignar.', true); }
  }
  async function purgeData(d: Device) {
    if (!confirm(`Borrar TODOS los datos (capturas, actividad, teclado, alertas) de ${d.hostname}? El equipo sigue registrado. No se puede deshacer.`)) return;
    try { await api.del(`/api/devices/${d.id}/data`); toast('Datos borrados.'); load(); }
    catch { toast('No se pudo borrar.', true); }
  }
  async function deleteDevice(d: Device) {
    if (!confirm(`Eliminar el equipo ${d.hostname} del panel, con todos sus datos? Si el agente sigue instalado, dejará de funcionar hasta que se reinstale. No se puede deshacer.`)) return;
    try { await api.del(`/api/devices/${d.id}`); toast('Equipo eliminado.'); load(); }
    catch { toast('No se pudo eliminar.', true); }
  }
  async function purgeOffline() {
    if (!confirm(`Eliminar TODOS los equipos sin conexión desde hace más de ${purgeDays} días, con sus datos?`)) return;
    try {
      const r = await api.post<{ deleted: number }>('/api/devices/purge-offline', { days: purgeDays });
      toast(`${r.deleted} equipos eliminados.`);
      load();
    } catch { toast('No se pudo purgar.', true); }
  }
  function exportData(d: Device) {
    window.open(authedUrl(`/api/devices/${d.id}/export`), '_blank');
  }

  return (
    <>
      <h1>Equipos y altas</h1>

      {canWrite && (
        <div className="grid cols-2">
          <div className="card">
            <b>Nuevo token de alta</b>
            <p className="muted" style={{ fontSize: 13 }}>
              Un token <b>reutilizable</b> sirve para dar de alta muchos equipos con el mismo
              instalador. Uno <b>de un solo uso</b> caduca tras la primera alta.
            </p>
            <div className="row">
              <input placeholder="Etiqueta (p. ej. Oficina Madrid)" value={tLabel} onChange={(e) => setTLabel(e.target.value)} />
              <select value={tTeam} onChange={(e) => setTTeam(e.target.value)}>
                <option value="">Sin grupo</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <label className="row" style={{ alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={tReusable} onChange={(e) => setTReusable(e.target.checked)} />
                reutilizable
              </label>
              <button className="primary" onClick={createToken}>Crear</button>
            </div>
          </div>
          <div className="card">
            <b>Grupos</b>
            <div className="row" style={{ marginTop: 8 }}>
              <input placeholder="Nombre del grupo" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              <button onClick={createTeam}>Añadir grupo</button>
            </div>
            <ul className="muted" style={{ fontSize: 13 }}>
              {teams.map((t) => <li key={t.id}>{t.name} · {t._count.devices} equipos</li>)}
            </ul>
          </div>
        </div>
      )}

      <h2>Tokens de alta</h2>
      <div className="card">
        <table>
          <thead><tr><th>Etiqueta</th><th>Token</th><th>Tipo</th><th>Altas</th><th>Grupo</th><th>Creado</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.label}</td>
                <td style={{ fontFamily: 'monospace' }}>
                  {t.usedAt && !t.reusable ? '••••••' : t.token}
                  {(t.reusable || !t.usedAt) && (
                    <button style={{ marginLeft: 8 }} onClick={() => { navigator.clipboard?.writeText(t.token); toast('Copiado.'); }}>copiar</button>
                  )}
                </td>
                <td>
                  {t.reusable
                    ? <span className="badge online">reutilizable</span>
                    : <span className="badge">un solo uso</span>}
                </td>
                <td>{t.useCount}</td>
                <td>{t.team?.name ?? '—'}</td>
                <td className="muted">{fmtDateTime(t.createdAt)}</td>
                {canWrite && <td><button className="danger" onClick={async () => { await api.del(`/api/enroll-tokens/${t.id}`); load(); }}>Borrar</button></td>}
              </tr>
            ))}
            {tokens.length === 0 && <tr><td colSpan={7} className="muted">Ningún token. Se crea uno solo al descargar el instalador.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="row between" style={{ margin: '22px 0 10px' }}>
        <h2 style={{ margin: 0 }}>Equipos ({devices.length})</h2>
        {canWrite && (
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 13 }}>Limpiar desconectados desde hace</span>
            <input type="number" style={{ width: 70 }} value={purgeDays} min={1}
              onChange={(e) => setPurgeDays(Number(e.target.value))} />
            <span className="muted" style={{ fontSize: 13 }}>días</span>
            <button className="danger" onClick={purgeOffline}>Purgar</button>
          </div>
        )}
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Equipo</th><th>Usuario</th><th>SO</th><th>Grupo</th><th>Estado</th><th>Consent.</th><th>Visto</th><th></th></tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td><Link to={`/devices/${d.id}`}>{d.hostname}</Link>{d.disabled && <span className="badge" style={{ marginLeft: 6 }}>deshab.</span>}</td>
                <td>{d.username || '—'}</td>
                <td>{d.os}</td>
                <td>
                  {canWrite ? (
                    <select value={d.team?.id ?? ''} onChange={(e) => assignTeam(d, e.target.value)}>
                      <option value="">—</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  ) : (d.team?.name ?? '—')}
                </td>
                <td><span className={`badge ${d.status}`}>{d.status}</span></td>
                <td>{d.consentAcceptedAt ? '✔' : <span style={{ color: 'var(--warn)' }}>pendiente</span>}</td>
                <td className="muted">{fmtDateTime(d.lastSeenAt)}</td>
                <td className="row">
                  <button onClick={() => exportData(d)}>Exportar</button>
                  {canWrite && <button onClick={() => purgeData(d)}>Borrar datos</button>}
                  {canWrite && <button className="danger" onClick={() => deleteDevice(d)}>Eliminar equipo</button>}
                </td>
              </tr>
            ))}
            {devices.length === 0 && <tr><td colSpan={8} className="muted">Ningún equipo dado de alta.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
