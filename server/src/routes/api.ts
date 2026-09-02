import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  hashPassword,
  requireAdmin,
  requireWriteRole,
  signAdmin,
  verifyAdminToken,
  verifyPassword,
} from '../auth.js';
import {
  getSettings,
  setSetting,
  bumpRulesVersion,
  DEFAULTS,
  buildConfig,
} from '../settings.js';
import { invalidateRuleCache, reclassifyRange } from '../productivity.js';
import {
  absScreenshotPath,
  deleteDeviceScreenshotDir,
  deleteScreenshotFiles,
  etagFor,
} from '../storage.js';
import {
  registerAdmin,
  unregisterAdmin,
  adminSubscribe,
  adminUnsubscribe,
  agentOnline,
  pushConfigToAgent,
} from '../liveHub.js';

async function offlineAfterSec(): Promise<number> {
  const s = await getSettings();
  return parseInt(s.offlineAfterSec, 10) || 180;
}

function deviceStatus(lastSeenAt: Date | null, offlineSec: number): 'online' | 'idle' | 'offline' {
  if (!lastSeenAt) return 'offline';
  const age = (Date.now() - lastSeenAt.getTime()) / 1000;
  if (age <= offlineSec) return 'online';
  if (age <= offlineSec * 4) return 'idle';
  return 'offline';
}

