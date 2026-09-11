import { IncidentStatusBadge, RiskTierBadge } from "@/components/fixai/badges";
import { EmptyState } from "@/components/fixai/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAgent } from "@/hooks/use-agent-context";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { BrainCircuit, FileText, ScanSearch, Terminal } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

interface Row {
  _id: string;
  detectedAt: number;
  status: string;
  failureProbability: number;
  risk: "LOW" | "MEDIUM" | "HIGH";
  primaryCause: string;
  explanation: string;
  shap: { feature: string; value: number; attribution: number }[];
  logEvidence: string[];
  mode: string | null;
  playbookName: string | null;
  isHealthRestored: boolean | null;
  systemName: string;
}

export default function Incidents() {
  const agent = useAgent();
  const rows = useQuery(api.history.listIncidents, { limit: 50 });
  const [selected, setSelected] = useState<Row | null>(null);

  // Fall back to the live episode if nothing persisted yet.
  const liveRow: Row | null = agent.episode
    ? {
        _id: agent.episode.incident.id,
        detectedAt: agent.episode.incident.detectedAt,
        status: agent.episode.incident.status,
        failureProbability: agent.episode.incident.failureProbability,
        risk: agent.episode.incident.risk,
        primaryCause: agent.episode.incident.rootCause.primaryCause,
        explanation: agent.episode.incident.rootCause.explanation,
        shap: agent.episode.incident.rootCause.shap,
        logEvidence: agent.episode.incident.rootCause.logEvidence,
        mode: null,
        playbookName: null,
        isHealthRestored: null,
        systemName: "Primary device (live)",
      }
    : null;

  const allRows = rows && rows.length > 0 ? (rows as unknown as Row[]) : liveRow ? [liveRow] : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Incidents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every detection with its root-cause analysis. Click a row for the full
          SHAP attribution and log evidence.
        </p>
      </div>

      <Card className="shadow-soft">
        <CardContent className="p-0">
          {allRows.length === 0 ? (
            <EmptyState
              icon={ScanSearch}
              title="No incidents recorded yet"
              body="When the predictor flags a failure risk above threshold, the episode appears here with its full diagnosis. Try injecting a fault from the Overview or Live Monitor page."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Detected</TableHead>
                  <TableHead>Root cause</TableHead>
                  <TableHead className="text-right">P(fail)</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Resolution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allRows.map((r) => (
                  <TableRow
                    key={r._id}
                    className="cursor-pointer"
                    onClick={() => setSelected(r)}
                  >
                    <TableCell className="text-muted-foreground tabular-nums">
                      {new Date(r.detectedAt).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className="font-medium">{r.primaryCause}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {(r.failureProbability * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell>
                      <RiskTierBadge tier={r.risk} />
                    </TableCell>
                    <TableCell>
                      <IncidentStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.playbookName
                        ? `${r.mode === "AUTOMATED" ? "Auto" : "Manual"} · ${r.playbookName}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* RCA drawer */}
      <Drawer open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DrawerContent className="max-h-[85vh]">
          {selected ? (
            <div className="mx-auto w-full max-w-2xl overflow-y-auto px-4 pb-8">
              <DrawerHeader className="px-0">
                <div className="flex flex-wrap items-center gap-2">
                  <IncidentStatusBadge status={selected.status} />
                  <RiskTierBadge tier={selected.risk} />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {new Date(selected.detectedAt).toLocaleString()}
                  </span>
                </div>
                <DrawerTitle className="text-xl">{selected.primaryCause}</DrawerTitle>
                <DrawerDescription className="text-sm leading-relaxed">
                  {selected.explanation}
                </DrawerDescription>
              </DrawerHeader>

              {/* SHAP attributions */}
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="size-4 text-primary" />
                  <p className="text-sm font-semibold">Feature attributions (SHAP)</p>
                </div>
                <div className="mt-3 flex flex-col gap-2.5">
                  {selected.shap.map((s) => {
                    const max = Math.max(...selected.shap.map((x) => Math.abs(x.attribution)), 0.01);
                    const width = Math.min(100, (Math.abs(s.attribution) / max) * 100);
                    const positive = s.attribution >= 0;
                    return (
                      <div key={s.feature} className="flex items-center gap-3">
                        <span className="w-32 shrink-0 text-xs font-medium text-muted-foreground">
                          {s.feature}
                        </span>
                        <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-background">
                          <div
                            className={cn(
                              "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                              positive ? "bg-red-500/80" : "bg-emerald-500/80",
                            )}
                            style={{ width: `${width}%` }}
                          />
                        </div>
                        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {s.value.toFixed(0)}
                          {s.feature.includes("Latency") ? "ms" : "%"} ·{" "}
                          <span className={positive ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                            {positive ? "+" : ""}
                            {s.attribution.toFixed(2)}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Red bars push failure risk up; green bars are protective.
                </p>
              </div>

              {/* Log evidence */}
              <div className="mt-4 rounded-xl border border-border/60 bg-[oklch(0.21_0.02_240)] p-4 dark:bg-[oklch(0.14_0.02_240)]">
                <div className="flex items-center gap-2">
                  <Terminal className="size-4 text-primary" />
                  <p className="text-sm font-semibold text-white">Log evidence (fused ±30s)</p>
                </div>
                <pre className="mt-2.5 overflow-x-auto font-mono text-xs leading-5 text-emerald-300/90">
                  {selected.logEvidence.join("\n")}
                </pre>
              </div>

              {/* Outcome */}
              {selected.playbookName ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/30 p-4">
                  <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="text-sm">
                    <p className="font-medium">
                      Resolved via {selected.mode === "AUTOMATED" ? "automated" : "manual"} recovery
                    </p>
                    <p className="mt-0.5 text-muted-foreground">{selected.playbookName}</p>
                    {selected.isHealthRestored !== null ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "mt-2",
                          selected.isHealthRestored
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
                        )}
                      >
                        {selected.isHealthRestored ? "Post-fix validation PASSED" : "Post-fix validation FAILED"}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
                  <p className="text-sm text-muted-foreground">
                    This episode is still open — recovery has not completed yet.
                  </p>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/dashboard/recovery">Go to recovery</Link>
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
