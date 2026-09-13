import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { LEGACY_PLAYBOOK_IDS } from "../lib/playbooks";

/**
 * Device sync: upserts a single "primary" device per user that the simulated
 * agent streams telemetry into. Real deployments would register many devices;
 * the MVP binds one device to the signed-in account.
 */

const specsValidator = v.object({
  os: v.string(),
  cpuModel: v.string(),
  cores: v.number(),
  ramGb: v.number(),
});

/**
 * Look up a device by name (used by the agent bridge HTTP action).
 * Returns the device _id if found, null otherwise.
 */
export const findDeviceByName = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const device = await ctx.db
      .query("devices")
      .filter((q) => q.eq(q.field("name"), name))
      .first();
    return device?._id ?? null;
  },
});

export const getMyDevice = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

export const ensureDevice = mutation({
  args: {
    name: v.string(),
    specs: specsValidator,
    agentOnline: v.boolean(),
  },
  handler: async (ctx, { name, specs, agentOnline }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const lastSeenAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { name, specs, agentOnline, lastSeenAt });
      return existing._id;
    }
    return await ctx.db.insert("devices", {
      userId,
      name,
      status: "HEALTHY",
      healthScore: 92,
      failureRisk: 0.06,
      anomalyScore: 0.08,
      agentOnline,
      lastSeenAt,
      specs,
    });
  },
});

const sampleValidator = v.object({
  t: v.number(),
  cpu: v.number(),
  ram: v.number(),
  latency: v.number(),
  errorRate: v.number(),
  disk: v.number(),
});

const shapValidator = v.object({
  feature: v.string(),
  value: v.number(),
  attribution: v.number(),
});

/**
 * Ingest one telemetry batch and persist an incident + audit entry when the
 * anomaly/failure verdict breaches thresholds. Mirrors the FixAI backend's
 * ingestion → prediction → RCA pipeline.
 */
