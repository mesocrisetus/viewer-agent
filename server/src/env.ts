import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const env = {
  port: parseInt(process.env.PORT ?? '8080', 10),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: req('DATABASE_URL'),
  jwtSecret: req('JWT_SECRET'),
  panelOrigin: process.env.PANEL_ORIGIN ?? 'http://localhost:5173',
  dataDir: process.env.DATA_DIR ?? './data',
  agentDistDir: process.env.AGENT_DIST_DIR ?? '../agent',
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@vigia.local',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'cambia-esta-clave',
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB ?? '8', 10),
  // Cuántas capturas se procesan a la vez (decodificar cabecera + generar
  // miniatura). Sube el pico de RAM de forma lineal. Ver server/src/limiter.ts.
  screenshotConcurrency: parseInt(process.env.SCREENSHOT_CONCURRENCY ?? '4', 10),
  // Cuántas capturas pueden esperar turno antes de que el servidor devuelva
  // 503 (el agente reintenta luego desde su buffer local). Es el freno que
  // impide que una ráfaga haga crecer la memoria sin límite.
  screenshotQueueMax: parseInt(process.env.SCREENSHOT_QUEUE_MAX ?? '48', 10),
};
