import { createReadStream, existsSync, statSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import archiver from 'archiver';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAdmin } from '../auth.js';
import { env } from './../env.js';
import { getSetting } from '../settings.js';

const AGENT_SRC = path.resolve(env.agentDistDir);
const PREBUILT = path.join(AGENT_SRC, 'dist');

const SRC_INCLUDE = ['vigia_agent', 'requirements.txt', 'config.example.json', 'install', 'README.md', 'pyproject.toml'];

function headerServerUrl(req: { headers: Record<string, unknown>; protocol: string }): string {
  const fwdProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0] || req.protocol;
  const host = String(req.headers['x-forwarded-host'] ?? req.headers['host'] ?? '');
  return `${fwdProto}://${host}`;
}

/**
 * URL que se graba en los instaladores. Prioridad:
 *  1. Ajuste `publicServerUrl` del panel (Ajustes) — obligatorio si hay equipos
 *     que se conectan por IP pública desde fuera de la empresa.
 *  2. La dirección con la que se abrió el panel (cabecera Host / X-Forwarded-*).
 */
async function installerServerUrl(req: { headers: Record<string, unknown>; protocol: string }): Promise<string> {
  const configured = (await getSetting('publicServerUrl')).trim().replace(/\/+$/, '');
  if (configured) return configured;
  return headerServerUrl(req);
}

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Localiza el ejecutable ya compilado para un SO en agent/dist/. */
function prebuiltFor(os: 'windows' | 'linux' | 'macos'): string | null {
  if (!existsSync(PREBUILT)) return null;
  const rx = os === 'windows' ? /win/i : os === 'macos' ? /mac|darwin/i : /lin/i;
  const hit = readdirSync(PREBUILT).find((f) => rx.test(f) && statSync(path.join(PREBUILT, f)).isFile());
  return hit ? path.join(PREBUILT, hit) : null;
}

/**
 * Token de alta REUTILIZABLE y estable para los instaladores. Así el mismo
 * fichero de instalación sirve para muchos equipos y para reinstalaciones.
 * Uno por grupo (o uno "general" sin grupo).
 */
