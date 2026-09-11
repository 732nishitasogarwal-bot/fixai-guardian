import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** All saved permission rows for the signed-in user. */
export const listMyPermissions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("permissions")
      .withIndex("by_user_and_playbook", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** Create or update a single permission row. */
export const upsertPermission = mutation({
  args: {
    playbookId: v.string(),
    riskTier: v.union(v.literal("LOW"), v.literal("MEDIUM"), v.literal("HIGH")),
    isAutoApproved: v.boolean(),
    maxExecPerDay: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("permissions")
      .withIndex("by_user_and_playbook", (q) =>
        q.eq("userId", userId).eq("playbookId", args.playbookId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isAutoApproved: args.isAutoApproved,
        maxExecPerDay: args.maxExecPerDay,
      });
      return existing._id;
    }
    return await ctx.db.insert("permissions", { userId, ...args });
  },
});
