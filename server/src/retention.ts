import cron from 'node-cron';
import { prisma } from './db.js';
import { getSettings } from './settings.js';
import { deleteScreenshotFiles, deleteDeviceScreenshotDir } from './storage.js';

async function runOnce() {
  const s = await getSettings();
  const retentionDays = parseInt(s.retentionDays, 10) || 30;
  const offlineSec = parseInt(s.offlineAfterSec, 10) || 180;
  const cutoff = new Date(Date.now() - retentionDays * 86400_000);

  // 1. Capturas caducadas (borra ficheros + filas).
  const stale = await prisma.screenshot.findMany({
    where: { capturedAt: { lt: cutoff } },
    select: { id: true, path: true, thumbPath: true },
    take: 5000,
  });
  if (stale.length) {
    await deleteScreenshotFiles(stale.flatMap((r) => [r.path, r.thumbPath]));
    await prisma.screenshot.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  }

  // 2. Actividad y teclado caducados.
  await prisma.activitySample.deleteMany({ where: { startedAt: { lt: cutoff } } });
  await prisma.keyboardEvent.deleteMany({ where: { at: { lt: cutoff } } });

  // 3. Alertas resueltas de más de 90 días.
  await prisma.alert.deleteMany({
    where: { acknowledgedAt: { lt: new Date(Date.now() - 90 * 86400_000) } },
  });

  // 3b. Equipos desconectados desde hace mucho (si deviceRetentionDays > 0).
  const deviceRetentionDays = parseInt(s.deviceRetentionDays, 10) || 0;
  if (deviceRetentionDays > 0) {
    const dCutoff = new Date(Date.now() - deviceRetentionDays * 86400_000);
    const staleDevices = await prisma.device.findMany({
      where: {
        OR: [
          { lastSeenAt: { lt: dCutoff } },
          { lastSeenAt: null, enrolledAt: { lt: dCutoff } },
        ],
      },
      select: { id: true, hostname: true },
    });
    for (const d of staleDevices) {
      await deleteDeviceScreenshotDir(d.id);
      await prisma.device.delete({ where: { id: d.id } }).catch(() => {});
    }
    if (staleDevices.length) {
      console.log(`[retención] equipos eliminados por inactividad: ${staleDevices.length}`);
    }
  }

  // 4. Alertas de agente desconectado (una por equipo cada 6 h como máximo).
  const sixHAgo = new Date(Date.now() - 6 * 3600_000);
  const offlineCutoff = new Date(Date.now() - offlineSec * 4 * 1000);
  const devices = await prisma.device.findMany({
    where: { disabled: false, lastSeenAt: { lt: offlineCutoff, not: null } },
    select: { id: true, hostname: true },
  });
  for (const d of devices) {
    const recent = await prisma.alert.findFirst({
      where: { deviceId: d.id, type: 'agent_offline', createdAt: { gte: sixHAgo } },
    });
    if (!recent) {
      await prisma.alert.create({
        data: { deviceId: d.id, type: 'agent_offline', message: `El agente de ${d.hostname} lleva horas sin conectar.` },
      });
    }
  }

  console.log(
    `[retención] capturas borradas: ${stale.length}; corte: ${cutoff.toISOString()}; equipos offline: ${devices.length}`,
  );
}

export function startRetentionJob() {
  cron.schedule('7 * * * *', () => {
    runOnce().catch((e) => console.error('[retención] error', e));
  });
  // Pasada inicial a los 30 s del arranque.
  setTimeout(() => runOnce().catch((e) => console.error('[retención] error', e)), 30_000);
}