export async function apiRoutes(app: FastifyInstance) {
  // ---------- Auth ----------
  app.post('/api/auth/login', async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body);
    const admin = await prisma.admin.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!admin || !verifyPassword(body.password, admin.passwordHash)) {
      return reply.code(401).send({ error: 'bad_credentials' });
    }
    await prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    return {
      token: signAdmin({ sub: admin.id, email: admin.email, role: admin.role }),
      admin: { id: admin.id, email: admin.email, role: admin.role },
    };
  });

  app.get('/api/auth/me', { preHandler: requireAdmin }, async (req) => {
    return { admin: (req as any).admin };
  });

  // Todo lo que sigue exige admin.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/auth/')) return;
    return requireAdmin(req, reply);
  });

  // ---------- Dashboard ----------
  app.get('/api/overview', async () => {
    const offlineSec = await offlineAfterSec();
    const devices = await prisma.device.findMany({ include: { team: true } });
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [openAlerts, samples] = await Promise.all([
      prisma.alert.count({ where: { acknowledgedAt: null } }),
      prisma.activitySample.groupBy({
        by: ['category'],
        where: { startedAt: { gte: since } },
        _sum: { durationSec: true },
      }),
    ]);
    const byCat: Record<string, number> = { productive: 0, unproductive: 0, neutral: 0 };
    for (const s of samples) byCat[s.category] = s._sum.durationSec ?? 0;
    const statuses = devices.map((d) => deviceStatus(d.lastSeenAt, offlineSec));
    return {
      devices: devices.length,
      online: statuses.filter((s) => s === 'online').length,
      idle: statuses.filter((s) => s === 'idle').length,
      offline: statuses.filter((s) => s === 'offline').length,
      openAlerts,
      last24h: byCat,
    };
  });

  // ---------- Devices ----------
  app.get('/api/devices', async () => {
    const offlineSec = await offlineAfterSec();
    const devices = await prisma.device.findMany({
      include: { team: true },
      orderBy: [{ lastSeenAt: 'desc' }],
    });
    return devices.map((d) => ({
      id: d.id,
      hostname: d.hostname,
      os: d.os,
      osVersion: d.osVersion,
      username: d.username,
      label: d.label,
      agentVersion: d.agentVersion,
      monitorCount: d.monitorCount,
      team: d.team ? { id: d.team.id, name: d.team.name } : null,
      enrolledAt: d.enrolledAt,
      lastSeenAt: d.lastSeenAt,
      consentAcceptedAt: d.consentAcceptedAt,
      disabled: d.disabled,
      paused: d.paused,
      status: deviceStatus(d.lastSeenAt, offlineSec),
      liveAvailable: agentOnline(d.id),
    }));
  });

  app.get('/api/devices/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const d = await prisma.device.findUnique({ where: { id }, include: { team: true } });
    if (!d) return reply.code(404).send({ error: 'not_found' });
    const offlineSec = await offlineAfterSec();
    return {
      ...d,
      secretHash: undefined,
      status: deviceStatus(d.lastSeenAt, offlineSec),
      liveAvailable: agentOnline(d.id),
    };
  });

  app.patch('/api/devices/:id', { preHandler: requireWriteRole }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        teamId: z.string().nullable().optional(),
        disabled: z.boolean().optional(),
        paused: z.boolean().optional(),
        username: z.string().max(120).optional(),
        label: z.string().max(120).optional(),
      })
      .parse(req.body);
    const d = await prisma.device.update({ where: { id }, data: body }).catch(() => null);
    if (!d) return reply.code(404).send({ error: 'not_found' });
    if (body.paused !== undefined || body.disabled !== undefined) {
      pushConfigToAgent(d.id, await buildConfig(d));
    }
    return { ok: true };
  });

  // Exportación / borrado de datos de un equipo (derechos RGPD).
  app.get('/api/devices/:id/export', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    reply.header('Content-Disposition', `attachment; filename="vigia-datos-${id}.json"`);
    const [device, activity, keyboard, screenshots, alerts] = await Promise.all([
      prisma.device.findUnique({ where: { id } }),
      prisma.activitySample.findMany({ where: { deviceId: id }, orderBy: { startedAt: 'asc' } }),
      prisma.keyboardEvent.findMany({ where: { deviceId: id }, orderBy: { at: 'asc' } }),
      prisma.screenshot.findMany({ where: { deviceId: id }, orderBy: { capturedAt: 'asc' } }),
      prisma.alert.findMany({ where: { deviceId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { device: { ...device, secretHash: undefined }, activity, keyboard, screenshots, alerts };
  });

  app.delete('/api/devices/:id/data', { preHandler: requireWriteRole }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const shots = await prisma.screenshot.findMany({ where: { deviceId: id }, select: { path: true, thumbPath: true } });
    await deleteScreenshotFiles(shots.flatMap((s) => [s.path, s.thumbPath]));
    await prisma.$transaction([
      prisma.screenshot.deleteMany({ where: { deviceId: id } }),
      prisma.activitySample.deleteMany({ where: { deviceId: id } }),
      prisma.keyboardEvent.deleteMany({ where: { deviceId: id } }),
      prisma.alert.deleteMany({ where: { deviceId: id } }),
    ]);
    await deleteDeviceScreenshotDir(id);
    return { ok: true };
  });

  // Elimina el equipo por completo (fila + datos + ficheros). El agente de ese
  // equipo, si sigue vivo, pasará a recibir 401 y deberá reinstalarse.
  app.delete('/api/devices/:id', { preHandler: requireWriteRole }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const dev = await prisma.device.findUnique({ where: { id } });
    if (!dev) return reply.code(404).send({ error: 'not_found' });
    await deleteDeviceScreenshotDir(id);
    await prisma.device.delete({ where: { id } }); // cascade: screenshots/activity/keyboard/alerts
    return { ok: true };
  });

  // Borrado masivo de equipos desconectados desde hace más de N días.
  app.post('/api/devices/purge-offline', { preHandler: requireWriteRole }, async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(3650) }).parse(req.body);
    const cutoff = new Date(Date.now() - days * 86400_000);
    const stale = await prisma.device.findMany({
      where: { OR: [{ lastSeenAt: { lt: cutoff } }, { lastSeenAt: null, enrolledAt: { lt: cutoff } }] },
      select: { id: true },
    });
    for (const d of stale) {
      await deleteDeviceScreenshotDir(d.id);
      await prisma.device.delete({ where: { id: d.id } }).catch(() => {});
    }
    return { ok: true, deleted: stale.length };
  });

  // ---------- Screenshots / reproducción ----------
  app.get('/api/devices/:id/screenshots', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const q = z
      .object({
        from: z.string(),
        to: z.string(),
        monitor: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).max(5000).default(2000),
      })
      .parse(req.query);
    const rows = await prisma.screenshot.findMany({
      where: {
        deviceId: id,
        capturedAt: { gte: new Date(q.from), lte: new Date(q.to) },
        ...(q.monitor !== undefined ? { monitor: q.monitor } : {}),
      },
      orderBy: { capturedAt: 'asc' },
      take: q.limit,
      select: { id: true, capturedAt: true, monitor: true, width: true, height: true },
    });
    return rows;
  });

  app.get('/api/screenshots/:id/:kind', async (req, reply) => {
    const { id, kind } = z
      .object({ id: z.string(), kind: z.enum(['full', 'thumb']) })
      .parse(req.params);
    const shot = await prisma.screenshot.findUnique({ where: { id } });
    if (!shot) return reply.code(404).send({ error: 'not_found' });
    const rel = kind === 'thumb' ? shot.thumbPath : shot.path;
    const tag = etagFor(rel);
    if (req.headers['if-none-match'] === tag) return reply.code(304).send();
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.header('ETag', tag);
    reply.type('image/jpeg');
    return reply.send(createReadStream(absScreenshotPath(rel)));
  });

  // ---------- Actividad ----------
  app.get('/api/devices/:id/activity', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const q = z.object({ from: z.string(), to: z.string() }).parse(req.query);
    const rows = await prisma.activitySample.findMany({
      where: { deviceId: id, startedAt: { gte: new Date(q.from), lte: new Date(q.to) } },
      orderBy: { startedAt: 'asc' },
    });
    const totals: Record<string, number> = { productive: 0, unproductive: 0, neutral: 0 };
    const byApp = new Map<string, { seconds: number; category: string }>();
    for (const r of rows) {
      totals[r.category] = (totals[r.category] ?? 0) + r.durationSec;
      const key = r.appName || '(desconocida)';
      const cur = byApp.get(key) ?? { seconds: 0, category: r.category };
      cur.seconds += r.durationSec;
      byApp.set(key, cur);
    }
    return {
      samples: rows,
      totals,
      byApp: [...byApp.entries()]
        .map(([app, v]) => ({ app, ...v }))
        .sort((a, b) => b.seconds - a.seconds),
    };
  });

  app.get('/api/devices/:id/keyboard', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const q = z
      .object({ from: z.string(), to: z.string(), limit: z.coerce.number().int().max(5000).default(1000) })
      .parse(req.query);
    return prisma.keyboardEvent.findMany({
      where: { deviceId: id, at: { gte: new Date(q.from), lte: new Date(q.to) } },
      orderBy: { at: 'asc' },
      take: q.limit,
    });
  });

  // ---------- Informes ----------
  app.get('/api/reports/productivity', async (req) => {
    const q = z
      .object({ from: z.string(), to: z.string(), teamId: z.string().optional(), format: z.enum(['json', 'csv']).default('json') })
      .parse(req.query);
    const where: any = { startedAt: { gte: new Date(q.from), lte: new Date(q.to) } };
    if (q.teamId) where.device = { teamId: q.teamId };
    const rows = await prisma.activitySample.findMany({
      where,
      select: { deviceId: true, startedAt: true, durationSec: true, category: true },
    });
    const devices = await prisma.device.findMany({ include: { team: true } });
    const dmap = new Map(devices.map((d) => [d.id, d]));

    type Bucket = { device: string; user: string; team: string; day: string; productive: number; unproductive: number; neutral: number };
    const buckets = new Map<string, Bucket>();
    for (const r of rows) {
      const d = dmap.get(r.deviceId);
      const day = r.startedAt.toISOString().slice(0, 10);
      const key = `${r.deviceId}|${day}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          device: d?.label || d?.hostname || r.deviceId,
          user: d?.username ?? '',
          team: d?.team?.name ?? '',
          day,
          productive: 0,
          unproductive: 0,
          neutral: 0,
        };
        buckets.set(key, b);
      }
      (b as any)[r.category] += r.durationSec;
    }
    const list = [...buckets.values()].sort((a, b) => (a.day < b.day ? 1 : -1));

    if (q.format === 'csv') {
      const header = 'dia,equipo,usuario,grupo,productivo_min,improductivo_min,neutro_min';
      const lines = list.map((b) =>
        [
          b.day,
          b.device,
          b.user,
          b.team,
          Math.round(b.productive / 60),
          Math.round(b.unproductive / 60),
          Math.round(b.neutral / 60),
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      );
      return { csv: [header, ...lines].join('\n') };
    }
    return { rows: list };
  });

  // ---------- Reglas de productividad ----------
  app.get('/api/rules', async () => {
    return prisma.productivityRule.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });
  });

  const ruleBody = z.object({
    matchType: z.enum(['app', 'domain', 'title_regex']),
    pattern: z.string().min(1).max(300),
    category: z.enum(['productive', 'unproductive', 'neutral']),
    priority: z.number().int().min(0).max(1000).default(100),
    forbidden: z.boolean().default(false),
  });

  app.post('/api/rules', { preHandler: requireWriteRole }, async (req, reply) => {
    const body = ruleBody.parse(req.body);
    if (body.matchType === 'title_regex') {
      try { new RegExp(body.pattern); } catch { return reply.code(400).send({ error: 'regex_invalida' }); }
    }
    const rule = await prisma.productivityRule.create({ data: body });
    invalidateRuleCache();
    await bumpRulesVersion();
    return rule;
  });

  app.put('/api/rules/:id', { preHandler: requireWriteRole }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = ruleBody.partial().parse(req.body);
    const rule = await prisma.productivityRule.update({ where: { id }, data: body });
    invalidateRuleCache();
    await bumpRulesVersion();
    return rule;
  });

  app.delete('/api/rules/:id', { preHandler: requireWriteRole }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.productivityRule.delete({ where: { id } });
    invalidateRuleCache();
    await bumpRulesVersion();
    return { ok: true };
  });

  // Reclasifica muestras existentes de un equipo en un rango.
  app.post('/api/rules/reclassify', { preHandler: requireWriteRole }, async (req) => {
    const body = z.object({ deviceId: z.string(), from: z.string(), to: z.string() }).parse(req.body);
    const n = await reclassifyRange(body.deviceId, new Date(body.from), new Date(body.to));
    return { ok: true, updated: n };
  });

  // ---------- Tokens de alta ----------
  app.get('/api/enroll-tokens', async () => {
    return prisma.enrollToken.findMany({ include: { team: true }, orderBy: { createdAt: 'desc' } });
  });

  app.post('/api/enroll-tokens', { preHandler: requireWriteRole }, async (req) => {
    const body = z
      .object({
        label: z.string().min(1).max(120),
        teamId: z.string().optional(),
        expiresInDays: z.number().int().min(1).max(90).optional(),
        reusable: z.boolean().default(false),
      })
      .parse(req.body);
    return prisma.enrollToken.create({
      data: {
        token: randomBytes(18).toString('hex'),
        label: body.label,
        teamId: body.teamId ?? null,
        reusable: body.reusable,
        expiresAt: body.expiresInDays
          ? new Date(Date.now() + body.expiresInDays * 86400_000)
          : null,
      },
    });
  });

  app.delete('/api/enroll-tokens/:id', { preHandler: requireWriteRole }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.enrollToken.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Equipos (grupos) ----------
  app.get('/api/teams', async () => {
    return prisma.team.findMany({ include: { _count: { select: { devices: true } } }, orderBy: { name: 'asc' } });
  });
  app.post('/api/teams', { preHandler: requireWriteRole }, async (req) => {
    const body = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    return prisma.team.create({ data: body });
  });
  app.delete('/api/teams/:id', { preHandler: requireWriteRole }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.team.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- Alertas ----------
  app.get('/api/alerts', async (req) => {
    const q = z.object({ open: z.coerce.boolean().optional() }).parse(req.query);
    return prisma.alert.findMany({
      where: q.open ? { acknowledgedAt: null } : {},
      include: { device: { select: { hostname: true, username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  });
  app.post('/api/alerts/:id/ack', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await prisma.alert.update({ where: { id }, data: { acknowledgedAt: new Date() } });
    return { ok: true };
  });

  // ---------- Ajustes ----------
  app.get('/api/settings', async () => {
    const s = await getSettings();
    return { settings: s, defaults: DEFAULTS };
  });
  app.put('/api/settings', { preHandler: requireWriteRole }, async (req) => {
    const body = z.record(z.string(), z.string()).parse(req.body);
    const allowed = new Set(Object.keys(DEFAULTS));
    for (const [k, v] of Object.entries(body)) {
      if (!allowed.has(k)) continue;
      await setSetting(k, v);
    }
    await bumpRulesVersion();
    // Empuja la nueva config a los agentes conectados.
    const devices = await prisma.device.findMany();
    for (const d of devices) pushConfigToAgent(d.id, await buildConfig(d));
    return { ok: true, settings: await getSettings() };
  });

  // ---------- Administradores ----------
  app.get('/api/admins', { preHandler: requireWriteRole }, async () => {
    return prisma.admin.findMany({ select: { id: true, email: true, role: true, createdAt: true, lastLoginAt: true } });
  });
  app.post('/api/admins', { preHandler: requireWriteRole }, async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(8), role: z.enum(['admin', 'viewer']).default('viewer') })
      .parse(req.body);
    const exists = await prisma.admin.findUnique({ where: { email: body.email.toLowerCase() } });
    if (exists) return reply.code(409).send({ error: 'email_en_uso' });
    return prisma.admin.create({
      data: { email: body.email.toLowerCase(), passwordHash: hashPassword(body.password), role: body.role },
      select: { id: true, email: true, role: true },
    });
  });
  app.put('/api/admins/:id', { preHandler: requireWriteRole }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        email: z.string().email().optional(),
        role: z.enum(['admin', 'viewer']).optional(),
        password: z.string().min(8).optional(),
      })
      .parse(req.body);
    // No permitir quedarse sin ningún administrador.
    if (body.role === 'viewer') {
      const target = await prisma.admin.findUnique({ where: { id } });
      if (target?.role === 'admin') {
        const admins = await prisma.admin.count({ where: { role: 'admin' } });
        if (admins <= 1) return reply.code(400).send({ error: 'ultimo_admin' });
      }
    }
    const data: Record<string, unknown> = {};
    if (body.email) data.email = body.email.toLowerCase();
    if (body.role) data.role = body.role;
    if (body.password) data.passwordHash = hashPassword(body.password);
    const updated = await prisma.admin
      .update({ where: { id }, data, select: { id: true, email: true, role: true } })
      .catch(() => null);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return updated;
  });
  app.delete('/api/admins/:id', { preHandler: requireWriteRole }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const target = await prisma.admin.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (target.role === 'admin') {
      const admins = await prisma.admin.count({ where: { role: 'admin' } });
      if (admins <= 1) return reply.code(400).send({ error: 'ultimo_admin' });
    }
    await prisma.admin.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- WebSocket del panel (vídeo en vivo) ----------
  app.get('/ws/live', { websocket: true }, (socket, req) => {
    const token = (req.query as any)?.token as string | undefined;
    try {
      if (!token) throw new Error('no token');
      verifyAdminToken(token);
    } catch {
      try { socket.close(4001, 'no autorizado'); } catch {}
      return;
    }
    const conn = registerAdmin(socket);
    socket.on('message', (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'subscribe' && msg.deviceId) adminSubscribe(conn, String(msg.deviceId));
      else if (msg.type === 'unsubscribe' && msg.deviceId) adminUnsubscribe(conn, String(msg.deviceId));
    });
    socket.on('close', () => unregisterAdmin(conn));
    socket.on('error', () => unregisterAdmin(conn));
  });
}
