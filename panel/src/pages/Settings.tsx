import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../components/Toast';
import { useAuth } from '../auth';

const FIELDS: { key: string; label: string; hint: string; type?: 'number' | 'text' | 'textarea' | 'bool' }[] = [
  { key: 'publicServerUrl', label: 'Dirección pública del servidor', hint: 'La que se graba en los instaladores. Pon aquí el dominio o IP pública (p. ej. https://vigilancia.miempresa.com o http://90.1.2.3) para que los equipos que trabajan desde casa se conecten. Si se deja vacío, se usa la dirección con la que abriste el panel.', type: 'text' },
  { key: 'screenshotIntervalSec', label: 'Intervalo de captura de pantalla (s)', hint: '0 = desactivar capturas periódicas', type: 'number' },
  { key: 'activityFlushSec', label: 'Cierre de intervalo de actividad (s)', hint: 'cada cuánto se corta una muestra de app activa', type: 'number' },
  { key: 'liveFps', label: 'Fotogramas por segundo del directo', hint: '1–10', type: 'number' },
  { key: 'jpegQuality', label: 'Calidad JPEG de las capturas', hint: '1–95', type: 'number' },
  { key: 'maxImageEdgePx', label: 'Lado máximo de imagen (px)', hint: 'las capturas se reducen a este tamaño', type: 'number' },
  { key: 'idleThresholdSec', label: 'Umbral de inactividad (s)', hint: 'sin teclado/ratón para contar como inactivo', type: 'number' },
  { key: 'retentionDays', label: 'Retención de datos (días)', hint: 'capturas y actividad se borran pasado este plazo', type: 'number' },
  { key: 'deviceRetentionDays', label: 'Auto-eliminar equipos desconectados (días)', hint: '0 = nunca. Si > 0, los equipos sin conexión desde hace ese tiempo se eliminan solos junto con sus datos', type: 'number' },
  { key: 'offlineAfterSec', label: 'Marcar «desconectado» tras (s)', hint: 'sin señal del agente', type: 'number' },
  { key: 'textCapture', label: 'Capturar el TEXTO completo del teclado', hint: 'Solo con base legal específica. Desactivado = solo métricas de tecleo.', type: 'bool' },
  { key: 'consentText', label: 'Texto del aviso de supervisión', hint: 'lo ve la persona en el primer arranque del agente', type: 'textarea' },
];

export function Settings() {
  const { canWrite } = useAuth();
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.get<{ settings: Record<string, string> }>('/api/settings').then((r) => setValues(r.settings)).catch(() => {});
  }, []);

  function set(k: string, v: string) { setValues((s) => ({ ...s, [k]: v })); setDirty(true); }

  async function save() {
    try {
      await api.put('/api/settings', values);
      toast('Ajustes guardados. Se han enviado a los agentes conectados.');
      setDirty(false);
    } catch { toast('No se pudieron guardar.', true); }
  }

  return (
    <>
      <h1>Ajustes</h1>
      {values.textCapture === 'true' && (
        <div className="notice" style={{ marginBottom: 14 }}>
          La captura de texto completo del teclado está <b>activada</b>. Revisa que tienes
          una base legal específica y limita su uso en el tiempo (ver guía de cumplimiento).
        </div>
      )}
      <div className="card grid" style={{ gap: 16 }}>
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label>{f.label}</label>
            {f.type === 'bool' ? (
              <select disabled={!canWrite} value={values[f.key] ?? 'false'} onChange={(e) => set(f.key, e.target.value)}>
                <option value="false">Desactivado</option>
                <option value="true">Activado</option>
              </select>
            ) : f.type === 'textarea' ? (
              <textarea disabled={!canWrite} rows={5} style={{ width: '100%' }} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <input disabled={!canWrite} type={f.type === 'number' ? 'number' : 'text'} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            )}
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{f.hint}</div>
          </div>
        ))}
        {canWrite && <button className="primary" disabled={!dirty} onClick={save}>Guardar cambios</button>}
      </div>
    </>
  );
}
