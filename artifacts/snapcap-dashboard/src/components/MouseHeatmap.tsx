// ============================================================
// MouseHeatmap — Issue 12 visualization
//
// Heatmap of mousemoves layered on top of the recording's thumbnail so
// you can see WHERE on the actual page the user was looking, plus the
// path they traced and where they entered/left. Includes a timeline
// scrubber to replay mouse motion up to any video time.
//
// Shared by the authenticated recording page and the public share page —
// keep both surfaces visually identical.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";

type AnyEvent = Record<string, any>;

export interface MouseHeatmapProps {
  events: AnyEvent[];
  pageUrl: string | null;
  thumbnailUrl: string | null;
  viewport: { width: number; height: number } | null;
}

export function MouseHeatmap({
  events,
  pageUrl,
  thumbnailUrl,
  viewport,
}: MouseHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [thumbDims, setThumbDims] = useState<{ w: number; h: number } | null>(null);

  // Pull out mousemoves with valid coordinates AND compute their position in
  // video time. Video t=0 maps to the earliest event timestamp across the
  // whole recording (which is when MediaRecorder also started); subtracting
  // that gives a millisecond offset into the video.
  const recordingStartMs = useMemo(() => {
    let earliest = Infinity;
    for (const e of events) {
      if (typeof e.timestamp === "number" && e.timestamp < earliest) {
        earliest = e.timestamp;
      }
    }
    return earliest === Infinity ? 0 : earliest;
  }, [events]);

  const moves = useMemo(() => {
    const out: Array<{ x: number; y: number; t: number; videoMs: number }> = [];
    for (const e of events) {
      if (e.type !== "mousemove") continue;
      if (typeof e.x !== "number" || typeof e.y !== "number") continue;
      out.push({
        x: e.x,
        y: e.y,
        t: e.timestamp,
        videoMs: Math.max(0, e.timestamp - recordingStartMs),
      });
    }
    out.sort((a, b) => a.videoMs - b.videoMs);
    return out;
  }, [events, recordingStartMs]);

  // Timeline scrubber — defaults to end of timeline ("show everything").
  const totalVideoMs = moves.length > 0 ? moves[moves.length - 1].videoMs : 0;
  const [scrubMs, setScrubMs] = useState<number>(0);
  useEffect(() => {
    setScrubMs(totalVideoMs);
  }, [totalVideoMs]);

  const visibleMoves = useMemo(() => {
    if (scrubMs >= totalVideoMs) return moves;
    return moves.filter((m) => m.videoMs <= scrubMs);
  }, [moves, scrubMs, totalVideoMs]);

  const bounds = useMemo(() => {
    if (viewport && viewport.width > 0 && viewport.height > 0) {
      return { w: viewport.width, h: viewport.height };
    }
    if (moves.length === 0) return null;
    let maxX = 0;
    let maxY = 0;
    for (const m of moves) {
      if (m.x > maxX) maxX = m.x;
      if (m.y > maxY) maxY = m.y;
    }
    const w = Math.max(1280, Math.ceil(maxX / 100) * 100);
    const h = Math.max(720, Math.ceil(maxY / 100) * 100);
    return { w, h };
  }, [moves, viewport]);

  useEffect(() => {
    if (!thumbnailUrl) {
      setThumbDims(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setThumbDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setThumbDims(null);
    img.src = thumbnailUrl;
  }, [thumbnailUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds || visibleMoves.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, cssW, cssH);

    const scaleX = cssW / bounds.w;
    const scaleY = cssH / bounds.h;

    ctx.globalCompositeOperation = "lighter";
    const dotRadius = 32;
    for (const m of visibleMoves) {
      const x = m.x * scaleX;
      const y = m.y * scaleY;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, dotRadius);
      grad.addColorStop(0, "rgba(255, 64, 64, 0.35)");
      grad.addColorStop(0.4, "rgba(255, 180, 0, 0.18)");
      grad.addColorStop(0.75, "rgba(120, 80, 255, 0.08)");
      grad.addColorStop(1, "rgba(120, 80, 255, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
    ctx.lineWidth = 1.2;
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 2;
    ctx.beginPath();
    visibleMoves.forEach((m, i) => {
      const x = m.x * scaleX;
      const y = m.y * scaleY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    const drawMarker = (
      x: number,
      y: number,
      color: string,
      label: string,
      radius = 6,
    ) => {
      ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
      ctx.shadowBlur = 4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (label) {
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "bold 10px ui-monospace, monospace";
        ctx.fillText(label, x + radius + 3, y - radius);
      }
    };

    const first = visibleMoves[0];
    const last = visibleMoves[visibleMoves.length - 1];
    drawMarker(first.x * scaleX, first.y * scaleY, "#10b981", "start");

    if (scrubMs < totalVideoMs) {
      const cx = last.x * scaleX;
      const cy = last.y * scaleY;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.stroke();
      drawMarker(cx, cy, "#fbbf24", "now", 5);
    } else {
      drawMarker(last.x * scaleX, last.y * scaleY, "#ef4444", "end");
    }
  }, [visibleMoves, bounds, thumbDims, scrubMs, totalVideoMs]);

  const stats = useMemo(() => {
    if (moves.length === 0) return null;
    const durationMs = moves[moves.length - 1].t - moves[0].t;
    let pathPx = 0;
    for (let i = 1; i < moves.length; i++) {
      const dx = moves[i].x - moves[i - 1].x;
      const dy = moves[i].y - moves[i - 1].y;
      pathPx += Math.sqrt(dx * dx + dy * dy);
    }
    return {
      samples: moves.length,
      durationMs,
      pathPx: Math.round(pathPx),
    };
  }, [moves]);

  if (moves.length === 0) {
    const totalMousemoves = events.filter((e) => e.type === "mousemove").length;
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
        <p className="font-semibold mb-1">No mouse coordinates available</p>
        <p className="text-muted-foreground">
          {totalMousemoves > 0
            ? `This recording has ${totalMousemoves} mousemove events but no x/y coordinates. It was captured before the coordinate-storage fix landed — record a new clip with the latest extension to see the heatmap.`
            : "No mouse motion was captured during this recording."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-border bg-muted/30 p-2.5">
            <div className="text-muted-foreground">Samples</div>
            <div className="font-semibold text-base mt-0.5">{stats.samples.toLocaleString()}</div>
          </div>
          <div className="rounded border border-border bg-muted/30 p-2.5">
            <div className="text-muted-foreground">Duration</div>
            <div className="font-semibold text-base mt-0.5">
              {(stats.durationMs / 1000).toFixed(1)}s
            </div>
          </div>
          <div className="rounded border border-border bg-muted/30 p-2.5">
            <div className="text-muted-foreground">Path length</div>
            <div className="font-semibold text-base mt-0.5">
              {stats.pathPx.toLocaleString()} px
            </div>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg border border-border bg-black"
        style={{ aspectRatio: bounds ? `${bounds.w} / ${bounds.h}` : "16 / 9" }}
      >
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt="Recording thumbnail"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: 0.55 }}
          />
        )}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
      {totalVideoMs > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted-foreground">{(scrubMs / 1000).toFixed(2)}s</span>
            <span className="text-foreground/80">
              {visibleMoves.length.toLocaleString()} / {moves.length.toLocaleString()} samples
            </span>
            <span className="text-muted-foreground">{(totalVideoMs / 1000).toFixed(2)}s</span>
          </div>
          <input
            type="range"
            min={0}
            max={totalVideoMs}
            value={scrubMs}
            onChange={(e) => setScrubMs(Number(e.target.value))}
            className="w-full h-2 rounded-full appearance-none bg-muted accent-primary cursor-pointer"
            aria-label="Mouse motion timeline"
          />
        </div>
      )}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
          start
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
          now (while scrubbing)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
          end
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-8 h-2.5 rounded-sm"
            style={{
              background:
                "linear-gradient(90deg, rgba(120,80,255,0.4), rgba(255,180,0,0.6), rgba(255,64,64,0.9))",
            }}
          />
          dwell time (red = longest)
        </span>
        {pageUrl && (
          <span className="ml-auto truncate max-w-xs">
            captured on{" "}
            <span className="text-foreground/80">
              {(() => {
                try { return new URL(pageUrl).hostname; } catch { return pageUrl; }
              })()}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
