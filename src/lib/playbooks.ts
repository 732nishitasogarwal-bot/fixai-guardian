import type { Playbook, RiskTier } from "./types";

/**
 * Pre-audited playbook catalogue.
 *
 * The execution runtime only ever fires these allowlisted playbooks — the AI
 * layer passes parameters, never raw shell strings (blueprint Part 22).
 * HIGH risk actions are hard-blocked from automation at code level.
 */
export const PLAYBOOKS: Playbook[] = [
  {
    id: "flush_cache",
    name: "Flush Application Cache",
    description:
      "Clears stale cache entries and re-primes the hot path. Zero downtime.",
    riskTier: "LOW",
    manualSteps: [
      "Open the service console and confirm cache hit-rate is degraded",
      "Run the cache flush command below",
      "Watch cache hit-rate recover above 80% within 60 seconds",
    ],
    command: "fixai cache flush --service app_service",
    autoAllowed: true,
    successProbability: 0.62,
    downtimeSeconds: 0,
  },
  {
    id: "restart_worker",
    name: "Restart Background Worker",
    description:
      "Recycles the background worker process to release leaked handles.",
    riskTier: "LOW",
    manualSteps: [
      "Identify the worker PID from the process table",
      "Gracefully stop the worker, then start it again",
      "Confirm the worker re-registers with the queue within 30s",
    ],
    command: "fixai worker restart --graceful",
    autoAllowed: true,
    successProbability: 0.58,
    downtimeSeconds: 3,
  },
  {
    id: "restart_container",
    name: "Restart Service Container",
    description:
      "Restarts the target container to reclaim memory and reset stuck threads.",
    riskTier: "MEDIUM",
    manualSteps: [
      "Open a terminal on the host running Docker",
      "Run the restart command below",
      "Wait for the /health endpoint to return 200 OK",
      "Verify RAM drops below 50% within 15 seconds",
    ],
    command: "docker restart app_service",
    autoAllowed: false,
    successProbability: 0.88,
    downtimeSeconds: 12,
  },
  {
    id: "scale_instances",
    name: "Scale Service Instances",
    description:
      "Adds a service replica to absorb load and lower per-instance pressure.",
    riskTier: "MEDIUM",
    manualSteps: [
      "Check current replica count and host capacity headroom",
      "Run the scale command below",
      "Confirm the new replica passes health checks",
      "Watch CPU/RAM per instance fall back under baseline",
    ],
    command: "docker compose up -d --scale app_service=2",
    autoAllowed: false,
    successProbability: 0.74,
    downtimeSeconds: 8,
  },
  {
    id: "purge_tmp",
    name: "Purge Temporary Files",
    description:
      "Safely removes stale temp artifacts blocking the disk (allowlisted paths).",
    riskTier: "MEDIUM",
    manualSteps: [
      "Run df -h to confirm the mount is above the safe threshold",
      "Run the purge command below (scoped to /tmp only)",
      "Confirm disk usage falls below 50%",
    ],
    command: "fixai disk purge --path /tmp --older-than 24h",
    autoAllowed: false,
    successProbability: 0.81,
    downtimeSeconds: 2,
  },
  {
    id: "db_maintenance",
    name: "Database Maintenance Window",
    description:
      "Runs VACUUM/ANALYZE and re-seats the connection pool. Can interrupt traffic.",
    riskTier: "HIGH",
    manualSteps: [
      "Announce a maintenance window to downstream teams",
      "Enable connection draining, then run the maintenance command",
      "Verify connection pool saturation returns under 60%",
      "Re-enable traffic and watch error rates",
    ],
    command: "fixai db maintenance --vacuum --reseat-pool",
    autoAllowed: false,
    successProbability: 0.69,
    downtimeSeconds: 45,
  },
];

export function getPlaybook(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}

export function riskTierColor(tier: RiskTier): string {
  switch (tier) {
    case "LOW":
      return "text-emerald-600 dark:text-emerald-400";
    case "MEDIUM":
      return "text-amber-600 dark:text-amber-400";
    case "HIGH":
      return "text-red-600 dark:text-red-400";
  }
}
