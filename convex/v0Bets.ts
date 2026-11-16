import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { BetState, BetView, CardLocator } from "./v0Contract";
import { activeMember, canReadBet, fail, isBlocked, once, policyStatus, rateLimit, requireBet, requireMember, requireSession } from "./v0Policy";
import { format } from "./v0Schema";
import { validateCandidate } from "./v0Safety";
import { queueNotification } from "./v0Notifications";

function lifecyclePolicy(): never {
  return fail("POLICY_PENDING", "Scoring and lifecycle rules are awaiting approval.");
}

function stateAt(bet: Doc<"v0Bets">, now: number): BetState {
  if (bet.state === "voided") return "voided";
  if (bet.state === "finalized" || bet.state === "provisional") return bet.state;
  if (now < bet.cutoffAt) return "open";
  if (now < bet.revealAt) return "locked";
  return "revealed";
}

async function cardFor(ctx: QueryCtx, bet: Doc<"v0Bets">): Promise<CardLocator> {
  let origin: URL;
  try {
    origin = new URL(process.env.V0_CARD_ORIGIN ?? "");
  } catch {
    return fail("PROVIDER_UNAVAILABLE", "Card links are not configured.");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) fail("PROVIDER_UNAVAILABLE", "Card links are not configured.");
  const subject = await activeMember(ctx, bet.groupId, bet.subjectId);
  const subjectAlias = subject?.alias ?? "a friend";
  const picks = (await ctx.db.query("v0Picks").withIndex("by_bet", (q) => q.eq("betId", bet._id)).collect()).filter((pick) => pick.voidedAt === undefined);
  const bettorInitials: string[] = [];
  for (const pick of picks) {
    const member = await activeMember(ctx, bet.groupId, pick.accountId);
    if (member?._id === pick.membershipId) bettorInitials.push(Array.from(member.alias.trim())[0]?.toUpperCase() ?? "?");
  }
  return {
    url: `${origin.origin}/c/${bet.locator}`,
    caption: `Secret bet on ${subjectAlias}`,
    accessibilityLabel: `Called It card. Secret bet on ${subjectAlias}`,
    subjectAlias,
    bettorCount: bettorInitials.length,
    bettorInitials,
  };
}

async function viewFor(ctx: QueryCtx, bet: Doc<"v0Bets">, accountId: Id<"v0Accounts">): Promise<BetView> {
  const now = Date.now();
  const state = stateAt(bet, now);
  const base = { serverTime: now, groupId: bet.groupId, betId: bet._id, state, cutoffAt: bet.cutoffAt, revealAt: bet.revealAt, card: await cardFor(ctx, bet) };
  if (state === "voided") return { ...base, view: "unavailable" };
  if (accountId === bet.subjectId && now < bet.revealAt) return { ...base, view: "sealed", canVeto: true };
  const allPicks = (await ctx.db.query("v0Picks").withIndex("by_bet", (q) => q.eq("betId", bet._id)).collect()).filter((pick) => pick.voidedAt === undefined);
  const mine = allPicks.find((pick) => pick.accountId === accountId);
  const picks: Extract<BetView, { view: "bet" }>["picks"] = [];
  if (now >= bet.revealAt) {
    for (const pick of allPicks) {
      const member = await activeMember(ctx, bet.groupId, pick.accountId);
      if (member?._id !== pick.membershipId || await isBlocked(ctx, accountId, pick.accountId)) continue;
      picks.push({ accountId: pick.accountId, alias: member.alias, option: pick.option, confidence: pick.confidence, ...(pick.riskPoints === undefined ? {} : { riskPoints: pick.riskPoints }) });
    }
  }
  return {
    ...base,
    view: "bet",
    question: bet.question,
    format: bet.format,
    options: bet.options,
    ...(bet.line === undefined ? {} : { line: bet.line }),
    canPick: false,
    canAnswer: false,
    canChallenge: false,
    myPick: mine ? { option: mine.option, confidence: mine.confidence, ...(mine.riskPoints === undefined ? {} : { riskPoints: mine.riskPoints }) } : null,
    picks,
    ...(now >= bet.revealAt && bet.answerDeadline !== undefined ? { answerDeadline: bet.answerDeadline } : {}),
    ...(now >= bet.revealAt && bet.challengeDeadline !== undefined ? { challengeDeadline: bet.challengeDeadline } : {}),
    ...(now >= bet.revealAt && bet.provisionalOutcome !== undefined ? { provisionalOutcome: bet.provisionalOutcome } : {}),
    ...(now >= bet.revealAt && state === "finalized" && bet.outcome !== undefined ? { outcome: bet.outcome } : {}),
  };
}

