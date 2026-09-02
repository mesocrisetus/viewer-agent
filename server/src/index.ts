import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { mkdir } from 'node:fs/promises';
import { ZodError } from 'zod';
import { env } from './env.js';
import { prisma } from './db.js';
import { agentRoutes } from './routes/agent.js';
import { apiRoutes } from './routes/api.js';
import { startRetentionJob } from './retention.js';
import { screenshotRoot } from './storage.js';
import { agentDownloadRoutes } from './routes/download.js';

async function main() {
  await mkdir(screenshotRoot(), { recursive: true });

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: env.maxUploadMb * 1024 * 1024,
    // El instalador de Windows lleva la config (base64url) en un segmento de ruta.
    maxParamLength: 4096,
  });

  await app.register(cors, {
    origin: env.panelOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 20 },
  });
  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'datos_invalidos', detalles: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'error no controlado');
    return reply.code(status).send({ error: status >= 500 ? 'error_interno' : err.message });
  });

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  await app.register(agentRoutes);
  await app.register(apiRoutes);
  await app.register(agentDownloadRoutes);

  startRetentionJob();

  await app.listen({ port: env.port, host: env.host });
  app.log.info(`Vigía server escuchando en ${env.host}:${env.port}`);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
