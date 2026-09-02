import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../components/Toast';
import { useAuth } from '../auth';

interface Manifest {
  serverUrl: string;
  sourceZip: string;
  windowsInstallerAvailable: boolean;
  prebuilt: { os: string; file: string; bytes: number }[];
  instructions: Record<'windows' | 'linux' | 'macos', string>;
}
interface Team { id: string; name: string; }

export function Downloads() {
  const { canWrite } = useAuth();
  const [m, setM] = useState<Manifest | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Manifest>('/api/download/manifest').then(setM).catch(() => {});
    api.get<Team[]>('/api/teams').then(setTeams).catch(() => {});
  }, []);

  async function downloadWindowsInstaller() {
    setBusy(true);
    try {
      const r = await api.post<{ filename: string; url: string }>(
        '/api/download/windows-installer',
        teamId ? { teamId } : {},
      );
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('Instalador descargado. Sirve para todos los equipos de ese grupo.');
    } catch (e: any) {
      toast(e?.code === 'sin_binario_windows'
        ? 'Aún no hay .exe compilado. Ver instrucciones abajo.'
        : 'No se pudo generar el instalador.', true);
    } finally {
      setBusy(false);
    }
  }

  async function bootstrapConfig() {
    try {
      const r = await api.post<{ filename: string; content: unknown }>(
        '/api/download/bootstrap-config',
        teamId ? { teamId } : {},
      );
      const blob = new Blob([JSON.stringify(r.content, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('config.json descargado. Sirve para todos los equipos de ese grupo.');
    } catch { toast('No se pudo generar el config.', true); }
  }

  if (!m) return <div className="card">Cargando…</div>;
  const isHttps = m.serverUrl.startsWith('https://');

  return (
    <>
      <h1>Descargar el cliente</h1>
      <p className="muted">
        El agente se instala en cada equipo a supervisar. Muestra un icono permanente
        en la bandeja del sistema y pide aceptar el aviso de supervisión la primera vez.
      </p>

      <div className="notice" style={{ marginBottom: 16 }}>
        El instalador usa un código de alta <b>reutilizable</b>: el <b>mismo fichero</b>
        {' '}vale para todos los equipos y para reinstalaciones. Apunta a <b>{m.serverUrl}</b>
        {' '}— si tus equipos también se conectan desde fuera de la empresa, abre este panel
        por la dirección <b>pública</b> del servidor antes de descargarlo.
        {!isHttps && ' Se recomienda encarecidamente usar HTTPS.'}
      </div>

      {canWrite && teams.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <label>Grupo al que se asignarán los equipos que instales con este descargable</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Sin grupo</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {/* ---- Windows: instalador todo-en-uno ---- */}
      <div className="card">
        <b>Windows · instalador todo-en-uno</b>
        <p className="muted" style={{ fontSize: 13 }}>
          Un solo <code>.exe</code>. No necesita Python ni pasos manuales: al abrirlo pide
          permiso de administrador (aviso de Windows), se copia a <code>C:\ProgramData\ViewerAgent</code>,
          se registra para arrancar con la sesión y queda en ejecución. La URL del servidor y
          el código de alta van dentro del propio fichero.
        </p>
        {m.windowsInstallerAvailable ? (
          canWrite ? (
            <button className="primary" disabled={busy} onClick={downloadWindowsInstaller}>
              {busy ? 'Generando…' : 'Descargar instalador (.exe)'}
            </button>
          ) : <p className="muted">Necesitas rol de administrador para generar instaladores.</p>
        ) : (
          <div className="notice">
            No se encuentra <code>agent/dist/viewer-agent-windows.exe</code> en el servidor.
            Normalmente viene incluido en el repositorio. Si falta, compílalo
            <b> en un equipo Windows</b> (PyInstaller no compila para otro sistema),
            con Python 3.10+:
            <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
{`cd agent
python -m venv .venv
.venv\\Scripts\\python -m pip install pyinstaller -r requirements.txt
.venv\\Scripts\\python build\\build.py`}
            </pre>
            y copia el <code>agent/dist/viewer-agent-windows.exe</code> resultante a la
            carpeta <code>agent/dist/</code> del servidor.
          </div>
        )}
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Reinstalar sobre un equipo ya dado de alta crea un registro nuevo; el viejo queda
          «desconectado» y puedes borrarlo en <b>Equipos y altas</b>.
          Para desinstalar en el equipo: <code>"C:\ProgramData\ViewerAgent\viewer-agent.exe" --uninstall</code>.
        </p>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          <b>Antivirus:</b> el instalador ya añade las exclusiones de Windows Defender.
          Para Kaspersky (o volver a aplicarlas):{' '}
          <a href="/download/install/av-exclusions.ps1">av-exclusions.ps1</a>{' · '}
          <a href="/download/install/EXCLUSIONES.md">guía paso a paso</a>.
        </p>
      </div>

      {/* ---- Linux / macOS ---- */}
      <div className="card" style={{ marginTop: 14 }}>
        <b>Linux y macOS</b>
        <p>
          1) Descarga el código del agente: <a href={m.sourceZip}>viewer-agent.zip</a> (Python 3.10+).
        </p>
        {canWrite && (
          <button onClick={bootstrapConfig} style={{ margin: '8px 0' }}>
            2) Descargar el config.json
          </button>
        )}
        <ul>
          <li><b>Linux:</b> {m.instructions.linux}</li>
          <li><b>macOS:</b> {m.instructions.macos}</li>
        </ul>
        {m.prebuilt.filter((p) => p.os !== 'windows').length > 0 && (
          <>
            <p className="muted">Binarios ya compilados disponibles:</p>
            <ul>
              {m.prebuilt.filter((p) => p.os !== 'windows').map((p) => (
                <li key={p.file}>
                  <a href={`/download/agent/${p.file}`}>{p.file}</a>{' '}
                  <span className="muted">({p.os}, {(p.bytes / 1e6).toFixed(1)} MB)</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted" style={{ fontSize: 12 }}>
          En Windows usa siempre el <b>botón de arriba</b>. El binario suelto
          <code> viewer-agent-windows.exe</code> no lleva configuración y no hará nada al abrirlo.
        </p>
      </div>
    </>
  );
}