export async function voidBet(ctx: MutationCtx, bet: Doc<"v0Bets">) {
  if (bet.state === "finalized" || bet.state === "voided") return;
  const now = Date.now();
  await ctx.db.patch(bet._id, { state: "voided", provisionalOutcome: undefined, outcome: undefined });
  for (const pick of await ctx.db.query("v0Picks").withIndex("by_bet", (q) => q.eq("betId", bet._id)).collect()) {
    if (pick.voidedAt === undefined) await ctx.db.patch(pick._id, { voidedAt: now });
  }
  for (const item of await ctx.db.query("v0Outbox").collect()) {
    if (item.betId === bet._id && item.state !== "sent") await ctx.db.delete(item._id);
  }
}

export const get = query({
  args: { token: v.string(), locator: v.string() },
  handler: async (ctx, { token, locator }) => {
    const { account } = await requireSession(ctx, token);
    if (!/^[a-f0-9]{64}$/.test(locator)) fail("NOT_AVAILABLE");
    const bet = await ctx.db.query("v0Bets").withIndex("by_locator", (q) => q.eq("locator", locator)).unique();
    if (!bet || !(await canReadBet(ctx, bet, account._id))) fail("NOT_AVAILABLE");
    return await viewFor(ctx, bet, account._id);
  },
});

export const list = query({
  args: { token: v.string(), groupId: v.id("v0Groups") },
  handler: async (ctx, { token, groupId }) => {
    const { account } = await requireSession(ctx, token);
    await requireMember(ctx, groupId, account._id);
    const bets = await ctx.db.query("v0Bets").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect();
    const views: BetView[] = [];
    for (const bet of bets) if (await canReadBet(ctx, bet, account._id)) views.push(await viewFor(ctx, bet, account._id));
    return views.sort((a, b) => b.revealAt - a.revealAt);
  },
});

export const history = query({
  args: { token: v.string(), groupId: v.id("v0Groups") },
  handler: async (ctx, { token, groupId }) => {
    const { account } = await requireSession(ctx, token);
    await requireMember(ctx, groupId, account._id);
    const bets = await ctx.db.query("v0Bets").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect();
    const views: BetView[] = [];
    for (const bet of bets) if ((bet.state === "finalized" || bet.state === "voided") && await canReadBet(ctx, bet, account._id)) views.push(await viewFor(ctx, bet, account._id));
    return views;
  },
});

export const create = mutation({
  args: { token: v.string(), groupId: v.id("v0Groups"), subjectId: v.id("v0Accounts"), question: v.string(), contextLine: v.string(), format, options: v.array(v.string()), line: v.optional(v.number()), cutoffAt: v.number(), revealAt: v.number(), source: v.union(v.literal("manual"), v.literal("template"), v.literal("history"), v.literal("hosted_ai")), requestId: v.string() },
  handler: async (ctx, args) => {
    const { account } = await requireSession(ctx, args.token);
    await requireMember(ctx, args.groupId, account._id);
    await requireMember(ctx, args.groupId, args.subjectId);
    const subject = await ctx.db.get(args.subjectId);
    if (args.subjectId === account._id || !subject || subject.deletedAt !== undefined || subject.noBets || await isBlocked(ctx, account._id, args.subjectId)) fail("NOT_AVAILABLE");
    validateCandidate(args, { blockedTopics: [...subject.blockedTopics, ...account.blockedTopics], contextLine: args.contextLine });
    if (!Number.isFinite(args.cutoffAt) || !Number.isFinite(args.revealAt) || args.cutoffAt <= Date.now() || args.cutoffAt >= args.revealAt) fail("INVALID_INPUT", "The cutoff must be in the future and before reveal.");
    return lifecyclePolicy();
  },
});

