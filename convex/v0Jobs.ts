import { internalMutation } from "./_generated/server";
import { advanceBet } from "./v0Bets";
import { approvedPolicy } from "./v0GamePolicy";
import { advanceGroupTurn } from "./v0Turns";

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const open = await ctx.db.query("v0Bets").withIndex("by_state_reveal", (q) => q.eq("state", "open").lte("revealAt", now)).take(100);
    const locked = await ctx.db.query("v0Bets").withIndex("by_state_reveal", (q) => q.eq("state", "locked").lte("revealAt", now)).take(100);
    const unanswered = await ctx.db.query("v0Bets").withIndex("by_state_reveal", (q) => q.eq("state", "revealed").lte("revealAt", now - approvedPolicy.unansweredDurationMs)).take(100);
    for (const bet of [...open, ...locked, ...unanswered]) await advanceBet(ctx, bet);
    return { advanced: open.length + locked.length + unanswered.length };
  },
});

export const turns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db.query("v0Groups").withIndex("by_next_turn", (q) => q.lte("nextTurnAt", now)).take(50);
    const unscheduled = await ctx.db.query("v0Groups").withIndex("by_next_turn", (q) => q.eq("nextTurnAt", Number.MAX_SAFE_INTEGER)).take(50);
    const counts = { assigned: 0, passed: 0, expired: 0, waiting: 0 };
    for (const group of [...due, ...unscheduled]) counts[await advanceGroupTurn(ctx, group, now)]++;
    return counts;
  },
});
