// ============================================================
// EventMinimap — design feature #6
//
// Horizontal strip placed under the video. Renders color-coded ticks
// for every event in the recording at its position on the timeline,
// plus a scrub cursor synced to the video's currentTime. Clicking the
// strip seeks the video to that time.
//
// Matches the warm-dark editorial direction from screens.html.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";

type AnyEvent = Record<string, any>;

export interface EventMinimapProps {
  events: AnyEvent[];
  /** Recording duration in milliseconds — drives the % scale. */
  durationMs: number;
  /**
   * The underlying <video> element. The minimap reads `currentTime` from it
   * via rAF and writes back to it on click-to-seek.
   */
  videoElement: HTMLVideoElement | null;
}

type TickCategory = "click" | "error" | "warn" | "network" | "info" | "cursor";

interface Tick {
  /** Position 0..1 along the strip. */
  pos: number;
  category: TickCategory;
  tooltip: string;
}

function categorize(e: AnyEvent): TickCategory | null {
  const t = e.type;
  // Errors (console + failed requests).
  if (t === "error" || t === "unhandledrejection") return "error";
  if (t === "console" && e.level === "error") return "error";
  if (t === "request" && (e.error || (e.status && e.status >= 400))) return "error";
  // Warnings.
  if (t === "console" && e.level === "warn") return "warn";
  // Network ok.
  if (t === "request") return "network";
  // User clicks / inputs / submits.
  if (t === "click" || t === "input" || t === "submit") return "click";
  // Mouse path.
  if (t === "mousemove" || t === "mousedown" || t === "mouseup" || t === "wheel") return "cursor";
  // Plain info console + everything else worth a faint tick.
  if (t === "console" || t === "navigation" || t === "select") return "info";
  return null;
}

const CATEGORY_STYLE: Record<TickCategory, { color: string; h: number; w: number; tall: boolean }> = {
  click:   { color: "#e8835a", h: 22, w: 2,   tall: false },
  error:   { color: "#ef6f6f", h: 36, w: 3,   tall: true  },
  warn:    { color: "#e8b85a", h: 28, w: 2,   tall: false },
  network: { color: "#7a9bff", h: 22, w: 2,   tall: false },
  info:    { color: "#7a9bff", h: 18, w: 2,   tall: false },
  cursor:  { color: "rgba(180,180,180,0.35)", h: 10, w: 1, tall: false },
};

