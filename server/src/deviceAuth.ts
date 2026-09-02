import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './db.js';

export function hashSecret(secret: string): string {
  return bcrypt.hashSync(secret, 10);
}

export async function findDeviceByCredentials(deviceId: string, secret: string) {
  if (!deviceId || !secret) return null;
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || device.disabled) return null;
  if (!bcrypt.compareSync(secret, device.secretHash)) return null;
  return device;
}

/** Hook Fastify para las rutas /agent/* (salvo /agent/enroll). */
export async function requireDevice(req: FastifyRequest, reply: FastifyReply) {
  const deviceId = String(req.headers['x-device-id'] ?? '');
  const secret = String(req.headers['x-device-secret'] ?? '');
  const device = await findDeviceByCredentials(deviceId, secret);
  if (!device) return reply.code(401).send({ error: 'bad_device_credentials' });
  (req as any).device = device;
}
