import { Router } from "express";
import { db } from "@workspace/db";
import { recordingsTable, usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import crypto from "crypto";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/me", requireAuth, async (req: any, res) => {
  try {
    const userId = req.userId;

    const clerk = await clerkClient();
    let email: string | null = null;
    let firstName: string | null = null;
    let lastName: string | null = null;

    try {
      const user = await clerk.users.getUser(userId);
      email = user.emailAddresses[0]?.emailAddress ?? null;
      firstName = user.firstName;
      lastName = user.lastName;
    } catch {}

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

export default router;
