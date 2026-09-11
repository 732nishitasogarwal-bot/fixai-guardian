import { cn } from "@/lib/utils";

const NODES: { key: string; label: string }[] = [
  { key: "stream", label: "Telemetry Stream" },
  { key: "predict", label: "Failure Prediction" },
  { key: "explain", label: "XAI Explanation" },
  { key: "recover", label: "Dual Recovery" },
  { key: "policy", label: "Policy Gate" },
  { key: "validate", label: "Validation" },
  { key: "memory", label: "Incident Memory" },
];

/**
 * Compact closed-loop pipeline strip: stream → … → memory, with a return edge
 * to "stream". Pure CSS, no images.
 */
export function PipelineFlow({ className }: { className?: string }) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2">
        {NODES.map((n, i) => (
          <div key={n.key} className="flex items-center gap-1">
            <div className="rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs font-medium shadow-soft">
              {n.label}
            </div>
            {i < NODES.length - 1 && (
              <span aria-hidden className="text-muted-foreground/60">
                →
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Closed loop — incident memory feeds the next prediction cycle ↺
      </p>
    </div>
  );
}
