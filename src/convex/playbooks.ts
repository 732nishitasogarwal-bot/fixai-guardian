import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Canonical playbook catalog (Fix #3) — Convex is the single source of truth.
 *
 * The dashboard imports the same catalog from `src/lib/playbooks.ts` for
 * display/utility ranking; the DB rows here are the authoritative seed that
 * the HTTP bridge and `claimIncident` validate against. The Python executor's
 * allowlist (`local_agent/recovery/executor.py`) mirrors these exact ids.
 */

const CATALOG_VERSION = 3;

const PLAYBOOK_SEED = [
  {
    playbookId: "flush_cache",
    name: "Flush Application Cache",
    description: "Clears stale temp/cache files to reclaim disk pressure.",
    riskTier: "LOW" as const,
    enabled: true,
    requiresApproval: false,
    agentExecutable: true,
    parameters: [],
    maxExecPerHour: 5,
  },
  {
    playbookId: "retry_service",
    name: "Retry Failed Requests",
    description: "Re-pings the local service health endpoint to clear transient failures.",
    riskTier: "LOW" as const,
    enabled: true,
    requiresApproval: false,
    agentExecutable: true,
    parameters: ["url"],
    maxExecPerHour: 10,
  },
  {
    playbookId: "restart_background_service",
    name: "Restart Background Service",
    description: "Gracefully restarts a registered user-level background service.",
    riskTier: "MEDIUM" as const,
    enabled: true,
    requiresApproval: true,
    agentExecutable: true,
    parameters: ["service_name"],
    maxExecPerHour: 3,
  },
  {
    playbookId: "kill_high_mem_process",
    name: "Terminate High-Memory Process",
    description: "Terminates the top user-space RAM consumer (denylist protected).",
    riskTier: "MEDIUM" as const,
    enabled: true,
    requiresApproval: true,
    agentExecutable: true,
    parameters: ["process_name"],
    maxExecPerHour: 3,
  },
  {
    playbookId: "purge_temp_files",
    name: "Purge Temporary Files",
    description: "Removes stale temp artifacts scoped to FixAI's own temp dir only.",
    riskTier: "MEDIUM" as const,
    enabled: true,
    requiresApproval: true,
    agentExecutable: true,
    parameters: [],
    maxExecPerHour: 3,
  },
];

/**
 * Idempotent seed: inserts missing playbooks and refreshes metadata for rows
 * whose catalog fields changed. Safe to run on every deployment — it never
 * creates duplicate records and never re-enables a playbook the operator has
 * disabled (only `enabled` set to false stays sticky).
 */
export const seedPlaybookCatalog = internalMutation({
  args: {},
  handler: async (ctx) => {
    let inserted = 0;
    let updated = 0;

    for (const pb of PLAYBOOK_SEED) {
      const existing = await ctx.db
        .query("playbooks")
        .withIndex("by_playbook_id", (q) => q.eq("playbookId", pb.playbookId))
        .first();

      if (!existing) {
        await ctx.db.insert("playbooks", { ...pb, catalogVersion: CATALOG_VERSION });
        inserted++;
        continue;
      }

      // Refresh non-operator-owned metadata when the catalog changes.
      const needsUpdate =
        existing.name !== pb.name ||
        existing.description !== pb.description ||
        existing.riskTier !== pb.riskTier ||
        existing.requiresApproval !== pb.requiresApproval ||
        existing.agentExecutable !== pb.agentExecutable ||
        existing.maxExecPerHour !== pb.maxExecPerHour ||
        existing.catalogVersion !== CATALOG_VERSION;

      if (needsUpdate) {
        await ctx.db.patch(existing._id, {
          ...pb,
          enabled: existing.enabled, // operator toggle is sticky
          catalogVersion: CATALOG_VERSION,
        });
        updated++;
      }
    }

    return { inserted, updated, version: CATALOG_VERSION };
  },
});

/** All playbooks in the catalog (dashboard + bridge reads). */
export const listPlaybooks = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("playbooks").withIndex("by_playbook_id").collect();
  },
});

/** Single playbook lookup used by requestAutoFix/claim validation. */
export const getPlaybookById = query({
  args: { playbookId: v.string() },
  handler: async (ctx, { playbookId }) => {
    return await ctx.db
      .query("playbooks")
      .withIndex("by_playbook_id", (q) => q.eq("playbookId", playbookId))
      .first();
  },
});
