import type { Playbook, RiskTier } from "./types";

/**
 * CANONICAL PLAYBOOK CATALOG (Fix #3) — the single source of truth.
 *
 * These IDs are the shared contract across the entire system:
 *   React dashboard → Convex `requestAutoFix` → HTTP bridge → Python executor.
 *
 * Every id below is implemented as a safe handler in
 * `local_agent/recovery/executor.py:PLAYBOOKS`. IDs that are not implemented
 * in the agent executor (e.g. container-only actions) are NOT listed here —
 * we never pretend unsupported recovery actions work.
 *
 * HIGH risk actions are hard-blocked from automation at code level
 * (policy engine + executor), so none exist in this catalog.
 */
export const PLAYBOOKS: Playbook[] = [
  {
    id: "flush_cache",
    name: "Flush Application Cache",
    description:
      "Clears stale temp/cache files to reclaim disk pressure and re-prime the hot path. Zero downtime.",
    riskTier: "LOW",
    manualSteps: [
      "Confirm the disk/temp pressure in the Live Monitor view",
      "Run the cache flush command below (scoped to FixAI's own cache dirs only)",
      "Verify RAM/disk usage recovers within 60 seconds",
    ],
    command: "fixai cache flush --service app_service",
    autoAllowed: true,
    successProbability: 0.62,
    downtimeSeconds: 0,
    agentExecutable: true,
    maxExecPerHour: 5,
  },
  {
    id: "retry_service",
    name: "Retry Failed Requests",
    description:
      "Re-pings the local service health endpoint to verify connectivity and clear transient failure states.",
    riskTier: "LOW",
    manualSteps: [
      "Confirm the service is listening on its health port",
      "Run the health check command below",
      "Watch the 5xx error rate fall back under baseline",
    ],
    command: "fixai healthcheck retry --url http://localhost:8000/health",
    autoAllowed: true,
    successProbability: 0.58,
    downtimeSeconds: 0,
    agentExecutable: true,
    maxExecPerHour: 10,
  },
  {
    id: "restart_background_service",
    name: "Restart Background Service",
    description:
      "Gracefully restarts a registered user-level background service to reset stuck threads.",
    riskTier: "MEDIUM",
    manualSteps: [
      "Identify the service unit name from the process table",
      "Gracefully restart it with the command below (user-level systemd only)",
      "Confirm the service re-registers and health returns to 200 OK",
    ],
    command: "systemctl --user restart <service_name>",
    autoAllowed: false,
    successProbability: 0.78,
    downtimeSeconds: 5,
    agentExecutable: true,
    maxExecPerHour: 3,
  },
  {
    id: "kill_high_mem_process",
    name: "Terminate High-Memory Process",
    description:
      "Terminates the top user-space RAM consumer (denylisted OS processes are protected).",
    riskTier: "MEDIUM",
    manualSteps: [
      "Identify the highest-memory user process (Task Manager / top)",
      "Close or terminate it gracefully yourself",
      "Verify RAM drops below the safe threshold within 15 seconds",
    ],
    command: "fixai process kill --top-memory",
    autoAllowed: false,
    successProbability: 0.88,
    downtimeSeconds: 2,
    agentExecutable: true,
    maxExecPerHour: 3,
  },
  {
    id: "purge_temp_files",
    name: "Purge Temporary Files",
    description:
      "Safely removes stale temp artifacts (scoped to /tmp/fixai_cache only) blocking the disk.",
    riskTier: "MEDIUM",
    manualSteps: [
      "Run df -h to confirm the mount is above the safe threshold",
      "Run the purge command below (scoped to FixAI's temp dir only)",
      "Confirm disk usage falls below 50%",
    ],
    command: "fixai disk purge --path /tmp/fixai_cache",
    autoAllowed: false,
    successProbability: 0.81,
    downtimeSeconds: 2,
    agentExecutable: true,
    maxExecPerHour: 3,
  },
];

/**
 * BACKWARD COMPATIBILITY (STEP 9).
 * Incidents created before Fix #3 may carry the old dashboard-only playbook
 * names/ids. This map resolves them to their nearest canonical equivalent so
 * old rows stay actionable without ever executing something the agent does
 * not implement. Read-only compatibility — never used for NEW requests.
 */
export const LEGACY_PLAYBOOK_IDS: Record<string, string> = {
  restart_worker: "restart_background_service",
  restart_container: "kill_high_mem_process",
  scale_instances: "retry_service",
  purge_tmp: "purge_temp_files",
  db_maintenance: "flush_cache", // HIGH risk was never automatable anyway
  // Old display-name keys stored by pre-Fix-#3 requestAutoFix calls:
  "Restart Background Worker": "restart_background_service",
  "Restart Service Container": "kill_high_mem_process",
  "Scale Service Instances": "retry_service",
  "Purge Temporary Files": "purge_temp_files",
  "Database Maintenance Window": "flush_cache",
  "Terminate High-Memory Process": "kill_high_mem_process",
  "Retry Failed Requests": "retry_service",
};

export function getPlaybook(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}

/** Resolve a legacy/display id to the canonical id (identity when already canonical). */
export function canonicalPlaybookId(id: string): string {
  return LEGACY_PLAYBOOK_IDS[id] ?? (getPlaybook(id) ? id : id);
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
