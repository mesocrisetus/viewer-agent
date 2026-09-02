import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from './env.js';

export type AdminToken = { sub: string; email: string; role: string };

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 12);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function signAdmin(payload: AdminToken): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '12h' });
}

export function verifyAdminToken(token: string): AdminToken {
  return jwt.verify(token, env.jwtSecret) as AdminToken;
}

/** Hook Fastify: exige un JWT de administrador válido.
 *
 * Acepta el token en la cabecera `Authorization: Bearer` o, como alternativa
 * para <img> y descargas que no pueden poner cabeceras, en `?token=` de la
 * query (solo peticiones GET). Endurecimiento pendiente: cookies de sesión para
 * no exponer el token en URLs (ver docs/ARCHITECTURE.md). */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization ?? '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token && req.method === 'GET') {
    const q = req.query as Record<string, unknown> | undefined;
    if (q && typeof q.token === 'string') token = q.token;
  }
  if (!token) return reply.code(401).send({ error: 'no_token' });
  try {
    (req as any).admin = verifyAdminToken(token);
  } catch {
    return reply.code(401).send({ error: 'bad_token' });
  }
}

/** Hook Fastify: además de admin, exige rol de escritura. */
export async function requireWriteRole(req: FastifyRequest, reply: FastifyReply) {
  const admin = (req as any).admin as AdminToken | undefined;
  if (!admin || admin.role !== 'admin') {
    return reply.code(403).send({ error: 'forbidden' });
  }
}