export function EventMinimap({ events, durationMs, videoElement }: EventMinimapProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [currentMs, setCurrentMs] = useState(0);

  // Earliest event timestamp is video t=0. Same mapping the MouseHeatmap uses.
  const recordingStartMs = useMemo(() => {
    let earliest = Infinity;
    for (const e of events) {
      if (typeof e.timestamp === "number" && e.timestamp < earliest) {
        earliest = e.timestamp;
      }
    }
    return earliest === Infinity ? 0 : earliest;
  }, [events]);

  const ticks: Tick[] = useMemo(() => {
    const totalMs = Math.max(durationMs || 1, 1);
    const out: Tick[] = [];
    for (const e of events) {
      const cat = categorize(e);
      if (!cat) continue;
      if (typeof e.timestamp !== "number") continue;
      const eventMs = Math.max(0, e.timestamp - recordingStartMs);
      const pos = Math.min(1, Math.max(0, eventMs / totalMs));
      const tooltip = describe(e, eventMs);
      out.push({ pos, category: cat, tooltip });
    }
    return out;
  }, [events, recordingStartMs, durationMs]);

  // Bucket cursor ticks so we don't render thousands of overlapping bars —
  // collapse mousemove samples into ~120 buckets for visual density.
  const renderTicks = useMemo(() => {
    const BUCKETS = 120;
    const cursorBuckets = new Map<number, number>();
    const out: Tick[] = [];
    for (const t of ticks) {
      if (t.category === "cursor") {
        const b = Math.round(t.pos * BUCKETS);
        cursorBuckets.set(b, (cursorBuckets.get(b) ?? 0) + 1);
      } else {
        out.push(t);
      }
    }
    for (const [bucket, count] of cursorBuckets) {
      out.push({
        pos: bucket / BUCKETS,
        category: "cursor",
        tooltip: `${count} cursor sample${count > 1 ? "s" : ""}`,
      });
    }
    // Errors should render last so they sit on top of everything else.
    return out.sort((a, b) => {
      const order = (c: TickCategory) =>
        c === "error" ? 4 : c === "warn" ? 3 : c === "click" ? 2 : c === "network" ? 1 : 0;
      return order(a.category) - order(b.category);
    });
  }, [ticks]);

  // Sync the scrub cursor to the live video. Uses rAF so it's smooth without
  // depending on Plyr's timeupdate (which fires only ~4 Hz).
  useEffect(() => {
    if (!videoElement) return;
    let raf = 0;
    const tick = () => {
      const sec = videoElement.currentTime;
      if (!Number.isNaN(sec)) setCurrentMs(sec * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoElement]);

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoElement || !stripRef.current) return;
    const rect = stripRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pos = Math.min(1, Math.max(0, x / rect.width));
    const totalSec = (durationMs || 0) / 1000;
    if (totalSec > 0) {
      videoElement.currentTime = pos * totalSec;
    }
  };

  const scrubLeftPct = durationMs > 0
    ? Math.min(100, (currentMs / durationMs) * 100)
    : 0;

  if (durationMs <= 0) return null;

  // Quick legend counts so users see what's on the strip.
  const counts = useMemo(() => {
    const c: Record<string, number> = { click: 0, error: 0, warn: 0, network: 0, cursor: 0 };
    for (const t of ticks) {
      if (t.category in c) c[t.category]++;
      else if (t.category === "info") c.network++;
    }
    return c;
  }, [ticks]);

  return (
    <div className="space-y-1.5">
      <div
        ref={stripRef}
        onClick={onSeek}
        className="relative h-11 rounded-lg border border-border bg-card overflow-hidden cursor-pointer select-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: `${100 / 24}% 100%`,
        }}
        role="slider"
        aria-label="Event timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(currentMs / 1000)}
      >
        {renderTicks.map((t, i) => {
          const s = CATEGORY_STYLE[t.category];
          return (
            <div
              key={i}
              title={t.tooltip}
              className="absolute pointer-events-none"
              style={{
                left: `${(t.pos * 100).toFixed(2)}%`,
                top: `${(44 - s.h) / 2}px`,
                width: `${s.w}px`,
                height: `${s.h}px`,
                background: s.color,
                borderRadius: "1px",
                boxShadow: s.tall ? `0 0 6px ${s.color}80` : undefined,
                transform: "translateX(-50%)",
              }}
            />
          );
        })}
        {/* Scrub cursor */}
        <div
          className="absolute top-0 bottom-0 w-px bg-white/85 pointer-events-none"
          style={{ left: `${scrubLeftPct.toFixed(3)}%` }}
        >
          <div
            className="absolute -top-1 left-1/2 -translate-x-1/2 h-2 w-2 rounded-sm bg-white shadow"
          />
        </div>
      </div>
      <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground select-none">
        <Legend dot="#ef6f6f" label={`errors ${counts.error}`} />
        <Legend dot="#e8b85a" label={`warns ${counts.warn}`} />
        <Legend dot="#e8835a" label={`clicks ${counts.click}`} />
        <Legend dot="#7a9bff" label={`network ${counts.network}`} />
        <Legend dot="rgba(180,180,180,0.55)" label={`cursor ${counts.cursor}`} />
        <span className="ml-auto tabular-nums text-foreground/80">
          {fmtTime(currentMs)} / {fmtTime(durationMs)}
        </span>
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-2 h-2 rounded-[1px]"
        style={{ background: dot }}
      />
      <span>{label}</span>
    </span>
  );
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function describe(e: AnyEvent, eventMs: number): string {
  const t = fmtTime(eventMs);
  const kind = e.type ?? "event";
  const detail =
    e.message ||
    e.url ||
    e.selector ||
    e.targetText ||
    "";
  return detail ? `${t} · ${kind} · ${String(detail).slice(0, 80)}` : `${t} · ${kind}`;
}
