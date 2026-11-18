import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { approvedPolicy } from "../../convex/v0GamePolicy";
import { voidBet } from "../../convex/v0Bets";
import { REVEAL, T0 } from "./fixture";
import { v0Fixture } from "./v0-fixture";

type Fixture = Awaited<ReturnType<typeof v0Fixture>>;
type Role = "creator" | "friend" | "revoked" | "new" | "outsider" | "otherSubject";
const pool: Role[] = ["creator", "friend", "revoked", "new", "outsider", "otherSubject"];
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const answeredAt = REVEAL + minute;
const deadline = answeredAt + hour;
const timeout = REVEAL + day;

const expectCode = (operation: Promise<unknown>, code: string) => expect(operation).rejects.toMatchObject({ data: { code } });
const sweep = (f: Fixture) => f.t.mutation(internal.v0Jobs.sweep, {});
const bet = (f: Fixture) => f.t.run(async (ctx) => (await ctx.db.get(f.bet))!);
const picks = (f: Fixture) => f.t.run((ctx) => ctx.db.query("v0Picks").collect());
const scores = (f: Fixture) => f.t.run(async (ctx) => ({ ledger: await ctx.db.query("v0Ledger").collect(), members: (await ctx.db.query("v0Memberships").collect()).map(({ _id, points, streak, lastScoredBetId }) => ({ _id, points, streak, lastScoredBetId })) }));

async function setup(pickers: Role[]) {
  const f = await v0Fixture();
  await f.t.run(async (ctx) => {
    for (const session of await ctx.db.query("v0Sessions").collect()) if (session.revokedAt === undefined) await ctx.db.patch(session._id, { expiresAt: T0 + 30 * day });
    for (const name of pool) {
      let member = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors[name].id)).unique();
      if (!member) member = (await ctx.db.get(await ctx.db.insert("v0Memberships", { groupId: f.g1, accountId: f.actors[name].id, alias: name, joinedAt: T0 - 60_000, points: 0, streak: 0 })))!;
      else if (member.joinedAt >= T0) await ctx.db.patch(member._id, { joinedAt: T0 - 60_000 });
      if (pickers.includes(name)) await ctx.db.insert("v0Picks", { groupId: f.g1, betId: f.bet, accountId: f.actors[name].id, membershipId: member._id, option: pickers.indexOf(name) % 2, confidence: 0.5, placedAt: T0 + 1, updatedAt: T0 + 1 });
    }
  });
  return f;
}

async function answer(f: Fixture, at = answeredAt, option = 0) {
  vi.setSystemTime(REVEAL);
  await sweep(f);
  vi.setSystemTime(at);
  return await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option, requestId: `${f.runId}_answer` });
}

async function storeChallenge(f: Fixture, name: Role | "subject" | "left", at = answeredAt + minute) {
  await f.t.run((ctx) => ctx.db.insert("v0Challenges", { betId: f.bet, accountId: f.actors[name].id, createdAt: at }));
}

