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
  // miniatura). Sube el pico de RAM de forma lineal; 3 va sobrado para 25-40
  // agentes con un servidor de 8 GB. Ver server/src/limiter.ts.
  screenshotConcurrency: parseInt(process.env.SCREENSHOT_CONCURRENCY ?? '3', 10),
};
