import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { approvedPolicy, scorePick } from "../../convex/v0GamePolicy";
import { noPrivateValues } from "./assertions";
import { REVEAL, T0 } from "./fixture";
import { v0Fixture } from "./v0-fixture";

type Fixture = Awaited<ReturnType<typeof v0Fixture>>;
type Role = "creator" | "friend" | "revoked" | "new" | "outsider" | "otherSubject";
type Seed = { role: Role; option: number; confidence: number; points?: number; streak?: number };
const pool: Role[] = ["creator", "friend", "revoked", "new", "outsider", "otherSubject"];
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const answeredAt = REVEAL + minute;
const deadline = answeredAt + hour;
const penalty = { ...approvedPolicy, wrongPickPenaltyFraction: 0.5 };

const sweep = (f: Fixture) => f.t.mutation(internal.v0Jobs.sweep, {});
const ledger = (f: Fixture) => f.t.run((ctx) => ctx.db.query("v0Ledger").collect());
const outbox = (f: Fixture) => f.t.run((ctx) => ctx.db.query("v0Outbox").collect());

async function member(f: Fixture, role: Role | "subject", groupId: Id<"v0Groups"> = f.g1) {
  return await f.t.run(async (ctx) => (await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", groupId).eq("accountId", f.actors[role].id)).collect()).find((row) => row.leftAt === undefined)!);
}

async function setup(seeds: Seed[]) {
  const f = await v0Fixture();
  await f.t.run(async (ctx) => {
    for (const session of await ctx.db.query("v0Sessions").collect()) if (session.revokedAt === undefined) await ctx.db.patch(session._id, { expiresAt: T0 + 30 * day });
    for (const name of pool) {
      let row = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors[name].id)).unique();
      if (!row) row = (await ctx.db.get(await ctx.db.insert("v0Memberships", { groupId: f.g1, accountId: f.actors[name].id, alias: name, joinedAt: T0 - 60_000, points: 0, streak: 0 })))!;
      const seed = seeds.find((entry) => entry.role === name);
      await ctx.db.patch(row._id, { joinedAt: T0 - 60_000, points: seed?.points ?? 0, streak: seed?.streak ?? 0 });
      if (seed) await ctx.db.insert("v0Picks", { groupId: f.g1, betId: f.bet, accountId: f.actors[name].id, membershipId: row._id, option: seed.option, confidence: seed.confidence, placedAt: T0 + 1, updatedAt: T0 + 1 });
    }
  });
  return f;
}

async function finalize(f: Fixture, option = 0) {
  vi.setSystemTime(REVEAL);
  await sweep(f);
  vi.setSystemTime(answeredAt);
  await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option, requestId: `${f.runId}_answer` });
  vi.setSystemTime(deadline);
  await sweep(f);
}

