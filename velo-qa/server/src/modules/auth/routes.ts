import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db.js';
import { loadEnv } from '../../env.js';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from '../../lib/cookies.js';
import { NotFound, Unauthorized } from '../../errors.js';
import {
  loginSchema,
  registerSchema,
  requestVerifySchema,
  verifyEmailSchema,
} from './schemas.js';
import * as authService from './service.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const sessionCtx = (req: { headers: Record<string, string | string[] | undefined>; ip: string }) => ({
    userAgent: (Array.isArray(req.headers['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers['user-agent']) ?? 'unknown',
    ip: req.ip,
  });

  app.post('/register', async (req, reply) => {
    const input = registerSchema.parse(req.body);
    const tokens = await authService.register(input, sessionCtx(req));
    setRefreshCookie(reply, tokens.refreshToken, tokens.refreshExpiresAt.getTime() - Date.now());
    return { accessToken: tokens.accessToken };
  });

  app.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const input = loginSchema.parse(req.body);
    const tokens = await authService.login(input, sessionCtx(req));
    setRefreshCookie(reply, tokens.refreshToken, tokens.refreshExpiresAt.getTime() - Date.now());
    return { accessToken: tokens.accessToken };
  });

  app.post('/refresh', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) throw Unauthorized('no_refresh', 'No refresh cookie');
    const tokens = await authService.refresh(raw, sessionCtx(req));
    setRefreshCookie(reply, tokens.refreshToken, tokens.refreshExpiresAt.getTime() - Date.now());
    return { accessToken: tokens.accessToken };
  });

  app.post('/demo-login', async (req, reply) => {
    if (loadEnv().NODE_ENV === 'production') {
      throw NotFound('route_not_found', 'Route not found');
    }
    const tokens = await authService.demoLogin(sessionCtx(req));
    setRefreshCookie(reply, tokens.refreshToken, tokens.refreshExpiresAt.getTime() - Date.now());
    return { accessToken: tokens.accessToken };
  });

  app.post('/logout', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    await authService.logout(raw);
    clearRefreshCookie(reply);
    return { ok: true };
  });

  app.post('/verify-email', async (req) => {
    const { token } = verifyEmailSchema.parse(req.body);
    await authService.verifyEmail(token);
    return { ok: true };
  });

  app.post('/request-verification', async (req) => {
    const { email } = requestVerifySchema.parse(req.body);
    await authService.requestVerification(email);
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const { userId } = await app.requireAuth(req);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        emailVerifiedAt: true,
        memberships: {
          select: {
            role: true,
            workspace: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });
    if (!user) throw Unauthorized();
    return { user };
  });
};
