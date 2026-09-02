import { useEffect, useState } from 'react';
import { api, type Rule } from '../api';
import { toast } from '../components/Toast';
import { CATEGORY_LABEL } from '../lib/format';
import { useAuth } from '../auth';

const MATCH_LABEL: Record<Rule['matchType'], string> = {
  app: 'Aplicación',
  domain: 'Dominio web',
  title_regex: 'Título (regex)',
};

const empty = {
  matchType: 'app' as Rule['matchType'],
  pattern: '',
  category: 'productive' as Rule['category'],
  priority: 100,
  forbidden: false,
};

export function Rules() {
  const { canWrite } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState({ ...empty });
  const [test, setTest] = useState({ appName: '', windowTitle: '', url: '' });

  const load = () => api.get<Rule[]>('/api/rules').then(setRules).catch(() => {});
  useEffect(() => { load(); }, []);

  async function add() {
    if (!draft.pattern.trim()) return;
    try {
      await api.post('/api/rules', draft);
      setDraft({ ...empty });
      toast('Regla creada. Las nuevas muestras ya la aplican.');
      load();
    } catch (e: any) {
      toast(e?.code === 'regex_invalida' ? 'La expresión regular no es válida.' : 'No se pudo crear.', true);
    }
  }
  async function update(r: Rule, patch: Partial<Rule>) {
    try { await api.put(`/api/rules/${r.id}`, patch); load(); } catch { toast('No se pudo guardar.', true); }
  }
  async function remove(r: Rule) {
    try { await api.del(`/api/rules/${r.id}`); load(); } catch { toast('No se pudo borrar.', true); }
  }

  // Previsualización local de la clasificación (misma lógica de prioridad).
  const preview = classifyPreview(rules, test);

  return (
    <>
      <h1>Reglas de productividad</h1>
      <p className="muted">
        Cada intervalo de actividad se clasifica con la primera regla que coincide, por
        prioridad descendente. Si ninguna coincide → neutro. Marcar una regla como
        «no permitida» genera una alerta cuando se detecta su uso.
      </p>

      {canWrite && (
        <div className="card">
          <b>Nueva regla</b>
          <div className="row" style={{ marginTop: 10 }}>
            <div>
              <label>Tipo</label>
              <select value={draft.matchType} onChange={(e) => setDraft({ ...draft, matchType: e.target.value as Rule['matchType'] })}>
                <option value="app">Aplicación</option>
                <option value="domain">Dominio web</option>
                <option value="title_regex">Título (regex)</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label>Patrón {draft.matchType === 'app' ? '(p. ej. excel, chrome)' : draft.matchType === 'domain' ? '(p. ej. youtube.com)' : '(p. ej. CRM|Pedidos)'}</label>
              <input style={{ width: '100%' }} value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} />
            </div>
            <div>
              <label>Categoría</label>
              <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Rule['category'] })}>
                <option value="productive">Productivo</option>
                <option value="unproductive">Improductivo</option>
                <option value="neutral">Neutro</option>
              </select>
            </div>
            <div>
              <label>Prioridad</label>
              <input type="number" style={{ width: 90 }} value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} />
            </div>
            <div>
              <label>No permitida</label>
              <input type="checkbox" checked={draft.forbidden} onChange={(e) => setDraft({ ...draft, forbidden: e.target.checked })} />
            </div>
            <button className="primary" onClick={add}>Añadir</button>
          </div>
        </div>
      )}

      <h2>Reglas ({rules.length})</h2>
      <div className="card">
        <table>
          <thead><tr><th>Prioridad</th><th>Tipo</th><th>Patrón</th><th>Categoría</th><th>No permitida</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{canWrite ? (
                  <input type="number" style={{ width: 70 }} defaultValue={r.priority}
                    onBlur={(e) => Number(e.target.value) !== r.priority && update(r, { priority: Number(e.target.value) })} />
                ) : r.priority}</td>
                <td>{MATCH_LABEL[r.matchType]}</td>
                <td style={{ fontFamily: 'monospace' }}>{r.pattern}</td>
                <td>
                  {canWrite ? (
                    <select defaultValue={r.category} onChange={(e) => update(r, { category: e.target.value as Rule['category'] })}>
                      <option value="productive">Productivo</option>
                      <option value="unproductive">Improductivo</option>
                      <option value="neutral">Neutro</option>
                    </select>
                  ) : <span className={`badge ${r.category}`}>{CATEGORY_LABEL[r.category]}</span>}
                </td>
                <td>
                  {canWrite
                    ? <input type="checkbox" defaultChecked={r.forbidden} onChange={(e) => update(r, { forbidden: e.target.checked })} />
                    : (r.forbidden ? 'Sí' : '—')}
                </td>
                {canWrite && <td><button className="danger" onClick={() => remove(r)}>Borrar</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Probar clasificación</h2>
      <div className="card row">
        <div><label>Aplicación</label><input value={test.appName} onChange={(e) => setTest({ ...test, appName: e.target.value })} /></div>
        <div style={{ flex: 1 }}><label>Título de ventana</label><input style={{ width: '100%' }} value={test.windowTitle} onChange={(e) => setTest({ ...test, windowTitle: e.target.value })} /></div>
        <div><label>Dominio</label><input value={test.url} onChange={(e) => setTest({ ...test, url: e.target.value })} /></div>
        <div>
          <label>Resultado</label>
          <span className={`badge ${preview.category}`}>{CATEGORY_LABEL[preview.category]}</span>
          {preview.forbidden && <span className="badge unproductive" style={{ marginLeft: 6 }}>no permitida</span>}
        </div>
      </div>
    </>
  );
}

function classifyPreview(rules: Rule[], s: { appName: string; windowTitle: string; url: string }) {
  const app = s.appName.toLowerCase().replace(/\.exe$/, '').trim();
  const host = s.url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  for (const r of [...rules].sort((a, b) => b.priority - a.priority)) {
    let hit = false;
    if (r.matchType === 'app') hit = r.pattern.toLowerCase().replace(/\.exe$/, '').trim() === app;
    else if (r.matchType === 'domain') {
      const p = r.pattern.toLowerCase().replace(/^www\./, '');
      hit = !!host && (host === p || host.endsWith('.' + p));
    } else {
      try { hit = new RegExp(r.pattern, 'i').test(s.windowTitle); } catch { hit = false; }
    }
    if (hit) return { category: r.category, forbidden: r.forbidden };
  }
  return { category: 'neutral' as const, forbidden: false };
}
