/**
 * AES-256-GCM encryption for the events JSONB column.
 *
 * Output format: "v{N}:{base64(iv + authTag + ciphertext)}"
 * Key rotation: each version maps to EVENTS_ENCRYPTION_KEY_V{N}.
 * EVENTS_ENCRYPTION_KEY_CURRENT selects which version is used for new writes.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;       // GCM standard
const AUTH_TAG_LENGTH = 16;  // 128-bit

/** Cache resolved key buffers so we don't re-parse env vars on every call. */
const keyCache = new Map<string, Buffer>();

function getKey(version: string): Buffer {
  const cached = keyCache.get(version);
  if (cached) return cached;

  const envName = `EVENTS_ENCRYPTION_KEY_${version.toUpperCase()}`;
  const hex = process.env[envName];
  if (!hex || hex.length !== 64) {
    throw new Error(
      `${envName} must be a 64-char hex string (32 bytes). ` +
      `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  const buf = Buffer.from(hex, 'hex');
  keyCache.set(version, buf);
  return buf;
}

function getCurrentVersion(): string {
  return process.env.EVENTS_ENCRYPTION_KEY_CURRENT || 'v1';
}

/**
 * Encrypt a JSON-serializable value.
 * Returns a versioned string: "v1:base64(iv + authTag + ciphertext)"
 */
export function encryptEvents(events: unknown): string {
  const version = getCurrentVersion();
  const key = getKey(version);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const plaintext = JSON.stringify(events);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return `${version}:${packed}`;
}

/**
 * Decrypt a versioned encrypted string back to the original value.
 */
export function decryptEvents(encoded: string): unknown {
  const colonIdx = encoded.indexOf(':');
  if (colonIdx === -1) {
    throw new Error('Invalid encrypted events format — missing version prefix');
  }
  const version = encoded.slice(0, colonIdx);
  const base64 = encoded.slice(colonIdx + 1);
  const key = getKey(version);
  const buf = Buffer.from(base64, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Check whether a stored events value is encrypted (versioned string)
 * or legacy plaintext (JSON array). Enables rolling migration.
 */
export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && /^v\d+:/.test(value);
}

/**
 * Safely decrypt events, handling both encrypted and legacy formats.
 */
export function decryptEventsIfNeeded(value: unknown): unknown {
  if (isEncrypted(value)) {
    return decryptEvents(value as string);
  }
  return value;
}
