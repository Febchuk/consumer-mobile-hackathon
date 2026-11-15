import { mutation, query, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";
import { HOUR, LOCK_AFTER_MS, multiplier, percents, requireAdmin } from "./lib";

const kind = v.union(v.literal("yesno"), v.literal("overunder"), v.literal("multi"));

function optionsFor(k: "yesno" | "overunder" | "multi", line?: number, options?: string[]) {
  if (k === "yesno") return ["Yes", "No"];
  if (k === "overunder") {
    if (line === undefined) throw new ConvexError("Over/under needs a line");
    return ["Over " + line, "Under " + line];
  }
  const opts = (options ?? []).map((o) => o.trim()).filter(Boolean);
  if (opts.length < 2) throw new ConvexError("Need at least 2 options");
  return opts;
}

export async function insertBet(
  ctx: MutationCtx,
  roundId: Id<"rounds">,
  question: string,
  k: "yesno" | "overunder" | "multi",
  line?: number,
  options?: string[],
) {
  const opts = optionsFor(k, line, options);
  const existing = await ctx.db
    .query("bets")
    .withIndex("by_round", (q) => q.eq("roundId", roundId))
    .collect();
  const betId = await ctx.db.insert("bets", {
    roundId,
    question: question.trim(),
    kind: k,
    options: opts,
    line,
    pools: opts.map(() => 0),
    status: "open",
    order: existing.length,
  });
  await ctx.db.insert("ticks", { betId, t: Date.now(), pct: percents(opts.map(() => 0)) });
  return betId;
}

export async function ensureRound(ctx: MutationCtx, opensAt: number) {
  const existing = await ctx.db
    .query("rounds")
    .withIndex("by_opensAt", (q) => q.eq("opensAt", opensAt))
    .first();
  if (existing) return existing._id;
  const last = await ctx.db.query("rounds").withIndex("by_number").order("desc").first();
  const number = (last?.number ?? 0) + 1;
  return await ctx.db.insert("rounds", {
    number,
    title: "Drop " + number,
    opensAt,
    locksAt: opensAt + LOCK_AFTER_MS,
  });
}

export const check = query({
  args: { passcode: v.string() },
  handler: async (_ctx, { passcode }) => {
    try {
      requireAdmin(passcode);
      return true;
    } catch {
      return false;
    }
  },
});

export const overview = query({
  args: { passcode: v.string() },
  handler: async (ctx, { passcode }) => {
    requireAdmin(passcode);
    const rounds = await ctx.db.query("rounds").withIndex("by_number").order("desc").take(6);
    return await Promise.all(
      rounds.map(async (r) => ({
        ...r,
        bets: (
          await ctx.db
            .query("bets")
            .withIndex("by_round", (q) => q.eq("roundId", r._id))
            .collect()
        ).sort((a, b) => a.order - b.order),
      })),
    );
  },
});

export const addBet = mutation({
  args: {
    passcode: v.string(),
    roundId: v.id("rounds"),
    question: v.string(),
    kind,
    line: v.optional(v.number()),
    options: v.optional(v.array(v.string())),
  },
  handler: async (ctx, a) => {
    requireAdmin(a.passcode);
    if (!a.question.trim()) throw new ConvexError("Write a question");
    return await insertBet(ctx, a.roundId, a.question, a.kind, a.line, a.options);
  },
});

export const editBet = mutation({
  args: { passcode: v.string(), betId: v.id("bets"), question: v.string() },
  handler: async (ctx, { passcode, betId, question }) => {
    requireAdmin(passcode);
    await ctx.db.patch(betId, { question: question.trim() });
  },
});

export const deleteBet = mutation({
  args: { passcode: v.string(), betId: v.id("bets") },
  handler: async (ctx, { passcode, betId }) => {
    requireAdmin(passcode);
    await refundAll(ctx, betId);
    await ctx.db.delete(betId);
  },
});

export const lockBet = mutation({
  args: { passcode: v.string(), betId: v.id("bets"), locked: v.boolean() },
  handler: async (ctx, { passcode, betId, locked }) => {
    requireAdmin(passcode);
    const bet = await ctx.db.get(betId);
    if (!bet || bet.status === "settled" || bet.status === "refunded")
      throw new ConvexError("Already settled");
    await ctx.db.patch(betId, { status: locked ? "locked" : "open" });
  },
});

async function refundAll(ctx: MutationCtx, betId: Id<"bets">) {
  const stakes = await ctx.db
    .query("stakes")
    .withIndex("by_bet", (q) => q.eq("betId", betId))
    .collect();
  for (const s of stakes) {
    if (s.payout !== undefined) continue;
    const u = await ctx.db.get(s.userId);
    if (u) await ctx.db.patch(u._id, { points: u.points + s.amount });
    await ctx.db.patch(s._id, { payout: s.amount });
  }
}

export const settle = mutation({
  args: { passcode: v.string(), betId: v.id("bets"), winningOption: v.union(v.number(), v.null()) },
  handler: async (ctx, { passcode, betId, winningOption }) => {
    requireAdmin(passcode);
    const bet = await ctx.db.get(betId);
    if (!bet) throw new ConvexError("Bet not found");
    if (bet.status === "settled" || bet.status === "refunded") throw new ConvexError("Already settled");
    const winPool = winningOption === null ? 0 : bet.pools[winningOption];
    if (winningOption === null || winPool === 0) {
      await refundAll(ctx, betId);
      await ctx.db.patch(betId, { status: "refunded", winningOption: winningOption ?? undefined });
      return { refunded: true };
    }
    const total = bet.pools.reduce((a, b) => a + b, 0);
    const stakes = await ctx.db
      .query("stakes")
      .withIndex("by_bet", (q) => q.eq("betId", betId))
      .collect();
    for (const s of stakes) {
      if (s.option !== winningOption) {
        await ctx.db.patch(s._id, { payout: 0 });
        continue;
      }
      const payout = Math.floor(((total * s.amount) / winPool) * multiplier(s.streakAtBet));
      const u = await ctx.db.get(s.userId);
      if (u) await ctx.db.patch(u._id, { points: u.points + payout });
      await ctx.db.patch(s._id, { payout });
    }
    await ctx.db.patch(betId, { status: "settled", winningOption });
    return { refunded: false };
  },
});

export const createRound = mutation({
  args: { passcode: v.string(), opensAt: v.number() },
  handler: async (ctx, { passcode, opensAt }) => {
    requireAdmin(passcode);
    return await ensureRound(ctx, opensAt);
  },
});

export const setRoundTimes = mutation({
  args: { passcode: v.string(), roundId: v.id("rounds"), opensAt: v.number(), locksAt: v.number() },
  handler: async (ctx, { passcode, roundId, opensAt, locksAt }) => {
    requireAdmin(passcode);
    await ctx.db.patch(roundId, { opensAt, locksAt });
  },
});

export const ensureNextRound = internalMutation({
  args: {},
  handler: async (ctx) => {
    const nextHour = Math.ceil((Date.now() + 1) / HOUR) * HOUR;
    await ensureRound(ctx, nextHour);
  },
});

export const seed = internalMutation({
  args: { opensAt: v.number() },
  handler: async (ctx, { opensAt }) => {
    const roundId = await ensureRound(ctx, opensAt);
    const bets = await ctx.db
      .query("bets")
      .withIndex("by_round", (q) => q.eq("roundId", roundId))
      .collect();
    if (bets.length > 0) return roundId;
    await insertBet(ctx, roundId, "Is dinner pizza tonight?", "yesno");
    await insertBet(ctx, roundId, "How many dating apps get built today?", "overunder", 3.5);
    await insertBet(ctx, roundId, "Does a demo crash live on stage at finals?", "yesno");
    return roundId;
  },
});

export const testRound = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const roundId = await ctx.db.insert("rounds", {
      number: 0,
      title: "Test drop",
      opensAt: now - 11 * 60 * 1000,
      locksAt: now + 30 * 60 * 1000,
    });
    await insertBet(ctx, roundId, "Test: does the API respond?", "yesno");
    await insertBet(ctx, roundId, "Test: pick a color", "multi", undefined, ["Red", "Green", "Blue"]);
    return roundId;
  },
});

export const wipeRound = internalMutation({
  args: { roundId: v.id("rounds") },
  handler: async (ctx, { roundId }) => {
    const bets = await ctx.db
      .query("bets")
      .withIndex("by_round", (q) => q.eq("roundId", roundId))
      .collect();
    for (const b of bets) {
      for (const s of await ctx.db.query("stakes").withIndex("by_bet", (q) => q.eq("betId", b._id)).collect())
        await ctx.db.delete(s._id);
      for (const t of await ctx.db.query("ticks").withIndex("by_bet", (q) => q.eq("betId", b._id)).collect())
        await ctx.db.delete(t._id);
      await ctx.db.delete(b._id);
    }
    await ctx.db.delete(roundId);
  },
});

export const deleteUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await ctx.db.delete(userId);
  },
});

export type _Unused = Doc<"bets">;
