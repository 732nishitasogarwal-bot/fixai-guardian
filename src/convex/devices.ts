import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
      await ctx.db.insert("incidents", {
        userId,
        deviceId: args.deviceId,
        ...args.incident,
      });
    }
    if (args.audit) {
      await ctx.db.insert("auditLogs", { userId, ...args.audit });
    }

    return { ok: true };
  },
});

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
    playbookName: v.string(),
  },
  handler: async (ctx, { incidentId, playbookName }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, reason: "NOT_AUTHENTICATED" as const };

    const incident = await ctx.db.get(incidentId);
    if (!incident) return { ok: false, reason: "NOT_FOUND" as const };
    if (incident.userId !== userId) return { ok: false, reason: "FORBIDDEN" as const };

    // Duplicate request guard: an incident already queued for (or being run by)
    // the agent must not be re-queued — the backend is the source of truth.
    if (incident.status !== "OPEN" && incident.status !== "PENDING_APPROVAL") {
      return { ok: false, reason: "ALREADY_IN_PROGRESS" as const, status: incident.status };
    }

    // Re-queuing while PENDING_APPROVAL updates the selected playbook only.
    await ctx.db.patch(incidentId, {
      status: "PENDING_APPROVAL",
      mode: "AUTOMATED",
      playbookName,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      timestamp: Date.now(),
      actor: "USER",
      action: `Requested auto-fix: ${playbookName}`,
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

    // Atomic claim: patch to EXECUTING
    await ctx.db.patch(incidentId, {
      status: "EXECUTING",
      executedBy: agentName,
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
