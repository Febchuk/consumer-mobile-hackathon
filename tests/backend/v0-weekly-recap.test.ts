import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import crons from "../../convex/crons";
import { approvedPolicy, recapLateLimitMs, recapWeek } from "../../convex/v0GamePolicy";
import { noPrivateValues } from "./assertions";
import { T0 } from "./fixture";
import { v0Fixture } from "./v0-fixture";

type Fixture = Awaited<ReturnType<typeof v0Fixture>>;
type Role = keyof Fixture["actors"];
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;
const sunday = Date.parse("2026-11-23T02:00:00Z");
const tokyoSunday = Date.parse("2026-11-22T09:00:00Z");

const run = (f: Fixture) => f.t.mutation(internal.v0Jobs.recaps, {});
const recaps = (f: Fixture, groupId: Id<"v0Groups"> = f.g1) => f.t.run(async (ctx) => (await ctx.db.query("v0Recaps").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect()).sort((a, b) => a.endsAt - b.endsAt));
const outbox = (f: Fixture, groupId: Id<"v0Groups"> = f.g1) => f.t.run(async (ctx) => (await ctx.db.query("v0Outbox").collect()).filter((row) => row.groupId === groupId && row.kind === "recap"));
const group = (f: Fixture, groupId: Id<"v0Groups"> = f.g1) => f.t.run(async (ctx) => (await ctx.db.get(groupId))!);
const members = (f: Fixture, groupId: Id<"v0Groups"> = f.g1) => f.t.run(async (ctx) => (await ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect()).filter((member) => member.leftAt === undefined).map((member) => member.accountId).sort());
const recipients = async (f: Fixture, groupId: Id<"v0Groups"> = f.g1) => (await outbox(f, groupId)).map((row) => row.accountId).sort();