describe("B3 scoring oracle: 100 x confidence, streak bonus, rounding", () => {
  it("[B3.policy.scoring-values] keeps the approved scoring values in the policy module with the wrong-pick penalty off", () => {
    expect(approvedPolicy).toMatchObject({ version: "v0-policy.3", economics: "reward_only", confidenceMin: 0.01, confidenceMax: 1, confidencePointScale: 100, wrongPickPenaltyFraction: 0, streakBonusPerCorrectPick: 0.1, streakMultiplierCap: 2 });
  });

  for (const [confidence, streak, points] of [
    [0.01, 0, 1], [0.5, 0, 50], [0.7, 0, 70], [1, 0, 100], [0.555, 0, 56], [0.554, 0, 55], [0.005 + 0.01, 0, 2],
    [0.7, 1, 77], [0.7, 2, 84], [0.7, 3, 91], [1, 1, 110], [1, 5, 150], [1, 9, 190], [1, 10, 200], [1, 11, 200], [1, 500, 200], [0.7, 10, 140], [0.7, 40, 140],
    [0.05, 1, 6], [0.15, 1, 17], [0.35, 1, 39], [0.45, 1, 50], [0.25, 3, 33], [0.01, 1, 1], [0.01, 4, 1], [0.01, 5, 2], [0.04, 1, 4], [0.03, 5, 5], [0.33, 2, 40], [0.07, 2, 8],
  ] as const) {
    it(`[B3.oracle.correct.${confidence}.streak-${streak}] earns ${points} for a correct pick`, () => {
      const result = scorePick({ confidence, correct: true, streak, balance: 0 });
      expect(result).toEqual({ points, streak: streak + 1 });
      expect(Number.isInteger(result.points)).toBe(true);
      expect(scorePick({ confidence, correct: true, streak, balance: 0 }, penalty)).toEqual(result);
    });
  }

  for (const [confidence, streak, balance] of [[0.01, 0, 0], [0.7, 3, 500], [1, 12, 10_000], [1, 0, 0]] as const) {
    it(`[B3.oracle.wrong.reward-only.${confidence}.streak-${streak}] earns 0, loses nothing and resets the streak under the approved rule`, () => {
      expect(scorePick({ confidence, correct: false, streak, balance })).toEqual({ points: 0, streak: 0 });
    });
  }

  for (const [confidence, balance, points] of [[0.7, 500, -35], [1, 500, -50], [0.01, 500, -1], [0.02, 500, -1], [0.03, 500, -2], [0.7, 10, -10], [0.7, 35, -35], [0.7, 34, -34], [1, 0, 0], [0.5, -5, 0]] as const) {
    it(`[B3.oracle.wrong.penalty.${confidence}.balance-${balance}] loses half the confidence points and never takes a balance below 0 when the penalty is switched on`, () => {
      const result = scorePick({ confidence, correct: false, streak: 4, balance }, penalty);
      expect(result).toEqual({ points, streak: 0 });
      expect(Math.max(0, balance) + result.points).toBeGreaterThanOrEqual(0);
    });
  }

  it("[B3.oracle.streak-run] pays +10% per correct pick in a row after the first, capped at double, and restarts after a miss", () => {
    let streak = 0;
    const earned: number[] = [];
    for (const correct of [true, true, true, false, true, true, true, true, true, true, true, true, true, true, true, true, true]) {
      const result = scorePick({ confidence: 1, correct, streak, balance: 0 });
      earned.push(result.points);
      streak = result.streak;
    }
    expect(earned).toEqual([100, 110, 120, 0, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 200, 200]);
    expect(streak).toBe(13);
  });
});

