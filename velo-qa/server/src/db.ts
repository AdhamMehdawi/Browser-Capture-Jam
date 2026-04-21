import { PrismaClient } from '@prisma/client';
import { loadEnv } from './env.js';

const env = loadEnv();

// Singleton — Fastify's dev reload can otherwise spawn many clients.
declare global {
  // eslint-disable-next-line no-var
  var __veloqa_prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__veloqa_prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalThis.__veloqa_prisma = prisma;
}
