import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
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

export const DEFAULT_GROUP = "YC Hackathon";

export async function defaultGroupId(ctx: QueryCtx) {
  const g = await ctx.db
    .query("groups")
    .withIndex("by_default", (q) => q.eq("isDefault", true))
    .first();
  return g?._id ?? null;
}

export async function ensureDefaultGroup(ctx: MutationCtx) {
  return (await defaultGroupId(ctx)) ?? (await ctx.db.insert("groups", { name: DEFAULT_GROUP, isDefault: true }));
}

export async function isMember(ctx: QueryCtx, groupId: Id<"groups">, userId: Id<"users">) {
  return !!(await ctx.db
    .query("members")
    .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", userId))
    .first());
}

export function normalizeUsername(raw: string) {
  return raw
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_.]/g, "")
    .slice(0, 20);
}

export async function uniqueUsername(ctx: QueryCtx, base: string, selfId?: Id<"users">) {
  const root = base.length >= 2 ? base : (base + "player").slice(0, 20);
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? root : (root.slice(0, 17) + (i + 1)).slice(0, 20);
    const taken = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", candidate))
      .first();
    if (!taken || taken._id === selfId) return candidate;
  }
  return root + Date.now().toString(36);
}

async function hasBets(ctx: QueryCtx, roundId: Doc<"rounds">["_id"]) {
  const bets = await ctx.db
    .query("bets")
    .withIndex("by_round", (q) => q.eq("roundId", roundId))
    .collect();
  return bets.some((b) => !b.hidden);
}

export async function supersededAt(ctx: QueryCtx, round: Doc<"rounds">, now: number) {
  const later = await ctx.db
    .query("rounds")
    .withIndex("by_group_opensAt", (q) => q.eq("groupId", round.groupId).gt("opensAt", round.opensAt).lte("opensAt", now))
    .order("asc")
    .collect();
  for (const r of later) if (await hasBets(ctx, r._id)) return r.opensAt;
  return null;
}

export async function betLocked(ctx: QueryCtx, bet: Doc<"bets">, round: Doc<"rounds">, now: number) {
  if (bet.status !== "open") return true;
  return (await supersededAt(ctx, round, now)) !== null;
}

export async function currentRound(ctx: QueryCtx, groupId: Id<"groups"> | null, now: number) {
  const opened = await ctx.db
    .query("rounds")
    .withIndex("by_group_opensAt", (q) => q.eq("groupId", groupId ?? undefined).lte("opensAt", now))
    .order("desc")
    .take(24);
  for (const r of opened) if (await hasBets(ctx, r._id)) return r;
  return opened[0] ?? null;
}

export async function nextRound(ctx: QueryCtx, groupId: Id<"groups"> | null, now: number) {
  return await ctx.db
    .query("rounds")
    .withIndex("by_group_opensAt", (q) => q.eq("groupId", groupId ?? undefined).gt("opensAt", now))
    .order("asc")
    .first();
}

export async function previousRound(ctx: QueryCtx, round: Doc<"rounds">) {
  return await ctx.db
    .query("rounds")
    .withIndex("by_group_opensAt", (q) => q.eq("groupId", round.groupId).lt("opensAt", round.opensAt))
    .order("desc")
    .first();
}

export async function streakFor(ctx: QueryCtx, user: Doc<"users">, round: Doc<"rounds"> | null) {
  if (!round || !user.lastRoundId) return { shown: 0, next: 1 };
  if (user.lastRoundId === round._id) return { shown: user.streak, next: user.streak };
  const prev = await previousRound(ctx, round);
  if (prev && user.lastRoundId === prev._id) return { shown: user.streak, next: user.streak + 1 };
  return { shown: 0, next: 1 };
}
