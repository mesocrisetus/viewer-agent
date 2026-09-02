export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

export function agoLabel(iso: string | null): string {
  if (!iso) return 'nunca';
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 60) return 'hace segundos';
  if (secs < 3600) return `hace ${Math.floor(secs / 60)} min`;
  if (secs < 86400) return `hace ${Math.floor(secs / 3600)} h`;
  return `hace ${Math.floor(secs / 86400)} días`;
}

export function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const CATEGORY_LABEL: Record<string, string> = {
  productive: 'Productivo',
  unproductive: 'Improductivo',
  neutral: 'Neutro',
};

export const CATEGORY_COLOR: Record<string, string> = {
  productive: 'var(--ok)',
  unproductive: 'var(--bad)',
  neutral: 'var(--neutral)',
};
