import { prisma } from './db.js';
import { hashPassword } from './auth.js';
import { DEFAULTS, setSetting } from './settings.js';
import { env } from './env.js';

async function main() {
  // Admin inicial
  const email = env.seedAdminEmail.toLowerCase();
  const existing = await prisma.admin.findUnique({ where: { email } });
  if (!existing) {
    await prisma.admin.create({
      data: { email, passwordHash: hashPassword(env.seedAdminPassword), role: 'admin' },
    });
    console.log(`✔ Admin creado: ${email}`);
  } else {
    console.log(`· Admin ya existe: ${email}`);
  }

  // Ajustes por defecto
  for (const [k, v] of Object.entries(DEFAULTS)) {
    const row = await prisma.setting.findUnique({ where: { key: k } });
    if (!row) await setSetting(k, v);
  }
  console.log('✔ Ajustes por defecto asegurados');

  // Reglas de productividad de ejemplo
  const ruleCount = await prisma.productivityRule.count();
  if (ruleCount === 0) {
    await prisma.productivityRule.createMany({
      data: [
        { matchType: 'domain', pattern: 'youtube.com', category: 'unproductive', priority: 200 },
        { matchType: 'domain', pattern: 'facebook.com', category: 'unproductive', priority: 200 },
        { matchType: 'domain', pattern: 'instagram.com', category: 'unproductive', priority: 200 },
        { matchType: 'domain', pattern: 'twitch.tv', category: 'unproductive', priority: 200, forbidden: true },
        { matchType: 'app', pattern: 'excel', category: 'productive', priority: 150 },
        { matchType: 'app', pattern: 'winword', category: 'productive', priority: 150 },
        { matchType: 'app', pattern: 'code', category: 'productive', priority: 150 },
        { matchType: 'app', pattern: 'outlook', category: 'productive', priority: 120 },
        { matchType: 'title_regex', pattern: 'CRM|ERP|Panel de pedidos', category: 'productive', priority: 180 },
        { matchType: 'domain', pattern: 'gmail.com', category: 'neutral', priority: 90 },
      ],
    });
    console.log('✔ Reglas de productividad de ejemplo creadas');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
