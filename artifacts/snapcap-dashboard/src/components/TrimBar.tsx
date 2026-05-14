// ============================================================
// TrimBar — design feature #7
//
// Visible trim handle row that sits below the video + minimap:
//
//   [ 00:32 ────waveform──── 01:08 ]   reset
//
// Mono bracket markers show the chosen start/end in/out points,
// a simulated waveform pattern fills the active range, and the
// outer faded zones show the trimmed-away regions.
//
// Calls back to the parent for state changes; the parent already
// owns trimStart / trimEnd / trimActive and the API save logic.
// ============================================================

import { useCallback, useRef, useState, useEffect } from "react";

export interface TrimBarProps {
  durationMs: number;
  startMs: number;
  endMs: number;
  active: boolean;
  saving?: boolean;
  onChange: (startMs: number, endMs: number) => void;
  onReset: () => void;
}

const MIN_SPAN_MS = 500; // can't trim to less than half a second

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

type DragKind = "start" | "end" | "range" | null;

export function TrimBar({
  durationMs,
  startMs,
  endMs,
  active,
  saving,
  onChange,
  onReset,
}: TrimBarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragKind>(null);
  // Used by "range" drag — the offset from the start of the selection to
  // wherever the user's pointer landed when they grabbed it.
  const dragOffset = useRef(0);

  // Effective values when trim is inactive (treat as full range).
  const effStart = active ? startMs : 0;
  const effEnd = active ? endMs : durationMs;
  const startPct = durationMs > 0 ? (effStart / durationMs) * 100 : 0;
  const endPct = durationMs > 0 ? (effEnd / durationMs) * 100 : 100;

  const pxToMs = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || durationMs === 0) return 0;
      const pos = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(durationMs, pos * durationMs));
    },
    [durationMs],
  );

  // Track pointer move/up globally during a drag so we don't lose the drag
  // when the cursor leaves the track.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const ms = pxToMs(e.clientX);
      if (drag === "start") {
        const next = Math.min(ms, endMs - MIN_SPAN_MS);
        onChange(Math.max(0, next), endMs);
      } else if (drag === "end") {
        const next = Math.max(ms, startMs + MIN_SPAN_MS);
        onChange(startMs, Math.min(durationMs, next));
      } else if (drag === "range") {
        const span = endMs - startMs;
        let newStart = ms - dragOffset.current;
        newStart = Math.max(0, Math.min(durationMs - span, newStart));
        onChange(newStart, newStart + span);
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, startMs, endMs, durationMs, onChange, pxToMs]);

  const startDrag = (kind: DragKind) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (kind === "range") {
      const ms = pxToMs(e.clientX);
      dragOffset.current = Math.max(0, ms - startMs);
    }
    setDrag(kind);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  if (durationMs <= 0) return null;

  return (
    <div className="flex items-center gap-3 select-none">
      {/* Start bracket */}
      <span className="font-mono text-xs tabular-nums text-foreground/80 shrink-0">
        [ {fmt(effStart)}
      </span>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative flex-1 h-8 rounded-md bg-card border border-border overflow-hidden"
      >
        {/* Trimmed-away regions (faded) */}
        <div
          className="absolute inset-y-0 left-0 bg-background/60"
          style={{ width: `${startPct}%` }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-y-0 right-0 bg-background/60"
          style={{ width: `${100 - endPct}%` }}
          aria-hidden="true"
        />

        {/* Active range — draggable in the middle */}
        <div
          onPointerDown={startDrag("range")}
          className="absolute inset-y-0 cursor-grab active:cursor-grabbing"
          style={{
            left: `${startPct}%`,
            width: `${endPct - startPct}%`,
            // Simulated waveform — repeating vertical bars at varying heights.
            backgroundImage: `repeating-linear-gradient(
              90deg,
              rgba(232,131,90,0.55) 0 1.5px,
              transparent 1.5px 4px,
              rgba(232,131,90,0.35) 4px 5px,
              transparent 5px 8px,
              rgba(232,131,90,0.65) 8px 9px,
              transparent 9px 12px
            )`,
            backgroundSize: "12px 100%",
            backgroundPosition: "center",
          }}
        />

        {/* Start handle */}
        <button
          type="button"
          onPointerDown={startDrag("start")}
          className="absolute top-0 bottom-0 w-2.5 -translate-x-1/2 cursor-ew-resize bg-primary/90 rounded-sm hover:bg-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          style={{ left: `${startPct}%` }}
          aria-label="Trim start"
        >
          <span className="absolute inset-y-1 left-1/2 -translate-x-1/2 w-px bg-primary-foreground/60" />
        </button>

        {/* End handle */}
        <button
          type="button"
          onPointerDown={startDrag("end")}
          className="absolute top-0 bottom-0 w-2.5 -translate-x-1/2 cursor-ew-resize bg-primary/90 rounded-sm hover:bg-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          style={{ left: `${endPct}%` }}
          aria-label="Trim end"
        >
          <span className="absolute inset-y-1 left-1/2 -translate-x-1/2 w-px bg-primary-foreground/60" />
        </button>
      </div>

      {/* End bracket */}
      <span className="font-mono text-xs tabular-nums text-foreground/80 shrink-0">
        {fmt(effEnd)} ]
      </span>

      {/* Reset / status */}
      {active ? (
        <button
          type="button"
          onClick={onReset}
          className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 transition-colors"
          disabled={saving}
          aria-label="Reset trim"
        >
          {saving ? "saving…" : "reset"}
        </button>
      ) : (
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground border border-dashed border-border rounded-md px-2.5 py-1.5">
          drag to trim
        </span>
      )}
    </div>
  );
}
