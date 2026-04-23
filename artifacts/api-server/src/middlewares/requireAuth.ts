import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Mock mode for local development (no Clerk required)
const MOCK_AUTH = !process.env.CLERK_SECRET_KEY || process.env.MOCK_AUTH === "true";

// Try to import Clerk, but don't fail if it's not configured
let getAuth: ((req: Request) => { userId?: string | null } | null) | null = null;
if (!MOCK_AUTH) {
  try {
    const clerk = await import("@clerk/express");
    getAuth = clerk.getAuth;
  } catch {
    console.warn("[auth] Clerk not available, using mock auth");
  }
}

/**
 * Resolves the authenticated user id from either:
 *   1. A Clerk session (cookie-based, used by the dashboard)
 *   2. An `Authorization: Bearer sc_...` API key (used by the Chrome
 *      extension and any other programmatic client)
 *   3. Mock auth for local development (demo_user)
 *
 * The api-zod user route generates these keys, the usersTable persists
 * them, and this middleware is the one place that maps either credential
 * form to `req.userId` so downstream route handlers don't have to care.
 *
 * Checks Clerk first because it's the common case for dashboard traffic
 * and avoids an extra DB roundtrip. API-key lookup only runs when there's
 * no Clerk session and the request carries a Bearer that looks like one
 * of our keys.
 */
async function resolveUserId(req: Request): Promise<string | null> {
  // Try Clerk auth first (if available)
  if (getAuth) {
    const clerkUserId = getAuth(req)?.userId;
    if (clerkUserId) return clerkUserId;
  }

  // Check for API key or JWT auth
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();

    // Check if it's our API key format (sc_ prefix)
    if (token.startsWith("sc_") && token.length >= 16) {
      const rows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.apiKey, token))
        .limit(1);
      if (rows[0]?.id) return rows[0].id;
    }

    // Check if it looks like a JWT (has 3 dot-separated parts)
    // This handles Clerk JWTs sent from the extension
    if (token.split('.').length === 3) {
      try {
        // Decode the JWT payload to get the user ID (sub claim)
        // JWTs use base64url encoding
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        if (payload.sub) {
          return payload.sub;
        }
      } catch {
        // Invalid JWT format, continue to other auth methods
      }
    }
  }

  // Mock auth for local development - allow unauthenticated requests
  if (MOCK_AUTH) {
    return "demo_user";
  }

  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    (req as any).userId = userId;
    next();
  } catch (err) {
    (req as any).log?.error?.({ err }, "requireAuth failed");
    res.status(500).json({ error: "Auth resolution failed" });
  }
}

export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    (req as any).userId = await resolveUserId(req);
  } catch {
    (req as any).userId = null;
  }
  next();
}
