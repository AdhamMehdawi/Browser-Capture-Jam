import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { loadEnv } from '../env.js';

export interface AccessTokenClaims {
  sub: string; // user id
  email: string;
  type: 'access';
}

export function signAccessToken(claims: Omit<AccessTokenClaims, 'type'>): string {
  const env = loadEnv();
  const options: SignOptions = { expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'] };
  return jwt.sign({ ...claims, type: 'access' }, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const env = loadEnv();
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string' || decoded.type !== 'access') {
    throw new Error('invalid_token');
  }
  return decoded as unknown as AccessTokenClaims;
}

/**
 * Refresh tokens are opaque random strings stored hashed in the DB.
 * We return the raw token to the client (httpOnly cookie) and keep only
 * the hash server-side so a DB read cannot leak active sessions.
 */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(48).toString('base64url');
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function generateOpaqueToken(bytes = 32): { raw: string; hash: string } {
  const raw = crypto.randomBytes(bytes).toString('base64url');
  return { raw, hash: hashToken(raw) };
}
