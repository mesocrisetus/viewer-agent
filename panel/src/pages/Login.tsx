import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
      nav('/', { replace: true });
    } catch {
      setError('Credenciales incorrectas.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0, marginBottom: 16 }}>◎ VIEWER</div>
        <p className="muted" style={{ marginTop: 0 }}>Panel de administración</p>
        <label>Correo</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
          style={{ width: '100%', marginBottom: 12 }} autoFocus />
        <label>Contraseña</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required
          style={{ width: '100%', marginBottom: 16 }} />
        {error && <div className="toast bad" style={{ position: 'static', marginBottom: 12 }}>{error}</div>}
        <button className="primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
