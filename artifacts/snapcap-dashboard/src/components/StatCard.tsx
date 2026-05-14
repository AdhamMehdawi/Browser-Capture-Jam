// ============================================================
// StatCard — design feature #1
//
// Compact stat card for the dashboard stats strip:
//   - mono uppercase label
//   - big number
//   - delta line vs prior period
//   - inline SVG sparkline
//
// Matches the warm-dark editorial direction from screens.html.
// Lives behind the current theme tokens; will pick up the new palette
// automatically once Layer A token swap lands.
// ============================================================

export interface StatCardProps {
  label: string;
  value: string;
  deltaLabel?: string;
  /**
   * Direction of the delta. "neutral" hides the arrow. "down-good" means
   * a downward number is positive (e.g. avg duration decreased).
   */
  deltaTone?: "up" | "down" | "neutral" | "down-good";
  /**
   * Sparkline samples (raw numbers). Auto-scaled into the 80×36 viewBox.
   * Pass at least 2 points; we'll pad shorter series.
   */
  sparkline?: number[];
  sparkColor?: string;
}

function buildPolyline(samples: number[]): string {
  if (samples.length === 0) return "";
  const padded = samples.length === 1 ? [samples[0], samples[0]] : samples;
  const w = 80;
  const h = 36;
  const max = Math.max(...padded, 1);
  const min = Math.min(...padded, 0);
  const range = Math.max(max - min, 1);
  return padded
    .map((v, i) => {
      const x = (i / (padded.length - 1)) * w;
      const y = h - 4 - ((v - min) / range) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function StatCard({
  label,
  value,
  deltaLabel,
  deltaTone = "neutral",
  sparkline,
  sparkColor = "var(--primary, hsl(var(--primary)))",
}: StatCardProps) {
  const points = sparkline ? buildPolyline(sparkline) : null;

  const deltaClass =
    deltaTone === "up"
      ? "text-emerald-500"
      : deltaTone === "down"
        ? "text-destructive"
        : deltaTone === "down-good"
          ? "text-emerald-500"
          : "text-muted-foreground";
  const deltaPrefix =
    deltaTone === "up" || (deltaTone === "down-good" && deltaLabel?.startsWith("-"))
      ? "↑"
      : deltaTone === "down" || deltaTone === "down-good"
        ? "↓"
        : "·";

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 pr-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </div>
      {deltaLabel && (
        <div className={`mt-1 text-[11px] ${deltaClass} flex items-center gap-1`}>
          <span aria-hidden="true">{deltaPrefix}</span>
          <span>{deltaLabel}</span>
        </div>
      )}
      {points && (
        <svg
          className="pointer-events-none absolute bottom-2 right-2 opacity-80"
          width="80"
          height="36"
          viewBox="0 0 80 36"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={points}
            fill="none"
            stroke={sparkColor}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
  );
}
