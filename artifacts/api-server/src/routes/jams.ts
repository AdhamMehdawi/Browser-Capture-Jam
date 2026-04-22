import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

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

// Get the SQLite database directly for raw queries
function getDb() {
  const dbPath = path.join(process.cwd(), ".data", "local.db");
  return new Database(dbPath);
}

/**
 * POST /jams
 *
 * Accepts recordings from the Chrome extension in the "Jam" format and stores
 * them as recordings in the database. This endpoint bridges the extension's
 * payload format to the dashboard's recording format.
 */
router.post("/jams", requireAuth, async (req: any, res) => {
  try {
    const body = req.body;
    const userId = req.userId;

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
          timestamp: netReq.timestamp || Date.now(),
          method: netReq.method || "GET",
          url: netReq.url || "",
          status: netReq.status,
          statusText: netReq.statusText,
          requestHeaders: netReq.requestHeaders,
          responseHeaders: netReq.responseHeaders,
          requestBody: netReq.requestBody,
          responseBody: netReq.responseBody,
          duration: netReq.duration,
          error: netReq.error,
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

    // Handle video/screenshot upload - store locally
    let videoObjectPath: string | null = null;

    if (body.media?.dataUrl) {
      try {
        const matches = body.media.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          const contentType = matches[1];
          const base64Data = matches[2];
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

          videoObjectPath = `/local-media/${fileName}`;
          req.log?.info?.({ path: videoObjectPath }, "Media saved locally");
        }
      } catch (uploadErr) {
        req.log?.warn?.({ err: uploadErr }, "Media save failed, continuing without video");
        videoObjectPath = null;
      }
    }

    // Create recording in database using raw SQL (works with SQLite)
    const db = getDb();
    const recordingId = randomUUID().replace(/-/g, "");
    const title = body.title || body.page?.title || "Untitled Recording";
    const duration = body.durationMs || 0;
    const pageUrl = body.page?.url ?? null;
    const pageTitle = body.page?.title ?? null;
    const browserInfo = body.device ? JSON.stringify(body.device) : null;
    const eventsJson = JSON.stringify(events);
    const tagsJson = JSON.stringify([]);

    const stmt = db.prepare(`
      INSERT INTO recordings (
        id, user_id, title, duration, page_url, page_title,
        network_logs_count, error_count, console_count, click_count,
        video_object_path, tags, events, browser_info
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      recordingId,
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
      tagsJson,
      eventsJson,
      browserInfo
    );

    db.close();

    // Build response URL for the dashboard
    const dashboardUrl = `http://localhost:3000/recordings/${recordingId}`;

    res.status(201).json({
      id: recordingId,
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
