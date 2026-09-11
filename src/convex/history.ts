import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { v } from "convex/values";

/** Recent incidents for the signed-in user, newest first. */
export const listIncidents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const nameById = new Map(devices.map((d) => [d._id, d.name]));

    return incidents.map((i) => ({
      _id: i._id,
      detectedAt: i.detectedAt,
      resolvedAt: i.resolvedAt ?? null,
      status: i.status,
      failureProbability: i.failureProbability,
      anomalyScore: i.anomalyScore,
      risk: i.risk,
      primaryCause: i.primaryCause,
      explanation: i.explanation,
      mode: i.mode ?? null,
      playbookName: i.playbookName ?? null,
      isHealthRestored: i.isHealthRestored ?? null,
      soakSeconds: i.soakSeconds ?? null,
      systemName: nameById.get(i.deviceId) ?? "Unknown device",
    }));
  },
});

/** Audit trail, newest first. */
export const listAuditLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 100 }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_user_and_ts", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

/** Stored telemetry window for a device (for the pre/post comparison view). */
export const listTelemetry = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 40 }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const device = await ctx.db
      .query("devices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!device) return [];

    const rows = await ctx.db
      .query("telemetry")
      .withIndex("by_device_and_t", (q) => q.eq("deviceId", device._id))
      .order("desc")
      .take(limit);
    return rows.reverse().map((r) => ({
      t: r.t,
      cpu: r.cpu,
      ram: r.ram,
      latency: r.latency,
      errorRate: r.errorRate,
      disk: r.disk,
    }));
  },
});
