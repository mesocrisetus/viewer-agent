import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { hashSecret, requireDevice, findDeviceByCredentials } from '../deviceAuth.js';
import { buildConfig, getSetting } from '../settings.js';
import { classify } from '../productivity.js';
import { storeScreenshot } from '../storage.js';
import {
  registerAgent,
  unregisterAgent,
  relayFrame,
  notifyAgentConnected,
} from '../liveHub.js';

const enrollBody = z.object({
  enrollToken: z.string().min(8),
  hostname: z.string().min(1).max(200),
  os: z.enum(['windows', 'linux', 'macos']),
  osVersion: z.string().max(120).default(''),
  username: z.string().max(120).default(''),
  agentVersion: z.string().max(40).default(''),
  monitorCount: z.number().int().min(1).max(16).default(1),
});

const activityBody = z.object({
  samples: z
    .array(
      z.object({
        startedAt: z.string(),
        endedAt: z.string(),
        appName: z.string().max(200).default(''),
        windowTitle: z.string().max(500).default(''),
        url: z.string().max(300).default(''),
        keyboardCount: z.number().int().min(0).default(0),
        mouseCount: z.number().int().min(0).default(0),
        idleSec: z.number().int().min(0).default(0),
      }),
    )
    .max(500),
});

const keyboardBody = z.object({
  events: z
    .array(
      z.object({
        at: z.string(),
        kind: z.enum(['activity', 'text']),
        keysCount: z.number().int().min(0).default(0),
        specialKeys: z.array(z.string()).max(50).default([]),
        textChunk: z.string().max(4000).optional(),
      }),
    )
    .max(1000),
});

