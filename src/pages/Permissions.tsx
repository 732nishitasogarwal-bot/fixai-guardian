import { RiskTierBadge } from "@/components/fixai/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { PLAYBOOKS } from "@/lib/playbooks";
import { DEFAULT_PERMISSIONS } from "@/lib/policy";
import { cn } from "@/lib/utils";
import type { ActionPermission } from "@/lib/types";
import { useMutation, useQuery } from "convex/react";
import { Info, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

export default function Permissions() {
  const { isAuthenticated } = useAuth();
  const saved = useQuery(
    api.permissions.listMyPermissions,
    isAuthenticated ? {} : "skip",
  );
  const upsert = useMutation(api.permissions.upsertPermission);

  /** Merge DB rows over defaults so the matrix always renders fully. */
  const rows: ActionPermission[] = DEFAULT_PERMISSIONS.map((def) => {
    const dbRow = saved?.find((s) => s.playbookId === def.playbookId);
    return dbRow
      ? {
          playbookId: def.playbookId,
          riskTier: def.riskTier,
          isAutoApproved: dbRow.isAutoApproved,
          maxExecPerDay: dbRow.maxExecPerDay,
        }
      : def;
  });

  const handleToggle = (playbookId: string, isAutoApproved: boolean) => {
    const row = rows.find((r) => r.playbookId === playbookId);
    if (!row) return;
    if (row.riskTier === "HIGH") {
      toast.error("HIGH risk actions are hard-blocked from automation and cannot be pre-approved.");
      return;
    }
    void upsert({
      playbookId,
      riskTier: row.riskTier,
      isAutoApproved,
      maxExecPerDay: row.maxExecPerDay,
    }).then(() => toast.success(`${isAutoApproved ? "Auto-approval enabled" : "Approval now required"} for ${playbookId.replace(/_/g, " ")}`));
  };

  const handleRateChange = (playbookId: string, value: string) => {
    const row = rows.find((r) => r.playbookId === playbookId);
    if (!row) return;
    const max = Math.max(0, Math.min(20, Number(value) || 0));
    void upsert({
      playbookId,
      riskTier: row.riskTier,
      isAutoApproved: row.isAutoApproved,
      maxExecPerDay: max,
    });
  };

  const tierGroups = [
    {
      tier: "LOW" as const,
      title: "Low risk — autonomous execution allowed",
      body: "Auto-runs when model confidence exceeds 0.80 and the daily limit is not exhausted. Toggle pre-approval off to require confirmation instead.",
      accent: "border-emerald-500/25",
    },
    {
      tier: "MEDIUM" as const,
      title: "Medium risk — one-click approval",
      body: "Requires your explicit confirmation on the approval modal unless you enable pre-approval below.",
      accent: "border-amber-500/25",
    },
    {
      tier: "HIGH" as const,
      title: "High risk — recommendation only",
      body: "Hard-blocked from automation at code level. The system shows manual steps only; no switch can override this.",
      accent: "border-red-500/25",
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Permissions & Risk</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control exactly what the automated agent may do on your device.
          Settings persist per account.
        </p>
      </div>

      {tierGroups.map((g) => (
        <Card key={g.tier} className={cn("shadow-soft", g.accent)}>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              {g.tier === "HIGH" ? (
                <Lock className="size-4.5 text-red-600 dark:text-red-400" />
              ) : g.tier === "MEDIUM" ? (
                <TriangleAlert className="size-4.5 text-amber-600 dark:text-amber-400" />
              ) : (
                <ShieldCheck className="size-4.5 text-emerald-600 dark:text-emerald-400" />
              )}
              <CardTitle className="text-base">{g.title}</CardTitle>
            </div>
            <CardDescription>{g.body}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {rows
              .filter((r) => r.riskTier === g.tier)
              .map((row) => {
                const pb = PLAYBOOKS.find((p) => p.id === row.playbookId);
                return (
                  <div
                    key={row.playbookId}
                    className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/30 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{pb?.name ?? row.playbookId}</p>
                        <RiskTierBadge tier={row.riskTier} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{pb?.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <label className="flex items-center gap-2.5">
                        <Switch
                          checked={row.isAutoApproved}
                          onCheckedChange={(v) => handleToggle(row.playbookId, v)}
                          disabled={row.riskTier === "HIGH"}
                          aria-label={`Auto-approve ${row.playbookId}`}
                        />
                        <span className="text-xs font-medium text-muted-foreground">
                          {row.isAutoApproved ? "Pre-approved" : "Ask first"}
                        </span>
                      </label>
                      <label className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={0}
                          max={20}
                          value={row.maxExecPerDay}
                          disabled={row.riskTier === "HIGH"}
                          onChange={(e) => handleRateChange(row.playbookId, e.target.value)}
                          className="h-8 w-16 text-center text-sm tabular-nums"
                          aria-label={`Max executions per day for ${row.playbookId}`}
                        />
                        <span className="text-xs text-muted-foreground">/day</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            {g.tier === "HIGH" ? (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/[0.06] px-3 py-2 text-xs text-red-700 dark:text-red-300">
                <Lock className="size-3.5 shrink-0" />
                Autonomous execution is blocked in code — this tier cannot be switched to auto.
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}

      <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Every permission evaluation, approval click, and execution is recorded
          in the append-only audit trail — see{" "}
          <Badge variant="outline" className="mx-0.5 font-medium">
            History & Audit
          </Badge>{" "}
          for the full ledger.
        </p>
      </div>
    </div>
  );
}
