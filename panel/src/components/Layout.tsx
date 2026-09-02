import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();

  // Cierra el menú lateral al navegar (en móvil).
  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);

  return (
    <div className="app">
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
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
          <button className="hamburger" aria-label="Menú" onClick={() => setMenuOpen((v) => !v)}>☰</button>
          <span className="brand-sm">◎ VIEWER</span>
          <div className="topbar-actions">
            <button
              className="theme-toggle"
              title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              onClick={() => setThemeState(toggleTheme())}
            >
              {theme === 'dark' ? '☀' : '🌙'}
              <span className="hide-sm">{theme === 'dark' ? ' Claro' : ' Oscuro'}</span>
            </button>
            <span className="muted hide-sm">
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
