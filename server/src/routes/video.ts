import { spawn } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAdmin } from '../auth.js';
import { absScreenshotPath } from '../storage.js';

const MAX_FRAMES = 20000; // ~55 min de vídeo a 6 fps; por encima se submuestrea

/**
 * Exporta las capturas de un equipo/pantalla en un rango como vídeo MP4
 * (timelapse: cada captura = 1 fotograma). Se transmite mientras ffmpeg
 * codifica (fragmented MP4), así el navegador empieza a descargar enseguida.
 */
export async function videoRoutes(app: FastifyInstance) {
  app.get('/api/devices/:id/video', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const q = z
      .object({
        from: z.string(),
        to: z.string(),
        monitor: z.coerce.number().int().min(0).max(15).default(0),
        fps: z.coerce.number().int().min(1).max(30).default(6),
      })
      .parse(req.query);

    const device = await prisma.device.findUnique({ where: { id }, select: { hostname: true } });
    if (!device) return reply.code(404).send({ error: 'not_found' });

    const rows = await prisma.screenshot.findMany({
      where: {
        deviceId: id,
        monitor: q.monitor,
        capturedAt: { gte: new Date(q.from), lte: new Date(q.to) },
      },
      orderBy: { capturedAt: 'asc' },
      select: { path: true, capturedAt: true },
    });
    if (rows.length === 0) return reply.code(404).send({ error: 'sin_capturas' });

    // Submuestreo si hay demasiados fotogramas.
    const step = Math.ceil(rows.length / MAX_FRAMES);
    const frames = step > 1 ? rows.filter((_, i) => i % step === 0) : rows;

    // Carpeta temporal con enlaces %06d.jpg en orden.
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'viewer-vid-'));
    let linked = 0;
    for (const r of frames) {
      try {
        const src = absScreenshotPath(r.path);
        if (!existsSync(src)) continue;
        await symlink(src, path.join(tmp, String(linked).padStart(6, '0') + '.jpg'));
        linked++;
      } catch {
        /* salta ficheros que falten */
      }
    }
    if (linked === 0) {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
      return reply.code(404).send({ error: 'sin_ficheros' });
    }

    const day = new Date(q.from).toISOString().slice(0, 10);
    const safeHost = device.hostname.replace(/[^\w.-]+/g, '_');
    const filename = `${safeHost}_${day}_P${q.monitor + 1}.mp4`;

    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-framerate', String(q.fps),
      '-i', path.join(tmp, '%06d.jpg'),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4', 'pipe:1',
    ]);

    reply.raw.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Frame-Total': String(linked),
    });

    ff.stdout.pipe(reply.raw);
    let errBuf = '';
    ff.stderr.on('data', (d) => { errBuf += d.toString().slice(0, 2000); });

    const cleanup = () => { rm(tmp, { recursive: true, force: true }).catch(() => {}); };
    ff.on('error', (e) => {
      app.log.error({ e, errBuf }, 'ffmpeg no disponible o falló');
      cleanup();
      try { reply.raw.destroy(); } catch { /* noop */ }
    });
    ff.on('close', (code) => {
      cleanup();
      if (code !== 0) app.log.warn({ code, errBuf }, 'ffmpeg terminó con error');
      try { reply.raw.end(); } catch { /* noop */ }
    });
    // Si el cliente cancela la descarga, mata ffmpeg.
    reply.raw.on('close', () => { try { ff.kill('SIGKILL'); } catch { /* noop */ } });

    return reply;
  });
}
