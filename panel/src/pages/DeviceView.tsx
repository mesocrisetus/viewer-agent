import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, authedUrl, type Category, type Device } from '../api';
import { live } from '../lib/live';
import { toast } from '../components/Toast';
import {
  CATEGORY_COLOR, CATEGORY_LABEL, fmtDateTime, fmtDuration, fmtTime, startOfDay, toLocalInput,
} from '../lib/format';
import { useAuth } from '../auth';

interface Shot { id: string; capturedAt: string; monitor: number; }
interface Sample {
  id: string; startedAt: string; endedAt: string; durationSec: number;
  appName: string; windowTitle: string; url: string; keyboardCount: number;
  mouseCount: number; idleSec: number; category: Category;
}
interface ActivityResp {
  samples: Sample[];
  totals: Record<Category, number>;
  byApp: { app: string; seconds: number; category: Category }[];
}
interface KeyRow { id: string; at: string; kind: string; keysCount: number; specialKeys: string; textChunk: string | null; }

export function DeviceView() {
  const { id = '' } = useParams();
  const { canWrite } = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [tab, setTab] = useState<'live' | 'playback' | 'activity' | 'keyboard'>('live');

  const [from, setFrom] = useState(toLocalInput(startOfDay()));
  const [to, setTo] = useState(toLocalInput(new Date()));

  const loadDevice = useCallback(() => {
    api.get<Device>(`/api/devices/${id}`).then(setDevice).catch(() => {});
  }, [id]);
  useEffect(() => { loadDevice(); const iv = setInterval(loadDevice, 15000); return () => clearInterval(iv); }, [loadDevice]);

  // ---- live ----
  const [frame, setFrame] = useState('');
  const [liveOnline, setLiveOnline] = useState(false);
  useEffect(() => {
    if (tab !== 'live') return;
    live.subscribe(id);
    const offF = live.onFrame((d, b64) => { if (d === id) setFrame(`data:image/jpeg;base64,${b64}`); });
    const offS = live.onStatus((d, online) => { if (d === id) setLiveOnline(online); });
    return () => { live.unsubscribe(id); offF(); offS(); };
  }, [id, tab]);

  async function patch(body: Partial<Pick<Device, 'paused' | 'disabled'>>) {
    try {
      await api.patch(`/api/devices/${id}`, body);
      toast('Guardado.');
      loadDevice();
    } catch { toast('No se pudo guardar.', true); }
  }

  return (
    <>
      <div className="row between">
        <h1>{device?.hostname ?? 'Equipo'} <span className="muted" style={{ fontSize: 14 }}>{device?.username}</span></h1>
        {device && (
          <div className="row">
            <span className={`badge ${device.status}`}>{device.status}</span>
            {canWrite && (
              <>
                <button onClick={() => patch({ paused: !device.paused })}>
                  {device.paused ? 'Reanudar' : 'Pausar'} captura
                </button>
                <button className="danger" onClick={() => patch({ disabled: !device.disabled })}>
                  {device.disabled ? 'Rehabilitar' : 'Deshabilitar'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {device && (
        <p className="muted">
          {device.os} {device.osVersion} · agente {device.agentVersion || '?'} ·
          alta {fmtDateTime(device.enrolledAt)} ·
          consentimiento {device.consentAcceptedAt ? fmtDateTime(device.consentAcceptedAt) : 'PENDIENTE'} ·
          visto {fmtDateTime(device.lastSeenAt)}
        </p>
      )}

      <div className="row" style={{ margin: '14px 0' }}>
        {(['live', 'playback', 'activity', 'keyboard'] as const).map((t) => (
          <button key={t} className={tab === t ? 'primary' : ''} onClick={() => setTab(t)}>
            {t === 'live' ? 'En vivo' : t === 'playback' ? 'Reproducción' : t === 'activity' ? 'Actividad' : 'Teclado'}
          </button>
        ))}
      </div>

      {tab !== 'live' && (
        <div className="card row" style={{ marginBottom: 14 }}>
          <div>
            <label>Desde</label>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>Hasta</label>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <QuickRanges onPick={(a, b) => { setFrom(toLocalInput(a)); setTo(toLocalInput(b)); }} />
        </div>
      )}

      {tab === 'live' && (
        <div className="card playback">
          {frame ? <img src={frame} alt="pantalla en vivo" /> : (
            <div style={{ padding: 40, textAlign: 'center' }} className="muted">
              {liveOnline || device?.liveAvailable ? 'Conectando con el equipo…' : 'El agente no está conectado.'}
            </div>
          )}
        </div>
      )}

      {tab === 'playback' && <Playback deviceId={id} fromISO={new Date(from).toISOString()} toISO={new Date(to).toISOString()} />}
      {tab === 'activity' && <Activity deviceId={id} fromISO={new Date(from).toISOString()} toISO={new Date(to).toISOString()} canWrite={canWrite} />}
      {tab === 'keyboard' && <Keyboard deviceId={id} fromISO={new Date(from).toISOString()} toISO={new Date(to).toISOString()} />}
    </>
  );
}

function QuickRanges({ onPick }: { onPick: (from: Date, to: Date) => void }) {
  const now = () => new Date();
  return (
    <div className="row">
      <button onClick={() => onPick(startOfDay(), now())}>Hoy</button>
      <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); onPick(startOfDay(d), startOfDay()); }}>Ayer</button>
      <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 7); onPick(d, now()); }}>7 días</button>
      <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 30); onPick(d, now()); }}>30 días</button>
    </div>
  );
}

