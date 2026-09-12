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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

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
 * will pick it up on its next poll.
 * Called by the React dashboard when the user clicks "Automated Fix".
 */
export const requestAutoFix = mutation({
  args: {
    incidentId: v.id("incidents"),
    playbookName: v.string(),
  },
  handler: async (ctx, { incidentId, playbookName }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const incident = await ctx.db.get(incidentId);
    if (!incident) throw new Error("Incident not found");
    if (incident.userId !== userId) throw new Error("Not authorized for this incident");

    // Only allow transitioning from OPEN to PENDING_APPROVAL
    if (incident.status !== "OPEN") {
      throw new Error(`Cannot request auto-fix: incident is ${incident.status}`);
    }

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

    return { ok: true };
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

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
