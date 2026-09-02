import { prisma } from './db.js';

export type RuleMatch = { category: string; forbidden: boolean; ruleId: string | null };

type Rule = {
  id: string;
  matchType: string;
  pattern: string;
  category: string;
  priority: number;
  forbidden: boolean;
};

let cache: { rules: Rule[]; at: number } | null = null;
const TTL_MS = 15_000;

async function loadRules(): Promise<Rule[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rules;
  const rules = await prisma.productivityRule.findMany({
    orderBy: { priority: 'desc' },
  });
  cache = { rules, at: Date.now() };
  return rules;
}

export function invalidateRuleCache() {
  cache = null;
}

function normApp(name: string): string {
  return name.toLowerCase().replace(/\.exe$/, '').trim();
}

function hostFromUrl(url: string): string {
  const u = url.toLowerCase().trim();
  if (!u) return '';
  try {
    return new URL(u.includes('://') ? u : `http://${u}`).hostname.replace(/^www\./, '');
  } catch {
    return u.replace(/^www\./, '').split('/')[0];
  }
}

function domainMatches(host: string, pattern: string): boolean {
  if (!host) return false;
  const p = pattern.toLowerCase().replace(/^\*?\.?/, '').replace(/^www\./, '');
  return host === p || host.endsWith('.' + p);
}

export async function classify(sample: {
  appName: string;
  windowTitle: string;
  url: string;
}): Promise<RuleMatch> {
  const rules = await loadRules();
  const app = normApp(sample.appName);
  const host = hostFromUrl(sample.url);
  const title = sample.windowTitle ?? '';

  for (const r of rules) {
    let hit = false;
    if (r.matchType === 'title_regex') {
      try {
        hit = new RegExp(r.pattern, 'i').test(title);
      } catch {
        hit = false;
      }
    } else if (r.matchType === 'domain') {
      hit = domainMatches(host, r.pattern);
    } else if (r.matchType === 'app') {
      hit = normApp(r.pattern) === app;
    }
    if (hit) return { category: r.category, forbidden: r.forbidden, ruleId: r.id };
  }
  return { category: 'neutral', forbidden: false, ruleId: null };
}

/** Reclasifica las muestras de un dispositivo en un rango (uso: tras editar reglas). */
export async function reclassifyRange(deviceId: string, from: Date, to: Date): Promise<number> {
  invalidateRuleCache();
  const samples = await prisma.activitySample.findMany({
    where: { deviceId, startedAt: { gte: from, lte: to } },
    select: { id: true, appName: true, windowTitle: true, url: true },
  });
  let n = 0;
  for (const s of samples) {
    const m = await classify(s);
    await prisma.activitySample.update({ where: { id: s.id }, data: { category: m.category } });
    n++;
  }
  return n;
}
