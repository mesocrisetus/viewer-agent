import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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

/** Guarda la captura a disco y genera miniatura. Devuelve rutas relativas a ROOT.
 *
 * El agente ya entrega el JPEG a `maxEdge` y `quality` (misma config que el
 * servidor le empuja), así que NO se vuelve a decodificar ni recomprimir la
 * imagen completa: se escribe tal cual y solo se hace UNA pasada de sharp para
 * la miniatura. Esto reduce a la mitad la CPU y la RAM por captura, que era lo
 * que tumbaba el proceso cuando muchos agentes subían a la vez.
 *
 * Solo se recomprime la imagen completa en el caso atípico de que llegue muy
 * por encima de `maxEdge` (agente antiguo o mal configurado). */
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

  // metadata() lee solo la cabecera del JPEG, no decodifica los píxeles.
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer, { failOn: 'none' }).metadata();
  } catch {
    meta = {} as sharp.Metadata;
  }

  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
  const oversized = maxEdge > 0 && longest > maxEdge * 1.5;

  let fullBuf = buffer;
  if (oversized) {
    // Camino de reserva: normaliza una imagen fuera de tamaño.
    fullBuf = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    const m2 = await sharp(fullBuf).metadata();
    meta.width = m2.width;
    meta.height = m2.height;
  }
  await writeFile(fullAbs, fullBuf);

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
    bytes: fullBuf.byteLength,
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
