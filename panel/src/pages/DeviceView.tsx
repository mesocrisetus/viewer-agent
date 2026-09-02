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

  // ---- live (multi-monitor) ----
  const framesRef = useRef<Map<number, string>>(new Map());
  const [, forceFrame] = useState(0);
  const [liveOnline, setLiveOnline] = useState(false);
  const [liveView, setLiveView] = useState<'all' | number>('all');
  const [seenMonitors, setSeenMonitors] = useState(0); // nº de pantallas que han enviado fotograma
  useEffect(() => {
    if (tab !== 'live') return;
    live.subscribe(id);
    const offF = live.onFrame((d, b64, _ts, monitor) => {
      if (d !== id) return;
      framesRef.current.set(monitor, `data:image/jpeg;base64,${b64}`);
      setSeenMonitors((n) => Math.max(n, monitor + 1));
      forceFrame((n) => n + 1);
    });
    const offS = live.onStatus((d, online) => { if (d === id) setLiveOnline(online); });
    return () => { live.unsubscribe(id); offF(); offS(); framesRef.current.clear(); setSeenMonitors(0); };
  }, [id, tab]);

  async function patch(body: Partial<Pick<Device, 'paused' | 'disabled' | 'label'>>) {
    try {
      await api.patch(`/api/devices/${id}`, body);
      toast('Guardado.');
      loadDevice();
    } catch { toast('No se pudo guardar.', true); }
  }

  return (
    <>
      <div className="row between">
        <h1>
          {device?.label || device?.hostname || 'Equipo'}
          {device?.label && <span className="muted" style={{ fontSize: 14 }}> · {device.hostname}</span>}
        </h1>
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

      {device && canWrite && (
        <div className="row" style={{ margin: '6px 0 2px', alignItems: 'center' }}>
          <label style={{ margin: 0 }}>Nombre / responsable</label>
          <input
            defaultValue={device.label}
            placeholder="p. ej. Juan Pérez"
            style={{ width: 220 }}
            key={device.label}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            onBlur={(e) => { if (e.target.value.trim() !== device.label) patch({ label: e.target.value.trim() }); }}
          />
        </div>
      )}

      {device && (
        <p className="muted">
          {device.username && <>usuario del equipo: {device.username} · </>}
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
        <LiveView
          monitorCount={Math.max(device?.monitorCount ?? 1, seenMonitors)}
          frames={framesRef.current}
          view={liveView}
          setView={setLiveView}
          connecting={liveOnline || !!device?.liveAvailable}
        />
      )}

      {tab === 'playback' && (
        <Playback
          deviceId={id}
          monitorCount={device?.monitorCount ?? 1}
          fromISO={new Date(from).toISOString()}
          toISO={new Date(to).toISOString()}
        />
      )}
      {tab === 'activity' && <Activity deviceId={id} fromISO={new Date(from).toISOString()} toISO={new Date(to).toISOString()} canWrite={canWrite} />}
      {tab === 'keyboard' && <Keyboard deviceId={id} fromISO={new Date(from).toISOString()} toISO={new Date(to).toISOString()} />}
    </>
  );
}

function MonitorPicker({
  count, value, onChange,
}: { count: number; value: 'all' | number; onChange: (v: 'all' | number) => void }) {
  if (count <= 1) return null;
  return (
    <div className="row" style={{ marginBottom: 12 }}>
      <button className={value === 'all' ? 'primary' : ''} onClick={() => onChange('all')}>
        Todas ({count})
      </button>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} className={value === i ? 'primary' : ''} onClick={() => onChange(i)}>
          Pantalla {i + 1}
        </button>
      ))}
    </div>
  );
}

