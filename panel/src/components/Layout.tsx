import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { ToastHost } from './Toast';
import { getTheme, toggleTheme, type Theme } from '../theme';

const links = [
  { to: '/', label: 'Resumen', end: true },
  { to: '/live', label: 'Pantallas en vivo' },
  { to: '/devices', label: 'Equipos y altas', admin: true },
  { to: '/rules', label: 'Reglas de productividad' },
  { to: '/reports', label: 'Informes' },
  { to: '/alerts', label: 'Alertas' },
  { to: '/downloads', label: 'Descargar cliente', admin: true },
  { to: '/users', label: 'Usuarios del panel', admin: true },
  { to: '/settings', label: 'Ajustes', admin: true },
];

export function Layout() {
  const { admin, logout, canWrite } = useAuth();
  const [theme, setThemeState] = useState<Theme>(getTheme());

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">◎ VIEWER</div>
        <nav className="nav">
          {links.filter((l) => !l.admin || canWrite).map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <div className="topbar">
          <div />
          <div className="row" style={{ alignItems: 'center' }}>
            <button
              className="theme-toggle"
              title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              onClick={() => setThemeState(toggleTheme())}
            >
              {theme === 'dark' ? '☀ Claro' : '🌙 Oscuro'}
            </button>
            <span className="muted">
              {admin?.email} · {admin?.role === 'admin' ? 'administrador' : 'solo lectura'}
            </span>
            <button onClick={logout}>Salir</button>
          </div>
        </div>
        <Outlet />
      </div>
      <ToastHost />
    </div>
  );
}