export const ingestTelemetry = mutation({
  args: {
    deviceId: v.id("devices"),
    status: v.union(
      v.literal("HEALTHY"),
      v.literal("DEGRADED"),
      v.literal("CRITICAL"),
    ),
    healthScore: v.number(),
    failureRisk: v.number(),
    anomalyScore: v.number(),
    agentOnline: v.boolean(),
    samples: v.array(sampleValidator),
    incident: v.optional(
      v.object({
        detectedAt: v.number(),
        resolvedAt: v.optional(v.number()),
        status: v.union(
          v.literal("OPEN"),
          v.literal("PENDING_APPROVAL"),
          v.literal("EXECUTING"),
          v.literal("RESOLVED"),
          v.literal("ESCALATED"),
          v.literal("FAILED"),
        ),
        failureProbability: v.number(),
        anomalyScore: v.number(),
        risk: v.union(v.literal("LOW"), v.literal("MEDIUM"), v.literal("HIGH")),
        rootCauseId: v.string(),
        primaryCause: v.string(),
        explanation: v.string(),
        shap: v.array(shapValidator),
        logEvidence: v.array(v.string()),
        mode: v.optional(v.union(v.literal("MANUAL"), v.literal("AUTOMATED"))),
        playbookName: v.optional(v.string()),
        policyDecision: v.optional(
          v.union(
            v.literal("ALLOWED"),
            v.literal("DENIED"),
            v.literal("BLOCKED"),
          ),
        ),
        executedBy: v.optional(v.string()),
        isHealthRestored: v.optional(v.boolean()),
        soakSeconds: v.optional(v.number()),
        scenarioKey: v.optional(v.string()),
      }),
    ),
    audit: v.optional(
      v.object({
        timestamp: v.number(),
        actor: v.string(),
        action: v.string(),
        decision: v.string(),
        reason: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Identity is derived from the device record, not the caller's session:
    // this mutation is invoked from BOTH the React dashboard (user session) and
    // the Python agent bridge (X-API-Key httpAction, no session). The HTTP
    // action authenticates the agent and resolves deviceId first, so the
    // device row's owner is the authoritative userId for writes here.
    const device = await ctx.db.get(args.deviceId);
    if (!device) throw new Error("Device not found");
    const userId = device.userId;

    // Keep the live window small: store only the most recent samples.
    const recent = args.samples.slice(-40);
    for (const s of recent) {
      await ctx.db.insert("telemetry", { deviceId: args.deviceId, ...s });
    }

    // Trim older rows so the table does not grow unbounded in dev.
    const all = await ctx.db
      .query("telemetry")
      .withIndex("by_device_and_t", (q) => q.eq("deviceId", args.deviceId))
      .collect();
    if (all.length > 160) {
      const excess = all
        .sort((a, b) => a.t - b.t)
        .slice(0, all.length - 120);
      for (const row of excess) await ctx.db.delete(row._id);
    }

    await ctx.db.patch(args.deviceId, {
      status: args.status,
      healthScore: args.healthScore,
      failureRisk: args.failureRisk,
      anomalyScore: args.anomalyScore,
      agentOnline: args.agentOnline,
      lastSeenAt: Date.now(),
    });

    if (args.incident) {
      await recordIncidentObservation(ctx, {
        userId,
        deviceId: args.deviceId,
        incoming: args.incident,
        source: "dashboard",
      });
    }
    if (args.audit) {
      await ctx.db.insert("auditLogs", { userId, ...args.audit });
    }

    return { ok: true };
  },
});

// ── Incident deduplication (Fix #5) ────────────────────────────────────

/**
 * Create-or-update an incident for one (device, scenario) observation.
 *
 * Incident identity = deviceId × scenarioKey × active-status. A sustained
 * anomaly must surface as ONE evolving incident, not one row per sync cycle.
 *
 * Behavior:
 *  - Active incident with the same (deviceId, scenarioKey) exists → update it
 *    in place (lastSeenAt heartbeat + refreshed scores/explanation/SHAP).
 *    Create and update share this single mutation, so two near-simultaneous
 *    ingest calls cannot both insert: Convex serialises mutations, so the
 *    second caller observes the first caller's insert and takes the update
 *    path (race-safe without extra locking).
 *  - No active incident → insert a new one. Terminal states (RESOLVED/FAILED)
 *    never match, so a later recurrence naturally creates a fresh incident —
 *    future occurrences are never permanently blocked.
 *  - An incident in EXECUTING/PENDING_APPROVAL is never demoted: telemetry
 *    updates refresh scores only, never the status.
 */
async function recordIncidentObservation(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    deviceId: Id<"devices">;
    incoming: Omit<Doc<"incidents">, "_id" | "_creationTime" | "userId" | "deviceId">;
    source: "agent" | "dashboard";
  },
) {
  const { userId, deviceId, incoming, source } = args;

  // Stable scenario identity; fall back to a namespaced cause string when the
  // agent did not send a machine-readable key.
  const scenarioKey = incoming.scenarioKey ?? `cause:${incoming.primaryCause}`;

  // ── 1. Find an ACTIVE incident for this identity ──────────────────
  const active = await ctx.db
    .query("incidents")
    .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
    .filter((q) =>
      q.and(
        q.eq(q.field("scenarioKey"), scenarioKey),
        q.or(
          q.eq(q.field("status"), "OPEN"),
          q.eq(q.field("status"), "PENDING_APPROVAL"),
          q.eq(q.field("status"), "EXECUTING"),
        ),
      ),
    )
    .first();

  const now = Date.now();

  // ── 2. Existing active incident → update in place (dedup) ─────────
  if (active) {
    await ctx.db.patch(active._id, {
      lastSeenAt: now,
      // Latest model verdicts. Status intentionally NOT touched — an
      // EXECUTING or PENDING_APPROVAL incident must never be demoted by a
      // telemetry update.
      failureProbability: incoming.failureProbability,
      anomalyScore: incoming.anomalyScore,
      risk: incoming.risk,
      explanation: incoming.explanation,
      shap: incoming.shap,
    });

    // Meaningful transition only: self-resolve when the REAL agent reports
    // the system healthy again while the incident is still OPEN (the recovery
    // worked, or the pressure passed). Dashboard-simulated ingests never
    // self-resolve; their lifecycle stays owned by the demo episode flow.
    if (
      source === "agent" &&
      active.status === "OPEN" &&
      incoming.risk === "LOW"
    ) {
      await ctx.db.patch(active._id, {
        status: "RESOLVED",
        resolvedAt: now,
        isHealthRestored: true,
        mode: "AUTOMATED",
        playbookName: "Self-resolved (telemetry normalised)",
        executedBy: "AI_AGENT",
      });
      await ctx.db.insert("auditLogs", {
        userId,
        timestamp: now,
        actor: "AI_AGENT",
        action: `Incident self-resolved: ${incoming.primaryCause}`,
        decision: "RESOLVED",
        reason: "Real agent telemetry returned to LOW risk",
      });
    }
    return;
  }

  // ── 3. No active incident → insert, with suppression rules ─────────
  // Agent ingests carrying LOW risk with no active incident are dropped:
  // there is nothing to heal and inserting would pollute the incident feed.
  if (source === "agent" && incoming.risk === "LOW") return;

  await ctx.db.insert("incidents", {
    ...incoming,
    userId,
    deviceId,
    scenarioKey,
    lastSeenAt: now,
  });
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars

// ── Pending Actions API (for Python agent) ───────────────────────────

/**
 * Live incident feed for the signed-in user, newest first.
 * The Recovery page subscribes to this so agent-driven status transitions
 * (PENDING_APPROVAL → EXECUTING → RESOLVED/FAILED) update the UI without a
 * refresh. Reads are auth-scoped; writes happen through dedicated mutations.
 */
export const getUserIncidents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 20 }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("incidents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Look up the canonical playbook row for an incoming playbook reference.
 *
 * Accepts: a canonical id ("flush_cache"), a legacy dashboard id
 * ("restart_worker"), or a pre-Fix-#3 display name ("Restart Background
 * Worker"). Returns null when the reference maps to nothing actionable.
 */
async function resolvePlaybook(
  ctx: MutationCtx,
  playbookRef: string,
): Promise<Doc<"playbooks"> | null> {
  const tryIds = [playbookRef, LEGACY_PLAYBOOK_IDS[playbookRef]].filter(
    (id): id is string => typeof id === "string",
  );
  for (const id of tryIds) {
    const row = await ctx.db
      .query("playbooks")
      .withIndex("by_playbook_id", (q) => q.eq("playbookId", id))
      .first();
    if (row) return row;
  }
  return null;
}

/**
 * Query: find pending actions for a device by name.
 * Used by the agent HTTP bridge to return incidents awaiting recovery.
 * Returns incidents with status OPEN or PENDING_APPROVAL for the named device.
 */
export const getPendingActionsForDevice = query({
  args: { deviceName: v.string() },
  handler: async (ctx, { deviceName }) => {
    // Find the device by name
    const device = await ctx.db
      .query("devices")
      .filter((q) => q.eq(q.field("name"), deviceName))
      .first();
    if (!device) return null; // signals 404 to the HTTP action

    // Find incidents that are awaiting agent action
    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_device", (q) => q.eq("deviceId", device._id))
      .collect();

    return incidents.filter(
      (inc) => inc.status === "OPEN" || inc.status === "PENDING_APPROVAL",
    );
  },
});

/**
 * Mutation: set an incident to PENDING_APPROVAL so the Python agent
 * will pick it up on its next poll. Called by the React dashboard when the
 * user clicks "Automated Fix" and confirms the permission modal.
 *
 * Returns a status object instead of throwing so the UI can render precise
 * error states (convex mutations that throw surface as opaque errors).
 */
export const requestAutoFix = mutation({
  args: {
    incidentId: v.id("incidents"),
    /** Canonical playbook id from the shared catalog (src/lib/playbooks.ts). */
    playbookId: v.optional(v.string()),
    /** Display name kept for human-readable audit rows; also accepted alone
     *  from legacy clients (resolved through the legacy id map). */
    playbookName: v.optional(v.string()),
  },
  handler: async (ctx, { incidentId, playbookId, playbookName }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, reason: "NOT_AUTHENTICATED" as const };

    const incident = await ctx.db.get(incidentId);
    if (!incident) return { ok: false, reason: "NOT_FOUND" as const };
    if (incident.userId !== userId) return { ok: false, reason: "FORBIDDEN" as const };

    // Fix #3: validate the requested playbook against the canonical catalog.
    // The canonical playbookId is preferred; legacy display-name-only calls
    // resolve transparently through the legacy map. Unknown ids are rejected.
    const playbookRef = playbookId ?? playbookName;
    if (!playbookRef) return { ok: false, reason: "UNKNOWN_PLAYBOOK" as const };
    const playbook = await resolvePlaybook(ctx, playbookRef);
    if (!playbook) return { ok: false, reason: "UNKNOWN_PLAYBOOK" as const };
    if (!playbook.enabled || !playbook.agentExecutable) {
      return { ok: false, reason: "PLAYBOOK_DISABLED" as const };
    }
    if (playbook.riskTier === "HIGH") {
      return { ok: false, reason: "HIGH_RISK_BLOCKED" as const };
    }

    // Duplicate request guard: an incident already queued for (or being run by)
    // the agent must not be re-queued — the backend is the source of truth.
    if (incident.status !== "OPEN" && incident.status !== "PENDING_APPROVAL") {
      return { ok: false, reason: "ALREADY_IN_PROGRESS" as const, status: incident.status };
    }

    const name = playbookName ?? playbook.name;

    // Re-queuing while PENDING_APPROVAL updates the selected playbook only.
    await ctx.db.patch(incidentId, {
      status: "PENDING_APPROVAL",
      mode: "AUTOMATED",
      playbookId: playbook.playbookId,
      playbookName: name,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      timestamp: Date.now(),
      actor: "USER",
      action: `Requested auto-fix: ${name} (${playbook.playbookId})`,
      decision: "PENDING_APPROVAL",
      reason: `Incident ${incidentId} escalated to automated recovery`,
    });

    return { ok: true as const };
  },
});

/**
 * Mutation: atomically claim an incident for execution.
 * Changes status from OPEN or PENDING_APPROVAL to EXECUTING.
 * Returns { ok: true } if claimed, { ok: false } if already claimed.
 * Called by the Python agent after receiving a pending action.
 */
export const claimIncident = mutation({
  args: {
    incidentId: v.id("incidents"),
    agentName: v.string(),
  },
  handler: async (ctx, { incidentId, agentName }) => {
    const incident = await ctx.db.get(incidentId);
    if (!incident) throw new Error("Incident not found");

    // Only OPEN or PENDING_APPROVAL can be claimed
    if (incident.status !== "OPEN" && incident.status !== "PENDING_APPROVAL") {
      return { ok: false, reason: `Already in status: ${incident.status}` };
    }

    // Fix #3 safety gate: the stored playbook must exist in the canonical
    // catalog, be enabled, and be agent-executable. Legacy incidents without
    // a stored id keep working — their playbookName falls back through the
    // legacy map inside resolvePlaybook.
    const playbookRef = incident.playbookId ?? incident.playbookName ?? "";
    const playbook = playbookRef ? await resolvePlaybook(ctx, playbookRef) : null;
    if (playbookRef && !playbook) {
      return { ok: false, reason: `Unknown playbook '${playbookRef}' — not in catalog` };
    }
    if (playbook && (!playbook.enabled || !playbook.agentExecutable)) {
      return { ok: false, reason: `Playbook '${playbook.playbookId}' is disabled` };
    }

    // Atomic claim: patch to EXECUTING (persist the canonical id on legacy rows)
    await ctx.db.patch(incidentId, {
      status: "EXECUTING",
      executedBy: agentName,
      playbookId: playbook?.playbookId ?? incident.playbookId,
    });

    // Audit log — use the device's userId
    const userId = incident.userId;
    await ctx.db.insert("auditLogs", {
      userId,
      timestamp: Date.now(),
      actor: agentName,
      action: `Claimed incident for execution: ${incident.playbookName ?? "unknown"}`,
      decision: "EXECUTING",
      reason: `Incident ${incidentId} claimed by agent`,
    });

    return { ok: true };
  },
});

/** Resolve an incident after successful or failed recovery. */
export const resolveIncident = mutation({
  args: {
    incidentId: v.id("incidents"),
    status: v.union(
      v.literal("RESOLVED"),
      v.literal("ESCALATED"),
      v.literal("FAILED"),
    ),
    isHealthRestored: v.boolean(),
    mode: v.union(v.literal("MANUAL"), v.literal("AUTOMATED")),
    playbookName: v.string(),
    postFixNote: v.string(),
    soakSeconds: v.number(),
  },
  handler: async (ctx, args) => {
    // Same sessionless path as ingestTelemetry: the Python agent resolves
    // incidents through the HTTP bridge with no user session. Derive the
    // owner from the incident row (mirrors claimIncident's pattern).
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) throw new Error("Incident not found");
    const userId = incident.userId;

    await ctx.db.patch(args.incidentId, {
      status: args.status,
      isHealthRestored: args.isHealthRestored,
      mode: args.mode,
      playbookName: args.playbookName,
      resolvedAt: args.status === "RESOLVED" ? Date.now() : undefined,
      soakSeconds: args.soakSeconds,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      timestamp: Date.now(),
      actor: args.mode === "AUTOMATED" ? "AUTO_AGENT" : "USER",
      action: `Recovery validated: ${args.playbookName}`,
      decision: args.status === "RESOLVED" ? "EXECUTED" : "VALIDATED",
      reason: args.postFixNote,
    });

    return { ok: true };
  },
});
