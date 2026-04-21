import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifyAccessToken } from '../lib/tokens.js';
import { Unauthorized } from '../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    userEmail?: string;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest) => Promise<{ userId: string; email: string }>;
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('userId', undefined);
  app.decorateRequest('userEmail', undefined);

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return;
    try {
      const claims = verifyAccessToken(header.slice('Bearer '.length));
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
