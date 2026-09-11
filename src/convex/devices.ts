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
