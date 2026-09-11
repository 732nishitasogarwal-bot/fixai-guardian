import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  hint,
  tone = "default",
  progress,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
  /** Optional 0..100 bar under the value. */
  progress?: number;
  children?: ReactNode;
  className?: string;
}) {
  const toneCls = {
    default: "text-primary",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
  }[tone];
  const iconBg = {
    default: "bg-primary/10",
    good: "bg-emerald-500/10",
    warn: "bg-amber-500/10",
    bad: "bg-red-500/10",
  }[tone];

  return (
    <Card className={cn("shadow-soft border-border/70", className)}>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className={cn("flex size-9 items-center justify-center rounded-lg", iconBg, toneCls)}>
            <Icon className="size-4.5" />
          </div>
          {hint ? (
            <span className="text-xs font-medium text-muted-foreground">{hint}</span>
          ) : null}
        </div>
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </p>
          <p className="mt-1 flex items-baseline gap-1 font-semibold tabular-nums">
            <span className="text-2xl">{value}</span>
            {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
          </p>
        </div>
        {progress !== undefined ? (
          <Progress value={Math.min(100, Math.max(0, progress))} className="h-1.5" />
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}
