import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { approvedPolicy } from "../../convex/v0GamePolicy";
import { noPrivateValues } from "./assertions";
import { T0 } from "./fixture";
import { v0Fixture } from "./v0-fixture";

type Fixture = Awaited<ReturnType<typeof v0Fixture>>;
type Role = keyof Fixture["actors"];
const minute = 60_000;
const day = 24 * 60 * minute;
const start = T0 + minute;

const expectCode = (operation: Promise<unknown>, code: string) => expect(operation).rejects.toMatchObject({ data: { code } });
const goals = (f: Fixture) => f.t.run((ctx) => ctx.db.query("v0Goals").collect());
const board = (f: Fixture, role: Role = "creator", groupId: Id<"v0Groups"> = f.g1) => f.t.query(api.v0Groups.board, { token: f.actors[role].token, groupId });
const propose = (f: Fixture, role: Role = "creator", patch: Record<string, unknown> = {}) => f.t.mutation(api.v0Groups.proposeGoal, { token: f.actors[role].token, groupId: f.g1, label: "Picnic trophy night", targetPoints: 500, requestId: `${f.runId}_propose_${role}`, ...patch });
const confirm = (f: Fixture, role: Role, requestId = `${f.runId}_confirm_${role}`) => f.t.mutation(api.v0Groups.confirmGoal, { token: f.actors[role].token, groupId: f.g1, requestId });

async function fixture(leaving: Role[] = []) {
  const f = await v0Fixture();
  vi.setSystemTime(start);
  await f.t.run(async (ctx) => {
    for (const member of await ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", f.g1)).collect()) {
      if (leaving.some((role) => f.actors[role].id === member.accountId) && member.leftAt === undefined) await ctx.db.patch(member._id, { leftAt: T0 - 1 });
    }
  });
  return f;
}

async function credit(f: Fixture, role: Role, points: number, at: number, groupId: Id<"v0Groups"> = f.g1) {
  await f.t.run(async (ctx) => {
    const member = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", groupId).eq("accountId", f.actors[role].id)).unique();
    await ctx.db.insert("v0Ledger", { groupId, betId: f.bet, accountId: f.actors[role].id, membershipId: member!._id, points, streakBefore: 0, streakAfter: points > 0 ? 1 : 0, policyVersion: "v0-policy.3", createdAt: at });
  });
}