describe("B3 ledger: credit exactly once at finalization, per group", () => {
  it("[B3.ledger.finalize] credits every standing pick once with points, streak and a ledger row", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 0.7, points: 40, streak: 2 }, { role: "friend", option: 1, confidence: 1, points: 300, streak: 6 }, { role: "revoked", option: 0, confidence: 0.35, points: 0, streak: 1 }]);
    const bystander = await member(f, "new");
    const subjectBefore = await member(f, "subject");
    const otherGroup = await member(f, "creator", f.g2);
    await finalize(f, 0);
    const rows = await ledger(f);
    const row = (role: Role) => rows.find((entry) => entry.accountId === f.actors[role].id);
    expect(rows).toHaveLength(3);
    expect(row("creator")).toMatchObject({ groupId: f.g1, betId: f.bet, membershipId: (await member(f, "creator"))._id, points: 84, streakBefore: 2, streakAfter: 3, policyVersion: "v0-policy.3", createdAt: deadline });
    expect(row("friend")).toMatchObject({ points: 0, streakBefore: 6, streakAfter: 0, createdAt: deadline });
    expect(row("revoked")).toMatchObject({ points: 39, streakBefore: 1, streakAfter: 2 });
    expect(await member(f, "creator")).toMatchObject({ points: 124, streak: 3, lastScoredBetId: f.bet });
    expect(await member(f, "friend")).toMatchObject({ points: 300, streak: 0, lastScoredBetId: f.bet });
    expect(await member(f, "revoked")).toMatchObject({ points: 39, streak: 2, lastScoredBetId: f.bet });
    expect(await member(f, "new")).toEqual(bystander);
    expect(await member(f, "subject")).toEqual(subjectBefore);
    expect(await member(f, "creator", f.g2)).toEqual(otherGroup);
    expect(await f.t.run(async (ctx) => (await ctx.db.get(f.bet))!)).toMatchObject({ state: "finalized", outcome: 0, finalizedAt: deadline });
  });

  it("[B3.ledger.exactly-once] never credits twice when finalization repeats, overlaps, retries or runs late", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 0.7 }, { role: "friend", option: 0, confidence: 0.5, streak: 1 }]);
    vi.setSystemTime(REVEAL);
    await sweep(f);
    vi.setSystemTime(answeredAt);
    await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 0, requestId: `${f.runId}_answer` });
    vi.setSystemTime(deadline);
    await Promise.all([sweep(f), sweep(f), f.t.mutation(internal.v0Bets.advance, { betId: f.bet }), f.t.mutation(internal.v0Bets.advance, { betId: f.bet })]);
    const first = { ledger: await ledger(f), creator: await member(f, "creator"), friend: await member(f, "friend"), outbox: await outbox(f) };
    expect(first.ledger).toHaveLength(2);
    expect(first.creator).toMatchObject({ points: 70, streak: 1 });
    expect(first.friend).toMatchObject({ points: 55, streak: 2 });
    for (const at of [deadline + 1, deadline + hour, deadline + 3 * day]) {
      vi.setSystemTime(at);
      await sweep(f);
      await f.t.mutation(internal.v0Bets.advance, { betId: f.bet });
      await f.t.run((ctx) => ctx.db.patch(f.bet, { challengeDeadline: at }));
      await sweep(f);
    }
    expect({ ledger: await ledger(f), creator: await member(f, "creator"), friend: await member(f, "friend"), outbox: await outbox(f) }).toEqual(first);
  });

  it("[B3.ledger.exactly-once.reopened-state] does not credit again even if a finalized bet is put back into the provisional state", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 1 }]);
    await finalize(f, 0);
    const first = { ledger: await ledger(f), creator: await member(f, "creator") };
    await f.t.run((ctx) => ctx.db.patch(f.bet, { state: "provisional", outcome: undefined, finalizedAt: undefined }));
    vi.setSystemTime(deadline + minute);
    await sweep(f);
    expect({ ledger: await ledger(f), creator: await member(f, "creator") }).toEqual(first);
    expect(first.creator).toMatchObject({ points: 100, streak: 1 });
  });

  it("[B3.ledger.no-early-credit] credits nothing before the challenge hour ends", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 1, points: 5, streak: 2 }]);
    const before = await member(f, "creator");
    vi.setSystemTime(REVEAL);
    await sweep(f);
    vi.setSystemTime(answeredAt);
    await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 0, requestId: `${f.runId}_answer` });
    for (const at of [answeredAt, deadline - 1]) {
      vi.setSystemTime(at);
      await sweep(f);
      await f.t.mutation(internal.v0Bets.advance, { betId: f.bet });
      expect(await ledger(f)).toEqual([]);
      expect(await member(f, "creator")).toEqual(before);
      expect((await outbox(f)).filter((row) => row.kind === "result")).toEqual([]);
    }
  });

  for (const ending of ["majority-void", "no-answer", "subject-veto", "subject-left"] as const) {
    it(`[B3.ledger.void.${ending}] leaves points and streaks alone when the bet is voided`, async () => {
      const f = await setup([{ role: "creator", option: 0, confidence: 1, points: 12, streak: 4 }, { role: "friend", option: 1, confidence: 0.6, points: 7, streak: 9 }]);
      const before = { creator: await member(f, "creator"), friend: await member(f, "friend") };
      if (ending === "subject-veto") {
        vi.setSystemTime(T0 + minute);
        await f.t.mutation(api.v0Bets.veto, { token: f.actors.subject.token, betId: f.bet, requestId: `${f.runId}_veto` });
      } else if (ending === "no-answer") {
        vi.setSystemTime(REVEAL + day);
        await sweep(f);
      } else {
        vi.setSystemTime(REVEAL);
        await sweep(f);
        vi.setSystemTime(answeredAt);
        await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 0, requestId: `${f.runId}_answer` });
        vi.setSystemTime(answeredAt + minute);
        if (ending === "majority-void") for (const role of ["creator", "friend"] as const) await f.t.mutation(api.v0Bets.challenge, { token: f.actors[role].token, betId: f.bet, requestId: `${f.runId}_${role}` });
        else await f.t.mutation(api.v0Controls.leave, { token: f.actors.subject.token, groupId: f.g1, requestId: `${f.runId}_leave` });
        vi.setSystemTime(deadline);
        await sweep(f);
      }
      vi.setSystemTime(REVEAL + 3 * day);
      await sweep(f);
      expect((await f.t.run(async (ctx) => (await ctx.db.get(f.bet))!)).state).toBe("voided");
      expect(await ledger(f)).toEqual([]);
      expect({ creator: await member(f, "creator"), friend: await member(f, "friend") }).toEqual(before);
      expect((await outbox(f)).filter((row) => row.kind === "result")).toEqual([]);
    });
  }

  it("[B3.ledger.skipped] leaves the streak of a member who did not pick untouched while others score", async () => {
    const f = await setup([{ role: "creator", option: 1, confidence: 1, streak: 3 }]);
    await f.t.run(async (ctx) => ctx.db.patch((await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.friend.id)).unique())!._id, { streak: 5, points: 250 }));
    await finalize(f, 0);
    expect(await member(f, "friend")).toMatchObject({ streak: 5, points: 250 });
    expect(await member(f, "friend")).not.toHaveProperty("lastScoredBetId");
    expect(await member(f, "creator")).toMatchObject({ streak: 0, points: 0 });
    expect(await ledger(f)).toHaveLength(1);
  });

  it("[B3.ledger.departed] does not score a member who left before the result became final, and keeps a credit earned before leaving", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 1 }, { role: "friend", option: 0, confidence: 1, points: 9, streak: 2 }]);
    vi.setSystemTime(REVEAL);
    await sweep(f);
    vi.setSystemTime(answeredAt);
    await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 0, requestId: `${f.runId}_answer` });
    await f.t.mutation(api.v0Controls.leave, { token: f.actors.friend.token, groupId: f.g1, requestId: `${f.runId}_leave` });
    vi.setSystemTime(deadline);
    await sweep(f);
    const rows = await ledger(f);
    expect(rows.map((row) => row.accountId)).toEqual([f.actors.creator.id]);
    const left = await f.t.run(async (ctx) => (await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.friend.id)).unique())!);
    expect(left).toMatchObject({ points: 9, streak: 2 });
    expect((await outbox(f)).filter((row) => row.kind === "result").map((row) => row.accountId).sort()).toEqual([f.actors.creator.id, f.actors.subject.id].sort());
    vi.setSystemTime(deadline + minute);
    await f.t.mutation(api.v0Controls.leave, { token: f.actors.creator.token, groupId: f.g1, requestId: `${f.runId}_leave_creator` });
    expect(await ledger(f)).toEqual(rows);
    expect(await f.t.run(async (ctx) => (await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.creator.id)).unique())!)).toMatchObject({ points: 100, streak: 1 });
  });

  for (const [name, patch] of [["confidence-zero", { confidence: 0 }], ["confidence-above-one", { confidence: 1.5 }], ["confidence-nan", { confidence: Number.NaN }], ["option-two", { option: 2 }], ["option-negative", { option: -1 }], ["option-fraction", { option: 0.5 }], ["foreign-group", { groupId: "g2" }], ["voided", { voidedAt: T0 + 2 }]] as const) {
    it(`[B3.ledger.invalid-pick.${name}] credits nothing for a stored pick that is not a valid standing pick`, async () => {
      const f = await setup([{ role: "creator", option: 0, confidence: 1, points: 3, streak: 2 }, { role: "friend", option: 0, confidence: 0.5 }]);
      await f.t.run(async (ctx) => {
        const pick = (await ctx.db.query("v0Picks").collect()).find((row) => row.accountId === f.actors.creator.id)!;
        await ctx.db.patch(pick._id, "groupId" in patch ? { groupId: f.g2 } : patch);
      });
      await finalize(f, 0);
      expect((await ledger(f)).map((row) => row.accountId)).toEqual([f.actors.friend.id]);
      expect(await member(f, "creator")).toMatchObject({ points: 3, streak: 2 });
    });
  }

  it("[B3.ledger.subject-pick] never scores the subject, even if a pick was stored for them", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 1 }]);
    const subject = await member(f, "subject");
    await f.t.run((ctx) => ctx.db.insert("v0Picks", { groupId: f.g1, betId: f.bet, accountId: f.actors.subject.id, membershipId: subject._id, option: 0, confidence: 1, placedAt: T0 + 1, updatedAt: T0 + 1 }));
    await finalize(f, 0);
    expect((await ledger(f)).map((row) => row.accountId)).toEqual([f.actors.creator.id]);
    expect(await member(f, "subject")).toEqual(subject);
  });

  it("[B3.ledger.streak-across-bets] carries a streak from one bet to the next in the same group and resets it on a miss", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 1 }]);
    await finalize(f, 0);
    const outcomes = [0, 0, 1, 0];
    const expected = [[110, 2], [120, 3], [0, 0], [100, 1]];
    let total = 100;
    for (const [index, outcome] of outcomes.entries()) {
      const start = deadline + (index + 1) * 2 * hour;
      vi.setSystemTime(start);
      const betId = await f.t.run(async (ctx) => {
        const row = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.creator.id)).unique();
        const id = await ctx.db.insert("v0Bets", { groupId: f.g1, creatorId: f.actors.friend.id, subjectId: f.actors.subject.id, createdAt: start, question: "Will the picnic have a puzzle?", contextLine: "", format: "yes_no", options: ["Yes", "No"], source: "manual", state: "revealed", cutoffAt: start + minute, revealAt: start + minute, locator: `${index}`.repeat(64) });
        await ctx.db.insert("v0Picks", { groupId: f.g1, betId: id, accountId: f.actors.creator.id, membershipId: row!._id, option: 0, confidence: 1, placedAt: start, updatedAt: start });
        return id;
      });
      vi.setSystemTime(start + 2 * minute);
      await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId, option: outcome, requestId: `${f.runId}_answer_${index}` });
      vi.setSystemTime(start + 2 * minute + hour);
      await sweep(f);
      total += expected[index][0];
      expect(await member(f, "creator")).toMatchObject({ points: total, streak: expected[index][1], lastScoredBetId: betId });
    }
    expect((await ledger(f)).map((row) => [row.points, row.streakBefore, row.streakAfter])).toEqual([[100, 0, 1], [110, 1, 2], [120, 2, 3], [0, 3, 0], [100, 0, 1]]);
    expect((await ledger(f)).reduce((sum, row) => sum + row.points, 0)).toBe((await member(f, "creator")).points);
  });

  for (const trigger of ["sweep", "advance-later-first", "later-subject-leaves", "later-subject-deletes", "later-subject-opts-out", "sweep-reversed-rows"] as const) {
    it(`[B3.ledger.settle-order.${trigger}] settles overdue results in the order they were answered whichever path reaches them first`, async () => {
      const f = await setup([{ role: "creator", option: 0, confidence: 1 }, { role: "new", option: 0, confidence: 0.5 }]);
      vi.setSystemTime(REVEAL);
      await sweep(f);
      const later = await f.t.run(async (ctx) => {
        const row = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.creator.id)).unique();
        const id = await ctx.db.insert("v0Bets", { groupId: f.g1, creatorId: f.actors.friend.id, subjectId: f.actors.new.id, createdAt: T0 + 2, question: "Will the picnic have a puzzle?", contextLine: "", format: "yes_no", options: ["Yes", "No"], source: "manual", state: "revealed", cutoffAt: REVEAL, revealAt: REVEAL, locator: "b".repeat(64) });
        await ctx.db.insert("v0Picks", { groupId: f.g1, betId: id, accountId: f.actors.creator.id, membershipId: row!._id, option: 0, confidence: 0.5, placedAt: T0 + 3, updatedAt: T0 + 3 });
        return id;
      });
      vi.setSystemTime(answeredAt);
      await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 0, requestId: `${f.runId}_first` });
      vi.setSystemTime(answeredAt + minute);
      await f.t.mutation(api.v0Bets.answer, { token: f.actors.new.token, betId: later, option: 0, requestId: `${f.runId}_second` });
      vi.setSystemTime(deadline + 2 * minute);
      if (trigger === "advance-later-first") await f.t.mutation(internal.v0Bets.advance, { betId: later });
      if (trigger === "later-subject-leaves") await f.t.mutation(api.v0Controls.leave, { token: f.actors.new.token, groupId: f.g1, requestId: `${f.runId}_leave` });
      if (trigger === "later-subject-deletes") await f.t.mutation(api.v0Controls.deleteAccount, { token: f.actors.new.token, requestId: `${f.runId}_delete` });
      if (trigger === "later-subject-opts-out") await f.t.mutation(api.v0Controls.update, { token: f.actors.new.token, noBets: true, blockedTopics: [], hostedAiConsent: false, requestId: `${f.runId}_optout` });
      if (trigger === "sweep-reversed-rows") await f.t.run(async (ctx) => {
        await ctx.db.patch(f.bet, { answeredAt: answeredAt + minute });
        await ctx.db.patch(later, { answeredAt });
      });
      await sweep(f);
      const rows = (await ledger(f)).filter((row) => row.accountId === f.actors.creator.id).map((row) => [row.betId, row.points, row.streakBefore, row.streakAfter]);
      expect(rows.sort((a, b) => Number(a[2]) - Number(b[2]))).toEqual(trigger === "sweep-reversed-rows" ? [[later, 50, 0, 1], [f.bet, 110, 1, 2]] : [[f.bet, 100, 0, 1], [later, 55, 1, 2]]);
      expect(await member(f, "creator")).toMatchObject({ points: trigger === "sweep-reversed-rows" ? 160 : 155, streak: 2 });
    });
  }

  it("[B3.ledger.per-group] keeps one person's balance and streak separate in each group", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 1, points: 10, streak: 1 }]);
    const g2Before = await f.t.run((ctx) => ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", f.g2)).collect());
    await finalize(f, 0);
    expect(await f.t.run((ctx) => ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", f.g2)).collect())).toEqual(g2Before);
    expect((await ledger(f)).every((row) => row.groupId === f.g1)).toBe(true);
    const first = await f.t.query(api.v0Groups.board, { token: f.actors.creator.token, groupId: f.g1 });
    const second = await f.t.query(api.v0Groups.board, { token: f.actors.creator.token, groupId: f.g2 });
    expect(first.rows.find((row) => row.accountId === f.actors.creator.id)).toMatchObject({ points: 120, streak: 2 });
    expect(second.rows.find((row) => row.accountId === f.actors.creator.id)).toMatchObject({ points: 50, streak: 0 });
  });

  it("[B3.ledger.same-everywhere] shows the same points and streak on the board, the account snapshot and the ledger", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 0.7, points: 30, streak: 1 }, { role: "friend", option: 0, confidence: 0.7, points: 30, streak: 1 }]);
    await finalize(f, 0);
    for (const viewer of ["creator", "friend", "subject", "alias"] as const) {
      const board = await f.t.query(api.v0Groups.board, { token: f.actors[viewer].token, groupId: f.g1 });
      const rows = board.rows.filter((row) => [f.actors.creator.id, f.actors.friend.id].includes(row.accountId));
      expect(rows.map((row) => [row.alias, row.points, row.streak])).toEqual([["Cora", 107, 2], ["Finn", 107, 2]]);
      noPrivateValues(board, f.privateValues);
    }
    const me = await f.t.query(api.v0Auth.me, { token: f.actors.creator.token });
    expect(me.groups.find((group) => group.id === f.g1)).toMatchObject({ points: 107, streak: 2 });
    const rows = await ledger(f);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["_creationTime", "_id", "accountId", "betId", "createdAt", "groupId", "membershipId", "points", "policyVersion", "streakAfter", "streakBefore"]);
    expect(JSON.stringify([rows, await f.t.query(api.v0Groups.board, { token: f.actors.creator.token, groupId: f.g1 })])).not.toMatch(/cash|dollar|price|payout|currency|\$/i);
  });

  it("[B3.result.notification] queues one result notification for the subject and each person who picked, and nobody else", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 0.7 }, { role: "friend", option: 1, confidence: 0.7 }]);
    await f.t.run((ctx) => ctx.db.patch(f.actors.friend.id, { notificationsEnabled: false }));
    await finalize(f, 0);
    await sweep(f);
    const results = (await outbox(f)).filter((row) => row.kind === "result");
    expect(results.map((row) => row.key).sort()).toEqual([`result:${f.bet}:${f.actors.creator.id}`, `result:${f.bet}:${f.actors.subject.id}`].sort());
    for (const row of results) {
      expect(row).toMatchObject({ groupId: f.g1, betId: f.bet, state: "pending", attempts: 0, availableAt: deadline });
      expect(Object.keys(row).sort()).toEqual(["_creationTime", "_id", "accountId", "attempts", "availableAt", "betId", "groupId", "key", "kind", "state"]);
      noPrivateValues(row, f.privateValues);
    }
    expect(await member(f, "friend")).toMatchObject({ lastScoredBetId: f.bet, streak: 0 });
  });

  for (const fraction of [0, 0.5] as const) {
    it(`[B3.penalty-switch.${fraction}] ${fraction ? "applies the wrong-pick penalty end to end when the one policy value is changed" : "applies no penalty end to end at the approved value"}`, async () => {
      const f = await setup([{ role: "creator", option: 1, confidence: 0.7, points: 500, streak: 3 }, { role: "friend", option: 1, confidence: 1, points: 20, streak: 1 }, { role: "revoked", option: 0, confidence: 0.7, points: 0, streak: 1 }]);
      const policy = approvedPolicy as { wrongPickPenaltyFraction: number };
      const approved = policy.wrongPickPenaltyFraction;
      expect(approved).toBe(0);
      policy.wrongPickPenaltyFraction = fraction;
      try {
        await finalize(f, 0);
      } finally {
        policy.wrongPickPenaltyFraction = approved;
      }
      const rows = await ledger(f);
      const points = (role: Role) => rows.find((row) => row.accountId === f.actors[role].id)?.points;
      expect([points("creator"), points("friend"), points("revoked")]).toEqual(fraction ? [-35, -20, 77] : [0, 0, 77]);
      expect([(await member(f, "creator")).points, (await member(f, "friend")).points, (await member(f, "revoked")).points]).toEqual(fraction ? [465, 0, 77] : [500, 20, 77]);
      expect([(await member(f, "creator")).streak, (await member(f, "friend")).streak, (await member(f, "revoked")).streak]).toEqual([0, 0, 2]);
      expect(approvedPolicy.wrongPickPenaltyFraction).toBe(0);
    });
  }

  it("[B3.ledger.sealed] exposes no question, option or context through the ledger, the board or a result notification", async () => {
    const f = await setup([{ role: "creator", option: 0, confidence: 1 }]);
    await finalize(f, 0);
    noPrivateValues([await ledger(f), await outbox(f)], f.privateValues);
    for (const viewer of ["subject", "alias", "new"] as const) noPrivateValues([await f.t.query(api.v0Groups.board, { token: f.actors[viewer].token, groupId: f.g1 }), await f.t.query(api.v0Groups.recap, { token: f.actors[viewer].token, groupId: f.g1 }), await f.t.query(api.v0Auth.me, { token: f.actors[viewer].token })], f.privateValues);
  });
});
