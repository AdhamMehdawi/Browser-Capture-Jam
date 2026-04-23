import { Router } from "express";
import { db } from "@workspace/db";
import { recordingsTable, usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "../middlewares/requireAuth";

// Mock mode for local development (no Clerk required)
const MOCK_AUTH = !process.env.CLERK_SECRET_KEY || process.env.MOCK_AUTH === "true";

// Try to import Clerk client
let clerkClient: (() => Promise<any>) | null = null;
if (!MOCK_AUTH) {
  try {
    const clerk = await import("@clerk/express");
    clerkClient = clerk.clerkClient;
  } catch {
    console.warn("[user] Clerk not available, using mock user data");
  }
}

const router = Router();

router.get("/me", requireAuth, async (req: any, res) => {
  try {
    const userId = req.userId;

    let email: string | null = null;
    let firstName: string | null = null;
    let lastName: string | null = null;

    // Try to get user info from Clerk if available
    if (clerkClient) {
      try {
        const clerk = await clerkClient();
        const user = await clerk.users.getUser(userId);
        email = user.emailAddresses[0]?.emailAddress ?? null;
        firstName = user.firstName;
        lastName = user.lastName;
      } catch {}
    }

    // Mock user data for local development
    if (MOCK_AUTH && !email) {
      email = "mo@menatal.com";
      firstName = "Mohammad";
      lastName = "Makhamreh";
    }

    const [{ count: totalRecordings }] = await db
      .select({ count: count() })
      .from(recordingsTable)
      .where(eq(recordingsTable.userId, userId));

    const userRow = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    res.json({
      userId,
      email,
      firstName,
      lastName,
      totalRecordings: Number(totalRecordings),
      apiKeyPreview: userRow[0]?.apiKeyPreview ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get user profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/me/api-key", requireAuth, async (req: any, res) => {
  try {
    const userId = req.userId;
    const apiKey = `sc_${crypto.randomBytes(24).toString("hex")}`;
    const apiKeyPreview = `sc_${"•".repeat(20)}${apiKey.slice(-4)}`;

    await db
      .insert(usersTable)
      .values({ id: userId, apiKey, apiKeyPreview })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: { apiKey, apiKeyPreview, updatedAt: new Date() },
      });

    res.json({ apiKey });
  } catch (err) {
    req.log.error({ err }, "Failed to generate API key");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/verify-clerk-token
 *
 * Validates a Clerk JWT token and returns user info. Used by the Chrome extension
 * to authenticate using Clerk session.
 */
router.post("/auth/verify-clerk-token", requireAuth, async (req: any, res) => {
  try {
    const userId = req.userId;

    // Get user info from Clerk if available
    let email: string | null = null;
    let firstName: string | null = null;
    let lastName: string | null = null;

    if (clerkClient) {
      try {
        const clerk = await clerkClient();
        const clerkUser = await clerk.users.getUser(userId);
        email = clerkUser.emailAddresses[0]?.emailAddress ?? null;
        firstName = clerkUser.firstName;
        lastName = clerkUser.lastName;
      } catch {}
    }

    // Mock user data for local development
    if (MOCK_AUTH && !email) {
      email = "mo@menatal.com";
      firstName = "Mohammad";
      lastName = "Makhamreh";
    }

    res.json({
      userId,
      email,
      name: firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to verify Clerk token");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/verify-api-key
 *
 * Validates an API key and returns user info. Used by the Chrome extension
 * to authenticate without requiring Clerk session.
 */
router.post("/auth/verify-api-key", async (req: any, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== "string" || !apiKey.startsWith("sc_")) {
      return res.status(400).json({ error: "Invalid API key format" });
    }

    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.apiKey, apiKey))
      .limit(1);

    if (!rows.length) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    const user = rows[0];

    // Get user info from Clerk if available
    let email: string | null = null;
    let firstName: string | null = null;
    let lastName: string | null = null;

    if (clerkClient) {
      try {
        const clerk = await clerkClient();
        const clerkUser = await clerk.users.getUser(user.id);
        email = clerkUser.emailAddresses[0]?.emailAddress ?? null;
        firstName = clerkUser.firstName;
        lastName = clerkUser.lastName;
      } catch {}
    }

    // Mock user data for local development
    if (MOCK_AUTH && !email) {
      email = "mo@menatal.com";
      firstName = "Mohammad";
      lastName = "Makhamreh";
    }

    res.json({
      userId: user.id,
      email,
      name: firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to verify API key");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
