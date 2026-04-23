import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth";
import path from "path";
import fs from "fs";
import { db, recordingsTable } from "@workspace/db";

const router = Router();

// Local storage mode - originally for Replit development.
// On ACA / any read-only FS this fails; swallow the error so the server still
// boots. /jams upload endpoints will fail until this is reworked to use Azure
// Blob (tracked in infra/TRACKER.md as follow-up work).
const LOCAL_MEDIA_DIR = path.join(process.cwd(), ".data", "media");
try {
  if (!fs.existsSync(LOCAL_MEDIA_DIR)) {
    fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });
  }
} catch (err) {
  console.warn("[jams] local media dir not writable; /jams uploads will fail:", err);
}

/**
 * POST /jams
 *
 * Accepts recordings from the Chrome extension in the "Jam" format and stores
 * them as recordings in the database. This endpoint bridges the extension's
 * payload format to the dashboard's recording format.
 */
router.post("/jams", requireAuth, async (req: any, res) => {
  console.log("[jams] Route hit, content-length:", req.headers["content-length"], "content-type:", req.headers["content-type"]);
  try {
    const body = req.body;
    const userId = req.userId;

    console.log("[jams] POST /jams received", {
      userId,
      hasMedia: !!body.media,
      mediaKind: body.media?.kind,
      dataUrlLength: body.media?.dataUrl?.length ?? 0,
      dataUrlPrefix: body.media?.dataUrl?.slice(0, 80),
      bodyKeys: Object.keys(body),
      mediaKeys: body.media ? Object.keys(body.media) : [],
    });

    // Transform extension events to dashboard format
    const events: any[] = [];

    // Transform console logs
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

    // Transform network requests
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

    // Transform user actions (clicks, inputs, selects, submits, navigations)
    if (Array.isArray(body.actions)) {
      for (const action of body.actions) {
        events.push({
          id: randomUUID(),
          type: action.type, // click, input, select, submit, navigation
          timestamp: action.timestamp || Date.now(),
          selector: action.selector || "",
          selectorAlts: action.selectorAlts || [],
          url: action.url || "",
          value: action.value,
          // Flatten target metadata for easier display in dashboard
          targetTag: action.target?.tag,
          targetText: action.target?.text,
          targetRole: action.target?.role,
          inputType: action.target?.inputType,
          targetName: action.target?.name,
        });
      }
    }

    // Calculate counts
    const networkLogsCount = events.filter((e) => e.type === "request").length;
    const errorCount = events.filter(
      (e) =>
        (e.type === "request" && (e.error || (e.status && e.status >= 400))) ||
        (e.type === "console" && e.level === "error")
    ).length;
    const consoleCount = events.filter((e) => e.type === "console").length;
    const clickCount = events.filter((e) => e.type === "click").length;
    const actionsCount = events.filter((e) => ["click", "input", "select", "submit", "navigation"].includes(e.type)).length;

    console.log("[jams] Transformed events:", {
      total: events.length,
      network: networkLogsCount,
      console: consoleCount,
      actions: actionsCount,
      clicks: clickCount,
      errors: errorCount,
    });

    // Handle video/screenshot upload - store locally
    let videoObjectPath: string | null = null;

    if (body.media?.dataUrl) {
      console.log("[jams] Processing media.dataUrl, length:", body.media.dataUrl.length);
      try {
        // Match data URLs with optional parameters like codecs=vp8
        // Format: data:video/webm;codecs=vp8;base64,DATA or data:image/png;base64,DATA
        const matches = body.media.dataUrl.match(/^data:([^;]+)(;[^;]+)*;base64,(.+)$/);
        console.log("[jams] Regex match result:", matches ? `matched, contentType=${matches[1]}` : "NO MATCH");
        if (matches) {
          const contentType = matches[1];
          const base64Data = matches[3]; // Group 3 because group 2 captures optional params like ;codecs=vp8
          const binaryData = Buffer.from(base64Data, "base64");

          // Determine file extension from content type
          let ext = "bin";
          if (contentType.includes("png")) ext = "png";
          else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
          else if (contentType.includes("webm")) ext = "webm";
          else if (contentType.includes("mp4")) ext = "mp4";

          // Save to local file
          const mediaId = randomUUID();
          const fileName = `${mediaId}.${ext}`;
          const filePath = path.join(LOCAL_MEDIA_DIR, fileName);
          fs.writeFileSync(filePath, binaryData);

          // Use /objects/local/ prefix so dashboard can fetch via /api/storage/local/xxx
          videoObjectPath = `/objects/local/${fileName}`;
          console.log("[jams] Media saved successfully:", { videoObjectPath, size: binaryData.length });
        }
      } catch (uploadErr) {
        console.error("[jams] Media save failed:", uploadErr);
        videoObjectPath = null;
      }
    } else {
      console.log("[jams] No media.dataUrl in body");
    }

    // Create recording in database using Drizzle ORM
    const title = body.title || body.page?.title || "Untitled Recording";
    const duration = body.durationMs || 0;
    const pageUrl = body.page?.url ?? null;
    const pageTitle = body.page?.title ?? null;
    const browserInfo = body.device ?? null;

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
        videoObjectPath,
        tags: [],
        events,
        browserInfo,
      })
      .returning();

    // Build response URL for the dashboard
    const dashboardUrl = `http://localhost:3001/recordings/${recording.id}`;

    res.status(201).json({
      id: recording.id,
      url: dashboardUrl,
    });
  } catch (err) {
    req.log?.error?.({ err }, "Failed to create jam/recording");
    console.error("Failed to create jam/recording:", err);
    res.status(500).json({ error: { code: "internal_error", message: "Failed to create recording" } });
  }
});

/**
 * GET /local-media/:filename
 * Serves locally stored media files
 */
router.get("/local-media/:filename", (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(LOCAL_MEDIA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Media not found" });
  }

  // Determine content type
  let contentType = "application/octet-stream";
  if (filename.endsWith(".png")) contentType = "image/png";
  else if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) contentType = "image/jpeg";
  else if (filename.endsWith(".webm")) contentType = "video/webm";
  else if (filename.endsWith(".mp4")) contentType = "video/mp4";

  res.setHeader("Content-Type", contentType);
  fs.createReadStream(filePath).pipe(res);
});

export default router;
