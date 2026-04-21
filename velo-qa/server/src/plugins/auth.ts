import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifyAccessToken } from '../lib/tokens.js';
import { Unauthorized } from '../errors.js';
import { prisma } from '../db.js';
import { loadEnv } from '../env.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    userEmail?: string;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest) => Promise<{ userId: string; email: string }>;
  }
}

// Demo user ID and email for local development
const DEMO_USER_ID = 'demo_user';
const DEMO_USER_EMAIL = 'mo@menatal.com';
const DEMO_WORKSPACE_ID = 'default';

// Ensure demo user and workspace exist
async function ensureDemoUser() {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') return;

  const existing = await prisma.user.findUnique({ where: { id: DEMO_USER_ID } });
  if (existing) return;

  console.log('[auth] Creating demo user and workspace...');
  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: DEMO_USER_ID,
        email: DEMO_USER_EMAIL,
        name: 'Mohammad Makhamreh',
        passwordHash: 'demo_no_login',
        emailVerifiedAt: new Date(),
      },
    });
    await tx.workspace.create({
      data: {
        id: DEMO_WORKSPACE_ID,
        slug: 'default',
        name: 'My Workspace',
        memberships: {
          create: {
            userId: DEMO_USER_ID,
            role: 'OWNER',
          },
        },
      },
    });
  });
  console.log('[auth] Demo user created: mo@menatal.com');
}

const authPlugin: FastifyPluginAsync = async (app) => {
  // Create demo user on startup
  await ensureDemoUser();

  app.decorateRequest('userId', undefined);
  app.decorateRequest('userEmail', undefined);

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return;

    const token = header.slice('Bearer '.length);

    // Accept demo_token for local development
    if (token === 'demo_token') {
      req.userId = DEMO_USER_ID;
      req.userEmail = DEMO_USER_EMAIL;
      return;
    }

    try {
      const claims = verifyAccessToken(token);
      req.userId = claims.sub;
      req.userEmail = claims.email;
    } catch {
      // leave unauthenticated; requireAuth will reject when needed
    }
  });

  app.decorate('requireAuth', async (req: FastifyRequest) => {
    if (!req.userId || !req.userEmail) throw Unauthorized();
    return { userId: req.userId, email: req.userEmail };
  });
};

export default fp(authPlugin, { name: 'veloqa-auth' });
