import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Resolves the authenticated user id from either:
 *   1. A Clerk session (cookie-based, used by the dashboard)
 *   2. An `Authorization: Bearer sc_...` API key (used by the Chrome
 *      extension and any other programmatic client)
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
  const clerkUserId = getAuth(req)?.userId;
  if (clerkUserId) return clerkUserId;

  const header = req.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  // Only treat strings we actually minted (`sc_` prefix from user.ts) as
  // candidates. Anything else is presumably a Clerk JWT handled elsewhere.
  if (!token.startsWith("sc_") || token.length < 16) return null;

  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.apiKey, token))
    .limit(1);
  return rows[0]?.id ?? null;
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
