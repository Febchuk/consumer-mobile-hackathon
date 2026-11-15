import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { START_POINTS, userByToken, requireUser } from "./lib";

export const join = mutation({
  args: { name: v.string(), emoji: v.string(), token: v.string() },
  handler: async (ctx, { name, emoji, token }) => {
    const clean = name.trim().slice(0, 20);
    if (!clean) throw new ConvexError("Pick a name");
    const existing = await userByToken(ctx, token);
    if (existing) {
      await ctx.db.patch(existing._id, { name: clean, emoji, lastSeen: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("users", {
      name: clean,
      emoji,
      token,
      points: START_POINTS,
      streak: 0,
      lastSeen: Date.now(),
    });
  },
});

export const me = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    const user = await userByToken(ctx, token);
    if (!user) return null;
    const { token: _t, ...rest } = user;
    return rest;
  },
});

export const ping = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx, token);
    await ctx.db.patch(user._id, { lastSeen: Date.now() });
  },
});