function LiveView({
  monitorCount, frames, view, setView, connecting,
}: {
  monitorCount: number;
  frames: Map<number, string>;
  view: 'all' | number;
  setView: (v: 'all' | number) => void;
  connecting: boolean;
}) {
  const mons = Array.from({ length: Math.max(1, monitorCount) }, (_, i) => i);
  const shown = view === 'all' ? mons : [view as number];
  const anyFrame = frames.size > 0;

  return (
    <div className="card">
      <MonitorPicker count={monitorCount} value={view} onChange={setView} />
      {!anyFrame && (
        <div style={{ padding: 40, textAlign: 'center' }} className="muted">
          {connecting ? 'Conectando con el equipo…' : 'El agente no está conectado.'}
        </div>
      )}
      {anyFrame && (
        <div className={shown.length > 1 ? 'mon-grid' : ''}>
          {shown.map((m) => (
            <div key={m} className="live-tile" style={{ cursor: view === 'all' && monitorCount > 1 ? 'zoom-in' : 'default' }}
              onClick={() => { if (view === 'all' && monitorCount > 1) setView(m); }}>
              {frames.get(m)
                ? <img src={frames.get(m)} alt={`Pantalla ${m + 1}`} style={{ aspectRatio: 'auto' }} />
                : <div style={{ aspectRatio: '16/10', display: 'grid', placeItems: 'center', color: '#8a97a5' }}>Pantalla {m + 1} · esperando…</div>}
              {monitorCount > 1 && <div className="cap"><span>Pantalla {m + 1}</span></div>}
            </div>
          ))}
        </div>
      )}
    </div>
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

function Playback({
  deviceId, monitorCount, fromISO, toISO,
}: { deviceId: string; monitorCount: number; fromISO: string; toISO: string }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<'all' | number>('all');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    api.get<Shot[]>(`/api/devices/${deviceId}/screenshots?from=${fromISO}&to=${toISO}&limit=5000`)
      .then((s) => { setShots(s); setIdx(0); setPlaying(false); })
      .catch(() => setShots([]));
  }, [deviceId, fromISO, toISO]);

  // Pantallas presentes en el rango + capturas por pantalla, ordenadas por hora.
  const { byMon, monsPresent, times } = useMemo(() => {
    const bm = new Map<number, Shot[]>();
    for (const s of shots) {
      const arr = bm.get(s.monitor) ?? [];
      arr.push(s);
      bm.set(s.monitor, arr);
    }
    for (const arr of bm.values()) arr.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    const present = [...bm.keys()].sort((a, b) => a - b);
    // Línea de tiempo unificada: la pantalla con más capturas hace de "eje".
    let spine: Shot[] = [];
    for (const arr of bm.values()) if (arr.length > spine.length) spine = arr;
    return { byMon: bm, monsPresent: present, times: spine.map((s) => s.capturedAt) };
  }, [shots]);

  useEffect(() => {
    if (!playing || times.length === 0) { if (timer.current) window.clearInterval(timer.current); return; }
    timer.current = window.setInterval(() => {
      setIdx((i) => (i + 1 < times.length ? i + 1 : (setPlaying(false), i)));
    }, 700);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, times.length]);

  if (shots.length === 0) return <div className="card">No hay capturas en este rango.</div>;

  const nMon = Math.max(monitorCount, monsPresent.length, 1);
  const t = times[Math.min(idx, times.length - 1)];

  // Captura de la pantalla m más cercana (≤ t); si no hay, la primera.
  const shotAt = (m: number): Shot | null => {
    const arr = byMon.get(m);
    if (!arr || arr.length === 0) return null;
    let pick = arr[0];
    for (const s of arr) { if (s.capturedAt <= t) pick = s; else break; }
    return pick;
  };

  const shown = view === 'all' ? monsPresent : [view as number];

  return (
    <div className="card">
      {nMon > 1 && <MonitorPicker count={nMon} value={view} onChange={setView} />}

      <div className={shown.length > 1 ? 'mon-grid' : ''}>
        {shown.map((m) => {
          const s = shotAt(m);
          return (
            <div key={m} className="live-tile" style={{ cursor: view === 'all' && nMon > 1 ? 'zoom-in' : 'default' }}
              onClick={() => { if (view === 'all' && nMon > 1) setView(m); }}>
              {s
                ? <img src={authedUrl(`/api/screenshots/${s.id}/full`)} alt={s.capturedAt} style={{ aspectRatio: 'auto' }} />
                : <div style={{ aspectRatio: '16/10', display: 'grid', placeItems: 'center', color: '#8a97a5' }}>Pantalla {m + 1} · sin capturas</div>}
              {nMon > 1 && <div className="cap"><span>Pantalla {m + 1}</span>{s && <span className="muted">{fmtTime(s.capturedAt)}</span>}</div>}
            </div>
          );
        })}
      </div>

      <div className="row between" style={{ marginTop: 10 }}>
        <button onClick={() => setPlaying((p) => !p)} className="primary">{playing ? '⏸ Pausa' : '▶ Reproducir'}</button>
        <span className="muted">
          {idx + 1} / {times.length} · {fmtDateTime(t)}
          {shots.length >= 5000 && ' · muestra parcial, acota el rango'}
        </span>
      </div>
      <input
        className="timeline"
        style={{ marginTop: 10 }}
        type="range"
        min={0}
        max={Math.max(0, times.length - 1)}
        value={idx}
        onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
      />
      <div className="row between" style={{ marginTop: 8, alignItems: 'center' }}>
        <div className="row">
          <button onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }}>◀ anterior</button>
          <button onClick={() => { setPlaying(false); setIdx((i) => Math.min(times.length - 1, i + 1)); }}>siguiente ▶</button>
        </div>
        <DownloadVideo deviceId={deviceId} fromISO={fromISO} toISO={toISO} monitors={shown} />
      </div>
    </div>
  );
}

function DownloadVideo({
  deviceId, fromISO, toISO, monitors,
}: { deviceId: string; fromISO: string; toISO: string; monitors: number[] }) {
  const [speed, setSpeed] = useState(6); // fotogramas/seg del timelapse

  function dl(monitor: number) {
    const url = authedUrl(
      `/api/devices/${deviceId}/video?from=${fromISO}&to=${toISO}&monitor=${monitor}&fps=${speed}`,
    );
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Generando vídeo… puede tardar 1-2 min. La descarga empezará sola.');
  }

  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <label style={{ margin: 0 }}>Velocidad</label>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="fotogramas por segundo">
        <option value={3}>Lenta</option>
        <option value={6}>Normal</option>
        <option value={12}>Rápida</option>
        <option value={24}>Muy rápida</option>
      </select>
      {monitors.length <= 1 ? (
        <button onClick={() => dl(monitors[0] ?? 0)}>⬇ Descargar vídeo</button>
      ) : (
        monitors.map((m) => (
          <button key={m} onClick={() => dl(m)}>⬇ Vídeo · Pantalla {m + 1}</button>
        ))
      )}
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
