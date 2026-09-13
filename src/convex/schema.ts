import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ── FixAI domain tables ────────────────────────────────────────────────

    devices: defineTable({
      userId: v.id("users"),
      name: v.string(),
      status: v.union(
        v.literal("HEALTHY"),
        v.literal("DEGRADED"),
        v.literal("CRITICAL"),
      ),
      healthScore: v.number(),
      failureRisk: v.number(),
      anomalyScore: v.number(),
      agentOnline: v.boolean(),
      lastSeenAt: v.number(),
      specs: v.object({
        os: v.string(),
        cpuModel: v.string(),
        cores: v.number(),
        ramGb: v.number(),
      }),
    })
      .index("by_user", ["userId"])
      .index("by_user_and_name", ["userId", "name"]),

    telemetry: defineTable({
      deviceId: v.id("devices"),
      t: v.number(),
      cpu: v.number(),
      ram: v.number(),
      latency: v.number(),
      errorRate: v.number(),
      disk: v.number(),
    }).index("by_device_and_t", ["deviceId", "t"]),

    incidents: defineTable({
      userId: v.id("users"),
      deviceId: v.id("devices"),
      detectedAt: v.number(),
      resolvedAt: v.optional(v.number()),
      /** Last sync that confirmed this incident is still ongoing (dedup heartbeat). */
      lastSeenAt: v.optional(v.number()),
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
      shap: v.array(
        v.object({
          feature: v.string(),
          value: v.number(),
          attribution: v.number(),
        }),
      ),
      logEvidence: v.array(v.string()),
      mode: v.optional(v.union(v.literal("MANUAL"), v.literal("AUTOMATED"))),
      playbookName: v.optional(v.string()),
      policyDecision: v.optional(
        v.union(v.literal("ALLOWED"), v.literal("DENIED"), v.literal("BLOCKED")),
      ),
      executedBy: v.optional(v.string()),
      isHealthRestored: v.optional(v.boolean()),
      soakSeconds: v.optional(v.number()),
      scenarioKey: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_device", ["deviceId"])
      .index("by_device_and_detected", ["deviceId", "detectedAt"]),

    auditLogs: defineTable({
      userId: v.id("users"),
      timestamp: v.number(),
      actor: v.string(),
      action: v.string(),
      decision: v.string(),
      reason: v.string(),
    }).index("by_user_and_ts", ["userId", "timestamp"]),

    permissions: defineTable({
      userId: v.id("users"),
      playbookId: v.string(),
      riskTier: v.union(
        v.literal("LOW"),
        v.literal("MEDIUM"),
        v.literal("HIGH"),
      ),
      isAutoApproved: v.boolean(),
      maxExecPerDay: v.number(),
    }).index("by_user_and_playbook", ["userId", "playbookId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
