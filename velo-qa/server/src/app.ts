import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { loadEnv } from './env.js';
import { logger } from './logger.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import { authRoutes } from './modules/auth/routes.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { galleryRoutes, jamRoutes, publicBridgeRoutes, viewerRoutes } from './modules/jams/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    // Allow the web dashboard + any Chrome extension origin. Extensions use
    // `chrome-extension://<id>` and we don't know the id until build time,
    // so we match the scheme instead of hard-coding one.
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin === env.WEB_ORIGIN) return cb(null, true);
      if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
  });
  await app.register(cookie, { secret: env.JWT_SECRET });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(errorHandler);
  await app.register(authPlugin);

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(workspaceRoutes, { prefix: '/workspaces' });
  await app.register(jamRoutes, { prefix: '/jams' });
  await app.register(viewerRoutes, { prefix: '/j' });
  await app.register(galleryRoutes);
  await app.register(publicBridgeRoutes);

  return app;
}
