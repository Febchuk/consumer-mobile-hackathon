import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  LATE_AFTER_MS,
  betLocked,
  currentRound,
  nextRound,
  percents,
  requireUser,
  userByToken,
  multiplier,
} from "./lib";

export const today = query({
  args: { token: v.optional(v.string()), now: v.number() },
  handler: async (ctx, { token, now }) => {
    const user = await userByToken(ctx, token);
    const round = await currentRound(ctx, now);
    const upcoming = await nextRound(ctx, now);
    if (!round) return { round: null, next: upcoming, bets: [], players: (await ctx.db.query("users").collect()).length };
    const bets = (
      await ctx.db
        .query("bets")
        .withIndex("by_round", (q) => q.eq("roundId", round._id))
        .collect()
    )
      .filter((b) => !b.hidden)
      .sort((a, b) => a.order - b.order);
    const myStakes = user
      ? await ctx.db
          .query("stakes")
          .withIndex("by_round_user", (q) => q.eq("roundId", round._id).eq("userId", user._id))
          .collect()
      : [];
    const withTicks = await Promise.all(
      bets.map(async (bet) => {
        const ticks = await ctx.db
          .query("ticks")
          .withIndex("by_bet", (q) => q.eq("betId", bet._id))
          .collect();
        const stakes = await ctx.db
          .query("stakes")
          .withIndex("by_bet", (q) => q.eq("betId", bet._id))
          .collect();
        return {
          ...bet,
          locked: betLocked(bet, round, now),
          pct: percents(bet.pools),
          total: bet.pools.reduce((a, b) => a + b, 0),
          bettors: new Set(stakes.map((s) => s.userId)).size,
          ticks: ticks.map((t) => ({ t: t.t, pct: t.pct })),
          mine: myStakes
            .filter((s) => s.betId === bet._id)
            .map((s) => ({ option: s.option, amount: s.amount, late: s.late, payout: s.payout })),
        };
      }),
    );
    const players = (await ctx.db.query("users").collect()).length;
    return { round, next: upcoming, bets: withTicks, players };
  },
});

export const placeStake = mutation({
  args: { token: v.string(), betId: v.id("bets"), option: v.number(), amount: v.number() },
  handler: async (ctx, { token, betId, option, amount }) => {
    const user = await requireUser(ctx, token);
    const bet = await ctx.db.get(betId);
    if (!bet) throw new ConvexError("Bet not found");
    const round = await ctx.db.get(bet.roundId);
    if (!round) throw new ConvexError("Round not found");
    const now = Date.now();
    if (now < round.opensAt) throw new ConvexError("Not open yet");
    if (betLocked(bet, round, now)) throw new ConvexError("Betting is locked");
    if (!Number.isInteger(option) || option < 0 || option >= bet.options.length)
      throw new ConvexError("Bad pick");
    const prior = await ctx.db
      .query("stakes")
      .withIndex("by_bet", (q) => q.eq("betId", bet._id))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .first();
    if (prior && prior.option !== option)
      throw new ConvexError("You already called " + bet.options[prior.option] + ". You can only add to that side.");
    const amt = Math.floor(amount);
    if (amt < 1) throw new ConvexError("Stake at least 1 point");
    if (amt > user.points) throw new ConvexError("Not enough points");

    let streak = user.streak;
    if (user.lastRoundNumber !== round.number) {
      streak = user.lastRoundNumber === round.number - 1 ? user.streak + 1 : 1;
    }
    await ctx.db.patch(user._id, {
      points: user.points - amt,
      streak,
      lastRoundNumber: round.number,
      lastSeen: now,
    });
    const pools = bet.pools.map((p, i) => (i === option ? p + amt : p));
    await ctx.db.patch(bet._id, { pools });
    await ctx.db.insert("ticks", { betId: bet._id, t: now, pct: percents(pools) });
    await ctx.db.insert("stakes", {
      betId: bet._id,
      roundId: round._id,
      userId: user._id,
      option,
      amount: amt,
      late: now - round.opensAt > LATE_AFTER_MS,
      streakAtBet: streak,
    });
  },
});

export const leaderboard = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const users = await ctx.db.query("users").withIndex("by_points").order("desc").take(200);
    const round = await currentRound(ctx, now);
    const roundStakes = round
      ? await ctx.db
          .query("stakes")
          .filter((q) => q.eq(q.field("roundId"), round._id))
          .collect()
      : [];
    const open = roundStakes.filter((s) => s.payout === undefined);
    return users.map((u) => {
      const mine = roundStakes.filter((s) => s.userId === u._id);
      const live = open.filter((s) => s.userId === u._id).reduce((a, s) => a + s.amount, 0);
      const streakAlive =
        u.lastRoundNumber !== undefined &&
        round !== null &&
        u.lastRoundNumber >= round.number - 1;
      return {
        _id: u._id,
        name: u.name,
        emoji: u.emoji,
        points: u.points,
        streak: streakAlive ? u.streak : 0,
        mult: multiplier(streakAlive ? u.streak : 0),
        live,
        inThisDrop: mine.length > 0,
        late: mine.length > 0 && mine.every((s) => s.late),
        online: now - u.lastSeen < 3 * 60 * 1000,
      };
    });
  },
});

export const myHistory = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    const user = await userByToken(ctx, token);
    if (!user) return [];
    const stakes = await ctx.db
      .query("stakes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(30);
    return await Promise.all(
      stakes.map(async (s) => {
        const bet = await ctx.db.get(s.betId);
        return {
          _id: s._id as Id<"stakes">,
          question: bet?.question ?? "",
          pick: bet?.options[s.option] ?? "",
          amount: s.amount,
          late: s.late,
          payout: s.payout,
          status: bet?.status,
          won: bet?.winningOption === s.option,
        };
      }),
    );
  },
});