async function getOrCreateInstallerToken(teamId: string | null) {
  const existing = await prisma.enrollToken.findFirst({
    where: { reusable: true, teamId: teamId ?? null, expiresAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;
  let label = 'Instalador general';
  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    label = `Instalador ${team?.name ?? teamId}`;
  }
  return prisma.enrollToken.create({
    data: { token: randomBytes(18).toString('hex'), label, teamId: teamId ?? null, reusable: true },
  });
}

export async function agentDownloadRoutes(app: FastifyInstance) {
  // Manifiesto: qué hay disponible para descargar + instrucciones por SO.
  app.get('/api/download/manifest', { preHandler: requireAdmin }, async (req) => {
    const serverUrl = await installerServerUrl(req as any);
    const prebuilt: { os: string; file: string; bytes: number }[] = [];
    if (existsSync(PREBUILT)) {
      for (const f of readdirSync(PREBUILT)) {
        const full = path.join(PREBUILT, f);
        if (statSync(full).isFile()) {
          const os = /win/i.test(f) ? 'windows' : /mac|darwin/i.test(f) ? 'macos' : /lin/i.test(f) ? 'linux' : 'otro';
          prebuilt.push({ os, file: f, bytes: statSync(full).size });
        }
      }
    }
    return {
      serverUrl,
      sourceZip: '/download/agent/source.zip',
      windowsInstallerAvailable: !!prebuiltFor('windows'),
      prebuilt,
      instructions: {
        windows:
          'Descarga el instalador todo-en-uno, ábrelo y acepta el aviso de Windows (UAC). Se instala solo y queda en ejecución. No necesita Python.',
        linux:
          'Descomprime el código, edita config.json y ejecuta bash install/install-linux.sh (crea un servicio de usuario systemd).',
        macos:
          'Descomprime el código, edita config.json y ejecuta bash install/install-macos.sh (crea un LaunchAgent). macOS pedirá permisos de Grabación de pantalla y Accesibilidad.',
      },
    };
  });

  // Instalador de Windows todo-en-uno: acuña un token de alta y devuelve un
  // enlace de descarga cuyo NOMBRE de fichero lleva embebidos (base64url) la URL
  // del servidor y el token. Así el .exe se autoconfigura sin ficheros sueltos.
  app.post('/api/download/windows-installer', { preHandler: requireAdmin }, async (req, reply) => {
    if (!prebuiltFor('windows')) {
      return reply.code(409).send({
        error: 'sin_binario_windows',
        detalle: 'Compila el agente en Windows (.venv/Scripts/python build/build.py) y copia viewer-agent-windows.exe a agent/dist/.',
      });
    }
    const body = z.object({ teamId: z.string().optional() }).parse(req.body ?? {});
    const token = await getOrCreateInstallerToken(body.teamId ?? null);
    const c = b64url({ s: await installerServerUrl(req as any), t: token.token, v: true });
    return {
      filename: `viewer-setup.${c}.exe`,
      url: `/download/agent/windows-installer/${c}/viewer-setup.exe`,
      enrollToken: token.token,
      reusable: true,
    };
  });

  // Sirve el .exe de Windows con el nombre que lleva la config embebida.
  app.get('/download/agent/windows-installer/:c/:name', async (req, reply) => {
    const { c } = z.object({ c: z.string().regex(/^[A-Za-z0-9_-]{8,512}$/), name: z.string() }).parse(req.params);
    let parsed: { s?: string; t?: string };
    try {
      parsed = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    } catch {
      return reply.code(400).send({ error: 'config_invalida' });
    }
    if (!parsed.s || !parsed.t) return reply.code(400).send({ error: 'config_incompleta' });
    const exe = prebuiltFor('windows');
    if (!exe) return reply.code(404).send({ error: 'sin_binario_windows' });
    reply.header('Content-Type', 'application/vnd.microsoft.portable-executable');
    reply.header('Content-Disposition', `attachment; filename="viewer-setup.${c}.exe"`);
    return reply.send(createReadStream(exe));
  });

  // config.json de arranque (para instalación manual / Linux / macOS).
  app.post('/api/download/bootstrap-config', { preHandler: requireAdmin }, async (req) => {
    const body = z.object({ teamId: z.string().optional() }).parse(req.body ?? {});
    const token = await getOrCreateInstallerToken(body.teamId ?? null);
    return {
      filename: 'config.json',
      content: { serverUrl: await installerServerUrl(req as any), enrollToken: token.token, verifyTls: true },
    };
  });

  // Código fuente del agente como zip (Linux / macOS / cualquier SO con Python).
  app.get('/download/agent/source.zip', async (req, reply) => {
    if (!existsSync(AGENT_SRC)) return reply.code(404).send({ error: 'agente no disponible' });
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', 'attachment; filename="viewer-agent.zip"');
    const zip = archiver('zip', { zlib: { level: 9 } });
    reply.send(zip);
    for (const entry of SRC_INCLUDE) {
      const full = path.join(AGENT_SRC, entry);
      if (!existsSync(full)) continue;
      if (statSync(full).isDirectory()) zip.directory(full, entry);
      else zip.file(full, { name: entry });
    }
    await zip.finalize();
    return reply;
  });

  // Utilidades de instalación (script de exclusiones AV, guía).
  app.get('/download/install/:file', async (req, reply) => {
    const { file } = z
      .object({ file: z.enum(['av-exclusions.ps1', 'EXCLUSIONES.md']) })
      .parse(req.params);
    const full = path.join(AGENT_SRC, 'install', file);
    if (!existsSync(full)) return reply.code(404).send({ error: 'no encontrado' });
    reply.header('Content-Type', file.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${file}"`);
    return reply.send(createReadStream(full));
  });

  // Descarga directa de binarios ya compilados en agent/dist/.
  app.get('/download/agent/:file', async (req, reply) => {
    const { file } = z.object({ file: z.string().regex(/^[\w.\-]+$/) }).parse(req.params);
    const full = path.join(PREBUILT, file);
    if (!full.startsWith(PREBUILT) || !existsSync(full)) return reply.code(404).send({ error: 'no encontrado' });
    reply.header('Content-Disposition', `attachment; filename="${file}"`);
    return reply.send(createReadStream(full));
  });
}
