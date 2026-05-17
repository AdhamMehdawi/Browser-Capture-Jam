import { Router } from "express";
import { db } from "@workspace/db";
import { recordingsTable } from "@workspace/db";
import { eq, and, desc, sql, ilike, or } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { decryptEventsIfNeeded } from "../lib/encryption";

const objectStorageService = new ObjectStorageService();

const router = Router();

router.use(requireAuth);

router.get("/recordings", async (req: any, res) => {
  try {
    const page = parseInt(String(req.query.page || "1"));
    const limit = Math.min(parseInt(String(req.query.limit || "20")), 100);
    const offset = (page - 1) * limit;
    const search = req.query.search as string | undefined;
    const tag = req.query.tag as string | undefined;

    let query = db
      .select()
      .from(recordingsTable)
      .where(
        and(
          eq(recordingsTable.userId, req.userId),
          search
            ? or(
                ilike(recordingsTable.title, `%${search}%`),
                ilike(recordingsTable.pageUrl ?? sql`''`, `%${search}%`),
              )
            : undefined,
          tag
            ? sql`${recordingsTable.tags} @> ARRAY[${tag}]::text[]`
            : undefined,
        ),
      )
      .orderBy(desc(recordingsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const recordings = await query;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(recordingsTable)
      .where(eq(recordingsTable.userId, req.userId));

    const sanitized = recordings.map(sanitizeRecording);

    res.json({ recordings: sanitized, total: Number(count), page, limit });
  } catch (err) {
    req.log.error({ err }, "Failed to list recordings");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/recordings", async (req: any, res) => {
  try {
    const body = req.body;
    const events = Array.isArray(body.events) ? body.events : [];

    const networkLogsCount = events.filter((e: any) => e.type === "request").length;
    const errorCount = events.filter(
      (e: any) =>
        (e.type === "request" && (e.error || (e.status && e.status >= 400))) ||
        (e.type === "console" && e.level === "error"),
    ).length;
    const consoleCount = events.filter((e: any) => e.type === "console").length;
    const clickCount = events.filter((e: any) => e.type === "click").length;

    const [recording] = await db
      .insert(recordingsTable)
      .values({
        userId: req.userId,
        title: body.title || "Untitled Recording",
        duration: body.duration || 0,
        pageUrl: body.pageUrl ?? null,
        pageTitle: body.pageTitle ?? null,
        tags: body.tags || [],
        events: events,
        networkLogsCount,
        errorCount,
        consoleCount,
        clickCount,
        videoObjectPath: body.videoObjectPath ?? null,
        browserInfo: body.browserInfo ?? null,
      })
      .returning();

    res.status(201).json(sanitizeRecording(recording));
  } catch (err) {
    req.log.error({ err }, "Failed to create recording");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/recordings/stats", async (req: any, res) => {
  try {
    const userId = req.userId;

    const [totals] = await db
      .select({
        totalRecordings: sql<number>`count(*)`,
        totalDuration: sql<number>`coalesce(sum(${recordingsTable.duration}), 0)`,
        totalRequests: sql<number>`coalesce(sum(${recordingsTable.networkLogsCount}), 0)`,
        totalErrors: sql<number>`coalesce(sum(${recordingsTable.errorCount}), 0)`,
      })
      .from(recordingsTable)
      .where(eq(recordingsTable.userId, userId));

    // Feature #1 (design): 7-day windowed stats for the dashboard stats strip,
    // each paired with the prior 7-day window so we can show a delta. All
    // counts derive from existing columns — no new tables.
    const [window7d] = await db
      .select({
        captures: sql<number>`count(*) filter (where ${recordingsTable.createdAt} >= now() - interval '7 days')`,
        capturesPrev: sql<number>`count(*) filter (where ${recordingsTable.createdAt} >= now() - interval '14 days' and ${recordingsTable.createdAt} < now() - interval '7 days')`,
        avgDuration: sql<number>`coalesce(avg(${recordingsTable.duration}) filter (where ${recordingsTable.createdAt} >= now() - interval '7 days'), 0)`,
        avgDurationPrev: sql<number>`coalesce(avg(${recordingsTable.duration}) filter (where ${recordingsTable.createdAt} >= now() - interval '14 days' and ${recordingsTable.createdAt} < now() - interval '7 days'), 0)`,
        errors: sql<number>`coalesce(sum(${recordingsTable.errorCount}) filter (where ${recordingsTable.createdAt} >= now() - interval '7 days'), 0)`,
        errorsPrev: sql<number>`coalesce(sum(${recordingsTable.errorCount}) filter (where ${recordingsTable.createdAt} >= now() - interval '14 days' and ${recordingsTable.createdAt} < now() - interval '7 days'), 0)`,
        openShareLinks: sql<number>`count(*) filter (where ${recordingsTable.shareToken} is not null)`,
        openShareLinks7dNew: sql<number>`count(*) filter (where ${recordingsTable.shareToken} is not null and ${recordingsTable.createdAt} >= now() - interval '7 days')`,
      })
      .from(recordingsTable)
      .where(eq(recordingsTable.userId, userId));

    // Per-day series for the last 30 days — drives all four stat-card
    // sparklines. One query, four aggregates so we don't round-trip 4×.
    const seriesByDay = await db
      .select({
        date: sql<string>`to_char(${recordingsTable.createdAt}::date, 'YYYY-MM-DD')`,
        captures: sql<number>`count(*)`,
        errors: sql<number>`coalesce(sum(${recordingsTable.errorCount}), 0)`,
        avgDuration: sql<number>`coalesce(avg(${recordingsTable.duration}), 0)`,
        shares: sql<number>`count(*) filter (where ${recordingsTable.shareToken} is not null)`,
      })
      .from(recordingsTable)
      .where(
        and(
          eq(recordingsTable.userId, userId),
          sql`${recordingsTable.createdAt} >= now() - interval '30 days'`,
        ),
      )
      .groupBy(sql`${recordingsTable.createdAt}::date`)
      .orderBy(sql`${recordingsTable.createdAt}::date`);

    // Keep the existing capturesByDay shape for back-compat consumers; the
    // new series ride alongside it.
    const capturesByDay = seriesByDay.map((r) => ({ date: r.date, count: Number(r.captures) }));
    const errorsByDay = seriesByDay.map((r) => ({ date: r.date, count: Number(r.errors) }));
    const avgDurationByDay = seriesByDay.map((r) => ({ date: r.date, ms: Number(r.avgDuration) }));
    const sharesByDay = seriesByDay.map((r) => ({ date: r.date, count: Number(r.shares) }));

    const recentActivity = await db
      .select()
      .from(recordingsTable)
      .where(eq(recordingsTable.userId, userId))
      .orderBy(desc(recordingsTable.createdAt))
      .limit(5);

    const topErrorPages = await db
      .select({
        pageUrl: recordingsTable.pageUrl,
        errorCount: sql<number>`sum(${recordingsTable.errorCount})`,
      })
      .from(recordingsTable)
      .where(
        and(
          eq(recordingsTable.userId, userId),
          sql`${recordingsTable.pageUrl} is not null`,
          sql`${recordingsTable.errorCount} > 0`,
        ),
      )
      .groupBy(recordingsTable.pageUrl)
      .orderBy(desc(sql`sum(${recordingsTable.errorCount})`))
      .limit(5);

    const requestsByDay = await db
      .select({
        date: sql<string>`to_char(${recordingsTable.createdAt}::date, 'YYYY-MM-DD')`,
        count: sql<number>`sum(${recordingsTable.networkLogsCount})`,
      })
      .from(recordingsTable)
      .where(
        and(
          eq(recordingsTable.userId, userId),
          sql`${recordingsTable.createdAt} >= now() - interval '30 days'`,
        ),
      )
      .groupBy(sql`${recordingsTable.createdAt}::date`)
      .orderBy(sql`${recordingsTable.createdAt}::date`);

    const avgErrorRate =
      Number(totals.totalRequests) > 0
        ? Number(totals.totalErrors) / Number(totals.totalRequests)
        : 0;

    res.json({
      // Lifetime totals (existing fields — kept for backward compatibility).
      totalRecordings: Number(totals.totalRecordings),
      totalDuration: Number(totals.totalDuration),
      totalRequests: Number(totals.totalRequests),
      totalErrors: Number(totals.totalErrors),
      avgErrorRate,
      recentActivity: recentActivity.map(sanitizeRecording),
      topErrorPages: topErrorPages.map((r) => ({
        pageUrl: r.pageUrl ?? "",
        errorCount: Number(r.errorCount),
      })),
      requestsByDay: requestsByDay.map((r) => ({
        date: r.date,
        count: Number(r.count),
      })),
      // Feature #1 (design): 7-day windowed stats with prior-7d for deltas.
      captures7d: Number(window7d.captures),
      captures7dPrev: Number(window7d.capturesPrev),
      avgDuration7dMs: Number(window7d.avgDuration),
      avgDuration7dPrevMs: Number(window7d.avgDurationPrev),
      errors7d: Number(window7d.errors),
      errors7dPrev: Number(window7d.errorsPrev),
      openShareLinks: Number(window7d.openShareLinks),
      openShareLinks7dNew: Number(window7d.openShareLinks7dNew),
      capturesByDay,
      errorsByDay,
      avgDurationByDay,
      sharesByDay,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/recordings/:id", async (req: any, res) => {
  try {
    const [recording] = await db
      .select()
      .from(recordingsTable)
      .where(
        and(
          eq(recordingsTable.id, req.params.id),
          eq(recordingsTable.userId, req.userId),
        ),
      );

    if (!recording) return res.status(404).json({ error: "Not found" });

    res.json({ ...sanitizeRecording(recording), events: decryptEventsIfNeeded(recording.events) });
  } catch (err) {
    req.log.error({ err }, "Failed to get recording");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/recordings/:id", async (req: any, res) => {
  try {
    const body = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.tags !== undefined) updates.tags = body.tags;
    if (body.trimStartMs !== undefined) {
      updates.trimStartMs = body.trimStartMs === null ? null : Number(body.trimStartMs);
      // Invalidate cached trimmed video when trim points change
      updates.trimmedVideoObjectPath = null;
    }
    if (body.trimEndMs !== undefined) {
      updates.trimEndMs = body.trimEndMs === null ? null : Number(body.trimEndMs);
      updates.trimmedVideoObjectPath = null;
    }

    const [recording] = await db
      .update(recordingsTable)
      .set(updates)
      .where(
        and(
          eq(recordingsTable.id, req.params.id),
          eq(recordingsTable.userId, req.userId),
        ),
      )
      .returning();

    if (!recording) return res.status(404).json({ error: "Not found" });

    res.json(sanitizeRecording(recording));
  } catch (err) {
    req.log.error({ err }, "Failed to update recording");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/recordings/:id", async (req: any, res) => {
  try {
    const [deleted] = await db
      .delete(recordingsTable)
      .where(
        and(
          eq(recordingsTable.id, req.params.id),
          eq(recordingsTable.userId, req.userId),
        ),
      )
      .returning();

    if (!deleted) return res.status(404).json({ error: "Not found" });

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete recording");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/recordings/:id/share", async (req: any, res) => {
  try {
    // Fix Issue 3: make this endpoint idempotent. Previously every call
    // generated a fresh random token and overwrote any existing one — which
    // silently invalidated any link the user had already copied/sent. Now
    // we look up the recording first and reuse its existing token when one
    // is already present. Caller can DELETE the token explicitly to rotate.
    const existing = await db
      .select({ shareToken: recordingsTable.shareToken })
      .from(recordingsTable)
      .where(
        and(
          eq(recordingsTable.id, req.params.id),
          eq(recordingsTable.userId, req.userId),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    let shareToken = existing[0].shareToken;
    if (!shareToken) {
      shareToken = crypto.randomBytes(16).toString("hex");
      await db
        .update(recordingsTable)
        .set({ shareToken, updatedAt: new Date() })
        .where(
          and(
            eq(recordingsTable.id, req.params.id),
            eq(recordingsTable.userId, req.userId),
          ),
        );
    }

    const host =
      req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const shareUrl = `${protocol}://${host}/share/${shareToken}`;

    res.json({ shareToken, shareUrl });
  } catch (err) {
    req.log.error({ err }, "Failed to create share link");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/recordings/:id/share", async (req: any, res) => {
  try {
    const [recording] = await db
      .update(recordingsTable)
      .set({ shareToken: null, updatedAt: new Date() })
      .where(
        and(
          eq(recordingsTable.id, req.params.id),
          eq(recordingsTable.userId, req.userId),
        ),
      )
      .returning();

    if (!recording) return res.status(404).json({ error: "Not found" });

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to remove share link");
    res.status(500).json({ error: "Internal server error" });
  }
});

function sanitizeRecording(r: typeof recordingsTable.$inferSelect) {
  // Handle tags - Drizzle with SQLite returns malformed data when schema
  // uses .array() but SQLite stores as TEXT. Parse carefully.
  let tags: string[] = [];
  const rawTags = r.tags as unknown;
  if (Array.isArray(rawTags)) {
    // If it looks like a character array from JSON (e.g., ['[', ']']), reconstruct and parse
    const allSingleChars = rawTags.every((t: unknown) => typeof t === 'string' && t.length === 1);
    if (allSingleChars && rawTags.length > 0) {
      const joined = rawTags.join('');
      try {
        const parsed = JSON.parse(joined);
        tags = Array.isArray(parsed) ? parsed.filter((t: unknown) => typeof t === 'string') : [];
      } catch {
        tags = [];
      }
    } else {
      // Proper array of tag strings
      tags = rawTags.filter((t: unknown) => typeof t === 'string' && t.length > 1);
    }
  } else if (typeof rawTags === 'string') {
    try {
      const parsed = JSON.parse(rawTags);
      tags = Array.isArray(parsed) ? parsed : [];
    } catch {
      tags = [];
    }
  }

  // Handle browserInfo - could be object or JSON string
  let browserInfo = r.browserInfo;
  if (typeof browserInfo === 'string') {
    try {
      browserInfo = JSON.parse(browserInfo);
    } catch {
      browserInfo = null;
    }
  }

  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    duration: r.duration,
    createdAt: r.createdAt,
    pageUrl: r.pageUrl,
    pageTitle: r.pageTitle,
    networkLogsCount: r.networkLogsCount,
    errorCount: r.errorCount,
    consoleCount: r.consoleCount,
    clickCount: r.clickCount,
    videoObjectPath: r.videoObjectPath,
    thumbnailObjectPath: r.thumbnailObjectPath,
    videoUrl: objectStorageService.getReadOnlySasUrl(r.videoObjectPath),
    thumbnailUrl: objectStorageService.getReadOnlySasUrl(r.thumbnailObjectPath),
    trimStartMs: r.trimStartMs,
    trimEndMs: r.trimEndMs,
    shareToken: r.shareToken,
    tags,
    browserInfo,
  };
}

export default router;