function Playback({ deviceId, fromISO, toISO }: { deviceId: string; fromISO: string; toISO: string }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    api.get<Shot[]>(`/api/devices/${deviceId}/screenshots?from=${fromISO}&to=${toISO}&limit=3000`)
      .then((s) => { setShots(s); setIdx(0); })
      .catch(() => setShots([]));
  }, [deviceId, fromISO, toISO]);

  useEffect(() => {
    if (!playing) { if (timer.current) window.clearInterval(timer.current); return; }
    timer.current = window.setInterval(() => {
      setIdx((i) => (i + 1 < shots.length ? i + 1 : (setPlaying(false), i)));
    }, 700);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, shots.length]);

  if (shots.length === 0) return <div className="card">No hay capturas en este rango.</div>;
  const cur = shots[Math.min(idx, shots.length - 1)];

  return (
    <div className="card">
      <div className="playback">
        <img src={authedUrl(`/api/screenshots/${cur.id}/full`)} alt={cur.capturedAt} />
      </div>
      <div className="row between" style={{ marginTop: 10 }}>
        <button onClick={() => setPlaying((p) => !p)} className="primary">{playing ? '⏸ Pausa' : '▶ Reproducir'}</button>
        <span className="muted">
          {idx + 1} / {shots.length} · {fmtDateTime(cur.capturedAt)} · monitor {cur.monitor}
        </span>
      </div>
      <input
        className="timeline"
        style={{ marginTop: 10 }}
        type="range"
        min={0}
        max={shots.length - 1}
        value={idx}
        onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))}>◀ anterior</button>
        <button onClick={() => setIdx((i) => Math.min(shots.length - 1, i + 1))}>siguiente ▶</button>
      </div>
    </div>
  );
}

