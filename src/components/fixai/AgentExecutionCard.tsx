import { IncidentStatusBadge } from "@/components/fixai/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Id } from "@/convex/_generated/dataModel";
import type { IncidentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Link } from "react-router";

/** Raw incident document as returned by the getUserIncidents subscription. */
export interface StoredIncidentRow {
  _id: Id<"incidents">;
  detectedAt: number;
  resolvedAt?: number;
  status: IncidentStatus;
  failureProbability: number;
  risk: "LOW" | "MEDIUM" | "HIGH";
  primaryCause: string;
  explanation: string;
  mode?: "MANUAL" | "AUTOMATED";
  /** Canonical catalog id stored on the incident by requestAutoFix (Fix #3). */
  playbookId?: string;
  playbookName?: string;
  executedBy?: string;
  isHealthRestored?: boolean;
  soakSeconds?: number;
}

const CHECKED_STEPS: Record<Exclude<IncidentStatus, "OPEN">, string[]> = {
  PENDING_APPROVAL: [
    "Recovery request received",
    "Safety policy verified",
    "Playbook approved",
  ],
  EXECUTING: [
    "Recovery request received",
    "Safety policy verified",
    "Playbook approved",
  ],
  RESOLVED: [
    "Recovery request received",
    "Safety policy verified",
    "Playbook approved",
    "Executing recovery",
    "Validating system",
  ],
  FAILED: [
    "Recovery request received",
    "Safety policy verified",
    "Playbook approved",
    "Executing recovery",
    "Validating system",
  ],
  ESCALATED: [
    "Recovery request received",
    "Safety policy verified",
    "Playbook approved",
    "Executing recovery",
    "Validating system",
  ],
};

/**
 * Live status card for the real agent execution pipeline. Rendered when the
 * selected incident is queued for (or being run by) the local Python agent —
 * its state comes exclusively from the Convex subscription, never a timer.
 */
export function AgentExecutionCard({
  incident,
  agentOnline,
  onRetry,
  busy,
}: {
  incident: StoredIncidentRow;
  agentOnline: boolean;
  onRetry: () => void;
  busy: boolean;
}) {
  const pending = incident.status === "PENDING_APPROVAL";
  const executing = incident.status === "EXECUTING";
  const resolved = incident.status === "RESOLVED";
  const failed = incident.status === "FAILED" || incident.status === "ESCALATED";
  const inFlight = pending || executing;

  return (
    <Card
      className={cn(
        "shadow-soft",
        executing && "border-sky-500/30 bg-sky-500/[0.04]",
        pending && "border-amber-500/30 bg-amber-500/[0.04]",
        resolved && "border-emerald-500/30 bg-emerald-500/[0.04]",
        failed && "border-red-500/30 bg-red-500/[0.04]",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {pending ? (
            <Clock className="size-4.5 text-amber-500" />
          ) : executing ? (
            <Loader2 className="size-4.5 animate-spin text-sky-500" />
          ) : resolved ? (
            <CheckCircle2 className="size-4.5 text-emerald-500" />
          ) : (
            <AlertTriangle className="size-4.5 text-red-500" />
          )}
          <CardTitle className="text-lg">
            {pending && "🟡 Recovery Request Queued"}
            {executing && "🔵 FixAI Agent is executing recovery"}
            {resolved && "🟢 Problem Successfully Resolved"}
            {failed && "🔴 Automatic Recovery Failed"}
          </CardTitle>
          <IncidentStatusBadge status={incident.status} className="ml-auto" />
        </div>
        <CardDescription>
          {pending &&
            "Recovery request sent successfully. Waiting for your FixAI Local Agent to pick it up."}
          {executing &&
            `The local agent claimed this incident and is running "${incident.playbookName ?? "the playbook"}" with full safety gating.`}
          {resolved &&
            "The local agent completed the playbook and post-fix telemetry validation passed."}
          {failed &&
            "The playbook ran but validation failed, or execution was refused. Nothing was silently marked resolved."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Pipeline checklist — driven purely by the subscribed incident status */}
        <ol className="flex flex-col gap-1.5">
          {CHECKED_STEPS[incident.status === "OPEN" ? "PENDING_APPROVAL" : incident.status].map(
            (step) => {
              // Which steps have completed / are running for the current status.
              const running = executing && (step === "Executing recovery" || step === "Validating system");
              const done = pending
                ? !running // queued: the 3 pre-execution steps are done
                : running
                  ? step === "Executing recovery" // while executing, validation still running
                  : true; // terminal states: everything finished
              return (
                <li key={step} className="flex items-center gap-2.5 text-sm">
                  {running && !done ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-sky-500" />
                  ) : done ? (
                    <CheckCircle2
                      className={cn(
                        "size-4 shrink-0",
                        failed && step === "Validating system"
                          ? "text-red-500"
                          : "text-emerald-500",
                      )}
                    />
                  ) : (
                    <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
                  )}
                  <span className={cn(running && !done ? "text-foreground" : "text-muted-foreground")}>
                    {step}
                    {running && !done ? "…" : ""}
                  </span>
                </li>
              );
            },
          )}
        </ol>

        {/* Agent connectivity hint while waiting */}
        {pending && !agentOnline ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 text-sm">
            <RadioTower className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <p className="text-muted-foreground">
              The local agent has not synced recently. Start it on the target machine
              (<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">python main.py</code>)
              — it polls for queued recoveries every few seconds.
            </p>
          </div>
        ) : null}

        {/* Resolution summary */}
        {resolved ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCell label="Action taken" value={incident.playbookName ?? "—"} />
            <SummaryCell
              label="Validation"
              value={
                incident.isHealthRestored === false
                  ? "FAILED"
                  : `PASSED · ${incident.soakSeconds ?? 15}s soak`
              }
              tone={incident.isHealthRestored === false ? "bad" : "good"}
            />
            <SummaryCell
              label="Executed by"
              value={incident.executedBy ?? "LOCAL_AGENT"}
            />
          </div>
        ) : null}

        {/* Failure actions */}
        {failed ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5" disabled={busy} onClick={onRetry}>
              <RefreshCw className="size-4" /> Try again
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Wrench className="size-4" /> <Link to="/dashboard/recovery">Manual recovery</Link>
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5">
              <FileText className="size-4" /> <Link to="/dashboard/incidents">View diagnostics</Link>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryCell({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "bad";
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 flex items-center gap-1.5 text-sm font-medium",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "bad" && "text-red-600 dark:text-red-400",
        )}
      >
        {tone === "good" ? <ShieldCheck className="size-3.5" /> : null}
        <span className="truncate">{value}</span>
      </p>
    </div>
  );
}

/** Compact "REAL MODE / DEMO MODE" chip shown in the Recovery header. */
export function ModeBadge({ mode }: { mode: "real" | "demo" }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium",
        mode === "real"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
    >
      <span className={cn("size-1.5 rounded-full", mode === "real" ? "bg-emerald-500" : "bg-amber-500")} />
      {mode === "real" ? "REAL AGENT MODE" : "DEMO MODE"}
    </Badge>
  );
}