export async function agentRoutes(app: FastifyInstance) {
  // --- Comprobación previa del token (la usa el instalador antes de instalar) ---
  app.get('/agent/token-status', async (req) => {
    const q = z.object({ token: z.string().min(1).max(200) }).parse(req.query);
    const t = await prisma.enrollToken.findUnique({ where: { token: q.token } });
    if (!t) return { ok: false, reason: 'no_existe' };
    if (t.expiresAt && t.expiresAt < new Date()) return { ok: false, reason: 'caducado' };
    if (!t.reusable && t.usedAt) return { ok: false, reason: 'ya_usado' };
    return { ok: true, reusable: t.reusable };
  });

  // --- Alta ---
  app.post('/agent/enroll', async (req, reply) => {
    const body = enrollBody.parse(req.body);
    const token = await prisma.enrollToken.findUnique({ where: { token: body.enrollToken } });
    const expired = token?.expiresAt && token.expiresAt < new Date();
    const spent = token && !token.reusable && token.usedAt;
    if (!token || expired || spent) {
      return reply.code(403).send({ error: 'invalid_token' });
    }

    const secret = randomBytes(32).toString('base64url');
    const device = await prisma.device.create({
      data: {
        secretHash: hashSecret(secret),
        hostname: body.hostname,
        os: body.os,
        osVersion: body.osVersion,
        username: body.username,
        agentVersion: body.agentVersion,
        monitorCount: body.monitorCount,
        teamId: token.teamId,
        lastSeenAt: new Date(),
      },
    });
    await prisma.enrollToken.update({
      where: { id: token.id },
      data: token.reusable
        ? { useCount: { increment: 1 } }
        : { usedAt: new Date(), usedByDeviceId: device.id, useCount: { increment: 1 } },
    });

    const cfg = await buildConfig(device);
    return {
      deviceId: device.id,
      deviceSecret: secret,
      config: cfg,
      consentText: await getSetting('consentText'),
    };
  });

  // --- Consentimiento ---
  app.post('/agent/consent', { preHandler: requireDevice }, async (req) => {
    const device = (req as any).device;
    const parsed = z
      .object({ acceptedAt: z.string().optional(), username: z.string().max(120).optional() })
      .parse(req.body ?? {});
    await prisma.device.update({
      where: { id: device.id },
      data: {
        consentAcceptedAt: parsed.acceptedAt ? new Date(parsed.acceptedAt) : new Date(),
        username: parsed.username ?? device.username,
      },
    });
    return { ok: true };
  });

  // --- Config (poll de reserva; el canal principal es el WS) ---
  app.get('/agent/config', { preHandler: requireDevice }, async (req) => {
    const device = (req as any).device;
    await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return { config: await buildConfig(device) };
  });

  // --- Capturas ---
  app.post('/agent/screenshots', { preHandler: requireDevice }, async (req, reply) => {
    const device = (req as any).device;
    const cfg = await buildConfig(device);
    const parts = req.parts();
    let capturedAt = new Date();
    let monitor = 0;
    let saved = 0;

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'capturedAt') capturedAt = new Date(String(part.value));
        if (part.fieldname === 'monitor') monitor = parseInt(String(part.value), 10) || 0;
      } else if (part.type === 'file' && part.fieldname === 'image') {
        const buf = await part.toBuffer();
        const stored = await storeScreenshot(
          device.id,
          capturedAt,
          monitor,
          buf,
          cfg.maxImageEdgePx,
          cfg.jpegQuality,
        );
        await prisma.screenshot.create({
          data: {
            deviceId: device.id,
            capturedAt,
            monitor,
            path: stored.path,
            thumbPath: stored.thumbPath,
            width: stored.width,
            height: stored.height,
            bytes: stored.bytes,
          },
        });
        saved++;
      }
    }
    await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return reply.send({ ok: true, saved });
  });

  // --- Actividad (app/ventana + contadores) ---
  app.post('/agent/activity', { preHandler: requireDevice }, async (req) => {
    const device = (req as any).device;
    const body = activityBody.parse(req.body);
    for (const s of body.samples) {
      const started = new Date(s.startedAt);
      const ended = new Date(s.endedAt);
      const durationSec = Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000));
      const match = await classify(s);
      await prisma.activitySample.create({
        data: {
          deviceId: device.id,
          startedAt: started,
          endedAt: ended,
          durationSec,
          appName: s.appName,
          windowTitle: s.windowTitle,
          url: s.url,
          keyboardCount: s.keyboardCount,
          mouseCount: s.mouseCount,
          idleSec: s.idleSec,
          category: match.category,
        },
      });
      if (match.forbidden) {
        await prisma.alert.create({
          data: {
            deviceId: device.id,
            type: 'forbidden_app',
            message: `Uso de aplicación no permitida: ${s.appName || s.windowTitle}`,
          },
        });
      }
    }
    await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return { ok: true, count: body.samples.length };
  });

  // --- Teclado ---
  app.post('/agent/keyboard', { preHandler: requireDevice }, async (req) => {
    const device = (req as any).device;
    const body = keyboardBody.parse(req.body);
    const cfg = await buildConfig(device);
    for (const e of body.events) {
      const isText = e.kind === 'text' && cfg.textCapture; // se ignora el texto si está desactivado
      await prisma.keyboardEvent.create({
        data: {
          deviceId: device.id,
          at: new Date(e.at),
          kind: isText ? 'text' : 'activity',
          keysCount: e.keysCount,
          specialKeys: e.specialKeys.join(','),
          textChunk: isText ? e.textChunk ?? null : null,
        },
      });
    }
    await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return { ok: true, count: body.events.length };
  });

  // --- WebSocket de control + vídeo en vivo ---
  app.get('/agent/ws', { websocket: true }, (socket) => {
    let deviceId: string | null = null;
    let helloDone = false;

    const closeWith = (code: number, reason: string) => {
      try { socket.close(code, reason); } catch {}
    };

    socket.on('message', async (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return closeWith(4000, 'json inválido');
      }

      if (!helloDone) {
        if (msg.type !== 'hello') return closeWith(4000, 'se esperaba hello');
        const device = await findDeviceByCredentials(msg.deviceId, msg.deviceSecret);
        if (!device) return closeWith(4001, 'credenciales inválidas');
        if (device.disabled) return closeWith(4003, 'dispositivo deshabilitado');
        deviceId = device.id;
        helloDone = true;
        registerAgent(deviceId, socket);
        notifyAgentConnected(deviceId);
        const mc = Number.isInteger(msg.monitorCount) ? Math.min(16, Math.max(1, msg.monitorCount)) : device.monitorCount;
        await prisma.device.update({
          where: { id: deviceId },
          data: { lastSeenAt: new Date(), monitorCount: mc },
        });
        socket.send(JSON.stringify({ type: 'config', config: await buildConfig(device) }));
        return;
      }

      if (!deviceId) return;

      switch (msg.type) {
        case 'heartbeat': {
          const data: { lastSeenAt: Date; monitorCount?: number } = { lastSeenAt: new Date() };
          if (Number.isInteger(msg.monitorCount)) {
            data.monitorCount = Math.min(16, Math.max(1, msg.monitorCount));
          }
          await prisma.device.update({ where: { id: deviceId }, data });
          break;
        }
        case 'frame': {
          if (typeof msg.jpegB64 === 'string') {
            const monitor = Number.isInteger(msg.monitor) ? msg.monitor : 0;
            relayFrame(deviceId, msg.ts ?? new Date().toISOString(), msg.jpegB64, monitor);
          }
          break;
        }
        case 'pong':
        case 'live_ended':
          break;
        default:
          break;
      }
    });

    socket.on('close', () => {
      if (deviceId) unregisterAgent(deviceId, socket);
    });
    socket.on('error', () => {
      if (deviceId) unregisterAgent(deviceId, socket);
    });

    // ping periódico
    const iv = setInterval(() => {
      try { socket.send(JSON.stringify({ type: 'ping' })); } catch {}
    }, 30_000);
    socket.on('close', () => clearInterval(iv));
  });
}
