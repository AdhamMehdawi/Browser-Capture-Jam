import type { FastifyReply } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { loadEnv } from '../env.js';

export const REFRESH_COOKIE = 'veloqa_rt';

function baseOptions(): CookieSerializeOptions {
  const env = loadEnv();
  const opts: CookieSerializeOptions = {
    path: '/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
  };
  // Browsers reject `Domain=localhost` outright, and host-only cookies (no
  // Domain attribute) are the right default anyway. Only set Domain when
  // we're actually on a real host.
  if (env.COOKIE_DOMAIN && env.COOKIE_DOMAIN !== 'localhost') {
    opts.domain = env.COOKIE_DOMAIN;
  }
  return opts;
}

export function setRefreshCookie(reply: FastifyReply, token: string, maxAgeMs: number): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    ...baseOptions(),
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, baseOptions());
}
