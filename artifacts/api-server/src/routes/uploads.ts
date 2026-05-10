import { Router } from "express";
import { randomUUID } from "crypto";
import { db, recordingsTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
const objectStorageService = new ObjectStorageService();

router.use(requireAuth);

// Initialize a streaming upload session. Returns a SAS URL for direct-to-Azure
// block uploads and a read-only SAS URL for preview after commit.
router.post("/uploads/init", async (req: any, res) => {
  try {
    const { contentType, ext } = req.body;
    if (!ext || typeof ext !== "string") {
      return res.status(400).json({ error: "ext is required" });
    }

    const { objectPath, uploadSasUrl } = objectStorageService.getBlockUploadSasUrl(ext);
    const readSasUrl = objectStorageService.getReadOnlySasUrl(objectPath);

    res.json({ uploadSasUrl, objectPath, readSasUrl });
  } catch (err) {
    req.log?.error?.({ err }, "Failed to init upload");
    res.status(500).json({ error: "Failed to initialize upload" });
  }
});

// Complete a streaming upload. The video/screenshot bytes are already in Azure
// (uploaded directly by the extension). This endpoint only receives metadata.
router.post("/uploads/complete", async (req: any, res) => {
  try {
    const userId = req.userId;
    const body = req.body;

    if (!body.objectPath || typeof body.objectPath !== "string") {
      return res.status(400).json({ error: "objectPath is required" });
    }

    // Transform events (same logic as POST /jams)
    const events: any[] = [];

    if (Array.isArray(body.console)) {
      for (const log of body.console) {
        events.push({
          id: randomUUID(),
          type: "console",
          timestamp: log.timestamp || Date.now(),
          level: log.level || "log",
          message: log.message || "",
          args: log.args,
          stack: log.stack,
        });
      }
    }

    if (Array.isArray(body.network)) {
      for (const netReq of body.network) {
        events.push({
          id: randomUUID(),
          type: "request",
          timestamp: netReq.timestamp || netReq.startedAt || Date.now(),
          method: netReq.method || "GET",
          url: netReq.url || "",
          status: netReq.status,
          statusText: netReq.statusText,
          requestHeaders: netReq.requestHeaders,
          responseHeaders: netReq.responseHeaders,
          requestBody: netReq.requestBody,
          responseBody: netReq.responseBody,
          duration: netReq.durationMs || netReq.duration,
          error: netReq.error,
        });
      }
    }

    if (Array.isArray(body.actions)) {
      for (const action of body.actions) {
        events.push({
          id: randomUUID(),
          type: action.type,
          timestamp: action.timestamp || Date.now(),
          selector: action.selector || "",
          selectorAlts: action.selectorAlts || [],
          url: action.url || "",
          value: action.value,
          targetTag: action.target?.tag,
          targetText: action.target?.text,
          targetRole: action.target?.role,
          inputType: action.target?.inputType,
          targetName: action.target?.name,
        });
      }
    }

    const networkLogsCount = events.filter((e) => e.type === "request").length;
    const errorCount = events.filter(
      (e) =>
        (e.type === "request" && (e.error || (e.status && e.status >= 400))) ||
        (e.type === "console" && e.level === "error"),
    ).length;
    const consoleCount = events.filter((e) => e.type === "console").length;
    const clickCount = events.filter((e) => e.type === "click").length;

    const title = body.title || body.page?.title || "Untitled Recording";
    const duration = body.durationMs || 0;
    const pageUrl = body.page?.url ?? null;
    const pageTitle = body.page?.title ?? null;
    const browserInfo = body.device ?? null;

    // Optional trim points (non-destructive — stored as metadata)
    const trimStartMs = typeof body.trimStartMs === "number" && body.trimStartMs >= 0 ? body.trimStartMs : null;
    const trimEndMs = typeof body.trimEndMs === "number" && body.trimEndMs > 0 ? body.trimEndMs : null;

    const [recording] = await db
      .insert(recordingsTable)
      .values({
        userId,
        title,
        duration,
        pageUrl,
        pageTitle,
        networkLogsCount,
        errorCount,
        consoleCount,
        clickCount,
        videoObjectPath: body.objectPath,
        thumbnailObjectPath: body.thumbnailObjectPath ?? null,
        trimStartMs,
        trimEndMs,
        tags: [],
        events,
        browserInfo,
      })
      .returning();

    const dashboardBase =
      process.env.DASHBOARD_URL || process.env.WEB_ORIGIN || "http://localhost:3001";

    res.status(201).json({
      id: recording.id,
      url: `${dashboardBase}/recordings/${recording.id}`,
    });
  } catch (err) {
    req.log?.error?.({ err }, "Failed to complete upload");
    console.error("Failed to complete upload:", err);
    res.status(500).json({ error: "Failed to complete upload" });
  }
});

// Discard a recording — delete the blob from Azure.
router.delete("/uploads/*objectPath", async (req: any, res) => {
  try {
    const objectPath = `/${req.params.objectPath}`;
    await objectStorageService.deleteBlob(objectPath);
    res.status(204).end();
  } catch (err) {
    req.log?.error?.({ err }, "Failed to discard upload");
    res.status(500).json({ error: "Failed to discard upload" });
  }
});

export default router;
