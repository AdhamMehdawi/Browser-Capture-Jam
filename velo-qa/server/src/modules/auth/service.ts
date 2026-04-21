import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { loadEnv } from '../../env.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  generateOpaqueToken,
  generateRefreshToken,
  hashToken,
  signAccessToken,
} from '../../lib/tokens.js';
import { createMailer } from '../../lib/mailer.js';
import { randomSuffix, slugify } from '../../lib/slug.js';
import { BadRequest, Conflict, Unauthorized } from '../../errors.js';
import type { LoginInput, RegisterInput } from './schemas.js';

const VERIFY_PURPOSE = 'verify_email';
const VERIFY_TTL_HOURS = 24;

export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

function refreshExpiry(): Date {
  const env = loadEnv();
  return new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function issueSession(
  userId: string,
  email: string,
  ctx: SessionContext,
  familyId?: string,
): Promise<IssuedTokens> {
  const { raw, hash } = generateRefreshToken();
  const expiresAt = refreshExpiry();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash,
      familyId: familyId ?? crypto.randomUUID(),
      expiresAt,
      userAgent: ctx.userAgent ?? null,
      ip: ctx.ip ?? null,
    },
  });
  const accessToken = signAccessToken({ sub: userId, email });
  return { accessToken, refreshToken: raw, refreshExpiresAt: expiresAt };
}

async function personalWorkspaceFor(
  tx: Prisma.TransactionClient,
  userId: string,
  seed: string,
): Promise<void> {
  const base = slugify(seed) || 'workspace';
  // Slug must be unique — retry with a short suffix if someone else grabbed it.
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${randomSuffix(4)}`;
    const exists = await tx.workspace.findUnique({ where: { slug } });
    if (exists) continue;
    const ws = await tx.workspace.create({
      data: { slug, name: `${seed}'s Workspace` },
    });
    await tx.membership.create({
      data: { userId, workspaceId: ws.id, role: 'OWNER' },
    });
    return;
  }
  throw new Error('could_not_allocate_workspace_slug');
}

async function sendVerification(userId: string, email: string): Promise<void> {
  const env = loadEnv();
  const { raw, hash } = generateOpaqueToken(32);
  await prisma.emailVerification.create({
    data: {
      userId,
      tokenHash: hash,
      purpose: VERIFY_PURPOSE,
      expiresAt: new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000),
    },
  });
  const url = `${env.WEB_ORIGIN}/verify?token=${raw}`;
  await createMailer().send({
    to: email,
    subject: 'Verify your Velo QA email',
    text: `Welcome to Velo QA. Verify your email: ${url}\n\nThis link expires in ${VERIFY_TTL_HOURS} hours.`,
  });
}

export async function register(input: RegisterInput, ctx: SessionContext): Promise<IssuedTokens> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw Conflict('email_taken', 'An account with that email already exists');

  const passwordHash = await hashPassword(input.password);
  const displayName = input.name ?? input.email.split('@')[0] ?? 'there';

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name ?? null,
      },
    });
    await personalWorkspaceFor(tx, created.id, displayName);
    return created;
  });

  await sendVerification(user.id, user.email);
  return issueSession(user.id, user.email, ctx);
}

export async function login(input: LoginInput, ctx: SessionContext): Promise<IssuedTokens> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.passwordHash) throw Unauthorized('invalid_credentials', 'Invalid email or password');
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw Unauthorized('invalid_credentials', 'Invalid email or password');
  return issueSession(user.id, user.email, ctx);
}

export async function refresh(rawToken: string, ctx: SessionContext): Promise<IssuedTokens> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!record) throw Unauthorized('invalid_refresh', 'Invalid refresh token');

  // Replay of a revoked token — nuke the whole family (A9).
  if (record.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw Unauthorized('refresh_replay', 'Refresh token reuse detected');
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw Unauthorized('refresh_expired', 'Refresh token expired');
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) throw Unauthorized();

  const { raw, hash } = generateRefreshToken();
  const expiresAt = refreshExpiry();

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedBy: hash },
    }),
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        familyId: record.familyId,
        expiresAt,
        userAgent: ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
      },
    }),
  ]);

  return {
    accessToken: signAccessToken({ sub: user.id, email: user.email }),
    refreshToken: raw,
    refreshExpiresAt: expiresAt,
  };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function verifyEmail(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.emailVerification.findUnique({ where: { tokenHash } });
  if (!record || record.purpose !== VERIFY_PURPOSE) {
    throw BadRequest('invalid_token', 'Verification link is invalid');
  }
  if (record.usedAt) throw BadRequest('token_used', 'Verification link has already been used');
  if (record.expiresAt.getTime() < Date.now()) {
    throw BadRequest('token_expired', 'Verification link has expired');
  }
  await prisma.$transaction([
    prisma.emailVerification.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
}

export async function requestVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Silent no-op if the user doesn't exist — avoids enumeration.
  if (!user || user.emailVerifiedAt) return;
  await sendVerification(user.id, user.email);
}

const DEMO_EMAIL = 'demo@veloqa.local';

/**
 * Dev-only passwordless login. Provisions a demo user + workspace on first
 * call and issues a session. Intentionally NOT exposed in production —
 * caller guards on NODE_ENV.
 */
export async function demoLogin(ctx: SessionContext): Promise<IssuedTokens> {
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: DEMO_EMAIL,
          name: 'Demo User',
          // Mark the demo user as verified so nothing prompts for it.
          emailVerifiedAt: new Date(),
        },
      });
      await personalWorkspaceFor(tx, u.id, 'Demo');
      return u;
    });
  }
  return issueSession(user.id, user.email, ctx);
}
