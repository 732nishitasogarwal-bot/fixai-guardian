import type { RiskTier } from "@/lib/types";
import { cn } from "@/lib/utils";

const STROKE = 10;
const SIZE = 180;
const R = (SIZE - STROKE) / 2;
const CIRC = Math.PI * R; // half-circle arc

function colorFor(tier: RiskTier): string {
  switch (tier) {
    case "LOW":
      return "oklch(0.63 0.15 155)";
    case "MEDIUM":
      return "oklch(0.75 0.14 85)";
    case "HIGH":
      return "oklch(0.58 0.22 25)";
  }
}

/**
 * Half-gauge showing P(Failure) ∈ [0,100] with the risk tier color.
 * Pure SVG so it animates smoothly with the live stream.
 */
export function RiskGauge({
  probability,
  tier,
  className,
  size = SIZE,
}: {
  probability: number; // 0..1
  tier: RiskTier;
  className?: string;
  size?: number;
}) {
  const pct = Math.min(100, Math.max(0, probability * 100));
  const arc = (pct / 100) * CIRC;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg
        width={size}
        height={size * 0.62}
        viewBox={`0 0 ${size} ${size * 0.62}`}
        className="overflow-visible"
      >
        <path
          d={`M ${STROKE / 2} ${size / 2} A ${R} ${R} 0 0 1 ${size - STROKE / 2} ${size / 2}`}
          fill="none"
          stroke="currentColor"
          className="text-muted"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        <path
          d={`M ${STROKE / 2} ${size / 2} A ${R} ${R} 0 0 1 ${size - STROKE / 2} ${size / 2}`}
          fill="none"
          stroke={colorFor(tier)}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${CIRC}`}
          style={{ transition: "stroke-dasharray 900ms ease, stroke 400ms ease" }}
        />
        <text
          x={size / 2}
          y={size / 2 - 6}
          textAnchor="middle"
          className="fill-foreground text-3xl font-semibold tabular-nums"
          style={{ fontSize: size * 0.19 }}
        >
          {pct.toFixed(0)}
          <tspan style={{ fontSize: size * 0.1 }}>%</tspan>
        </text>
        <text
          x={size / 2}
          y={size / 2 + 12}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: size * 0.062 }}
        >
          failure risk
        </text>
      </svg>
    </div>
  );
}

/** Compact 0..100 score ring for health score. */
export function HealthRing({
  score,
  className,
  size = 92,
}: {
  score: number; // 0..100
  className?: string;
  size?: number;
}) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, score)) / 100) * circ;
  const color =
    score >= 70
      ? "oklch(0.63 0.15 155)"
      : score >= 45
        ? "oklch(0.75 0.14 85)"
        : "oklch(0.58 0.22 25)";

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-muted"
          strokeWidth={8}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 900ms ease, stroke 400ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tabular-nums">{Math.round(score)}</span>
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          health
        </span>
      </div>
    </div>
  );
}
