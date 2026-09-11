import { IncidentStatusBadge, RiskTierBadge } from "@/components/fixai/badges";
import { EmptyState } from "@/components/fixai/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  CheckCircle2,
  History as HistoryIcon,
  ScrollText,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

export default function History() {
  const incidents = useQuery(api.history.listIncidents, { limit: 100 });
  const audit = useQuery(api.history.listAuditLogs, { limit: 100 });
  const [q, setQ] = useState("");

  const filteredIncidents = useMemo(() => {
    const rows = incidents ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.primaryCause.toLowerCase().includes(needle) ||
        (r.playbookName ?? "").toLowerCase().includes(needle) ||
        r.status.toLowerCase().includes(needle),
    );
  }, [incidents, q]);

  const filteredAudit = useMemo(() => {
    const rows = audit ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.action.toLowerCase().includes(needle) ||
        r.actor.toLowerCase().includes(needle) ||
        r.decision.toLowerCase().includes(needle),
    );
  }, [audit, q]);

  const resolvedCount = (incidents ?? []).filter((i) => i.status === "RESOLVED").length;
  const successRate =
    incidents && incidents.length > 0
      ? Math.round((resolvedCount / incidents.length) * 100)
      : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">History & Audit</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Append-only ledger of every incident, execution, and policy decision.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {successRate !== null ? (
            <Badge variant="outline" className="gap-1.5 border-emerald-500/25 bg-emerald-500/[0.06] font-medium">
              <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              {successRate}% recovery success
            </Badge>
          ) : null}
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search incidents & audit…"
              className="w-56 pl-8 sm:w-72"
            />
          </div>
        </div>
      </div>

      <Tabs defaultValue="incidents">
        <TabsList>
          <TabsTrigger value="incidents" className="gap-1.5">
            <HistoryIcon className="size-4" /> Incidents
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <ScrollText className="size-4" /> Audit log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="incidents" className="mt-4">
          <Card className="shadow-soft">
            <CardContent className="p-0">
              {filteredIncidents.length === 0 ? (
                <EmptyState
                  icon={HistoryIcon}
                  title={q ? "No matching incidents" : "No incidents yet"}
                  body={
                    q
                      ? "Try a different search term."
                      : "Resolved incidents persist here with their playbook, outcome, and validation status."
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Detected</TableHead>
                      <TableHead>Root cause</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Playbook</TableHead>
                      <TableHead>Validated</TableHead>
                      <TableHead className="text-right">MTTR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredIncidents.map((r) => {
                      const mttr =
                        r.resolvedAt && r.resolvedAt > r.detectedAt
                          ? Math.round((r.resolvedAt - r.detectedAt) / 1000)
                          : null;
                      return (
                        <TableRow key={r._id}>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {new Date(r.detectedAt).toLocaleTimeString()}
                          </TableCell>
                          <TableCell className="font-medium">{r.primaryCause}</TableCell>
                          <TableCell>
                            <RiskTierBadge tier={r.risk} />
                          </TableCell>
                          <TableCell>
                            <IncidentStatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.playbookName ?? "—"}
                          </TableCell>
                          <TableCell>
                            {r.isHealthRestored === null ? (
                              "—"
                            ) : r.isHealthRestored ? (
                              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <XCircle className="size-4 text-red-600 dark:text-red-400" />
                            )}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-medium tabular-nums",
                              mttr !== null ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {mttr !== null ? `${mttr}s` : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card className="shadow-soft">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Append-only audit trail</CardTitle>
              <CardDescription>
                Policy evaluations, approvals, executions, and validations.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {filteredAudit.length === 0 ? (
                <EmptyState
                  icon={ScrollText}
                  title={q ? "No matching entries" : "Audit log is empty"}
                  body={
                    q
                      ? "Try a different search term."
                      : "Entries appear when the policy engine evaluates actions or recovery completes."
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAudit.map((r) => (
                      <TableRow key={r._id}>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {new Date(r.timestamp).toLocaleTimeString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-medium">
                            {r.actor.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{r.action}</TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "text-xs font-semibold",
                              r.decision === "ALLOWED" || r.decision === "EXECUTED" || r.decision === "VALIDATED"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400",
                            )}
                          >
                            {r.decision}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-72 truncate text-muted-foreground">
                          {r.reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
