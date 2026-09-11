import { getPlaybook, PLAYBOOKS } from "./playbooks";
import type {
  ActionPermission,
  AiVerdict,
  Playbook,
  PolicyDecision,
  RecoveryOption,
  RiskTier,
  TelemetrySample,
} from "./types";

/**
 * Risk-tiered permission engine (blueprint Part 7).
 *
 * LOW    → autonomous execution allowed when confidence is high and the
 *          daily rate limit for the action has not been exhausted.
 * MEDIUM → requires one-click user confirmation on the approval modal
 *          (unless pre-approved in settings).
 * HIGH   → hard-blocked from automation at code level; manual guide only.
 */

export const DEFAULT_PERMISSIONS: ActionPermission[] = [
  { playbookId: "flush_cache", riskTier: "LOW", isAutoApproved: true, maxExecPerDay: 5 },
  { playbookId: "restart_worker", riskTier: "LOW", isAutoApproved: true, maxExecPerDay: 5 },
  { playbookId: "restart_container", riskTier: "MEDIUM", isAutoApproved: false, maxExecPerDay: 3 },
  { playbookId: "scale_instances", riskTier: "MEDIUM", isAutoApproved: false, maxExecPerDay: 3 },
  { playbookId: "purge_tmp", riskTier: "MEDIUM", isAutoApproved: false, maxExecPerDay: 2 },
  { playbookId: "db_maintenance", riskTier: "HIGH", isAutoApproved: false, maxExecPerDay: 0 },
];

/** LLM/simulated-command guard: intercept destructive patterns (AST check). */
const BLOCKED_PATTERNS = [
  "rm -rf",
  "drop table",
  "delete from",
  "eval(",
  "exec(",
  "shutdown",
  "mkfs",
  "chmod 777 /",
];

export function auditCommandSafety(command: string): {
  safe: boolean;
  reason?: string;
} {
  const lower = command.toLowerCase();
  const hit = BLOCKED_PATTERNS.find((p) => lower.includes(p));
  return hit
    ? { safe: false, reason: `AST inspection blocked restricted token "${hit}"` }
    : { safe: true };
}

export interface PolicyInput {
  playbook: Playbook;
  verdict: AiVerdict;
  /** How many times this playbook already executed today. */
  executionsToday: number;
  /** User's saved permission row for this playbook (if any). */
  permission?: ActionPermission;
  /** Did the user click "Approve" on the modal? */
  userConfirmed: boolean;
}

export interface PolicyResult {
  decision: PolicyDecision;
  allowed: boolean;
  reason: string;
}

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const { playbook, verdict, executionsToday, permission, userConfirmed } = input;

  // 1) Hard safety gate — allowlisted playbooks only, never raw commands.
  const safety = auditCommandSafety(playbook.command);
  if (!safety.safe) {
    return { decision: "BLOCKED", allowed: false, reason: safety.reason! };
  }

  // 2) HIGH risk is never autonomous.
  if (playbook.riskTier === "HIGH") {
    return {
      decision: "BLOCKED",
      allowed: false,
      reason:
        "HIGH risk tier is hard-blocked from automated execution. Follow the manual guide.",
    };
  }

  // 3) Rate limiting per action per day.
  const maxPerDay = permission?.maxExecPerDay ?? 3;
  if (executionsToday >= maxPerDay) {
    return {
      decision: "DENIED",
      allowed: false,
      reason: `Rate limit reached: ${executionsToday}/${maxPerDay} executions in the last 24h.`,
    };
  }

  // 4) Risk tier gating.
  if (playbook.riskTier === "LOW") {
    if (verdict.failureProbability >= 0.8 || userConfirmed || permission?.isAutoApproved) {
      return {
        decision: "ALLOWED",
        allowed: true,
        reason: "LOW risk: auto-approved by policy (confidence gate + rate limit passed).",
      };
    }
    return {
      decision: "DENIED",
      allowed: false,
      reason: "LOW risk auto-execution requires model confidence above 0.80.",
    };
  }

  // MEDIUM: pre-approved toggle or explicit one-click confirmation.
  if (permission?.isAutoApproved) {
    return {
      decision: "ALLOWED",
      allowed: true,
      reason: "MEDIUM risk pre-approved in user settings.",
    };
  }
  if (userConfirmed) {
    return {
      decision: "ALLOWED",
      allowed: true,
      reason: "MEDIUM risk approved by explicit user confirmation.",
    };
  }
  return {
    decision: "DENIED",
    allowed: false,
    reason: "MEDIUM risk requires one-click user approval before execution.",
  };
}

/**
 * Multi-attribute utility ranking (blueprint Part 6E):
 * Utility(A) = P(success) − λ1·cost − λ2·downtime − λ3·risk
 */
const LAMBDA = { cost: 0.15, downtime: 0.35, risk: 0.3 };

const RISK_WEIGHT: Record<RiskTier, number> = {
  LOW: 0.1,
  MEDIUM: 0.5,
  HIGH: 1,
};

export function rankRecoveryOptions(
  verdict: AiVerdict,
  current: TelemetrySample,
  permissions: ActionPermission[],
): RecoveryOption[] {
  const costOfAction = (p: Playbook): number => {
    // Disk pressure → purging is more valuable; memory → restart more valuable.
    if (p.id === "purge_tmp") return current.disk / 100;
    if (p.id === "restart_container") return current.ram / 100;
    if (p.id === "flush_cache") return current.latency / 5000;
    return 0.3;
  };

  return (
    PLAYBOOKS.map((p) => ({
      ...p,
      utilityScore:
        p.successProbability -
        LAMBDA.cost * costOfAction(p) -
        LAMBDA.downtime * (p.downtimeSeconds / 60) -
        LAMBDA.risk * RISK_WEIGHT[p.riskTier],
    }))
      // Only surface playbooks the permission set knows about.
      .filter((o) => permissions.some((perm) => perm.playbookId === o.id))
      .sort((a, b) => b.utilityScore - a.utilityScore)
  );
}

export function getPermissionFor(
  permissions: ActionPermission[],
  playbookId: string,
): ActionPermission {
  return (
    permissions.find((p) => p.playbookId === playbookId) ?? {
      playbookId,
      riskTier: getPlaybook(playbookId)?.riskTier ?? "MEDIUM",
      isAutoApproved: false,
      maxExecPerDay: 3,
    }
  );
}