describe("B5 shared goal: propose, confirm by more than half, one active goal, group points only", () => {
  it("[B5.policy.goal-values] keeps the goal limits in the policy module", () => {
    expect(approvedPolicy).toMatchObject({ goalTargetMinPoints: 100, goalTargetMaxPoints: 1_000_000, goalProposalDurationMs: 7 * day });
  });

  for (const role of ["creator", "friend", "subject", "new"] as const) {
    it(`[B5.propose.any-member.${role}] lets any member propose a name and a points target, counting the proposer as the first confirmation`, async () => {
      const f = await fixture();
      const proposed = await propose(f, role);
      const rows = await goals(f);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ groupId: f.g1, proposerId: f.actors[role].id, label: "Picnic trophy night", targetPoints: 500, confirmedBy: [f.actors[role].id], state: "proposed", createdAt: start });
      expect(rows[0]).not.toHaveProperty("confirmedAt");
      expect(proposed).toEqual({ id: rows[0]._id, label: "Picnic trophy night", targetPoints: 500, confirmedBy: [f.actors[role].id], state: "proposed", progressPoints: 0 });
      expect((await board(f, "friend")).goal).toEqual(proposed);
      expect((await board(f, "creator", f.g2)).goal).toBeNull();
    });
  }

  for (const role of ["outsider", "left", "revoked"] as const) {
    it(`[B5.propose.non-member.${role}] refuses a proposal or confirmation from someone who is not a signed-in member`, async () => {
      const f = await fixture();
      const code = role === "revoked" ? "AUTH_REQUIRED" : "NOT_AVAILABLE";
      await expectCode(propose(f, role), code);
      await propose(f, "creator");
      await expectCode(confirm(f, role), code);
      expect((await goals(f))[0].confirmedBy).toEqual([f.actors.creator.id]);
    });
  }

  for (const [members, leaving, needed] of [[5, [], 3], [4, ["new"], 3], [3, ["new", "revoked"], 2], [2, ["new", "revoked", "subject"], 2], [1, ["new", "revoked", "subject", "friend"], 1]] as const) {
    it(`[B5.confirm.majority.${members}-members] becomes active only when more than half of the ${members} active members have confirmed`, async () => {
      const f = await fixture([...leaving]);
      const order = (["creator", "friend", "subject", "revoked", "new"] as const).filter((role) => !(leaving as readonly string[]).includes(role));
      expect(order).toHaveLength(members);
      let latest = await propose(f, "creator");
      let confirmations = 1;
      for (const role of order.slice(1)) {
        expect(latest.state).toBe(confirmations >= needed ? "confirmed" : "proposed");
        if (latest.state === "confirmed" || role === "revoked") continue;
        vi.setSystemTime(start + confirmations * minute);
        latest = await confirm(f, role);
        confirmations++;
        expect(latest.confirmedBy).toHaveLength(confirmations);
      }
      expect(confirmations).toBe(needed);
      expect(latest.state).toBe("confirmed");
      const [row] = await goals(f);
      expect(row).toMatchObject({ state: "confirmed", confirmedAt: start + (needed - 1) * minute });
      expect(row.confirmedBy).toHaveLength(needed);
      expect((await board(f)).goal).toMatchObject({ id: row._id, state: "confirmed", progressPoints: 0 });
    });
  }

  it("[B5.confirm.idempotent] counts each member once however often they confirm, and replays a retried request", async () => {
    const f = await fixture();
    await propose(f, "creator");
    const first = await confirm(f, "friend");
    expect(await confirm(f, "friend")).toEqual(first);
    expect(await confirm(f, "friend", `${f.runId}_again`)).toMatchObject({ state: "proposed", confirmedBy: [f.actors.creator.id, f.actors.friend.id] });
    expect(await confirm(f, "creator", `${f.runId}_self`)).toMatchObject({ state: "proposed", confirmedBy: [f.actors.creator.id, f.actors.friend.id] });
    expect((await goals(f))[0]).toMatchObject({ state: "proposed", confirmedBy: [f.actors.creator.id, f.actors.friend.id] });
    expect(await propose(f, "creator")).toMatchObject({ state: "proposed", confirmedBy: [f.actors.creator.id] });
    expect(await goals(f)).toHaveLength(1);
  });

  it("[B5.confirm.departed] does not count a confirmation from a member who has left", async () => {
    const f = await fixture();
    await propose(f, "creator");
    await confirm(f, "friend");
    await f.t.mutation(api.v0Controls.leave, { token: f.actors.friend.token, groupId: f.g1, requestId: `${f.runId}_leave` });
    const next = await confirm(f, "subject");
    expect(next).toMatchObject({ state: "proposed", confirmedBy: [f.actors.creator.id, f.actors.subject.id] });
    expect(await confirm(f, "new")).toMatchObject({ state: "confirmed" });
    await expectCode(confirm(f, "friend", `${f.runId}_after_leave`), "NOT_AVAILABLE");
  });

  it("[B5.confirm.nothing-pending] refuses a confirmation when no proposal is waiting", async () => {
    const f = await fixture();
    await expectCode(confirm(f, "friend"), "NOT_AVAILABLE");
    await propose(f, "creator");
    await confirm(f, "friend");
    await confirm(f, "subject");
    await expectCode(confirm(f, "new"), "NOT_AVAILABLE");
    expect((await goals(f))[0].confirmedBy).toHaveLength(3);
  });

  it("[B5.one-goal.pending] allows one waiting proposal at a time and lets it lapse after 7 days", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (const session of await ctx.db.query("v0Sessions").collect()) if (session.revokedAt === undefined) await ctx.db.patch(session._id, { expiresAt: T0 + 30 * day });
    });
    const first = await propose(f, "creator");
    await expectCode(propose(f, "friend"), "CONFLICT");
    await expectCode(propose(f, "creator", { requestId: `${f.runId}_other`, label: "Board game crown" }), "CONFLICT");
    const proposedAt = (await goals(f))[0].createdAt;
    vi.setSystemTime(proposedAt + 7 * day - 1);
    expect((await board(f)).goal).toEqual(first);
    await expectCode(propose(f, "subject"), "CONFLICT");
    vi.setSystemTime(proposedAt + 7 * day);
    expect((await board(f)).goal).toBeNull();
    await expectCode(confirm(f, "friend"), "NOT_AVAILABLE");
    const second = await propose(f, "friend", { label: "Board game crown" });
    expect(second).toMatchObject({ label: "Board game crown", state: "proposed", confirmedBy: [f.actors.friend.id] });
    expect((await board(f)).goal).toEqual(second);
    expect((await goals(f)).map((goal) => goal.state)).toEqual(["proposed", "proposed"]);
  });

  it("[B5.one-goal.active] refuses a new proposal while the active goal is unreached and allows one after it is reached", async () => {
    const f = await fixture(["new", "revoked"]);
    await propose(f, "creator", { targetPoints: 100 });
    const active = await confirm(f, "friend");
    expect(active.state).toBe("confirmed");
    vi.setSystemTime(start + minute);
    await expectCode(propose(f, "subject", { label: "Board game crown" }), "CONFLICT");
    await credit(f, "friend", 99, start + minute);
    await expectCode(propose(f, "subject", { label: "Board game crown" }), "CONFLICT");
    expect((await board(f)).goal).toMatchObject({ id: active.id, progressPoints: 99, state: "confirmed" });
    await credit(f, "creator", 1, start + minute);
    expect((await board(f)).goal).toMatchObject({ id: active.id, progressPoints: 100, targetPoints: 100, state: "confirmed" });
    vi.setSystemTime(start + 2 * minute);
    const next = await propose(f, "subject", { label: "Board game crown" });
    expect(next).toMatchObject({ state: "proposed", label: "Board game crown" });
    expect((await board(f)).goal).toEqual(next);
    vi.setSystemTime(start + 3 * minute);
    await confirm(f, "creator");
    await credit(f, "friend", 40, start + 3 * minute);
    expect((await board(f)).goal).toMatchObject({ id: next.id, state: "confirmed", progressPoints: 40 });
    expect((await goals(f)).filter((goal) => goal.state === "confirmed")).toHaveLength(2);
  });

  it("[B5.progress.group-points] counts the points the whole group earned since the goal became active, in this group only", async () => {
    const f = await fixture(["new", "revoked"]);
    await credit(f, "friend", 300, start - minute);
    await propose(f, "creator");
    vi.setSystemTime(start + minute);
    await confirm(f, "friend");
    expect((await board(f)).goal).toMatchObject({ progressPoints: 0, targetPoints: 500 });
    await credit(f, "friend", 70, start + minute);
    await credit(f, "creator", 55, start + 2 * minute);
    await credit(f, "subject", 0, start + 2 * minute);
    await credit(f, "creator", 4000, start + 2 * minute, f.g2);
    await credit(f, "friend", 9000, start + 10 * minute);
    vi.setSystemTime(start + 3 * minute);
    for (const viewer of ["creator", "friend", "subject", "alias"] as const) expect((await board(f, viewer)).goal).toMatchObject({ progressPoints: 125 });
    expect((await board(f, "creator", f.g2)).goal).toBeNull();
    await f.t.mutation(api.v0Controls.leave, { token: f.actors.friend.token, groupId: f.g1, requestId: `${f.runId}_leave` });
    expect((await board(f)).goal).toMatchObject({ progressPoints: 125 });
  });

  it("[B5.progress.penalty-ignored] counts points earned and never subtracts a loss from the group's progress", async () => {
    const f = await fixture(["new", "revoked"]);
    await propose(f, "creator");
    await confirm(f, "friend");
    vi.setSystemTime(start + minute);
    await credit(f, "friend", 70, start + minute);
    await credit(f, "creator", -35, start + minute);
    expect((await board(f)).goal).toMatchObject({ progressPoints: 70 });
  });

  it("[B5.reward.points-only] carries no money, prize or individual payout: only a name, a target and the group's points", async () => {
    const f = await fixture(["new", "revoked"]);
    await propose(f, "creator");
    const active = await confirm(f, "friend");
    vi.setSystemTime(start + minute);
    await credit(f, "friend", 70, start + minute);
    const view = (await board(f)).goal!;
    expect(Object.keys(view).sort()).toEqual(["confirmedBy", "id", "label", "progressPoints", "state", "targetPoints"]);
    expect(Object.keys((await goals(f))[0]).sort()).toEqual(["_creationTime", "_id", "confirmedAt", "confirmedBy", "createdAt", "groupId", "label", "proposerId", "state", "targetPoints"]);
    expect(Object.keys(active).sort()).toEqual(Object.keys(view).sort());
    const members = await f.t.run((ctx) => ctx.db.query("v0Memberships").collect());
    expect(members.find((member) => member.accountId === f.actors.creator.id && member.groupId === f.g1)).toMatchObject({ points: 1000, streak: 0 });
  });

  for (const [name, patch] of [
    ["empty", { label: "   " }], ["too-long", { label: "a".repeat(81) }], ["way-too-long", { label: "a".repeat(400) }], ["control-character", { label: "Trophy\u200bnight" }], ["link", { label: "see https://example.invalid" }], ["markup", { label: "<b>Trophy</b>" }],
    ["money", { label: "Loser pays for dinner" }], ["cash", { label: "Winner gets money" }], ["health", { label: "Lose weight together" }],
    ["target-zero", { targetPoints: 0 }], ["target-negative", { targetPoints: -500 }], ["target-fraction", { targetPoints: 250.5 }], ["target-small", { targetPoints: 99 }], ["target-huge", { targetPoints: 1_000_001 }], ["target-nan", { targetPoints: Number.NaN }], ["target-infinite", { targetPoints: Infinity }],
  ] as const) {
    it(`[B5.propose.invalid.${name}] refuses an unusable goal name or target and stores nothing`, async () => {
      const f = await fixture();
      await expectCode(propose(f, "creator", patch), "INVALID_INPUT");
      expect(await goals(f)).toEqual([]);
      expect(await f.t.run((ctx) => ctx.db.query("v0Requests").collect())).toEqual([]);
    });
  }

  for (const [name, targetPoints] of [["minimum", 100], ["maximum", 1_000_000]] as const) {
    it(`[B5.propose.valid-target.${name}] accepts a target at the edge of the allowed range and tidies the name`, async () => {
      const f = await fixture();
      expect(await propose(f, "creator", { targetPoints, label: "  Picnic   trophy night " })).toMatchObject({ targetPoints, label: "Picnic trophy night" });
    });
  }

  it("[B5.propose.rate-bound] bounds proposals per member per hour", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.insert("v0RateLimits", { key: `groups.proposeGoal:${f.actors.creator.id}`, windowStart: start, count: 10 }));
    await expectCode(propose(f, "creator"), "RATE_LIMITED");
    expect(await goals(f)).toEqual([]);
    await f.t.run((ctx) => ctx.db.insert("v0RateLimits", { key: `groups.confirmGoal:${f.actors.subject.id}`, windowStart: start, count: 30 }));
    await propose(f, "friend");
    await expectCode(confirm(f, "subject"), "RATE_LIMITED");
    expect((await goals(f))[0].confirmedBy).toEqual([f.actors.friend.id]);
  });

  it("[B5.blocked.proposal-hidden] hides a waiting proposal from a member blocked with the proposer and shows them the goal once the group confirms it", async () => {
    const f = await fixture(["new", "revoked"]);
    await f.t.run((ctx) => ctx.db.insert("v0Blocks", { accountId: f.actors.subject.id, blockedId: f.actors.creator.id, createdAt: T0 }));
    await propose(f, "creator");
    expect((await board(f, "subject")).goal).toBeNull();
    await expectCode(confirm(f, "subject"), "NOT_AVAILABLE");
    expect((await board(f, "friend")).goal).toMatchObject({ state: "proposed" });
    await confirm(f, "friend");
    const seen = (await board(f, "subject")).goal;
    expect(seen).toMatchObject({ state: "confirmed", label: "Picnic trophy night", confirmedBy: [f.actors.friend.id] });
  });

  it("[B5.sealed] never carries a sealed question, option or context through the goal or the board", async () => {
    const f = await fixture(["new", "revoked"]);
    await propose(f, "creator");
    await confirm(f, "friend");
    vi.setSystemTime(start + minute);
    await credit(f, "friend", 70, start + minute);
    for (const viewer of ["subject", "alias", "creator", "friend"] as const) expect((await board(f, viewer)).goal).toMatchObject({ progressPoints: 70 });
    for (const viewer of ["subject", "alias", "creator", "friend"] as const) noPrivateValues(await board(f, viewer), f.privateValues);
    noPrivateValues(await goals(f), f.privateValues);
  });

  it("[B5.account-deleted] removes a deleted member's proposal and drops their confirmation from another member's", async () => {
    const f = await fixture();
    await propose(f, "creator");
    await confirm(f, "friend");
    await f.t.mutation(api.v0Controls.deleteAccount, { token: f.actors.friend.token, requestId: `${f.runId}_delete` });
    expect((await goals(f))[0].confirmedBy).toEqual([f.actors.creator.id]);
    await f.t.mutation(api.v0Controls.deleteAccount, { token: f.actors.creator.token, requestId: `${f.runId}_delete_creator` });
    expect(await goals(f)).toEqual([]);
    expect((await board(f, "subject")).goal).toBeNull();
  });
});
