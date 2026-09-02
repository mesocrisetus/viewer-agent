import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { env } from './env.js';

const ROOT = path.resolve(env.dataDir, 'screenshots');

function dayDir(deviceId: string, when: Date): string {
  const day = when.toISOString().slice(0, 10);
  return path.join(ROOT, deviceId, day);
}

export type StoredImage = {
  path: string;
  thumbPath: string;
  width: number;
  height: number;
  bytes: number;
};

/** Guarda la captura a disco y genera miniatura. Devuelve rutas relativas a ROOT. */
export async function storeScreenshot(
  deviceId: string,
  capturedAt: Date,
  monitor: number,
  buffer: Buffer,
  maxEdge: number,
  quality: number,
): Promise<StoredImage> {
  const dir = dayDir(deviceId, capturedAt);
  await mkdir(dir, { recursive: true });

  const base = `${capturedAt.getTime()}_${monitor}`;
  const fullAbs = path.join(dir, `${base}.jpg`);
  const thumbAbs = path.join(dir, `${base}_thumb.jpg`);

  const img = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await img.metadata();

  const full = await img
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  await sharp(full).toFile(fullAbs);

  await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 45 })
    .toFile(thumbAbs);

  return {
    path: path.relative(ROOT, fullAbs).split(path.sep).join('/'),
    thumbPath: path.relative(ROOT, thumbAbs).split(path.sep).join('/'),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: full.byteLength,
  };
}

export function absScreenshotPath(rel: string): string {
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(ROOT)) throw new Error('ruta fuera de almacenamiento');
  return abs;
}

export function screenshotRoot(): string {
  return ROOT;
}

export async function deleteScreenshotFiles(rels: string[]): Promise<void> {
  for (const rel of rels) {
    try {
      const abs = absScreenshotPath(rel);
      if (existsSync(abs)) await rm(abs, { force: true });
    } catch {
      /* ignora ficheros ya borrados */
    }
  }
}

/** Borra toda la carpeta de capturas de un dispositivo. */
export async function deleteDeviceScreenshotDir(deviceId: string): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(deviceId)) return;
  const dir = path.join(ROOT, deviceId);
  try {
    if (dir.startsWith(ROOT) && existsSync(dir)) await rm(dir, { recursive: true, force: true });
  } catch {
    /* nada */
  }
}

export function etagFor(rel: string): string {
  return '"' + createHash('sha1').update(rel).digest('hex').slice(0, 16) + '"';
}
