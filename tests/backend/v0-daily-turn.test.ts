import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { approvedPolicy, localDateAt, localInstant } from "../../convex/v0GamePolicy";
import { queueNotification } from "../../convex/v0Notifications";
import { phoneHash } from "../../convex/v0Policy";
import { T0 } from "./fixture";
import { v0Fixture } from "./v0-fixture";

type Fixture = Awaited<ReturnType<typeof v0Fixture>>;
type Role = keyof Fixture["actors"];
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const eightAm = T0 + minute;
const noon = eightAm + 4 * hour;
const eightPm = eightAm + 12 * hour;

const expectCode = (operation: Promise<unknown>, code: string) => expect(operation).rejects.toMatchObject({ data: { code } });
const sweep = (f: Fixture) => f.t.mutation(internal.v0Jobs.turns, {});
const turns = (f: Fixture, groupId: Id<"v0Groups"> = f.g1) => f.t.run(async (ctx) => (await ctx.db.query("v0Turns").collect()).filter((turn) => turn.groupId === groupId).sort((a, b) => a.localDate.localeCompare(b.localDate)));
const outbox = (f: Fixture, groupId: Id<"v0Groups"> = f.g1) => f.t.run(async (ctx) => (await ctx.db.query("v0Outbox").collect()).filter((row) => row.groupId === groupId));
const group = (f: Fixture, groupId: Id<"v0Groups"> = f.g1) => f.t.run(async (ctx) => (await ctx.db.get(groupId))!);
const role = (f: Fixture, id: Id<"v0Accounts"> | undefined) => (Object.entries(f.actors).find(([name, actor]) => actor.id === id && name !== "alias")?.[0] ?? null) as Role | null;

async function longSessions(f: Fixture) {
  await f.t.run(async (ctx) => {
    for (const session of await ctx.db.query("v0Sessions").collect()) if (session.revokedAt === undefined) await ctx.db.patch(session._id, { expiresAt: T0 + 400 * day });
  });
}

async function setMembers(f: Fixture, leaving: Role[]) {
  await f.t.run(async (ctx) => {
    for (const member of await ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", f.g1)).collect()) {
      if (leaving.some((name) => f.actors[name].id === member.accountId) && member.leftAt === undefined) await ctx.db.patch(member._id, { leftAt: T0 - 1 });
    }
  });
}

function createArgs(f: Fixture, creator: Role, subjectId: Id<"v0Accounts">, requestId: string) {
  return { token: f.actors[creator].token, groupId: f.g1, subjectId, question: "Will the picnic have a puzzle?", contextLine: "A synthetic picnic", format: "yes_no" as const, options: ["Yes", "No"], source: "manual" as const, requestId };
}

describe("B2 local date and clock helpers", () => {
  for (const [zone, at, expected] of [
    ["UTC", "2026-11-16T23:59:59.999Z", "2026-11-16"],
    ["America/Los_Angeles", "2026-11-16T07:59:59.999Z", "2026-11-15"],
    ["America/Los_Angeles", "2026-11-16T08:00:00Z", "2026-11-16"],
    ["Asia/Tokyo", "2026-11-16T15:00:00Z", "2026-11-17"],
    ["Asia/Kolkata", "2026-11-16T18:29:59.999Z", "2026-11-16"],
    ["Pacific/Kiritimati", "2026-11-16T10:00:00Z", "2026-11-17"],
  ] as const) {
    it(`[B2.clock.local-date.${zone}.${at}] resolves the group-local calendar date`, () => {
      expect(localDateAt(zone, Date.parse(at))).toBe(expected);
    });
  }

  for (const [zone, date, hourOfDay, expected] of [
    ["America/Los_Angeles", "2026-11-16", 8, "2026-11-16T16:00:00Z"],
    ["America/Los_Angeles", "2027-03-13", 8, "2027-03-13T16:00:00Z"],
    ["America/Los_Angeles", "2027-03-14", 8, "2027-03-14T15:00:00Z"],
    ["America/Los_Angeles", "2027-11-07", 8, "2027-11-07T16:00:00Z"],
    ["America/Los_Angeles", "2027-11-06", 20, "2027-11-07T03:00:00Z"],
    ["Europe/London", "2027-03-28", 12, "2027-03-28T11:00:00Z"],
    ["Asia/Kolkata", "2026-11-16", 18, "2026-11-16T12:30:00Z"],
    ["Australia/Lord_Howe", "2027-04-04", 8, "2027-04-03T21:30:00Z"],
    ["Asia/Tokyo", "2026-11-17", 8, "2026-11-16T23:00:00Z"],
  ] as const) {
    it(`[B2.clock.local-instant.${zone}.${date}.${hourOfDay}] resolves a group-local wall-clock hour across daylight-saving changes`, () => {
      expect(localInstant(zone, date, hourOfDay)).toBe(Date.parse(expected));
    });
  }

  it("[B2.clock.invalid] returns nothing for an unusable zone, date or clock instead of inventing a time", () => {
    expect(localDateAt("Synthetic/Invalid", T0)).toBeNull();
    expect(localDateAt("UTC", Number.NaN)).toBeNull();
    expect(localInstant("Synthetic/Invalid", "2026-11-16", 8)).toBeNull();
    expect(localInstant("UTC", "16/11/2026", 8)).toBeNull();
    expect(localInstant("UTC", "2026-11-16", 8, 1)).toBe(Date.parse("2026-11-17T08:00:00Z"));
  });

  it("[B2.policy.turn-values] keeps the approved turn hours and limits in the policy module", () => {
    expect(approvedPolicy).toMatchObject({ version: "v0-policy.3", turnStartHour: 8, turnPassHour: 12, turnEndHour: 20, turnPassesPerDay: 1, minActiveMembers: 3, betsPerGroupPerDay: 1 });
  });
});