export const pick = mutation({
  args: { token: v.string(), betId: v.id("v0Bets"), option: v.number(), confidence: v.number(), riskPoints: v.optional(v.number()), requestId: v.string() },
  handler: async (ctx, args) => {
    const { account } = await requireSession(ctx, args.token);
    const bet = await requireBet(ctx, args.betId, account._id);
    if (bet.subjectId === account._id || stateAt(bet, Date.now()) !== "open") fail("NOT_AVAILABLE");
    if (![0, 1].includes(args.option) || !Number.isFinite(args.confidence) || args.confidence < 0 || args.confidence > 1 || (args.riskPoints !== undefined && (!Number.isFinite(args.riskPoints) || args.riskPoints < 0))) fail("INVALID_INPUT");
    return lifecyclePolicy();
  },
});

export const veto = mutation({
  args: { token: v.string(), betId: v.id("v0Bets"), requestId: v.string() },
  handler: async (ctx, { token, betId, requestId }) => {
    const { account } = await requireSession(ctx, token);
    const bet = await requireBet(ctx, betId, account._id);
    if (bet.subjectId !== account._id) fail("NOT_AVAILABLE");
    return await once(ctx, account._id, "veto", requestId, { betId }, async () => {
      if (Date.now() >= bet.revealAt || bet.state === "finalized") fail("NOT_AVAILABLE");
      await rateLimit(ctx, `veto:${account._id}`, 60, 60_000);
      await voidBet(ctx, bet);
      return { voided: true as const };
    });
  },
});

export const answer = mutation({
  args: { token: v.string(), betId: v.id("v0Bets"), option: v.number(), requestId: v.string() },
  handler: async (ctx, { token, betId, option }) => {
    const { account } = await requireSession(ctx, token);
    const bet = await requireBet(ctx, betId, account._id);
    if (bet.subjectId !== account._id || stateAt(bet, Date.now()) !== "revealed") fail("NOT_AVAILABLE");
    if (![0, 1].includes(option)) fail("INVALID_INPUT");
    return lifecyclePolicy();
  },
});

export const challenge = mutation({
  args: { token: v.string(), betId: v.id("v0Bets"), requestId: v.string() },
  handler: async (ctx, { token, betId }) => {
    const { account } = await requireSession(ctx, token);
    const bet = await requireBet(ctx, betId, account._id);
    if (bet.subjectId === account._id || stateAt(bet, Date.now()) !== "provisional") fail("NOT_AVAILABLE");
    return lifecyclePolicy();
  },
});

export const advance = internalMutation({
  args: { betId: v.id("v0Bets") },
  handler: async (ctx, { betId }) => {
    const bet = await ctx.db.get(betId);
    if (!bet) return;
    const state = await advanceBet(ctx, bet);
    return { state, policy: policyStatus };
  },
});

export async function advanceBet(ctx: MutationCtx, bet: Doc<"v0Bets">) {
  if (![bet.createdAt, bet.cutoffAt, bet.revealAt].every(Number.isFinite) || bet.cutoffAt <= bet.createdAt || bet.revealAt <= bet.cutoffAt) {
    await voidBet(ctx, bet);
    return "voided" as const;
  }
  const state = stateAt(bet, Date.now());
  if (state === bet.state) return state;
  await ctx.db.patch(bet._id, { state });
  if (state === "revealed") {
    const recipients = new Set([bet.subjectId]);
    for (const pick of await ctx.db.query("v0Picks").withIndex("by_bet", (q) => q.eq("betId", bet._id)).collect()) {
      if (pick.voidedAt === undefined) recipients.add(pick.accountId);
    }
    for (const accountId of recipients) await queueNotification(ctx, { key: `reveal:${bet._id}:${accountId}`, accountId, groupId: bet.groupId, betId: bet._id, kind: "reveal" });
  }
  return state;
}
