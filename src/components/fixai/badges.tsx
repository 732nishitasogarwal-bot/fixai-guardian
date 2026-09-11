import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HealthStatus, RiskTier } from "@/lib/types";
import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

export function StatusBadge({
  status,
  className,
}: {
  status: HealthStatus;
  className?: string;
}) {
  const map = {
    HEALTHY: {
      icon: CheckCircle2,
      cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
    },
    DEGRADED: {
      icon: AlertTriangle,
      cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25",
    },
    CRITICAL: {
      icon: ShieldAlert,
      cls: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25",
    },
  } as const;
  const { icon: Icon, cls } = map[status];
  return (
    <Badge variant="outline" className={cn(cls, "gap-1.5 font-medium", className)}>
      <Icon className="size-3" />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

export function RiskTierBadge({ tier, className }: { tier: RiskTier; className?: string }) {
  const map = {
    LOW: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
    MEDIUM: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25",
    HIGH: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25",
  } as const;
  const Icon = tier === "LOW" ? ShieldCheck : tier === "MEDIUM" ? ShieldAlert : ShieldX;
  return (
    <Badge variant="outline" className={cn(map[tier], "gap-1.5 font-medium", className)}>
      <Icon className="size-3" />
      {tier} risk
    </Badge>
  );
}

export function IncidentStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const map: Record<string, string> = {
    OPEN: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25",
    PENDING_APPROVAL: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25",
    EXECUTING: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25",
    RESOLVED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
    ESCALATED: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/25",
    FAILED: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25",
  };
  return (
    <Badge variant="outline" className={cn(map[status] ?? "", "font-medium", className)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
