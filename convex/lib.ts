import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { ConvexError } from "convex/values";

export const START_POINTS = 1000;
export const LATE_AFTER_MS = 10 * 60 * 1000;
export const LOCK_AFTER_MS = 50 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;

export function multiplier(streak: number) {
  return Math.min(2, 1 + 0.1 * Math.max(0, streak - 1));
}

export function percents(pools: number[]) {
  const total = pools.reduce((a, b) => a + b, 0);
  if (total === 0) return pools.map(() => 100 / pools.length);
  return pools.map((p) => (100 * p) / total);
}

export async function userByToken(ctx: QueryCtx, token: string | undefined) {
  if (!token) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

export async function requireUser(ctx: MutationCtx, token: string) {
  const user = await userByToken(ctx, token);
  if (!user) throw new ConvexError("Not joined");
  return user;
}

export function requireAdmin(passcode: string) {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected || passcode !== expected) throw new ConvexError("Wrong passcode");
}

export function betLocked(bet: Doc<"bets">, round: Doc<"rounds">, now: number) {
  return bet.status !== "open" || now >= round.locksAt;
}

export async function currentRound(ctx: QueryCtx, now: number) {
  return await ctx.db
    .query("rounds")
    .withIndex("by_opensAt", (q) => q.lte("opensAt", now))
    .order("desc")
    .first();
}

export async function nextRound(ctx: QueryCtx, now: number) {
  return await ctx.db
    .query("rounds")
    .withIndex("by_opensAt", (q) => q.gt("opensAt", now))
    .order("asc")
    .first();
}