async function credit(f: Fixture, role: Role, points: number, at: number, groupId: Id<"v0Groups"> = f.g1) {
  await f.t.run(async (ctx) => {
    const member = (await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", groupId).eq("accountId", f.actors[role].id)).collect())[0];
    await ctx.db.insert("v0Ledger", { groupId, betId: f.bet, accountId: f.actors[role].id, membershipId: member._id, points, streakBefore: 0, streakAfter: points > 0 ? 1 : 0, policyVersion: approvedPolicy.version, createdAt: at });
  });
}

async function fixture() {
  const f = await v0Fixture();
  await f.t.run(async (ctx) => {
    for (const session of await ctx.db.query("v0Sessions").collect()) if (session.revokedAt === undefined) await ctx.db.patch(session._id, { expiresAt: T0 + 800 * day });
  });
  return f;
}

describe("B6 recap clock: Sunday 6:00 PM group time over the previous seven days", () => {
  it("[B6.policy.recap-values] keeps the recap schedule in the policy module and reports every rule approved", async () => {
    expect(approvedPolicy).toMatchObject({ recapWeekday: 0, recapHour: 18, recapWindowDays: 7 });
    expect(recapLateLimitMs).toBe(day);
    const f = await fixture();
    expect((await f.t.query(api.v0Groups.board, { token: f.actors.creator.token, groupId: f.g1 })).policy).toEqual({ status: "approved", version: "v0-policy.3" });
  });

  for (const [zone, at, localDate, startsAt, endsAt, nextAt] of [
    ["America/Los_Angeles", "2026-11-23T02:00:00.000Z", "2026-11-22", "2026-11-16T02:00:00Z", "2026-11-23T02:00:00Z", "2026-11-30T02:00:00Z"],
    ["America/Los_Angeles", "2026-11-23T01:59:59.999Z", "2026-11-15", "2026-11-09T02:00:00Z", "2026-11-16T02:00:00Z", "2026-11-23T02:00:00Z"],
    ["America/Los_Angeles", "2026-11-26T20:00:00.000Z", "2026-11-22", "2026-11-16T02:00:00Z", "2026-11-23T02:00:00Z", "2026-11-30T02:00:00Z"],
    ["America/Los_Angeles", "2026-11-02T02:00:00.000Z", "2026-11-01", "2026-10-26T01:00:00Z", "2026-11-02T02:00:00Z", "2026-11-09T02:00:00Z"],
    ["America/Los_Angeles", "2026-11-02T01:00:00.000Z", "2026-10-25", "2026-10-19T01:00:00Z", "2026-10-26T01:00:00Z", "2026-11-02T02:00:00Z"],
    ["America/Los_Angeles", "2027-03-15T01:00:00.000Z", "2027-03-14", "2027-03-08T02:00:00Z", "2027-03-15T01:00:00Z", "2027-03-22T01:00:00Z"],
    ["America/Los_Angeles", "2027-03-15T00:59:59.999Z", "2027-03-07", "2027-03-01T02:00:00Z", "2027-03-08T02:00:00Z", "2027-03-15T01:00:00Z"],
    ["Asia/Tokyo", "2026-11-22T09:00:00.000Z", "2026-11-22", "2026-11-15T09:00:00Z", "2026-11-22T09:00:00Z", "2026-11-29T09:00:00Z"],
    ["Asia/Kolkata", "2026-11-22T12:30:00.000Z", "2026-11-22", "2026-11-15T12:30:00Z", "2026-11-22T12:30:00Z", "2026-11-29T12:30:00Z"],
    ["Pacific/Kiritimati", "2026-11-22T04:00:00.000Z", "2026-11-22", "2026-11-15T04:00:00Z", "2026-11-22T04:00:00Z", "2026-11-29T04:00:00Z"],
    ["Europe/London", "2027-03-28T17:00:00.000Z", "2027-03-28", "2027-03-21T18:00:00Z", "2027-03-28T17:00:00Z", "2027-04-04T17:00:00Z"],
    ["UTC", "2026-12-31T23:59:59.999Z", "2026-12-27", "2026-12-20T18:00:00Z", "2026-12-27T18:00:00Z", "2027-01-03T18:00:00Z"],
  ] as const) {
    it(`[B6.clock.week.${zone}.${at}] resolves the most recent Sunday 6:00 PM in the group's timezone and the seven local days before it`, () => {
      expect(recapWeek(zone, Date.parse(at))).toEqual({ localDate, startsAt: Date.parse(startsAt), endsAt: Date.parse(endsAt), nextAt: Date.parse(nextAt) });
    });
  }

  it("[B6.clock.unreadable] has no recap week for an unreadable timezone or time", () => {
    expect(recapWeek("Synthetic/Invalid", sunday)).toBeNull();
    expect(recapWeek("UTC", Number.NaN)).toBeNull();
  });

  it("[B6.cron.registered] runs the recap worker from one scheduled job", () => {
    const jobs = Object.values(crons.crons).filter((job) => job.name === "v0Jobs:recaps");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toEqual({ type: "interval", minutes: 1 });
  });
});

describe("B6 weekly recap worker: one recap per group per week", () => {
  it("[B6.recap.fixed-local-weekday] sends nothing before Sunday 6:00 PM group time and one recap at that minute", async () => {
    const f = await fixture();
    await credit(f, "friend", 70, sunday - day);
    for (let at = T0 + minute; at < sunday; at += 3 * hour) {
      vi.setSystemTime(at);
      await run(f);
    }
    vi.setSystemTime(sunday - 1);
    await run(f);
    expect(await recaps(f)).toEqual([]);
    expect(await outbox(f)).toEqual([]);
    expect((await group(f)).nextRecapAt).toBe(sunday);
    vi.setSystemTime(sunday);
    expect(await run(f)).toMatchObject({ sent: 1 });
    const rows = await recaps(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ groupId: f.g1, startsAt: sunday - week, endsAt: sunday, createdAt: sunday, localDate: "2026-11-22" });
    expect((await group(f)).nextRecapAt).toBe(sunday + week);
    const sent = await outbox(f);
    expect(sent.map((row) => row.accountId).sort()).toEqual(await members(f));
    expect(sent).toHaveLength(5);
    for (const row of sent) expect(row).toMatchObject({ key: `recap:${f.g1}:2026-11-22:${row.accountId}`, kind: "recap", state: "pending", groupId: f.g1 });
    for (const row of sent) expect(row).not.toHaveProperty("betId");
  });

  it("[B6.recap.per-group-timezone] sends each group's recap at its own Sunday 6:00 PM", async () => {
    const f = await fixture();
    await credit(f, "friend", 70, tokyoSunday - day);
    await credit(f, "creator", 30, tokyoSunday - day, f.g2);
    vi.setSystemTime(tokyoSunday);
    await run(f);
    expect(await recaps(f)).toEqual([]);
    expect(await recaps(f, f.g2)).toMatchObject([{ startsAt: tokyoSunday - week, endsAt: tokyoSunday, localDate: "2026-11-22" }]);
    expect(await recipients(f, f.g2)).toEqual(await members(f, f.g2));
    expect(await outbox(f)).toEqual([]);
    vi.setSystemTime(sunday);
    await run(f);
    expect(await recaps(f)).toMatchObject([{ startsAt: sunday - week, endsAt: sunday }]);
    expect(await recaps(f, f.g2)).toHaveLength(1);
    expect(await recipients(f, f.g2)).toEqual(await members(f, f.g2));
  });

  it("[B6.recap.retries] sends one recap however many times the worker runs again that week", async () => {
    const f = await fixture();
    await credit(f, "friend", 70, sunday - day);
    vi.setSystemTime(sunday);
    await run(f);
    const [first, firstOutbox] = [await recaps(f), await outbox(f)];
    for (const later of [0, 1, minute, hour, 23 * hour, day, 3 * day, week - 1]) {
      vi.setSystemTime(sunday + later);
      await f.t.run((ctx) => ctx.db.patch(f.g1, { nextRecapAt: later % 2 ? undefined : sunday }));
      expect(await run(f)).toMatchObject({ sent: 0 });
      expect(await recaps(f)).toEqual(first);
      expect(await outbox(f)).toEqual(firstOutbox);
    }
  });

  it("[B6.recap.duplicate-workers] sends one recap when several workers run at the same moment", async () => {
    const f = await fixture();
    await credit(f, "friend", 70, sunday - day);
    vi.setSystemTime(sunday + minute);
    const results = await Promise.all(Array.from({ length: 12 }, () => run(f)));
    expect(results.reduce((total, result) => total + result.sent, 0)).toBe(1);
    expect(await recaps(f)).toHaveLength(1);
    const sent = await outbox(f);
    expect(sent).toHaveLength(5);
    expect(new Set(sent.map((row) => row.key)).size).toBe(5);
  });

  for (const [name, late, expected] of [["one-minute", minute, 1], ["three-hours", 3 * hour, 1], ["just-under-a-day", day - 1, 1], ["a-day", day, 0], ["three-days", 3 * day, 0]] as const) {
    it(`[B6.recap.late-worker.${name}] a worker that first runs late sends that week's recap once if less than a day late, and otherwise skips the week`, async () => {
      const f = await fixture();
      await credit(f, "friend", 70, sunday - day);
      await credit(f, "creator", 900, sunday + 30_000);
      vi.setSystemTime(sunday + late);
      expect(await run(f)).toMatchObject({ sent: expected });
      const rows = await recaps(f);
      expect(rows).toHaveLength(expected);
      if (expected) expect(rows[0]).toMatchObject({ startsAt: sunday - week, endsAt: sunday, createdAt: sunday + late, localDate: "2026-11-22" });
      expect(await outbox(f)).toHaveLength(expected * 5);
      expect((await group(f)).nextRecapAt).toBe(sunday + week);
      await run(f);
      expect(await recaps(f)).toHaveLength(expected);
      vi.setSystemTime(sunday + week);
      await run(f);
      const next = await recaps(f);
      expect(next).toHaveLength(expected + 1);
      expect(next.at(-1)).toMatchObject({ startsAt: sunday, endsAt: sunday + week, localDate: "2026-11-29" });
    });
  }

  it("[B6.recap.late-worker.outage] sends only the most recent week after a worker outage of several weeks", async () => {
    const f = await fixture();
    for (const weeks of [0, 1, 2, 3]) await credit(f, "friend", 10, sunday + weeks * week - day);
    vi.setSystemTime(sunday + 3 * week + 2 * hour);
    expect(await run(f)).toMatchObject({ sent: 1 });
    await run(f);
    expect(await recaps(f)).toMatchObject([{ startsAt: sunday + 2 * week, endsAt: sunday + 3 * week, localDate: "2026-12-13" }]);
    expect(await outbox(f)).toHaveLength(5);
  });

  for (const [name, at, startsAt, falseStart] of [
    ["spring-forward", "2027-03-15T01:00:00Z", "2027-03-08T02:00:00Z", "2027-03-15T00:59:59.999Z"],
    ["fall-back", "2027-11-08T02:00:00Z", "2027-11-01T01:00:00Z", "2027-11-08T01:00:00Z"],
  ] as const) {
    it(`[B6.recap.dst.${name}] sends one recap at 6:00 PM local time in a week when the clocks change`, async () => {
      const f = await fixture();
      const [endsAt, begins] = [Date.parse(at), Date.parse(startsAt)];
      expect(endsAt - begins).toBe(name === "spring-forward" ? week - hour : week + hour);
      await credit(f, "friend", 70, begins);
      await credit(f, "friend", 5, endsAt + week - hour);
      vi.setSystemTime(Date.parse(falseStart));
      await run(f);
      expect((await recaps(f)).filter((row) => row.endsAt >= begins)).toEqual([]);
      await f.t.run(async (ctx) => { for (const row of await ctx.db.query("v0Recaps").collect()) await ctx.db.delete(row._id); for (const row of await ctx.db.query("v0Outbox").collect()) await ctx.db.delete(row._id); });
      for (const later of [0, hour, 2 * hour, 26 * hour]) {
        vi.setSystemTime(endsAt + later);
        await run(f);
        expect(await recaps(f)).toMatchObject([{ startsAt: begins, endsAt, localDate: at.slice(0, 8) + (name === "spring-forward" ? "14" : "07") }]);
        expect(await outbox(f)).toHaveLength(5);
      }
      vi.setSystemTime(endsAt + week);
      await run(f);
      expect(await recaps(f)).toMatchObject([{ endsAt }, { startsAt: endsAt, endsAt: endsAt + week }]);
      expect(await outbox(f)).toHaveLength(10);
    });
  }

  for (const [name, from, to, firstAt, secondAt] of [
    ["west-to-east", "America/Los_Angeles", "Asia/Tokyo", sunday, sunday + minute],
    ["east-to-west", "Asia/Tokyo", "America/Los_Angeles", tokyoSunday, sunday],
    ["date-line", "Pacific/Kiritimati", "Pacific/Pago_Pago", Date.parse("2026-11-22T04:00:00Z"), Date.parse("2026-11-23T05:00:00Z")],
  ] as const) {
    it(`[B6.recap.timezone-change.${name}] sends no second recap for the same week when the group's timezone changes`, async () => {
      const f = await fixture();
      await credit(f, "friend", 70, firstAt - day);
      await credit(f, "friend", 20, firstAt + hour);
      await f.t.run((ctx) => ctx.db.patch(f.g1, { timezone: from }));
      vi.setSystemTime(firstAt);
      await run(f);
      const first = await recaps(f);
      expect(first).toMatchObject([{ endsAt: firstAt, localDate: "2026-11-22" }]);
      const sent = await outbox(f);
      await f.t.run((ctx) => ctx.db.patch(f.g1, { timezone: to, nextRecapAt: undefined }));
      for (const at of [firstAt + 1, secondAt, secondAt + hour]) {
        vi.setSystemTime(at);
        expect(await run(f)).toMatchObject({ sent: 0 });
      }
      expect(await recaps(f)).toEqual(first);
      expect(await outbox(f)).toEqual(sent);
      const next = recapWeek(to, secondAt + hour)!.nextAt;
      expect((await group(f)).nextRecapAt).toBe(next);
      await credit(f, "friend", 20, next - day);
      vi.setSystemTime(next);
      await run(f);
      const both = await recaps(f);
      expect(both).toHaveLength(2);
      expect(both[1]).toMatchObject({ startsAt: Math.max(firstAt, next - week), endsAt: next, localDate: "2026-11-29" });
    });
  }

  it("[B6.recap.empty-week] sends no recap for a week in which no result was scored", async () => {
    const f = await fixture();
    await credit(f, "friend", 70, sunday - week - 1);
    await credit(f, "friend", 70, sunday);
    await credit(f, "creator", 70, sunday - day, f.g2);
    vi.setSystemTime(sunday);
    await run(f);
    expect(await recaps(f)).toEqual([]);
    expect(await outbox(f)).toEqual([]);
    expect((await group(f)).nextRecapAt).toBe(sunday + week);
  });

  it("[B6.recap.new-group] sends no recap for a week that ended before the group existed", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.g1, { createdAt: sunday }));
    await credit(f, "friend", 70, sunday - day);
    vi.setSystemTime(sunday + hour);
    expect(await run(f)).toMatchObject({ sent: 0 });
    expect(await recaps(f)).toEqual([]);
    expect(await outbox(f)).toEqual([]);
  });

  it("[B6.recap.unreadable-timezone] sends nothing for a group whose timezone cannot be read and checks again a day later", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.g1, { timezone: "Synthetic/Invalid" }));
    await credit(f, "friend", 70, sunday - day);
    vi.setSystemTime(sunday);
    await run(f);
    expect(await recaps(f)).toEqual([]);
    expect(await outbox(f)).toEqual([]);
    expect((await group(f)).nextRecapAt).toBe(sunday + day);
  });

  it("[B6.recap.recipient-preferences] sends only to current members who have notifications on", async () => {
    const f = await fixture();
    await credit(f, "friend", 70, sunday - day);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.actors.friend.id, { notificationsEnabled: false });
      await ctx.db.patch(f.actors.new.id, { deletedAt: sunday - hour });
      await ctx.db.insert("v0Memberships", { groupId: f.g1, accountId: f.actors.outsider.id, joinedAt: sunday + minute, alias: "Late joiner", points: 0, streak: 0 });
    });
    await f.t.mutation(api.v0Controls.leave, { token: f.actors.subject.token, groupId: f.g1, requestId: `${f.runId}_leave` });
    vi.setSystemTime(sunday + 2 * minute);
    await run(f);
    expect(await recaps(f)).toHaveLength(1);
    expect(await recipients(f)).toEqual([f.actors.creator.id, f.actors.revoked.id].sort());
  });

  it("[B6.recap.preference-at-delivery] withdraws a queued recap when the member turns notifications off, leaves, or a newer recap exists", async () => {
    const f = await fixture();
    await credit(f, "friend", 70, sunday - day);
    await credit(f, "friend", 70, sunday + day);
    vi.setSystemTime(sunday);
    await run(f);
    expect(await outbox(f)).toHaveLength(5);
    await f.t.run(async (ctx) => {
      for (const [index, role] of (["creator", "friend", "subject", "new"] as const).entries()) await ctx.db.insert("v0PushTokens", { accountId: f.actors[role].id, deviceId: f.actors[role].deviceId, token: `a${index}`.repeat(32), environment: "sandbox", updatedAt: T0 });
    });
    await f.t.mutation(api.v0Notifications.setPreferences, { token: f.actors.friend.token, enabled: false, requestId: `${f.runId}_off` });
    await f.t.mutation(api.v0Controls.leave, { token: f.actors.subject.token, groupId: f.g1, requestId: `${f.runId}_leave` });
    const claimed = await f.t.mutation(internal.v0Notifications.claimBatch, {});
    expect(claimed).toHaveLength(2);
    expect(await recipients(f)).toEqual([f.actors.creator.id, f.actors.revoked.id, f.actors.new.id].sort());
    await f.t.run(async (ctx) => { for (const row of await ctx.db.query("v0Outbox").collect()) await ctx.db.patch(row._id, { state: "pending", leaseUntil: undefined, availableAt: sunday }); });
    vi.setSystemTime(sunday + week);
    await run(f);
    const fresh = await f.t.mutation(internal.v0Notifications.claimBatch, {});
    expect(fresh).toHaveLength(2);
    const left = await outbox(f);
    expect(left).toHaveLength(3);
    for (const row of left) expect(row.key).toContain(":2026-11-29:");
  });

  it("[B6.recap.read] produces the recap the group reads, with each member's points for the week and no sealed content", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.bet, { state: "finalized", outcome: 0 }));
    await credit(f, "friend", 70, sunday - week - 1);
    await credit(f, "friend", 70, T0);
    await credit(f, "friend", 30, sunday - 1);
    await credit(f, "creator", 55, sunday - day);
    await credit(f, "creator", 400, sunday);
    vi.setSystemTime(sunday);
    await run(f);
    const [row] = await recaps(f);
    for (const viewer of ["creator", "friend"] as const) {
      const recap = await f.t.query(api.v0Groups.recap, { token: f.actors[viewer].token, groupId: f.g1 });
      expect(recap).toMatchObject({ id: row._id, groupId: f.g1, startsAt: T0 - 60_000, endsAt: sunday, policy: { status: "approved", version: "v0-policy.3" } });
      expect(recap!.rows.map((entry) => [entry.accountId, entry.points])).toEqual([[f.actors.friend.id, 100], [f.actors.creator.id, 55]]);
      noPrivateValues(recap, f.privateValues);
    }
    noPrivateValues(await outbox(f), f.privateValues);
    noPrivateValues(await recaps(f), f.privateValues);
    expect(await f.t.query(api.v0Groups.recap, { token: f.actors.creator.token, groupId: f.g2 })).toBeNull();
  });
});
