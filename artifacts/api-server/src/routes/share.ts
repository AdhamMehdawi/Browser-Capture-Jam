import { Router } from "express";
import { db } from "@workspace/db";
import { recordingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/share/:token", async (req: any, res) => {
  try {
    const [recording] = await db
      .select()
      .from(recordingsTable)
      .where(eq(recordingsTable.shareToken, req.params.token));

    if (!recording) return res.status(404).json({ error: "Not found or sharing disabled" });

    res.json({
      id: recording.id,
      userId: recording.userId,
      title: recording.title,
      duration: recording.duration,
      createdAt: recording.createdAt,
      pageUrl: recording.pageUrl,
      pageTitle: recording.pageTitle,
      networkLogsCount: recording.networkLogsCount,
      errorCount: recording.errorCount,
      consoleCount: recording.consoleCount,
      clickCount: recording.clickCount,
      videoObjectPath: recording.videoObjectPath,
      thumbnailObjectPath: recording.thumbnailObjectPath,
      shareToken: recording.shareToken,
      tags: recording.tags,
      browserInfo: recording.browserInfo,
      events: recording.events,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get shared recording");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
