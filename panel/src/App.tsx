import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { LiveGrid } from './pages/LiveGrid';
import { DeviceView } from './pages/DeviceView';
import { Rules } from './pages/Rules';
import { Reports } from './pages/Reports';
import { Devices } from './pages/Devices';
import { Downloads } from './pages/Downloads';
import { Settings } from './pages/Settings';
import { Alerts } from './pages/Alerts';
import { Users } from './pages/Users';

export function App() {
  const { admin, ready } = useAuth();
  if (!ready) return <div className="login-wrap">Cargando…</div>;

  return (
    <Routes>
      <Route path="/login" element={admin ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/*"
        element={admin ? <Layout /> : <Navigate to="/login" replace />}
      >
        <Route index element={<Dashboard />} />
        <Route path="live" element={<LiveGrid />} />
        <Route path="devices" element={<Devices />} />
        <Route path="devices/:id" element={<DeviceView />} />
        <Route path="rules" element={<Rules />} />
        <Route path="reports" element={<Reports />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="downloads" element={<Downloads />} />
        <Route path="users" element={<Users />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