describe("B4 challenge resolution: majority of pickers voids, otherwise the answer stands when the hour ends", () => {
  it("[B4.policy.challenge-values] keeps the approved windows in the policy module", () => {
    expect(approvedPolicy).toMatchObject({ challengeDurationMs: hour, unansweredDurationMs: day });
  });

  for (const [pickers, challengers, voided] of [[0, 0, false], [1, 0, false], [1, 1, true], [2, 0, false], [2, 1, false], [2, 2, true], [3, 1, false], [3, 2, true], [4, 2, false], [4, 3, true], [5, 2, false], [5, 3, true], [6, 3, false], [6, 4, true], [6, 6, true]] as const) {
    it(`[B4.majority.${pickers}-pickers.${challengers}-challenges] ${voided ? "voids the bet when more than half of the pickers challenge" : "lets the subject's answer stand at a tie or a minority"}`, async () => {
      const f = await setup(pool.slice(0, pickers));
      const before = await scores(f);
      await answer(f, answeredAt, 1);
      for (const name of pool.slice(0, challengers)) await storeChallenge(f, name);
      vi.setSystemTime(deadline - 1);
      expect(await sweep(f)).toEqual({ advanced: 0 });
      expect(await bet(f)).toMatchObject({ state: "provisional", provisionalOutcome: 1 });
      expect(await bet(f)).not.toHaveProperty("outcome");
      vi.setSystemTime(deadline);
      expect(await sweep(f)).toEqual({ advanced: 1 });
      const resolved = await bet(f);
      if (voided) {
        expect(resolved.state).toBe("voided");
        for (const key of ["outcome", "finalizedAt", "provisionalOutcome", "answeredAt", "challengeDeadline"]) expect(resolved).not.toHaveProperty(key);
        expect((await picks(f)).every((pick) => pick.voidedAt === deadline)).toBe(true);
        expect(await f.t.query(api.v0Bets.get, { token: f.actors.friend.token, locator: f.locator })).toMatchObject({ view: "unavailable", state: "voided" });
      } else {
        expect(resolved).toMatchObject({ state: "finalized", outcome: 1, provisionalOutcome: 1, finalizedAt: deadline, answeredAt, policyVersion: "v0-policy.3" });
        expect((await picks(f)).every((pick) => pick.voidedAt === undefined)).toBe(true);
        expect(await f.t.query(api.v0Bets.get, { token: f.actors.friend.token, locator: f.locator })).toMatchObject({ view: "bet", state: "finalized", outcome: 1, canChallenge: false, canAnswer: false, canPick: false });
      }
      expect(await sweep(f)).toEqual({ advanced: 0 });
      expect(await bet(f)).toEqual(resolved);
      if (voided) expect(await scores(f)).toEqual(before);
    });
  }

  it("[B4.vote.unique] counts one challenge per person however many times it is sent or stored", async () => {
    const f = await setup(["creator", "friend", "revoked"]);
    await answer(f);
    vi.setSystemTime(answeredAt + minute);
    for (const requestId of ["a", "b", "c"]) expect(await f.t.mutation(api.v0Bets.challenge, { token: f.actors.friend.token, betId: f.bet, requestId: `${f.runId}_${requestId}` })).toEqual({ recorded: true });
    expect(await f.t.run((ctx) => ctx.db.query("v0Challenges").collect())).toHaveLength(1);
    await storeChallenge(f, "friend");
    await storeChallenge(f, "friend", answeredAt + 2 * minute);
    vi.setSystemTime(deadline);
    await sweep(f);
    expect(await bet(f)).toMatchObject({ state: "finalized", outcome: 0 });
  });

  it("[B4.vote.non-picker] does not count a challenge from a member who did not pick", async () => {
    const f = await setup(["creator"]);
    await answer(f);
    vi.setSystemTime(answeredAt + minute);
    expect(await f.t.mutation(api.v0Bets.challenge, { token: f.actors.friend.token, betId: f.bet, requestId: `${f.runId}_friend` })).toEqual({ recorded: true });
    await storeChallenge(f, "new");
    await storeChallenge(f, "outsider");
    vi.setSystemTime(deadline);
    await sweep(f);
    expect(await bet(f)).toMatchObject({ state: "finalized", outcome: 0 });
  });

  it("[B4.vote.ineligible] refuses a challenge from the subject, an outsider and a former member, and never counts one stored for them", async () => {
    const f = await setup(["creator", "friend"]);
    await f.t.run(async (ctx) => {
      const member = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.outsider.id)).unique();
      await ctx.db.patch(member!._id, { leftAt: T0 });
    });
    await answer(f);
    vi.setSystemTime(answeredAt + minute);
    for (const name of ["subject", "alias", "outsider", "left"] as const) await expectCode(f.t.mutation(api.v0Bets.challenge, { token: f.actors[name].token, betId: f.bet, requestId: `${f.runId}_${name}` }), "NOT_AVAILABLE");
    await expectCode(f.t.mutation(api.v0Bets.challenge, { token: f.actors.revoked.token, betId: f.bet, requestId: `${f.runId}_revoked` }), "AUTH_REQUIRED");
    expect(await f.t.run((ctx) => ctx.db.query("v0Challenges").collect())).toEqual([]);
    await storeChallenge(f, "subject");
    await storeChallenge(f, "left");
    await storeChallenge(f, "outsider");
    await storeChallenge(f, "creator");
    vi.setSystemTime(deadline);
    await sweep(f);
    expect(await bet(f)).toMatchObject({ state: "finalized", outcome: 0 });
  });

  it("[B4.vote.departed-member] drops a departed member's stored challenge and their pick from the count", async () => {
    const f = await setup(["creator", "friend", "revoked"]);
    await answer(f);
    vi.setSystemTime(answeredAt + minute);
    await f.t.mutation(api.v0Bets.challenge, { token: f.actors.friend.token, betId: f.bet, requestId: `${f.runId}_friend` });
    await f.t.mutation(api.v0Bets.challenge, { token: f.actors.creator.token, betId: f.bet, requestId: `${f.runId}_creator` });
    vi.setSystemTime(answeredAt + 2 * minute);
    await f.t.mutation(api.v0Controls.leave, { token: f.actors.friend.token, groupId: f.g1, requestId: `${f.runId}_leave` });
    expect(await f.t.run((ctx) => ctx.db.query("v0Challenges").collect())).toHaveLength(2);
    vi.setSystemTime(deadline);
    await sweep(f);
    expect(await bet(f)).toMatchObject({ state: "finalized", outcome: 0, finalizedAt: deadline });
    const rows = await picks(f);
    expect(rows.find((pick) => pick.accountId === f.actors.friend.id)?.voidedAt).toBe(answeredAt + 2 * minute);
    expect(rows.filter((pick) => pick.voidedAt === undefined).map((pick) => pick.accountId).sort()).toEqual([f.actors.creator.id, f.actors.revoked.id].sort());
  });

  it("[B4.vote.departed-member.majority-kept] still voids when the members who stayed are a majority of the pickers who stayed", async () => {
    const f = await setup(["creator", "friend", "revoked"]);
    await answer(f);
    await storeChallenge(f, "creator");
    await storeChallenge(f, "revoked");
    vi.setSystemTime(answeredAt + 2 * minute);
    await f.t.mutation(api.v0Controls.leave, { token: f.actors.friend.token, groupId: f.g1, requestId: `${f.runId}_leave` });
    vi.setSystemTime(deadline);
    await sweep(f);
    expect((await bet(f)).state).toBe("voided");
  });

  for (const [name, leaver, voided] of [["challenger-leaves", "friend", true], ["non-challenger-leaves", "revoked", true], ["only-challenger-leaves", "creator", false]] as const) {
    it(`[B4.vote.left-after-deadline.${name}] counts pickers as they stood when the hour ended, not when the worker ran`, async () => {
      const f = await setup(["creator", "friend", "revoked"]);
      await answer(f);
      await storeChallenge(f, "creator");
      if (voided) await storeChallenge(f, "friend");
      vi.setSystemTime(deadline);
      if (leaver === "revoked") await f.t.run(async (ctx) => {
        const member = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.revoked.id)).unique();
        await ctx.db.patch(member!._id, { leftAt: deadline });
        const pick = (await ctx.db.query("v0Picks").collect()).find((row) => row.accountId === f.actors.revoked.id);
        await ctx.db.patch(pick!._id, { voidedAt: deadline });
      });
      else await f.t.mutation(api.v0Controls.leave, { token: f.actors[leaver].token, groupId: f.g1, requestId: `${f.runId}_leave` });
      vi.setSystemTime(deadline + 30_000);
      await sweep(f);
      expect((await bet(f)).state).toBe(voided ? "voided" : "finalized");
    });
  }

  for (const stored of [-30 * minute, 2 * hour] as const) {
    it(`[B4.deadline.obsolete-stored.${stored}] resolves at one hour after the answer whatever deadline is stored on the bet`, async () => {
      const f = await setup(["creator"]);
      await answer(f);
      await f.t.run((ctx) => ctx.db.patch(f.bet, { challengeDeadline: deadline + stored }));
      vi.setSystemTime(deadline - 1);
      expect(await sweep(f)).toEqual({ advanced: 0 });
      expect((await bet(f)).state).toBe("provisional");
      vi.setSystemTime(deadline);
      expect(await sweep(f)).toEqual({ advanced: 1 });
      expect(await bet(f)).toMatchObject({ state: "finalized", finalizedAt: deadline });
    });
  }

  it("[B4.vote.rejoined-member] does not count a pick or challenge made under a membership that ended", async () => {
    const f = await setup(["creator", "friend"]);
    await answer(f);
    await storeChallenge(f, "friend");
    await f.t.run(async (ctx) => {
      const member = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.friend.id)).unique();
      await ctx.db.patch(member!._id, { leftAt: answeredAt + 2 * minute });
      await ctx.db.insert("v0Memberships", { groupId: f.g1, accountId: f.actors.friend.id, alias: "Finn", joinedAt: answeredAt + 3 * minute, points: 0, streak: 0 });
    });
    vi.setSystemTime(deadline);
    await sweep(f);
    expect(await bet(f)).toMatchObject({ state: "finalized", outcome: 0 });
  });

  for (const offset of [-1, 0, 1]) {
    it(`[B4.deadline.challenge.${offset}] counts a challenge only when it arrives before the hour ends`, async () => {
      const f = await setup(["creator"]);
      await answer(f);
      vi.setSystemTime(deadline + offset);
      const send = f.t.mutation(api.v0Bets.challenge, { token: f.actors.creator.token, betId: f.bet, requestId: `${f.runId}_edge` });
      if (offset < 0) expect(await send).toEqual({ recorded: true });
      else await expectCode(send, "NOT_AVAILABLE");
      vi.setSystemTime(deadline + Math.max(offset, 0));
      await sweep(f);
      expect((await bet(f)).state).toBe(offset < 0 ? "voided" : "finalized");
    });
  }

  it("[B4.deadline.stored-late] ignores a stored challenge dated at or after the deadline or before the answer", async () => {
    const f = await setup(["creator", "friend"]);
    await answer(f);
    await storeChallenge(f, "creator", deadline);
    await storeChallenge(f, "friend", answeredAt - 1);
    vi.setSystemTime(deadline + minute);
    await sweep(f);
    expect(await bet(f)).toMatchObject({ state: "finalized", finalizedAt: deadline + minute });
  });

  it("[B4.finalize.exactly-once] reaches one terminal state when the worker repeats, overlaps or runs late", async () => {
    const f = await setup(["creator", "friend", "revoked"]);
    await answer(f);
    await storeChallenge(f, "creator");
    vi.setSystemTime(deadline + 5 * minute);
    await Promise.all([sweep(f), sweep(f), f.t.mutation(internal.v0Bets.advance, { betId: f.bet })]);
    const first = await bet(f);
    expect(first).toMatchObject({ state: "finalized", outcome: 0, finalizedAt: deadline + 5 * minute });
    vi.setSystemTime(deadline + day);
    await sweep(f);
    expect(await f.t.mutation(internal.v0Bets.advance, { betId: f.bet })).toMatchObject({ state: "finalized" });
    await storeChallenge(f, "friend");
    await storeChallenge(f, "revoked");
    await sweep(f);
    await f.t.run(async (ctx) => voidBet(ctx, (await ctx.db.get(f.bet))!));
    expect(await bet(f)).toEqual(first);
    expect((await picks(f)).every((pick) => pick.voidedAt === undefined)).toBe(true);
    await expectCode(f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 1, requestId: `${f.runId}_again` }), "NOT_AVAILABLE");
    await expectCode(f.t.mutation(api.v0Bets.challenge, { token: f.actors.friend.token, betId: f.bet, requestId: `${f.runId}_late` }), "NOT_AVAILABLE");
  });

  it("[B4.finalize.void-is-terminal] never finalizes a bet that a majority voided", async () => {
    const f = await setup(["creator"]);
    await answer(f);
    await storeChallenge(f, "creator");
    vi.setSystemTime(deadline);
    await Promise.all([sweep(f), sweep(f)]);
    const first = await bet(f);
    expect(first.state).toBe("voided");
    await f.t.run(async (ctx) => {
      for (const row of await ctx.db.query("v0Challenges").collect()) await ctx.db.delete(row._id);
    });
    vi.setSystemTime(deadline + day);
    await sweep(f);
    expect(await f.t.mutation(internal.v0Bets.advance, { betId: f.bet })).toMatchObject({ state: "voided" });
    expect(await bet(f)).toEqual(first);
  });

  it("[B4.finalize.no-early-result] exposes no outcome and changes no score before the hour ends", async () => {
    const f = await setup(["creator", "friend"]);
    const before = await scores(f);
    await answer(f);
    for (const at of [answeredAt, answeredAt + 30 * minute, deadline - 1]) {
      vi.setSystemTime(at);
      await sweep(f);
      await f.t.mutation(internal.v0Bets.advance, { betId: f.bet });
      expect(await bet(f)).not.toHaveProperty("outcome");
      expect(await bet(f)).not.toHaveProperty("finalizedAt");
      const view = await f.t.query(api.v0Bets.get, { token: f.actors.friend.token, locator: f.locator });
      expect(view).toMatchObject({ state: "provisional", provisionalOutcome: 0 });
      expect(view).not.toHaveProperty("outcome");
      expect(await scores(f)).toEqual(before);
      expect(await f.t.query(api.v0Bets.history, { token: f.actors.friend.token, groupId: f.g1 })).toEqual([]);
    }
  });

  it("[B4.timeout.no-answer] voids an unanswered bet 24 hours after reveal, once", async () => {
    const f = await setup(["creator", "friend"]);
    const before = await scores(f);
    vi.setSystemTime(REVEAL);
    await sweep(f);
    vi.setSystemTime(timeout - 1);
    await sweep(f);
    expect((await bet(f)).state).toBe("revealed");
    vi.setSystemTime(timeout);
    await Promise.all([sweep(f), sweep(f)]);
    const first = await bet(f);
    expect(first.state).toBe("voided");
    expect((await picks(f)).every((pick) => pick.voidedAt === timeout)).toBe(true);
    vi.setSystemTime(timeout + hour);
    await sweep(f);
    expect(await bet(f)).toEqual(first);
    expect(await scores(f)).toEqual(before);
    await expectCode(f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 0, requestId: `${f.runId}_late` }), "NOT_AVAILABLE");
  });

  for (const offset of [-1, 0]) {
    it(`[B4.timeout.late-answer-race.${offset}] gives an answer and the timeout worker one winner at the 24-hour edge`, async () => {
      const f = await setup(["creator", "friend"]);
      vi.setSystemTime(REVEAL);
      await sweep(f);
      vi.setSystemTime(timeout + offset);
      const send = f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 1, requestId: `${f.runId}_edge` });
      if (offset < 0) expect(await send).toEqual({ state: "provisional", challengeDeadline: timeout - 1 + hour });
      else await expectCode(send, "NOT_AVAILABLE");
      vi.setSystemTime(timeout);
      await Promise.all([sweep(f), sweep(f)]);
      expect((await bet(f)).state).toBe(offset < 0 ? "provisional" : "voided");
      vi.setSystemTime(timeout + hour);
      await sweep(f);
      await sweep(f);
      if (offset < 0) expect(await bet(f)).toMatchObject({ state: "finalized", outcome: 1, finalizedAt: timeout + hour });
      else expect((await bet(f)).state).toBe("voided");
    });
  }

  it("[B4.timeout.worker-first] refuses an answer after the worker has voided the bet", async () => {
    const f = await setup(["creator"]);
    vi.setSystemTime(timeout);
    await sweep(f);
    expect((await bet(f)).state).toBe("voided");
    await expectCode(f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 0, requestId: `${f.runId}_after` }), "NOT_AVAILABLE");
    await sweep(f);
    expect((await bet(f)).state).toBe("voided");
  });

  it("[B4.finalize.unreadable-answer] voids a provisional bet whose stored answer time is unusable once every window has passed", async () => {
    const f = await setup(["creator"]);
    await answer(f);
    await f.t.run((ctx) => ctx.db.patch(f.bet, { answeredAt: Number.NaN }));
    vi.setSystemTime(timeout + hour - 1);
    await sweep(f);
    expect((await bet(f)).state).toBe("provisional");
    vi.setSystemTime(timeout + hour);
    await sweep(f);
    expect((await bet(f)).state).toBe("voided");
  });

  it("[B4.finalize.history] lists a finalized bet in history with its outcome", async () => {
    const f = await setup(["creator", "friend"]);
    await answer(f, answeredAt, 1);
    vi.setSystemTime(deadline);
    await sweep(f);
    const history = await f.t.query(api.v0Bets.history, { token: f.actors.creator.token, groupId: f.g1 });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ view: "bet", state: "finalized", outcome: 1 });
  });

  it("[B4.finalize.history-voided] lists a majority-voided bet in history with no outcome", async () => {
    const g = await setup(["creator"]);
    await answer(g);
    await storeChallenge(g, "creator");
    vi.setSystemTime(deadline);
    await sweep(g);
    const voided = await g.t.query(api.v0Bets.history, { token: g.actors.creator.token, groupId: g.g1 });
    expect(voided).toHaveLength(1);
    expect(voided[0]).toMatchObject({ view: "unavailable", state: "voided" });
    expect(voided[0]).not.toHaveProperty("outcome");
  });

  it("[B4.reveal.creator-left] still tells the subject and the remaining pickers about the reveal after the bet's creator left the group", async () => {
    const f = await setup(["creator", "friend", "revoked"]);
    vi.setSystemTime(T0 + 5 * minute);
    await f.t.mutation(api.v0Controls.leave, { token: f.actors.creator.token, groupId: f.g1, requestId: `${f.runId}_leave` });
    vi.setSystemTime(REVEAL);
    await sweep(f);
    await sweep(f);
    const outbox = await f.t.run((ctx) => ctx.db.query("v0Outbox").collect());
    expect(outbox.map((row) => [row.kind, row.accountId]).sort()).toEqual([["reveal", f.actors.friend.id], ["reveal", f.actors.revoked.id], ["reveal", f.actors.subject.id]].sort());
    expect(outbox.every((row) => row.betId === f.bet && row.groupId === f.g1)).toBe(true);
    vi.setSystemTime(answeredAt);
    await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 0, requestId: `${f.runId}_answer` });
    vi.setSystemTime(deadline);
    await sweep(f);
    expect(await bet(f)).toMatchObject({ state: "finalized", outcome: 0, answeredAt, finalizedAt: deadline });
  });

  it("[B4.reveal.creator-blocked-subject] queues no reveal notification for a bet whose creator and subject have blocked each other", async () => {
    const f = await setup(["friend"]);
    await f.t.run((ctx) => ctx.db.insert("v0Blocks", { accountId: f.actors.creator.id, blockedId: f.actors.subject.id, createdAt: T0 }));
    vi.setSystemTime(REVEAL);
    await sweep(f);
    expect(await f.t.run((ctx) => ctx.db.query("v0Outbox").collect())).toEqual([]);
  });
});
