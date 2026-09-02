import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../components/Toast';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../auth';

interface Admin {
  id: string;
  email: string;
  role: 'admin' | 'viewer';
  createdAt: string;
  lastLoginAt: string | null;
}

const ROLE_LABEL: Record<Admin['role'], string> = {
  admin: 'Administrador (control total)',
  viewer: 'Solo lectura (ver equipos y grabaciones)',
};

export function Users() {
  const { admin: me, canWrite } = useAuth();
  const [rows, setRows] = useState<Admin[]>([]);
  const [nEmail, setNEmail] = useState('');
  const [nPass, setNPass] = useState('');
  const [nRole, setNRole] = useState<Admin['role']>('viewer');

  const load = () => api.get<Admin[]>('/api/admins').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!canWrite) {
    return <div className="card">Solo los administradores pueden gestionar usuarios del panel.</div>;
  }

  async function create() {
    if (!nEmail.trim() || nPass.length < 8) { toast('Correo válido y contraseña de 8+ caracteres.', true); return; }
    try {
      await api.post('/api/admins', { email: nEmail.trim(), password: nPass, role: nRole });
      setNEmail(''); setNPass(''); setNRole('viewer');
      toast('Usuario creado.');
      load();
    } catch (e: any) {
      toast(e?.code === 'email_en_uso' ? 'Ese correo ya está en uso.' : 'No se pudo crear.', true);
    }
  }
  async function setRole(a: Admin, role: Admin['role']) {
    try { await api.put(`/api/admins/${a.id}`, { role }); toast('Rol actualizado.'); load(); }
    catch (e: any) { toast(e?.code === 'ultimo_admin' ? 'Debe quedar al menos un administrador.' : 'No se pudo cambiar.', true); }
  }
  async function resetPass(a: Admin) {
    const p = prompt(`Nueva contraseña para ${a.email} (mínimo 8 caracteres):`);
    if (!p) return;
    if (p.length < 8) { toast('Mínimo 8 caracteres.', true); return; }
    try { await api.put(`/api/admins/${a.id}`, { password: p }); toast('Contraseña cambiada.'); }
    catch { toast('No se pudo cambiar.', true); }
  }
  async function remove(a: Admin) {
    if (a.id === me?.id) { toast('No puedes eliminar tu propia cuenta.', true); return; }
    if (!confirm(`Eliminar al usuario ${a.email}?`)) return;
    try { await api.del(`/api/admins/${a.id}`); toast('Usuario eliminado.'); load(); }
    catch (e: any) { toast(e?.code === 'ultimo_admin' ? 'Debe quedar al menos un administrador.' : 'No se pudo eliminar.', true); }
  }

  return (
    <>
      <h1>Usuarios del panel</h1>
      <p className="muted">
        <b>Administrador</b>: puede verlo y cambiarlo todo (equipos, reglas, ajustes, usuarios).<br />
        <b>Solo lectura</b>: puede ver pantallas en vivo, grabaciones, actividad e informes, pero no
        modificar nada.
      </p>

      <div className="card">
        <b>Nuevo usuario</b>
        <div className="row" style={{ marginTop: 10 }}>
          <div>
            <label>Correo</label>
            <input type="email" value={nEmail} onChange={(e) => setNEmail(e.target.value)} placeholder="persona@empresa.com" />
          </div>
          <div>
            <label>Contraseña</label>
            <input type="text" value={nPass} onChange={(e) => setNPass(e.target.value)} placeholder="mín. 8 caracteres" />
          </div>
          <div>
            <label>Rol</label>
            <select value={nRole} onChange={(e) => setNRole(e.target.value as Admin['role'])}>
              <option value="viewer">Solo lectura</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <button className="primary" onClick={create}>Crear</button>
        </div>
      </div>

      <h2>Usuarios ({rows.length})</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>Correo</th><th>Rol</th><th>Creado</th><th>Último acceso</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{a.email}{a.id === me?.id && <span className="badge" style={{ marginLeft: 6 }}>tú</span>}</td>
                <td>
                  <select value={a.role} onChange={(e) => setRole(a, e.target.value as Admin['role'])}>
                    <option value="viewer">Solo lectura</option>
                    <option value="admin">Administrador</option>
                  </select>
                  <div className="muted" style={{ fontSize: 12 }}>{ROLE_LABEL[a.role]}</div>
                </td>
                <td className="muted">{fmtDateTime(a.createdAt)}</td>
                <td className="muted">{a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : 'nunca'}</td>
                <td className="row">
                  <button onClick={() => resetPass(a)}>Cambiar contraseña</button>
                  <button className="danger" disabled={a.id === me?.id} onClick={() => remove(a)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
