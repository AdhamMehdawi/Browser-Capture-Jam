import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { db, recordingsTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();

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

    // Transform user actions (clicks, inputs, selects, submits, navigations,
    // and Issue 12's new event types: mouse / wheel / key / focus / visibility).
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
          // Flatten target metadata for easier display in dashboard
          targetTag: action.target?.tag,
          targetText: action.target?.text,
          targetRole: action.target?.role,
          inputType: action.target?.inputType,
          targetName: action.target?.name,
          // Issue 12: forward the new fields. Conditional spread keeps them
          // out of the JSONB blob when missing (instead of explicit nulls).
          ...(action.x != null ? { x: action.x } : {}),
          ...(action.y != null ? { y: action.y } : {}),
          ...(action.button != null ? { button: action.button } : {}),
          ...(action.deltaX != null ? { deltaX: action.deltaX } : {}),
          ...(action.deltaY != null ? { deltaY: action.deltaY } : {}),
          ...(action.scrollTop != null ? { scrollTop: action.scrollTop } : {}),
          ...(action.key != null ? { key: action.key } : {}),
          ...(action.ctrl != null ? { ctrl: action.ctrl } : {}),
          ...(action.shift != null ? { shift: action.shift } : {}),
          ...(action.alt != null ? { alt: action.alt } : {}),
          ...(action.meta != null ? { meta: action.meta } : {}),
          ...(action.state != null ? { state: action.state } : {}),
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

    // Upload video/screenshot to Azure Blob (the `assets` container). The
    // resulting /objects/<id>.<ext> path is served by the existing
    // /api/storage/objects/* route — no new route needed, and the bytes
    // survive container restarts.
    let videoObjectPath: string | null = null;

    if (body.media?.dataUrl) {
      console.log("[jams] Processing media.dataUrl, length:", body.media.dataUrl.length);
      try {
        // Format: data:video/webm;codecs=vp8;base64,DATA or data:image/png;base64,DATA
        const matches = body.media.dataUrl.match(/^data:([^;]+)(;[^;]+)*;base64,(.+)$/);
        console.log("[jams] Regex match result:", matches ? `matched, contentType=${matches[1]}` : "NO MATCH");
        if (matches) {
          const contentType = matches[1];
          const base64Data = matches[3];
          const binaryData = Buffer.from(base64Data, "base64");

          let ext = "bin";
          if (contentType.includes("png")) ext = "png";
          else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
          else if (contentType.includes("webm")) ext = "webm";
          else if (contentType.includes("mp4")) ext = "mp4";

          videoObjectPath = await objectStorageService.uploadBytes(binaryData, contentType, ext);
          console.log("[jams] Media uploaded to Blob:", { videoObjectPath, size: binaryData.length });
        }
      } catch (uploadErr) {
        console.error("[jams] Blob upload failed:", uploadErr);
        videoObjectPath = null;
      }
    } else {
      console.log("[jams] No media.dataUrl in body");
    }

    // Upload thumbnail to Blob Storage (non-fatal — recording works without it)
    let thumbnailObjectPath: string | null = null;

    if (body.thumbnail?.dataUrl) {
      try {
        const matches = body.thumbnail.dataUrl.match(/^data:([^;]+)(;[^;]+)*;base64,(.+)$/);
        if (matches) {
          const contentType = matches[1];
          const base64Data = matches[3];
          const binaryData = Buffer.from(base64Data, "base64");
          const ext = contentType.includes("png") ? "png" : "jpg";
          thumbnailObjectPath = await objectStorageService.uploadBytes(binaryData, contentType, ext);
          console.log("[jams] Thumbnail uploaded to Blob:", { thumbnailObjectPath, size: binaryData.length });
        }
      } catch (uploadErr) {
        console.error("[jams] Thumbnail upload failed (non-fatal):", uploadErr);
      }
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
        thumbnailObjectPath,
        tags: [],
        events,
        browserInfo,
      })
      .returning();

    const dashboardBase = process.env.DASHBOARD_URL || process.env.WEB_ORIGIN || 'http://localhost:3001';
    const dashboardUrl = `${dashboardBase}/recordings/${recording.id}`;

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

export default router;
