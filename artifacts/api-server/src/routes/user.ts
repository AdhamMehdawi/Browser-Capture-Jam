import { Router } from "express";
import { db } from "@workspace/db";
import { recordingsTable, usersTable } from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { decryptEventsIfNeeded } from "../lib/encryption";

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

// ── GDPR: Right to Erasure ──────────────────────────────────────────
router.delete("/me", requireAuth, async (req: any, res) => {
  try {
    const userId = req.userId;

    // 1. Collect blob paths before deleting DB rows
    const recordings = await db
      .select({
        videoObjectPath: recordingsTable.videoObjectPath,
        thumbnailObjectPath: recordingsTable.thumbnailObjectPath,
        trimmedVideoObjectPath: recordingsTable.trimmedVideoObjectPath,
      })
      .from(recordingsTable)
      .where(eq(recordingsTable.userId, userId));

    // 2. DB first (transaction) — safer than blobs first
    await db.delete(recordingsTable).where(eq(recordingsTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));

    // 3. Best-effort blob cleanup (don't fail if a blob is already gone)
    const objectStorageService = new ObjectStorageService();
    for (const rec of recordings) {
      if (rec.videoObjectPath) {
        await objectStorageService.deleteBlob(rec.videoObjectPath).catch(() => {});
      }
      if (rec.thumbnailObjectPath) {
        await objectStorageService.deleteBlob(rec.thumbnailObjectPath).catch(() => {});
      }
      if (rec.trimmedVideoObjectPath) {
        await objectStorageService.deleteBlob(rec.trimmedVideoObjectPath).catch(() => {});
      }
    }

    // 4. Best-effort Clerk user deletion
    if (clerkClient) {
      try {
        const clerk = await clerkClient();
        await clerk.users.deleteUser(userId);
      } catch (e) {
        req.log?.warn?.({ err: e }, "Failed to delete Clerk user (continuing)");
      }
    }

    res.status(204).send();
  } catch (err) {
    req.log?.error?.({ err }, "Failed to delete account");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GDPR: Right to Data Portability ─────────────────────────────────
router.get("/me/export", requireAuth, async (req: any, res) => {
  try {
    const userId = req.userId;

    // Get user info
    let email: string | null = null;
    let firstName: string | null = null;
    let lastName: string | null = null;

    if (clerkClient) {
      try {
        const clerk = await clerkClient();
        const user = await clerk.users.getUser(userId);
        email = user.emailAddresses[0]?.emailAddress ?? null;
        firstName = user.firstName;
        lastName = user.lastName;
      } catch {}
    }

    if (MOCK_AUTH && !email) {
      email = "demo@example.com";
      firstName = "Demo";
      lastName = "User";
    }

    // Stream response to avoid OOM on large accounts
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="velocap-export-${userId}-${Date.now()}.json"`,
    );

    res.write('{"exportedAt":' + JSON.stringify(new Date().toISOString()));
    res.write(',"user":' + JSON.stringify({ id: userId, email, firstName, lastName }));
    res.write(',"recordings":[');

    const BATCH_SIZE = 50;
    let offset = 0;
    let first = true;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await db
        .select()
        .from(recordingsTable)
        .where(eq(recordingsTable.userId, userId))
        .orderBy(desc(recordingsTable.createdAt))
        .limit(BATCH_SIZE)
        .offset(offset);

      for (const r of batch) {
        if (!first) res.write(",");
        first = false;
        res.write(JSON.stringify({
          id: r.id,
          title: r.title,
          duration: r.duration,
          pageUrl: r.pageUrl,
          pageTitle: r.pageTitle,
          createdAt: r.createdAt,
          tags: r.tags,
          browserInfo: r.browserInfo,
          events: decryptEventsIfNeeded(r.events),
        }));
      }

      if (batch.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }

    res.write("]}");
    res.end();
  } catch (err) {
    req.log?.error?.({ err }, "Failed to export user data");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.end();
    }
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
