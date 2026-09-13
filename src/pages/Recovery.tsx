import { AgentExecutionCard, ModeBadge, type StoredIncidentRow } from "@/components/fixai/AgentExecutionCard";
import { RiskTierBadge } from "@/components/fixai/badges";
import { EmptyState } from "@/components/fixai/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/convex/_generated/api";
import { useAgent } from "@/hooks/use-agent-context";
import { auditCommandSafety } from "@/lib/policy";
import { cn } from "@/lib/utils";
import type { RecoveryOption } from "@/lib/types";
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  Copy,
  FileText,
  ShieldCheck,
  Terminal,
  Wand2,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

/** Human-readable message per requestAutoFix failure reason. */
const REQUEST_ERRORS: Record<string, string> = {
  NOT_AUTHENTICATED: "Your session expired — sign in again and retry.",
  NOT_FOUND: "This incident no longer exists in the backend.",
  FORBIDDEN: "This incident belongs to a different account.",
  ALREADY_IN_PROGRESS: "A recovery request for this incident is already queued or running.",
};

export default function Recovery() {
  const agent = useAgent();
  const {
    episode,
    executionLog,
    isExecuting,
    validationResult,
    executeAutomated,
    completeManualFix,
    dismissEpisode,
  } = agent;
  const isSubmitting = isExecuting;

  // ── Real-agent mode wiring ─────────────────────────────────────
  // Live incident documents straight from Convex — the source of truth for
  // PENDING_APPROVAL → EXECUTING → RESOLVED/FAILED transitions made by the
  // Python agent. Also the duplicate-request guard (STEP 15).
  const storedIncidents = useQuery(api.devices.getUserIncidents, { limit: 20 });
  const device = useQuery(api.devices.getMyDevice, {});
  const requestAutoFix = useMutation(api.devices.requestAutoFix);

  const [approveFor, setApproveFor] = useState<RecoveryOption | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * REAL MODE when a device row exists (it is created on dashboard sign-in and
   * kept fresh by the local agent's heartbeat). Demo mode otherwise — kept for
   * the /demo route where no device/agent is present.
   */
  const realMode = device !== undefined && device !== null;
  const agentOnline = device?.agentOnline ?? false;

  // The live stored incident matching the current episode. Matched on the
  // server-created rows; the newest OPEN/PENDING/EXECUTING row wins.
  const trackedIncident: StoredIncidentRow | null = useMemo(() => {
    if (!storedIncidents || storedIncidents.length === 0) return null;
    const active = storedIncidents.find(
      (i) =>
        i.status === "OPEN" ||
        i.status === "PENDING_APPROVAL" ||
        i.status === "EXECUTING",
    );
    // Fall back to the most recent terminal-state row so resolution feedback
    // stays visible after the agent finishes.
    return (active ?? storedIncidents[0]) as unknown as StoredIncidentRow;
  }, [storedIncidents]);

  const trackedInFlight =
    trackedIncident !== null &&
    (trackedIncident.status === "PENDING_APPROVAL" ||
      trackedIncident.status === "EXECUTING");

  const options = episode?.options ?? [];
  const incident = episode?.incident ?? null;

  const copyCommand = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(cmd);
      toast.success("Command copied");
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  /**
   * REAL-MODE auto-fix: persist the request, never execute in the browser.
   * The Python agent picks the incident up via GET /pending-actions →
   * claim-action → executes → POST /resolve; the subscription below re-renders
   * this page at every transition.
   */
  const handleRealAutoFix = async (option: RecoveryOption) => {
    if (!trackedIncident) {
      toast.error("No backend incident is tracked yet — wait for the agent to report one.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await requestAutoFix({
        incidentId: trackedIncident._id,
        playbookName: option.name,
      });
      if (result.ok) {
        toast.success("Recovery request sent — waiting for your local agent");
      } else if (result.reason === "ALREADY_IN_PROGRESS") {
        toast.warning("This incident is already queued with the agent.");
      } else {
        toast.error(REQUEST_ERRORS[result.reason] ?? "Recovery request failed.");
      }
    } catch {
      toast.error("Could not reach the backend — check your connection and retry.");
    } finally {
      setSubmitting(false);
      setApproveFor(null);
      setConfirmText("");
    }
  };

  /** Fire the correct mode's flow after modal approval. */
  const handleApprove = async () => {
    if (!approveFor) return;
    if (realMode) {
      await handleRealAutoFix(approveFor);
    } else {
      // DEMO-MODE auto-fix: the original in-browser simulation, unchanged.
      const safety = auditCommandSafety(approveFor.command);
      if (!safety.safe) {
        toast.error(safety.reason ?? "Command blocked by AST inspection");
        return;
      }
      await executeAutomated(approveFor);
      toast.success("Automated recovery finished");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recovery Center</h1>
          <p className={cn("mt-1 text-sm text-muted-foreground")}>
            Dual recovery modes: follow the guided steps yourself, or approve a
            permission-gated automated playbook executed by your local agent.
          </p>
        </div>
        <ModeBadge mode={realMode ? "real" : "demo"} />
      </div>

      {/* ── REAL MODE: live agent execution state ──────────────────────── */}
      {realMode && trackedIncident && trackedInFlight ? (
        <AgentExecutionCard
          incident={trackedIncident}
          agentOnline={agentOnline}
          busy={submitting}
          onRetry={() => void handleRealAutoFix(options[0])}
        />
      ) : null}

      {/* ── REAL MODE: terminal outcome (resolved / failed) ────────────── */}
      {realMode && trackedIncident && !trackedInFlight && trackedIncident.status !== "OPEN" ? (
        <AgentExecutionCard
          incident={trackedIncident}
          agentOnline={agentOnline}
          busy={submitting}
          onRetry={() =>
            void handleRealAutoFix(
              options[0] ?? {
                ...({ id: "flush_cache", name: "Flush Application Cache" } as RecoveryOption),
              },
            )
          }
        />
      ) : null}

      {/* Active episode (diagnosis + options; demo mode runs the sim) */}
      {!incident ? (
        <Card className="shadow-soft">
          <CardContent>
            <EmptyState
              icon={ShieldCheck}
              title="No active incident"
              body={
                realMode
                  ? "Your local agent has not reported an anomaly. Start it on the target machine and it will stream incidents here."
                  : "The agent has nothing to heal right now. Inject a fault from the Overview page to walk the full recovery loop."
              }
            />
            {agent.validationResult ? (
              <div className="mx-auto -mt-2 max-w-xl pb-6">
                <ValidationSummary restored={agent.validationResult.restored} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Diagnosis header */}
          <Card className="border-red-500/30 bg-red-500/[0.04] shadow-soft-lg">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{incident.rootCause.primaryCause}</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                {incident.rootCause.explanation}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="font-medium">
                P(fail) {(incident.failureProbability * 100).toFixed(0)}%
              </Badge>
              <RiskTierBadge tier={incident.risk} />
              <span className="text-xs">
                detected {new Date(incident.detectedAt).toLocaleTimeString()}
              </span>
            </CardContent>
          </Card>

          {/* Recovery options ranked by utility */}
          <div className="flex flex-col gap-3">
            {options.map((opt, idx) => {
              const safety = auditCommandSafety(opt.command);
              return (
                <Card key={opt.id} className="shadow-soft">
                  <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                    <div className="flex items-start gap-3 sm:flex-1">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-bold">
                        #{idx + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold tracking-tight">{opt.name}</p>
                          <RiskTierBadge tier={opt.riskTier} />
                          {idx === 0 && <Badge className="font-medium">Recommended</Badge>}
                          {opt.riskTier === "HIGH" ? (
                            <Badge variant="outline" className="border-red-500/30 text-red-600 dark:text-red-400">
                              <Ban className="size-3" /> automation blocked
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{opt.description}</p>
                        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Utility {opt.utilityScore.toFixed(2)}</span>
                          <span>Success P {Math.round(opt.successProbability * 100)}%</span>
                          <span>Downtime ~{opt.downtimeSeconds}s</span>
                          {!safety.safe && (
                            <span className="text-red-600 dark:text-red-400">AST check failed</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => document.getElementById(`guide-${opt.id}`)?.scrollIntoView({ behavior: "smooth" })}
                      >
                        <FileText className="size-4" /> Manual guide
                      </Button>
                      {/* STEP 15: disabled while the backend reports the
                          incident queued/running — state is the guard. */}
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={
                          isSubmitting ||
                          submitting ||
                          opt.riskTier === "HIGH" ||
                          (realMode && trackedInFlight)
                        }
                        onClick={() => setApproveFor(opt)}
                      >
                        <Wand2 className="size-4" />
                        {realMode ? "Auto-fix (agent)" : "Auto-fix"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Manual guides */}
          <div className="grid gap-4 lg:grid-cols-2">
            {options.map((opt) => (
              <Card key={opt.id} id={`guide-${opt.id}`} className="scroll-mt-20 shadow-soft">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Wrench className="size-4 text-primary" />
                    <CardTitle className="text-base">{opt.name}</CardTitle>
                  </div>
                  <CardDescription>Manual step-by-step guide</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <ol className="flex flex-col gap-2">
                    {opt.manualSteps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {i + 1}
                        </span>
                        <span className="text-muted-foreground">{step}</span>
                      </li>
                    ))}
                  </ol>
                  <button
                    onClick={() => void copyCommand(opt.command)}
                    className="group flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-[oklch(0.21_0.02_240)] px-3 py-2 text-left dark:bg-[oklch(0.14_0.02_240)]"
                  >
                    <code className="truncate font-mono text-xs text-emerald-300/90">{opt.command}</code>
                    {copied === opt.command ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <Copy className="size-3.5 shrink-0 text-white/50 transition-colors group-hover:text-white" />
                    )}
                  </button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 w-full gap-1.5"
                    disabled={isExecuting}
                    onClick={() => {
                      void completeManualFix().then(() => toast.success("Manual fix validated"));
                    }}
                  >
                    <CheckCircle2 className="size-4" /> Mark steps done & validate
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Execution terminal (demo mode only — real output lives on the agent host) */}
      {!realMode ? (
        <Card className="shadow-soft">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Terminal className="size-4.5 text-primary" />
              <CardTitle className="text-base">Guarded execution runtime</CardTitle>
            </div>
            <CardDescription>
              Live output of the last automated run — allowlisted commands only,
              checkpoint + rollback enabled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {executionLog.length === 0 ? (
              <p className="rounded-lg bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">
                No executions yet. The runtime log streams here when you approve an automated fix.
              </p>
            ) : (
              <ScrollArea className="h-44 rounded-lg bg-[oklch(0.21_0.02_240)] p-3 dark:bg-[oklch(0.14_0.02_240)]">
                <pre className="font-mono text-xs leading-5 text-emerald-300/90">
                  {executionLog.join("\n")}
                </pre>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Validation result (demo mode) */}
      {validationResult ? (
        <Card className="shadow-soft">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Post-fix validation</CardTitle>
            <CardDescription>15-second telemetry soak · pre vs post</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-5">
            {(
              [
                ["CPU", "cpu", "%"],
                ["Memory", "ram", "%"],
                ["Latency", "latency", "ms"],
                ["5xx", "errorRate", "%"],
                ["Disk", "disk", "%"],
              ] as const
            ).map(([label, key, unit]) => (
              <div key={key} className="rounded-lg border border-border/60 bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className="mt-1 flex items-baseline gap-1.5 text-sm tabular-nums">
                  <span className="text-muted-foreground line-through decoration-red-400/60">
                    {validationResult.pre[key].toFixed(0)}
                    {unit}
                  </span>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <span
                    className={cn(
                      "font-semibold",
                      validationResult.post[key] <= validationResult.pre[key]
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {validationResult.post[key].toFixed(0)}
                    {unit}
                  </span>
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Approval modal */}
      <Dialog open={approveFor !== null} onOpenChange={(o) => !o && setApproveFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" /> Approval required
            </DialogTitle>
            <DialogDescription>
              {realMode
                ? "Your local agent will execute this recovery action after the policy gate."
                : "The policy engine requires your confirmation before executing this recovery action."}
            </DialogDescription>
          </DialogHeader>
          {approveFor ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{approveFor.name}</p>
                  <RiskTierBadge tier={approveFor.riskTier} />
                </div>
                <code className="mt-2 block truncate rounded-md bg-background px-2 py-1.5 font-mono text-xs text-muted-foreground">
                  {approveFor.command}
                </code>
                <p className="mt-2 text-xs text-muted-foreground">
                  {realMode
                    ? `FixAI is ready to have your local agent run this action. The agent claims it, executes the allowlisted playbook, and validates telemetry afterwards.`
                    : "A pre-repair checkpoint will be created for automatic rollback."}{" "}
                  Rate limit: max {approveFor.riskTier === "LOW" ? 5 : 3} executions/day.
                </p>
              </div>
              <label className="text-sm font-medium">
                Type <span className="font-mono text-primary">approve</span> to confirm
              </label>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="approve"
                autoFocus
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={confirmText.trim().toLowerCase() !== "approve" || submitting}
              onClick={() => void handleApprove()}
            >
              <Wand2 className="size-4" /> {realMode ? "Confirm & queue" : "Approve & execute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dismiss episode affordance (demo mode) */}
      {incident && !isExecuting && !realMode ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={dismissEpisode}>
            Dismiss episode
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ValidationSummary({ restored }: { restored: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border p-3 text-sm",
        restored
          ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-800 dark:text-emerald-300"
          : "border-red-500/25 bg-red-500/[0.06] text-red-800 dark:text-red-300",
      )}
    >
      <CheckCircle2 className="size-4 shrink-0" />
      Last recovery: validation {restored ? "PASSED — health restored" : "FAILED — escalated"}.
    </div>
  );
}