describe("B2 daily turn assignment, pass and expiry", () => {
  it("[B2.turn.assign-8am] assigns exactly one turn at 8:00 AM group time and queues one notification for the creator", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm - 1);
    await sweep(f);
    expect(await turns(f)).toEqual([]);
    expect(await outbox(f)).toEqual([]);
    vi.setSystemTime(eightAm);
    expect(await sweep(f)).toMatchObject({ assigned: 1 });
    const rows = await turns(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ groupId: f.g1, localDate: "2026-11-16", creatorId: f.actors.creator.id, subjectId: f.actors.friend.id, status: "assigned", assignedAt: eightAm, passAt: noon });
    expect(rows[0]).not.toHaveProperty("betId");
    const queued = await outbox(f);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ key: `turn:${f.g1}:2026-11-16:assigned`, accountId: f.actors.creator.id, groupId: f.g1, kind: "turn", state: "pending", attempts: 0, availableAt: eightAm });
    expect(queued[0]).not.toHaveProperty("betId");
    expect(await group(f)).toMatchObject({ nextTurnAt: noon, lastCreatorId: f.actors.creator.id, lastTurnDate: "2026-11-16" });
    expect(await f.t.query(api.v0Groups.turn, { token: f.actors.creator.token, groupId: f.g1 })).toEqual({ id: rows[0]._id, groupId: f.g1, localDate: "2026-11-16", creatorId: f.actors.creator.id, subjectId: f.actors.friend.id, status: "assigned", assignedAt: eightAm, passAt: noon, canPass: true });
    expect(await f.t.query(api.v0Groups.turn, { token: f.actors.friend.token, groupId: f.g1 })).toMatchObject({ creatorId: f.actors.creator.id, canPass: false });
    expect(await turns(f, f.g2)).toEqual([]);
  });

  it("[B2.turn.duplicate-workers] keeps one turn and one notification when the worker runs again, overlaps or retries", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await Promise.all([sweep(f), sweep(f)]);
    await sweep(f);
    vi.setSystemTime(eightAm + 30_000);
    await sweep(f);
    await f.t.run((ctx) => ctx.db.patch(f.g1, { nextTurnAt: eightAm }));
    await sweep(f);
    await sweep(f);
    expect(await turns(f)).toHaveLength(1);
    expect(await outbox(f)).toHaveLength(1);
    expect((await group(f)).nextTurnAt).toBe(noon);
  });

  it("[B2.turn.atomic-enqueue] writes the turn and its notification together or not at all, then recovers on the next run", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    const blocker = await f.t.run((ctx) => ctx.db.insert("v0Outbox", { key: `turn:${f.g1}:2026-11-16:assigned`, accountId: f.actors.friend.id, groupId: f.g1, kind: "turn", state: "pending", attempts: 0, availableAt: eightAm }));
    await expectCode(sweep(f), "IDEMPOTENCY_CONFLICT");
    expect(await turns(f)).toEqual([]);
    expect(await group(f)).toMatchObject({ nextTurnAt: eightAm });
    expect(await group(f)).not.toHaveProperty("lastTurnDate");
    await f.t.run((ctx) => ctx.db.delete(blocker));
    vi.setSystemTime(eightAm + minute);
    await sweep(f);
    await sweep(f);
    expect(await turns(f)).toHaveLength(1);
    expect(await outbox(f)).toHaveLength(1);
    expect((await outbox(f))[0]).toMatchObject({ accountId: f.actors.creator.id });
  });

  it("[B2.turn.rotation] rotates creators in join order and names the member who has gone longest without being the subject", async () => {
    const f = await v0Fixture();
    await longSessions(f);
    const seen: [Role | null, Role | null][] = [];
    for (let index = 0; index < 7; index++) {
      vi.setSystemTime(eightAm + index * day);
      await sweep(f);
      const turn = (await turns(f)).at(-1)!;
      expect(turn.localDate).toBe(localDateAt("America/Los_Angeles", eightAm + index * day));
      expect(turn.creatorId).not.toBe(turn.subjectId);
      const creator = role(f, turn.creatorId)!;
      seen.push([creator, role(f, turn.subjectId)]);
      vi.setSystemTime(eightAm + index * day + hour);
      if (creator !== "revoked") await f.t.mutation(api.v0Bets.create, createArgs(f, creator, turn.subjectId, `${f.runId}_day_${index}`));
      vi.setSystemTime(eightAm + index * day + 12 * hour);
      await sweep(f);
    }
    expect(seen).toEqual([["creator", "friend"], ["friend", "creator"], ["subject", "revoked"], ["revoked", "new"], ["new", "subject"], ["creator", "new"], ["friend", "creator"]]);
    expect(await turns(f)).toHaveLength(7);
    expect((await turns(f)).map((turn) => turn.status)).toEqual(["created", "created", "created", "expired", "created", "created", "created"]);
    expect(await f.t.run(async (ctx) => (await ctx.db.query("v0Bets").collect()).filter((bet) => bet.groupId === f.g1))).toHaveLength(7);
  });

  it("[B2.turn.noon-pass] passes an unused turn once at 12:00 noon to the next member and renames the subject when the new creator was the subject", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await sweep(f);
    vi.setSystemTime(noon - 1);
    await sweep(f);
    expect((await turns(f))[0]).toMatchObject({ status: "assigned", creatorId: f.actors.creator.id });
    vi.setSystemTime(noon);
    expect(await sweep(f)).toMatchObject({ passed: 1 });
    await sweep(f);
    vi.setSystemTime(noon + minute);
    await f.t.run((ctx) => ctx.db.patch(f.g1, { nextTurnAt: noon }));
    await sweep(f);
    const rows = await turns(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "passed", creatorId: f.actors.friend.id, subjectId: f.actors.creator.id, passedFromId: f.actors.creator.id, assignedAt: noon, passAt: noon, localDate: "2026-11-16" });
    const queued = await outbox(f);
    expect(queued.map((row) => [row.key, row.accountId])).toEqual([[`turn:${f.g1}:2026-11-16:passed`, f.actors.friend.id]]);
    expect(await group(f)).toMatchObject({ nextTurnAt: eightPm, lastCreatorId: f.actors.friend.id });
    expect(await f.t.query(api.v0Groups.turn, { token: f.actors.friend.token, groupId: f.g1 })).toMatchObject({ status: "passed", canPass: false });
    await expectCode(f.t.mutation(api.v0Groups.passTurn, { token: f.actors.friend.token, groupId: f.g1, requestId: `${f.runId}_again` }), "NOT_AVAILABLE");
    await expectCode(f.t.mutation(api.v0Groups.passTurn, { token: f.actors.creator.token, groupId: f.g1, requestId: `${f.runId}_first` }), "NOT_AVAILABLE");
    await expectCode(f.t.mutation(api.v0Bets.create, createArgs(f, "creator", f.actors.friend.id, `${f.runId}_old`)), "FORBIDDEN");
    const created = await f.t.mutation(api.v0Bets.create, createArgs(f, "friend", f.actors.creator.id, `${f.runId}_new`));
    expect((await turns(f))[0]).toMatchObject({ status: "created", betId: created.betId });
  });

  it("[B2.turn.noon-pass.sent-kept] keeps a turn notification that was already delivered when the turn passes", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await sweep(f);
    await f.t.run(async (ctx) => ctx.db.patch((await ctx.db.query("v0Outbox").collect())[0]._id, { state: "sent", sentAt: eightAm + 1 }));
    vi.setSystemTime(noon);
    await sweep(f);
    expect((await outbox(f)).map((row) => [row.key.split(":").at(-1), row.state]).sort()).toEqual([["assigned", "sent"], ["passed", "pending"]]);
  });

  it("[B2.turn.manual-pass] lets the creator pass before noon exactly once, idempotently, and never passes the same turn again", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await sweep(f);
    vi.setSystemTime(eightAm + hour);
    for (const other of ["friend", "subject", "revoked", "outsider"] as const) await expect(f.t.mutation(api.v0Groups.passTurn, { token: f.actors[other].token, groupId: f.g1, requestId: `${f.runId}_${other}` })).rejects.toMatchObject({ data: { code: other === "revoked" ? "AUTH_REQUIRED" : "NOT_AVAILABLE" } });
    expect((await turns(f))[0]).toMatchObject({ status: "assigned", creatorId: f.actors.creator.id });
    const passed = await f.t.mutation(api.v0Groups.passTurn, { token: f.actors.creator.token, groupId: f.g1, requestId: `${f.runId}_pass` });
    expect(passed).toMatchObject({ status: "passed", creatorId: f.actors.friend.id, subjectId: f.actors.creator.id, assignedAt: eightAm + hour, canPass: false });
    expect(await f.t.mutation(api.v0Groups.passTurn, { token: f.actors.creator.token, groupId: f.g1, requestId: `${f.runId}_pass` })).toEqual(passed);
    await expectCode(f.t.mutation(api.v0Groups.passTurn, { token: f.actors.creator.token, groupId: f.g1, requestId: `${f.runId}_pass_2` }), "NOT_AVAILABLE");
    await expectCode(f.t.mutation(api.v0Groups.passTurn, { token: f.actors.friend.token, groupId: f.g1, requestId: `${f.runId}_pass_3` }), "NOT_AVAILABLE");
    vi.setSystemTime(noon);
    await sweep(f);
    vi.setSystemTime(noon + hour);
    await sweep(f);
    const rows = await turns(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "passed", creatorId: f.actors.friend.id, passedFromId: f.actors.creator.id });
    expect((await outbox(f)).map((row) => row.accountId)).toEqual([f.actors.friend.id]);
  });

  it("[B2.turn.created-keeps] does not pass or expire a turn whose bet was sent", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await sweep(f);
    vi.setSystemTime(eightAm + hour);
    const created = await f.t.mutation(api.v0Bets.create, createArgs(f, "creator", f.actors.friend.id, `${f.runId}_create`));
    expect(await outbox(f)).toEqual([]);
    await expectCode(f.t.mutation(api.v0Groups.passTurn, { token: f.actors.creator.token, groupId: f.g1, requestId: `${f.runId}_pass` }), "NOT_AVAILABLE");
    for (const at of [noon, eightPm, eightPm + hour]) {
      vi.setSystemTime(at);
      await sweep(f);
    }
    expect(await turns(f)).toHaveLength(1);
    expect((await turns(f))[0]).toMatchObject({ status: "created", betId: created.betId, creatorId: f.actors.creator.id });
    expect((await group(f)).nextTurnAt).toBe(eightAm + day);
  });

  it("[B2.turn.expire-8pm] ends the day with no bet at 8:00 PM and starts the next day with the member after the last holder", async () => {
    const f = await v0Fixture();
    for (const at of [eightAm, noon, eightPm - 1]) {
      vi.setSystemTime(at);
      await sweep(f);
    }
    expect((await turns(f))[0]).toMatchObject({ status: "passed", creatorId: f.actors.friend.id });
    expect(await outbox(f)).toHaveLength(1);
    vi.setSystemTime(eightPm);
    expect(await sweep(f)).toMatchObject({ expired: 1 });
    await sweep(f);
    expect((await turns(f))[0]).toMatchObject({ status: "expired", creatorId: f.actors.friend.id });
    expect(await outbox(f)).toEqual([]);
    expect((await group(f)).nextTurnAt).toBe(eightAm + day);
    await expectCode(f.t.mutation(api.v0Bets.create, createArgs(f, "friend", f.actors.creator.id, `${f.runId}_late`)), "FORBIDDEN");
    await expectCode(f.t.mutation(api.v0Groups.passTurn, { token: f.actors.friend.token, groupId: f.g1, requestId: `${f.runId}_late_pass` }), "NOT_AVAILABLE");
    vi.setSystemTime(eightAm + day - 1);
    await sweep(f);
    expect(await turns(f)).toHaveLength(1);
    vi.setSystemTime(eightAm + day);
    await sweep(f);
    const rows = await turns(f);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ localDate: "2026-11-17", status: "assigned", creatorId: f.actors.subject.id, subjectId: f.actors.creator.id });
  });

  for (const [name, firstRun, expected] of [["ten-am", eightAm + 2 * hour, "passes-at-noon"], ["one-pm", eightAm + 5 * hour, "no-pass"], ["eight-pm", eightPm, "no-turn"], ["next-morning-early", eightAm + 20 * hour, "no-turn"]] as const) {
    it(`[B2.turn.late-worker.${name}] produces at most one turn for the local date when the worker starts late`, async () => {
      const f = await v0Fixture();
      vi.setSystemTime(firstRun);
      await sweep(f);
      await sweep(f);
      const first = await turns(f);
      if (expected === "no-turn") {
        expect(first).toEqual([]);
        expect(await outbox(f)).toEqual([]);
        expect((await group(f)).nextTurnAt).toBe(eightAm + day);
        return;
      }
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ localDate: "2026-11-16", status: "assigned", creatorId: f.actors.creator.id, assignedAt: firstRun, passAt: noon });
      expect(await outbox(f)).toHaveLength(1);
      for (const at of [noon, noon + 2 * hour, eightPm - 1].filter((time) => time > firstRun)) {
        vi.setSystemTime(at);
        await f.t.run((ctx) => ctx.db.patch(f.g1, { nextTurnAt: at }));
        await sweep(f);
      }
      expect(await turns(f)).toHaveLength(1);
      expect((await turns(f))[0]).toMatchObject(expected === "passes-at-noon" ? { status: "passed", creatorId: f.actors.friend.id } : { status: "assigned", creatorId: f.actors.creator.id });
      vi.setSystemTime(eightPm);
      await sweep(f);
      expect((await turns(f))[0].status).toBe("expired");
    });
  }

  it("[B2.turn.downtime] skips the days the worker missed and never assigns a past date", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await sweep(f);
    vi.setSystemTime(eightAm + 3 * day + hour);
    await sweep(f);
    await sweep(f);
    expect((await turns(f)).map((turn) => [turn.localDate, turn.status])).toEqual([["2026-11-16", "assigned"], ["2026-11-19", "assigned"]]);
    expect((await outbox(f)).map((row) => row.key.split(":").slice(2).join(":")).sort()).toEqual(["2026-11-16:assigned", "2026-11-19:assigned"]);
  });

  it("[B2.turn.small-group] gives no turn to a group with fewer than 3 active members and assigns one the same day once a third member joins", async () => {
    const f = await v0Fixture();
    await setMembers(f, ["subject", "revoked", "new"]);
    await f.t.run(async (ctx) => {
      const member = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.new.id)).unique();
      await ctx.db.patch(member!._id, { leftAt: T0 + 2 });
    });
    vi.setSystemTime(eightAm);
    expect(await sweep(f)).toMatchObject({ assigned: 0 });
    expect(await turns(f)).toEqual([]);
    expect(await outbox(f)).toEqual([]);
    expect((await group(f)).nextTurnAt).toBe(eightAm + day);
    vi.setSystemTime(eightAm + 2 * hour);
    await f.t.run(async (ctx) => ctx.db.patch(f.invite, { expiresAt: eightAm + day, phoneHash: await phoneHash(f.actors.outsider.phone) }));
    await f.t.mutation(api.v0Groups.accept, { token: f.actors.outsider.token, inviteId: f.invite, requestId: `${f.runId}_accept` });
    expect((await group(f)).nextTurnAt).toBe(eightAm + 2 * hour);
    vi.setSystemTime(eightAm + 2 * hour + minute);
    await sweep(f);
    await sweep(f);
    const rows = await turns(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ localDate: "2026-11-16", creatorId: f.actors.creator.id, status: "assigned", assignedAt: eightAm + 2 * hour + minute });
    expect([f.actors.friend.id, f.actors.outsider.id]).toContain(rows[0].subjectId);
  });

  it("[B2.turn.join-after-turn] does not assign a second turn when a member joins on a day that already has one", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await sweep(f);
    vi.setSystemTime(eightAm + hour);
    await f.t.run((ctx) => ctx.db.patch(f.invite, { expiresAt: eightAm + day }));
    await f.t.mutation(api.v0Groups.accept, { token: f.actors.outsider.token, inviteId: f.invite, requestId: `${f.runId}_accept` });
    expect((await group(f)).nextTurnAt).toBe(noon);
    await sweep(f);
    expect(await turns(f)).toHaveLength(1);
    expect(await outbox(f)).toHaveLength(1);
  });

  for (const skipped of ["no-bets", "creator-blocked", "blocked-creator", "deleted", "left"] as const) {
    it(`[B2.turn.skip-subject.${skipped}] never names a subject who opted out, is blocked with the creator, left or deleted their account`, async () => {
      const f = await v0Fixture();
      await f.t.run(async (ctx) => {
        if (skipped === "no-bets") await ctx.db.patch(f.actors.friend.id, { noBets: true });
        if (skipped === "creator-blocked") await ctx.db.insert("v0Blocks", { accountId: f.actors.creator.id, blockedId: f.actors.friend.id, createdAt: T0 });
        if (skipped === "blocked-creator") await ctx.db.insert("v0Blocks", { accountId: f.actors.friend.id, blockedId: f.actors.creator.id, createdAt: T0 });
        if (skipped === "deleted") await ctx.db.patch(f.actors.friend.id, { deletedAt: T0 });
      });
      if (skipped === "left") await setMembers(f, ["friend"]);
      vi.setSystemTime(eightAm);
      await sweep(f);
      const turn = (await turns(f))[0];
      expect(turn).toMatchObject({ creatorId: f.actors.creator.id, subjectId: f.actors.revoked.id });
      vi.setSystemTime(eightPm);
      await sweep(f);
      vi.setSystemTime(eightAm + day);
      await sweep(f);
      const next = (await turns(f))[1];
      expect(role(f, next.creatorId)).toBe(skipped === "deleted" || skipped === "left" ? "subject" : "friend");
      expect(next.subjectId).not.toBe(next.creatorId);
      if (skipped === "no-bets") expect(next.subjectId).not.toBe(f.actors.friend.id);
    });
  }

  it("[B2.turn.skip-creator.no-eligible-subject] moves to the next creator when nobody can be the first creator's subject, and gives no turn when no pair exists", async () => {
    const f = await v0Fixture();
    await setMembers(f, ["revoked"]);
    await f.t.run(async (ctx) => {
      for (const name of ["friend", "subject", "new"] as const) await ctx.db.insert("v0Blocks", { accountId: f.actors.creator.id, blockedId: f.actors[name].id, createdAt: T0 });
    });
    vi.setSystemTime(eightAm);
    await sweep(f);
    expect((await turns(f))[0]).toMatchObject({ creatorId: f.actors.friend.id });
    expect((await turns(f))[0].subjectId).not.toBe(f.actors.creator.id);

    const g = await v0Fixture();
    await g.t.run(async (ctx) => {
      for (const name of ["creator", "friend", "subject", "revoked", "new"] as const) await ctx.db.patch(g.actors[name].id, { noBets: true });
    });
    vi.setSystemTime(eightAm);
    await sweep(g);
    expect(await turns(g)).toEqual([]);
    expect(await outbox(g)).toEqual([]);
  });

  it("[B2.turn.notification-preference] still assigns the turn but queues nothing for a creator who turned notifications off", async () => {
    const f = await v0Fixture();
    await f.t.run((ctx) => ctx.db.patch(f.actors.creator.id, { notificationsEnabled: false }));
    vi.setSystemTime(eightAm);
    await sweep(f);
    expect((await turns(f))[0]).toMatchObject({ creatorId: f.actors.creator.id, status: "assigned" });
    expect(await outbox(f)).toEqual([]);
  });

  it("[B2.turn.neutral-notification] queues only opaque identifiers: no name, subject or question", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await sweep(f);
    const [row] = await outbox(f);
    expect(Object.keys(row).sort()).toEqual(["_creationTime", "_id", "accountId", "attempts", "availableAt", "groupId", "key", "kind", "state"]);
    const body = JSON.stringify(row);
    for (const text of ["Cora", "Finn", "Sage", f.actors.friend.id, ...f.privateValues]) expect(body).not.toContain(text);
  });

  for (const ending of ["missed-day-end", "subject-left", "creator-left", "passed", "bet-sent", "wrong-recipient"] as const) {
    it(`[B2.turn.stale-notification.${ending}] withdraws a turn notification at delivery once its turn is over or belongs to someone else`, async () => {
      const f = await v0Fixture();
      await longSessions(f);
      vi.setSystemTime(eightAm);
      await sweep(f);
      const [row] = await outbox(f);
      await f.t.run(async (ctx) => {
        await ctx.db.insert("v0PushTokens", { accountId: f.actors.creator.id, deviceId: f.actors.creator.deviceId, token: "ab".repeat(32), environment: "sandbox", updatedAt: T0 });
        if (ending === "wrong-recipient") await ctx.db.insert("v0Outbox", { key: `turn:${f.g1}:2026-11-16:passed`, accountId: f.actors.friend.id, groupId: f.g1, kind: "turn", state: "pending", attempts: 0, availableAt: eightAm });
      });
      expect(await f.t.mutation(internal.v0Notifications.claimBatch, {})).toHaveLength(1);
      await f.t.run((ctx) => ctx.db.patch(row._id, { state: "pending", leaseUntil: undefined, availableAt: eightAm }));
      if (ending === "missed-day-end") vi.setSystemTime(eightPm);
      else vi.setSystemTime(eightAm + hour);
      if (ending === "subject-left") await f.t.mutation(api.v0Controls.leave, { token: f.actors.friend.token, groupId: f.g1, requestId: `${f.runId}_leave` });
      if (ending === "creator-left") await f.t.mutation(api.v0Controls.leave, { token: f.actors.creator.token, groupId: f.g1, requestId: `${f.runId}_leave` });
      if (ending === "passed" || ending === "bet-sent") await f.t.run(async (ctx) => {
        const turn = (await ctx.db.query("v0Turns").collect())[0];
        await ctx.db.patch(turn._id, ending === "passed" ? { status: "passed", creatorId: f.actors.revoked.id, passedFromId: f.actors.creator.id } : { status: "created" });
      });
      if (ending === "missed-day-end") expect((await turns(f))[0].status).toBe("assigned");
      const claimed = await f.t.mutation(internal.v0Notifications.claimBatch, {});
      const left = await outbox(f);
      if (ending === "wrong-recipient") {
        expect(claimed).toHaveLength(1);
        expect(left.map((item) => item.key)).toEqual([row.key]);
        return;
      }
      expect(claimed).toEqual([]);
      expect(left).toEqual([]);
    });
  }

  it("[B2.turn.stale-notification.queue] refuses to queue a turn notification for a turn that is not the recipient's open turn", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await sweep(f);
    const queue = (accountId: Id<"v0Accounts">, step: string, date = "2026-11-16") => f.t.run((ctx) => queueNotification(ctx, { key: `turn:${f.g1}:${date}:${step}`, accountId, groupId: f.g1, kind: "turn" }));
    expect(await queue(f.actors.friend.id, "passed")).toBeNull();
    expect(await queue(f.actors.creator.id, "passed", "2026-11-15")).toBeNull();
    expect(await queue(f.actors.creator.id, "passed")).not.toBeNull();
    vi.setSystemTime(eightPm);
    expect(await queue(f.actors.creator.id, "assigned")).toBeNull();
  });

  for (const [name, dates] of [["spring-forward", ["2027-03-13", "2027-03-14", "2027-03-15"]], ["fall-back", ["2027-11-06", "2027-11-07", "2027-11-08"]]] as const) {
    it(`[B2.turn.dst.${name}] assigns one turn per local date at 8:00 AM wall-clock time across a daylight-saving change`, async () => {
      const f = await v0Fixture();
      for (const date of dates) {
        const start = localInstant("America/Los_Angeles", date, 8)!;
        const end = localInstant("America/Los_Angeles", date, 20)!;
        vi.setSystemTime(start - 1);
        await sweep(f);
        expect((await turns(f)).some((turn) => turn.localDate === date)).toBe(false);
        expect((await group(f)).nextTurnAt).toBe(start);
        vi.setSystemTime(start);
        await sweep(f);
        await sweep(f);
        expect((await turns(f)).filter((turn) => turn.localDate === date)).toHaveLength(1);
        expect((await turns(f)).find((turn) => turn.localDate === date)).toMatchObject({ assignedAt: start, passAt: localInstant("America/Los_Angeles", date, 12) });
        vi.setSystemTime(end);
        await sweep(f);
        await sweep(f);
      }
      const rows = await turns(f);
      expect(rows.map((turn) => turn.localDate)).toEqual([...dates]);
      expect(rows.every((turn) => turn.status === "expired")).toBe(true);
      const gaps = dates.map((date) => localInstant("America/Los_Angeles", date, 8)!);
      expect([gaps[1] - gaps[0], gaps[2] - gaps[1]]).toEqual(name === "spring-forward" ? [23 * hour, 24 * hour] : [25 * hour, 24 * hour]);
    });
  }

  it("[B2.turn.zone-change] never holds two turns for one local date when the group's timezone changes mid-day", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await sweep(f);
    await f.t.run((ctx) => ctx.db.patch(f.g1, { timezone: "Asia/Tokyo", nextTurnAt: eightAm }));
    vi.setSystemTime(eightAm + minute);
    await sweep(f);
    expect(await turns(f)).toHaveLength(1);
    const tokyoStart = Date.parse("2026-11-16T23:00:00Z");
    expect((await group(f)).nextTurnAt).toBe(tokyoStart);
    vi.setSystemTime(tokyoStart);
    await sweep(f);
    await sweep(f);
    expect((await turns(f)).map((turn) => turn.localDate)).toEqual(["2026-11-16", "2026-11-17"]);
    await f.t.run((ctx) => ctx.db.patch(f.g1, { timezone: "America/Los_Angeles", nextTurnAt: tokyoStart }));
    vi.setSystemTime(tokyoStart + minute);
    await sweep(f);
    await sweep(f);
    vi.setSystemTime(eightAm + day);
    await f.t.run((ctx) => ctx.db.patch(f.g1, { nextTurnAt: eightAm + day }));
    await sweep(f);
    const rows = await turns(f);
    expect(rows.map((turn) => turn.localDate)).toEqual(["2026-11-16", "2026-11-17"]);
    expect(new Set((await outbox(f)).map((row) => row.key)).size).toBe((await outbox(f)).length);
  });

  it("[B2.turn.invalid-zone] parks a group with an unusable timezone without failing the other groups", async () => {
    const f = await v0Fixture();
    await f.t.run((ctx) => ctx.db.patch(f.g2, { timezone: "Synthetic/Invalid", nextTurnAt: eightAm }));
    vi.setSystemTime(eightAm);
    await sweep(f);
    expect(await turns(f)).toHaveLength(1);
    expect(await turns(f, f.g2)).toEqual([]);
    expect((await group(f, f.g2)).nextTurnAt).toBe(eightAm + day);
  });

  it("[B2.turn.unscheduled-group] schedules a group that was created before turns existed", async () => {
    const f = await v0Fixture();
    await f.t.run((ctx) => ctx.db.patch(f.g1, { nextTurnAt: Number.MAX_SAFE_INTEGER }));
    vi.setSystemTime(eightAm - 30_000);
    await sweep(f);
    expect(await turns(f)).toEqual([]);
    expect((await group(f)).nextTurnAt).toBe(eightAm);
  });

  for (const [zone, expected] of [["America/Los_Angeles", "2026-11-16T16:00:00Z"], ["Asia/Tokyo", "2026-11-16T23:00:00Z"], ["UTC", "2026-11-17T08:00:00Z"]] as const) {
    it(`[B2.groups.create-schedule.${zone}] schedules a new group's first turn check at the next 8:00 AM group time`, async () => {
      const f = await v0Fixture();
      const created = await f.t.mutation(api.v0Groups.create, { token: f.actors.creator.token, name: "Synthetic room", timezone: zone, requestId: `${f.runId}_group` });
      expect((await group(f, created.id)).nextTurnAt).toBe(Date.parse(expected));
    });
  }

  it("[B2.turn.other-group] assigns each group on its own local clock and keeps their turns apart", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(eightAm);
    await sweep(f);
    expect(await turns(f, f.g2)).toEqual([]);
    const tokyoStart = Date.parse("2026-11-16T23:00:00Z");
    expect((await group(f, f.g2)).nextTurnAt).toBe(tokyoStart);
    vi.setSystemTime(tokyoStart);
    await sweep(f);
    const rows = await turns(f, f.g2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ localDate: "2026-11-17", creatorId: f.actors.creator.id, subjectId: f.actors.outsider.id });
    expect(await turns(f)).toHaveLength(1);
    expect(await f.t.query(api.v0Groups.turn, { token: f.actors.friend.token, groupId: f.g1 })).toMatchObject({ localDate: "2026-11-16" });
    await expectCode(f.t.query(api.v0Groups.turn, { token: f.actors.friend.token, groupId: f.g2 }), "NOT_AVAILABLE");
  });
});
