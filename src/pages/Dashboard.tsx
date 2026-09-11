import { RiskGauge, HealthRing } from "@/components/fixai/RiskGauge";
import { IncidentStatusBadge, RiskTierBadge, StatusBadge } from "@/components/fixai/badges";
import { MetricCard } from "@/components/fixai/MetricCard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAgent } from "@/hooks/use-agent-context";
import { FAULTS } from "@/lib/telemetry";
import type { FaultKey } from "@/lib/telemetry";
import type { RecoveryOption } from "@/lib/types";
import {
  Activity,
  ArrowRight,
  Bug,
  Cpu,
  HardDrive,
  ListChecks,
  MemoryStick,
  MonitorSmartphone,
  RadioTower,
  ShieldCheck,
  Timer,
  Wand2,
  Wrench,
  Zap,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

const DEVICE_SPECS_HINT = "Streaming via local agent · no CSV upload";

export default function Dashboard() {
  const agent = useAgent();
  const {
    current,
    verdict,
    healthScore,
    status,
    episode,
    validationResult,
    fault,
    injectFault,
    clearFault,
    executeAutomated,
    isExecuting,
  } = agent;

  const openEpisode = episode;
  const recommended: RecoveryOption | undefined = openEpisode?.options[0];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Overview</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MonitorSmartphone className="size-4" />
            Primary device · {DEVICE_SPECS_HINT}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} className="h-7 px-3 text-xs" />
          <span className="text-sm text-muted-foreground">
            {fault === "none"
              ? "All monitored signals nominal"
              : `Fault injected: ${FAULTS[fault].label}`}
          </span>
        </div>
      </div>

      {/* ── Hero: health + risk ────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/70 shadow-soft">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_auto]">
          <div className="flex flex-col justify-between gap-5">
            <div>
              <CardTitle className="text-lg">Current health assessment</CardTitle>
              <CardDescription className="mt-1">
                Composite score from CPU, memory, latency, error rate, and disk
                signals — weighted with the model's failure probability.
              </CardDescription>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MiniStat label="CPU" value={`${current.cpu.toFixed(0)}%`} />
              <MiniStat label="Memory" value={`${current.ram.toFixed(0)}%`} />
              <MiniStat label="Latency" value={`${Math.round(current.latency)}ms`} />
              <MiniStat label="5xx rate" value={`${current.errorRate.toFixed(1)}%`} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link to="/dashboard/monitor">
                  <Activity className="size-4" /> Live charts
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link to="/dashboard/incidents">
                  <ListChecks className="size-4" /> Incidents
                </Link>
              </Button>
            </div>
          </div>

          <div className="flex flex-row items-center justify-center gap-6 lg:flex-col lg:gap-4">
            <HealthRing score={healthScore} />
            <RiskGauge probability={verdict.failureProbability} tier={verdict.risk} size={170} />
          </div>
        </CardContent>
      </Card>

      {/* ── Metric cards ───────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Cpu}
          label="CPU usage"
          value={current.cpu.toFixed(0)}
          unit="%"
          progress={current.cpu}
          tone={current.cpu > 85 ? "bad" : current.cpu > 65 ? "warn" : "good"}
          hint={current.cpu > 85 ? "starved" : "nominal"}
        />
        <MetricCard
          icon={MemoryStick}
          label="Memory"
          value={current.ram.toFixed(0)}
          unit="%"
          progress={current.ram}
          tone={current.ram > 85 ? "bad" : current.ram > 65 ? "warn" : "good"}
          hint={current.ram > 85 ? "pressure" : "nominal"}
        />
        <MetricCard
          icon={Zap}
          label="Latency p95"
          value={Math.round(current.latency).toString()}
          unit="ms"
          progress={Math.min(100, current.latency / 50)}
          tone={current.latency > 2000 ? "bad" : current.latency > 800 ? "warn" : "good"}
          hint={current.latency > 2000 ? "degraded" : "healthy"}
        />
        <MetricCard
          icon={HardDrive}
          label="Disk"
          value={current.disk.toFixed(0)}
          unit="%"
          progress={current.disk}
          tone={current.disk > 90 ? "bad" : current.disk > 75 ? "warn" : "good"}
          hint={current.disk > 90 ? "nearly full" : "nominal"}
        />
      </div>

      {/* ── Active episode banner ──────────────────────────────────────── */}
      {openEpisode ? (
        <Card className="border-red-500/30 bg-red-500/[0.04] shadow-soft-lg">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <IncidentStatusBadge status={openEpisode.incident.status} />
              <RiskTierBadge tier={openEpisode.incident.risk} />
              <span className="text-xs text-muted-foreground">
                detected {new Date(openEpisode.incident.detectedAt).toLocaleTimeString()}
              </span>
            </div>
            <CardTitle className="mt-2 text-lg">
              {openEpisode.incident.rootCause.primaryCause}
            </CardTitle>
            <CardDescription className="mt-1 max-w-3xl text-sm leading-relaxed">
              {openEpisode.incident.rootCause.explanation}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-muted-foreground">
              Recommended: <span className="font-medium text-foreground">{recommended?.name}</span>{" "}
              · <RiskTierBadge tier={recommended?.riskTier ?? "MEDIUM"} className="align-middle" />
            </p>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link to="/dashboard/recovery">
                  <Wrench className="size-4" /> Manual guide
                </Link>
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={isExecuting}
                onClick={() => {
                  if (!recommended) return;
                  void executeAutomated(recommended).then(() =>
                    toast.success("Automated recovery finished — see Recovery page."),
                  );
                }}
              >
                <Wand2 className="size-4" />
                {isExecuting ? "Executing…" : "Auto-fix"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-emerald-500/25 bg-emerald-500/[0.04] shadow-soft">
          <CardContent className="flex items-center gap-3 p-5">
            <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">No active incidents.</span>{" "}
              The agent is streaming telemetry and evaluating predictions every 2 seconds.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Fault injection lab ────────────────────────────────────────── */}
      <Card className="border-border/70 shadow-soft">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Bug className="size-4.5 text-primary" />
            <CardTitle className="text-base">Fault injection lab</CardTitle>
          </div>
          <CardDescription>
            Reproduce the 6 controlled failure scenarios. The prediction engine
            will flag rising risk before hard thresholds are breached.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(Object.keys(FAULTS) as Exclude<FaultKey, "none">[]).map((key) => (
            <Button
              key={key}
              variant={fault === key ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => injectFault(key)}
            >
              <Zap className="size-3.5" />
              {FAULTS[key].label}
            </Button>
          ))}
          {fault !== "none" && (
            <Button variant="ghost" size="sm" onClick={clearFault}>
              Clear fault
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Validation proof ───────────────────────────────────────────── */}
      {validationResult ? (
        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className={
                  validationResult.restored
                    ? "size-4.5 text-emerald-600 dark:text-emerald-400"
                    : "size-4.5 text-red-600 dark:text-red-400"
                }
              />
              <CardTitle className="text-base">
                Post-fix validation · {validationResult.restored ? "PASSED" : "FAILED"}
              </CardTitle>
            </div>
            <CardDescription>
              15-second telemetry soak comparing pre-fix vs post-fix signals.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-5">
            <CompareChip label="CPU" pre={validationResult.pre.cpu} post={validationResult.post.cpu} unit="%" />
            <CompareChip label="Memory" pre={validationResult.pre.ram} post={validationResult.post.ram} unit="%" />
            <CompareChip label="Latency" pre={validationResult.pre.latency} post={validationResult.post.latency} unit="ms" />
            <CompareChip label="5xx" pre={validationResult.pre.errorRate} post={validationResult.post.errorRate} unit="%" />
            <CompareChip label="Disk" pre={validationResult.pre.disk} post={validationResult.post.disk} unit="%" />
          </CardContent>
        </Card>
      ) : null}

      {/* ── Quick links ────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <QuickLink
          to="/dashboard/history"
          icon={Timer}
          title="History & audit"
          body="Every incident, execution, and policy decision — append-only."
        />
        <QuickLink
          to="/dashboard/permissions"
          icon={RadioTower}
          title="Permissions & risk"
          body="Tune which playbooks the agent may run autonomously."
        />
        <QuickLink
          to="/dashboard/recovery"
          icon={ArrowRight}
          title="Recovery center"
          body="Manual playbooks and guarded automated execution."
        />
      </div>

  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CompareChip({
  label,
  pre,
  post,
  unit,
}: {
  label: string;
  pre: number;
  post: number;
  unit: string;
}) {
  const better = post <= pre;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5 text-sm tabular-nums">
        <span className="text-muted-foreground line-through decoration-red-400/60">
          {pre.toFixed(0)}
          {unit}
        </span>
        <ArrowRight className="size-3 text-muted-foreground" />
        <span
          className={
            better
              ? "font-semibold text-emerald-600 dark:text-emerald-400"
              : "font-semibold text-red-600 dark:text-red-400"
          }
        >
          {post.toFixed(0)}
          {unit}
        </span>
      </p>
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  title,
  body,
}: {
  to: string;
  icon: typeof Timer;
  title: string;
  body: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-border/70 bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-soft-lg"
    >
      <div className="flex items-center justify-between">
        <Icon className="size-5 text-primary" />
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-3 font-semibold tracking-tight">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </Link>
  );
}
