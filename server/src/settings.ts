import { prisma } from './db.js';

export type Config = {
  screenshotIntervalSec: number;
  activityFlushSec: number;
  liveFps: number;
  jpegQuality: number;
  maxImageEdgePx: number;
  textCapture: boolean;
  idleThresholdSec: number;
  rulesVersion: number;
  paused: boolean;
};

export const DEFAULTS: Record<string, string> = {
  screenshotIntervalSec: '30',
  activityFlushSec: '30',
  liveFps: '4',
  jpegQuality: '55',
  maxImageEdgePx: '1600',
  textCapture: 'false',
  idleThresholdSec: '60',
  rulesVersion: '1',
  retentionDays: '30',
  deviceRetentionDays: '0',
  offlineAfterSec: '180',
  publicServerUrl: '',
  consentText:
    'Este equipo pertenece a la empresa y su actividad está supervisada: ' +
    'capturas de pantalla periódicas, aplicación y ventana en uso, y actividad ' +
    'de teclado y ratón. Los datos se conservan un tiempo limitado y solo el ' +
    'personal autorizado puede consultarlos. Al continuar, confirmas que has ' +
    'sido informado de esta supervisión.',
};

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? DEFAULTS[key] ?? '';
}

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  const map: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function bumpRulesVersion(): Promise<number> {
  const current = parseInt(await getSetting('rulesVersion'), 10) || 1;
  const next = current + 1;
  await setSetting('rulesVersion', String(next));
  return next;
}

export async function buildConfig(device?: { paused: boolean }): Promise<Config> {
  const s = await getSettings();
  return {
    screenshotIntervalSec: parseInt(s.screenshotIntervalSec, 10),
    activityFlushSec: parseInt(s.activityFlushSec, 10),
    liveFps: parseInt(s.liveFps, 10),
    jpegQuality: parseInt(s.jpegQuality, 10),
    maxImageEdgePx: parseInt(s.maxImageEdgePx, 10),
    textCapture: s.textCapture === 'true',
    idleThresholdSec: parseInt(s.idleThresholdSec, 10),
    rulesVersion: parseInt(s.rulesVersion, 10),
    paused: device?.paused ?? false,
  };
}