function Activity({ deviceId, fromISO, toISO, canWrite }: { deviceId: string; fromISO: string; toISO: string; canWrite: boolean }) {
  const [data, setData] = useState<ActivityResp | null>(null);
  const load = useCallback(() => {
    api.get<ActivityResp>(`/api/devices/${deviceId}/activity?from=${fromISO}&to=${toISO}`).then(setData).catch(() => setData(null));
  }, [deviceId, fromISO, toISO]);
  useEffect(() => { load(); }, [load]);

  const total = useMemo(() => {
    if (!data) return 1;
    return (data.totals.productive + data.totals.unproductive + data.totals.neutral) || 1;
  }, [data]);

  if (!data) return <div className="card">Sin datos.</div>;
  const pct = (n: number) => `${(n / total) * 100}%`;

  async function reclassify() {
    try {
      const r = await api.post<{ updated: number }>('/api/rules/reclassify', { deviceId, from: fromISO, to: toISO });
      toast(`Reclasificadas ${r.updated} muestras.`);
      load();
    } catch { toast('No se pudo reclasificar.', true); }
  }

  return (
    <>
      <div className="card">
        <div className="row between">
          <b>Reparto del tiempo</b>
          {canWrite && <button onClick={reclassify}>Reclasificar con reglas actuales</button>}
        </div>
        <div className="bar" style={{ height: 16, marginTop: 10 }}>
          <span className="productive" style={{ width: pct(data.totals.productive) }} />
          <span className="unproductive" style={{ width: pct(data.totals.unproductive) }} />
          <span className="neutral" style={{ width: pct(data.totals.neutral) }} />
        </div>
        <div className="row" style={{ marginTop: 10, gap: 22 }}>
          {(['productive', 'unproductive', 'neutral'] as Category[]).map((c) => (
            <span key={c}><span className={`badge ${c}`}>{CATEGORY_LABEL[c]}</span> {fmtDuration(data.totals[c])}</span>
          ))}
        </div>
      </div>

      <h2>Tiempo por aplicación</h2>
      <div className="card">
        <table>
          <thead><tr><th>Aplicación</th><th>Categoría</th><th>Tiempo</th></tr></thead>
          <tbody>
            {data.byApp.slice(0, 40).map((a) => (
              <tr key={a.app}>
                <td>{a.app}</td>
                <td><span className={`badge ${a.category}`} style={{ borderColor: CATEGORY_COLOR[a.category] }}>{CATEGORY_LABEL[a.category]}</span></td>
                <td>{fmtDuration(a.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Detalle ({data.samples.length} intervalos)</h2>
      <div className="card" style={{ maxHeight: 420, overflow: 'auto' }}>
        <table>
          <thead><tr><th>Inicio</th><th>Dur.</th><th>App</th><th>Ventana</th><th>Teclas</th><th>Ratón</th><th>Cat.</th></tr></thead>
          <tbody>
            {data.samples.map((s) => (
              <tr key={s.id}>
                <td>{fmtTime(s.startedAt)}</td>
                <td>{fmtDuration(s.durationSec)}</td>
                <td>{s.appName}</td>
                <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.windowTitle}>{s.windowTitle}</td>
                <td>{s.keyboardCount}</td>
                <td>{s.mouseCount}</td>
                <td><span className={`badge ${s.category}`}>{CATEGORY_LABEL[s.category]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Keyboard({ deviceId, fromISO, toISO }: { deviceId: string; fromISO: string; toISO: string }) {
  const [rows, setRows] = useState<KeyRow[]>([]);
  useEffect(() => {
    api.get<KeyRow[]>(`/api/devices/${deviceId}/keyboard?from=${fromISO}&to=${toISO}&limit=3000`).then(setRows).catch(() => setRows([]));
  }, [deviceId, fromISO, toISO]);

  const hasText = rows.some((r) => r.kind === 'text');
  const totalKeys = rows.reduce((n, r) => n + r.keysCount, 0);

  return (
    <div className="card">
      <p className="muted">
        {totalKeys.toLocaleString('es-ES')} pulsaciones registradas en el rango.
        {hasText
          ? ' La captura de texto está ACTIVADA en Ajustes; abajo se muestra el contenido.'
          : ' Solo se registran métricas de actividad; el contenido del texto no se guarda.'}
      </p>
      <table>
        <thead><tr><th>Momento</th><th>Tipo</th><th>Pulsaciones</th><th>Teclas especiales</th>{hasText && <th>Texto</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtDateTime(r.at)}</td>
              <td>{r.kind === 'text' ? 'texto' : 'actividad'}</td>
              <td>{r.keysCount}</td>
              <td className="muted">{r.specialKeys}</td>
              {hasText && <td style={{ fontFamily: 'monospace' }}>{r.textChunk ?? ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
