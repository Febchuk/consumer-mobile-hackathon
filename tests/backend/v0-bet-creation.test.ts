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
const eightAm = T0 + minute;
const eightPm = Date.parse("2026-11-17T04:00:00Z");

const expectCode = (operation: Promise<unknown>, code: string) => expect(operation).rejects.toMatchObject({ data: { code } });

async function seedTurn(f: Fixture, patch: Record<string, unknown> = {}) {
  return await f.t.run((ctx) => ctx.db.insert("v0Turns", { groupId: f.g1, localDate: "2026-11-16", creatorId: f.actors.creator.id, subjectId: f.actors.subject.id, status: "assigned", assignedAt: T0 - 1000, passAt: T0 + 4 * 60 * minute + minute, ...patch } as never));
}

function args(f: Fixture, role: Role = "creator", patch: Record<string, unknown> = {}) {
  return { token: f.actors[role].token, groupId: f.g1, subjectId: f.actors.subject.id, question: "Will Sage bring a puzzle to the picnic?", contextLine: "A synthetic picnic", format: "yes_no" as const, options: ["Yes", "No"], source: "manual" as const, requestId: `${f.runId}_create`, ...patch } as Parameters<typeof f.t.mutation<typeof api.v0Bets.create>>[1];
}

const state = (f: Fixture) => f.t.run(async (ctx) => ({ bets: await ctx.db.query("v0Bets").collect(), turns: await ctx.db.query("v0Turns").collect(), requests: await ctx.db.query("v0Requests").collect(), outbox: await ctx.db.query("v0Outbox").collect(), ledger: await ctx.db.query("v0Ledger").collect(), members: await ctx.db.query("v0Memberships").collect() }));

describe("B1 bet creation under the approved creator, subject and reveal rules", () => {
  it("[B1.create.turn-holder] lets today's creator send one bet about the app-named subject with the default group-local reveal", async () => {
    const f = await v0Fixture();
    const turnId = await seedTurn(f);
    vi.setSystemTime(eightAm);
    const before = await state(f);
    const created = await f.t.mutation(api.v0Bets.create, args(f));
    const after = await state(f);
    expect(after.bets).toHaveLength(before.bets.length + 1);
    const bet = after.bets.find((row) => row._id === created.betId)!;
    expect(bet).toMatchObject({ groupId: f.g1, creatorId: f.actors.creator.id, subjectId: f.actors.subject.id, createdAt: eightAm, question: "Will Sage bring a puzzle to the picnic?", contextLine: "A synthetic picnic", format: "yes_no", options: ["Yes", "No"], source: "manual", state: "open", cutoffAt: eightPm, revealAt: eightPm, policyVersion: "v0-policy.3" });
    expect(bet).not.toHaveProperty("line");
    expect(bet.locator).toMatch(/^[a-f0-9]{64}$/);
    expect(created).toEqual({ betId: bet._id, groupId: f.g1, card: { url: `https://cards.e2e.invalid/c/${bet.locator}`, caption: "Secret bet on Sage", accessibilityLabel: "Called It card. Secret bet on Sage", subjectAlias: "Sage", bettorCount: 0, bettorInitials: [] } });
    expect(JSON.stringify(created)).not.toContain("puzzle");
    expect(after.turns).toEqual([{ ...before.turns[0], status: "created", betId: bet._id }]);
    expect(after.turns[0]._id).toBe(turnId);
    expect(after.ledger).toEqual([]);
    expect(after.outbox).toEqual([]);
    expect(after.members).toEqual(before.members);
    expect(await f.t.query(api.v0Bets.get, { token: f.actors.friend.token, locator: bet.locator })).toMatchObject({ view: "bet", state: "open", question: "Will Sage bring a puzzle to the picnic?", canPick: true, revealAt: eightPm });
    expect(await f.t.query(api.v0Bets.get, { token: f.actors.subject.token, locator: bet.locator })).toMatchObject({ view: "sealed", canVeto: true });
  });

  for (const role of ["friend", "subject", "revoked", "new", "left", "outsider"] as const) {
    it(`[B1.create.not-holder.${role}] refuses anyone who does not hold today's turn and writes nothing`, async () => {
      const f = await v0Fixture();
      await seedTurn(f);
      vi.setSystemTime(eightAm);
      const before = await state(f);
      const subjectId = role === "subject" ? f.actors.friend.id : f.actors.subject.id;
      await expectCode(f.t.mutation(api.v0Bets.create, args(f, role, { subjectId })), role === "friend" || role === "subject" || role === "new" ? "FORBIDDEN" : role === "revoked" ? "AUTH_REQUIRED" : "NOT_AVAILABLE");
      expect(await state(f)).toEqual(before);
    });
  }

  it("[B1.create.app-named-subject] refuses a subject other than the one the turn names", async () => {
    const f = await v0Fixture();
    await seedTurn(f);
    vi.setSystemTime(eightAm);
    const before = await state(f);
    await expectCode(f.t.mutation(api.v0Bets.create, args(f, "creator", { subjectId: f.actors.friend.id })), "FORBIDDEN");
    await expectCode(f.t.mutation(api.v0Bets.create, args(f, "creator", { subjectId: f.actors.creator.id })), "NOT_AVAILABLE");
    await expectCode(f.t.mutation(api.v0Bets.create, args(f, "creator", { subjectId: f.actors.outsider.id })), "NOT_AVAILABLE");
    expect(await state(f)).toEqual(before);
  });

  it("[B1.create.one-per-day] refuses a second bet in the same group on the same local day", async () => {
    const f = await v0Fixture();
    await seedTurn(f);
    vi.setSystemTime(eightAm);
    await f.t.mutation(api.v0Bets.create, args(f));
    const before = await state(f);
    vi.setSystemTime(eightAm + 5 * minute);
    await expectCode(f.t.mutation(api.v0Bets.create, args(f, "creator", { requestId: `${f.runId}_second`, question: "Will Sage suggest a board game?" })), "FORBIDDEN");
    await expectCode(f.t.mutation(api.v0Bets.create, args(f, "friend", { requestId: `${f.runId}_friend` })), "FORBIDDEN");
    expect(await state(f)).toEqual(before);
  });

  it("[B1.create.idempotent] returns the stored bet for a retried request and refuses a reused identifier with different content", async () => {
    const f = await v0Fixture();
    await seedTurn(f);
    vi.setSystemTime(eightAm);
    const first = await f.t.mutation(api.v0Bets.create, args(f));
    const before = await state(f);
    vi.setSystemTime(eightAm + 30 * minute);
    expect(await f.t.mutation(api.v0Bets.create, args(f))).toEqual(first);
    vi.setSystemTime(eightPm + minute);
    expect(await f.t.mutation(api.v0Bets.create, args(f))).toEqual(first);
    await expectCode(f.t.mutation(api.v0Bets.create, args(f, "creator", { question: "Will Sage suggest a board game?" })), "IDEMPOTENCY_CONFLICT");
    expect(await state(f)).toEqual(before);
    expect(before.bets.filter((bet) => bet._id === first.betId)).toHaveLength(1);
  });

  for (const [name, lead, ok] of [
    ["one-ms-short", approvedPolicy.customRevealMinLeadMs - 1, false],
    ["ten-minutes", approvedPolicy.customRevealMinLeadMs, true],
    ["one-hour", 60 * minute, true],
    ["seven-days", approvedPolicy.customRevealMaxLeadMs, true],
    ["one-ms-long", approvedPolicy.customRevealMaxLeadMs + 1, false],
    ["thirty-days", 30 * day, false],
  ] as const) {
    it(`[B1.create.custom-reveal.${name}] keeps a custom reveal between 10 minutes and 7 days ahead`, async () => {
      const f = await v0Fixture();
      await seedTurn(f);
      vi.setSystemTime(eightAm);
      expect(approvedPolicy.customRevealMinLeadMs).toBe(10 * minute);
      expect(approvedPolicy.customRevealMaxLeadMs).toBe(7 * day);
      const before = await state(f);
      const revealAt = eightAm + lead;
      if (!ok) {
        await expectCode(f.t.mutation(api.v0Bets.create, args(f, "creator", { revealAt })), "INVALID_INPUT");
        await expectCode(f.t.mutation(api.v0Bets.create, args(f, "creator", { revealAt, cutoffAt: revealAt })), "INVALID_INPUT");
        expect(await state(f)).toEqual(before);
        return;
      }
      const created = await f.t.mutation(api.v0Bets.create, args(f, "creator", { revealAt, cutoffAt: revealAt }));
      expect((await state(f)).bets.find((bet) => bet._id === created.betId)).toMatchObject({ revealAt, cutoffAt: revealAt, state: "open" });
    });
  }

  for (const [name, at, ok] of [["first-ms", eightAm, true], ["last-ms", eightPm - 1, true], ["eight-pm", eightPm, false], ["after-eight-pm", eightPm + minute, false]] as const) {
    it(`[B1.create.day-window.${name}] accepts today's bet only before 8:00 PM group time`, async () => {
      const f = await v0Fixture();
      await seedTurn(f);
      vi.setSystemTime(at);
      const before = await state(f);
      if (!ok) {
        await expectCode(f.t.mutation(api.v0Bets.create, args(f)), "FORBIDDEN");
        await expectCode(f.t.mutation(api.v0Bets.create, args(f, "creator", { revealAt: at + 60 * minute })), "FORBIDDEN");
        expect(await state(f)).toEqual(before);
        return;
      }
      const created = await f.t.mutation(api.v0Bets.create, args(f));
      expect((await state(f)).bets.find((bet) => bet._id === created.betId)).toMatchObject({ createdAt: at, revealAt: eightPm });
    });
  }

  for (const [name, leaving, ok] of [["two-members", ["friend", "revoked", "new"], false], ["three-members", ["revoked", "new"], true]] as const) {
    it(`[B1.create.small-group.${name}] needs at least 3 active members`, async () => {
      const f = await v0Fixture();
      await seedTurn(f);
      vi.setSystemTime(eightAm);
      expect(approvedPolicy.minActiveMembers).toBe(3);
      await f.t.run(async (ctx) => {
        for (const member of await ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", f.g1)).collect()) {
          if (leaving.some((role) => f.actors[role].id === member.accountId)) await ctx.db.patch(member._id, { leftAt: eightAm - 1 });
        }
      });
      const before = await state(f);
      if (!ok) {
        await expectCode(f.t.mutation(api.v0Bets.create, args(f)), "FORBIDDEN");
        expect(await state(f)).toEqual(before);
        return;
      }
      expect((await f.t.mutation(api.v0Bets.create, args(f))).groupId).toBe(f.g1);
    });
  }

  it("[B1.create.small-group.deleted-account] does not count a deleted account toward the 3 active members", async () => {
    const f = await v0Fixture();
    await seedTurn(f);
    vi.setSystemTime(eightAm);
    await f.t.run(async (ctx) => {
      for (const member of await ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", f.g1)).collect()) {
        if ([f.actors.revoked.id, f.actors.new.id].includes(member.accountId)) await ctx.db.patch(member._id, { leftAt: eightAm - 1 });
      }
      await ctx.db.patch(f.actors.friend.id, { deletedAt: eightAm - 1 });
    });
    const before = await state(f);
    await expectCode(f.t.mutation(api.v0Bets.create, args(f)), "FORBIDDEN");
    expect(await state(f)).toEqual(before);
  });

  for (const [format, options, line] of [["yes_no", ["Yes", "No"], undefined], ["over_under", ["Over", "Under"], 2.5], ["this_that", ["  A puzzle ", "A  board game"], undefined]] as const) {
    for (const source of ["manual", "template", "history"] as const) {
      it(`[B1.create.format.${format}.${source}] stores the validated two-choice bet with its source and context`, async () => {
        const f = await v0Fixture();
        await seedTurn(f);
        vi.setSystemTime(eightAm);
        const created = await f.t.mutation(api.v0Bets.create, args(f, "creator", { format, options: [...options], question: "  Will Sage bring a  puzzle to the picnic? ", contextLine: "  A synthetic   picnic ", source, ...(line === undefined ? {} : { line }) }));
        const bet = (await state(f)).bets.find((row) => row._id === created.betId)!;
        expect(bet).toMatchObject({ format, source, question: "Will Sage bring a puzzle to the picnic?", contextLine: "A synthetic picnic", options: format === "this_that" ? ["A puzzle", "A board game"] : [...options] });
        expect(bet.options).toHaveLength(2);
        expect(bet.line).toBe(line);
        const view = await f.t.query(api.v0Bets.get, { token: f.actors.friend.token, locator: bet.locator });
        expect(view).toMatchObject({ view: "bet", format, options: bet.options, ...(line === undefined ? {} : { line }) });
        expect(JSON.stringify(view)).not.toContain("synthetic picnic");
        expect(JSON.stringify(created)).not.toContain("synthetic picnic");
      });
    }
  }

  it("[B1.create.rate-bound] bounds creation per account per hour and recovers when the window ends", async () => {
    const f = await v0Fixture();
    await seedTurn(f);
    vi.setSystemTime(eightAm);
    await f.t.run((ctx) => ctx.db.insert("v0RateLimits", { key: `bets.create:${f.actors.creator.id}`, windowStart: eightAm - minute, count: 10 }));
    const before = await state(f);
    await expectCode(f.t.mutation(api.v0Bets.create, args(f)), "RATE_LIMITED");
    expect(await state(f)).toEqual(before);
    vi.setSystemTime(eightAm + 59 * minute);
    expect((await f.t.mutation(api.v0Bets.create, args(f))).groupId).toBe(f.g1);
    expect(await f.t.run((ctx) => ctx.db.query("v0RateLimits").withIndex("by_key", (q) => q.eq("key", `bets.create:${f.actors.creator.id}`)).unique())).toMatchObject({ count: 1, windowStart: eightAm + 59 * minute });
  });

  it("[B1.create.rate-bound.counts] counts each created bet against the hourly bound", async () => {
    const f = await v0Fixture();
    await seedTurn(f);
    vi.setSystemTime(eightAm);
    await f.t.run((ctx) => ctx.db.insert("v0RateLimits", { key: `bets.create:${f.actors.creator.id}`, windowStart: eightAm - minute, count: 9 }));
    await f.t.mutation(api.v0Bets.create, args(f));
    expect(await f.t.run((ctx) => ctx.db.query("v0RateLimits").withIndex("by_key", (q) => q.eq("key", `bets.create:${f.actors.creator.id}`)).unique())).toMatchObject({ count: 10 });
  });

  it("[B1.create.passed-turn] gives creation to the member the turn passed to and takes it from the first creator", async () => {
    const f = await v0Fixture();
    await seedTurn(f, { status: "passed", creatorId: f.actors.friend.id });
    vi.setSystemTime(eightAm);
    const before = await state(f);
    await expectCode(f.t.mutation(api.v0Bets.create, args(f)), "FORBIDDEN");
    expect(await state(f)).toEqual(before);
    const created = await f.t.mutation(api.v0Bets.create, args(f, "friend"));
    expect((await state(f)).bets.find((bet) => bet._id === created.betId)).toMatchObject({ creatorId: f.actors.friend.id, subjectId: f.actors.subject.id });
  });

  for (const status of ["created", "expired"] as const) {
    it(`[B1.create.closed-turn.${status}] refuses a turn that is already used or over`, async () => {
      const f = await v0Fixture();
      await seedTurn(f, { status });
      vi.setSystemTime(eightAm);
      const before = await state(f);
      await expectCode(f.t.mutation(api.v0Bets.create, args(f)), "FORBIDDEN");
      expect(await state(f)).toEqual(before);
    });
  }

  for (const [name, localDate] of [["yesterday", "2026-11-15"], ["tomorrow", "2026-11-17"]] as const) {
    it(`[B1.create.other-day.${name}] refuses a turn that belongs to another local date`, async () => {
      const f = await v0Fixture();
      await seedTurn(f, { localDate });
      vi.setSystemTime(eightAm);
      const before = await state(f);
      await expectCode(f.t.mutation(api.v0Bets.create, args(f)), "FORBIDDEN");
      expect(await state(f)).toEqual(before);
    });
  }

  for (const change of ["no-bets", "creator-blocks-subject", "subject-blocks-creator", "subject-left"] as const) {
    it(`[B1.create.subject-withdrawn.${change}] refuses a named subject who opted out, left or is blocked after the turn was assigned`, async () => {
      const f = await v0Fixture();
      await seedTurn(f);
      vi.setSystemTime(eightAm);
      await f.t.run(async (ctx) => {
        if (change === "no-bets") await ctx.db.patch(f.actors.subject.id, { noBets: true });
        if (change === "creator-blocks-subject") await ctx.db.insert("v0Blocks", { accountId: f.actors.creator.id, blockedId: f.actors.subject.id, createdAt: eightAm });
        if (change === "subject-blocks-creator") await ctx.db.insert("v0Blocks", { accountId: f.actors.subject.id, blockedId: f.actors.creator.id, createdAt: eightAm });
        if (change === "subject-left") {
          const member = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.subject.id)).unique();
          await ctx.db.patch(member!._id, { leftAt: eightAm - 1 });
        }
      });
      const before = await state(f);
      await expectCode(f.t.mutation(api.v0Bets.create, args(f)), "NOT_AVAILABLE");
      expect(await state(f)).toEqual(before);
    });
  }

  it("[B1.create.other-group] does not let a turn in one group create a bet in another", async () => {
    const f = await v0Fixture();
    await seedTurn(f);
    vi.setSystemTime(eightAm);
    const before = await state(f);
    await expectCode(f.t.mutation(api.v0Bets.create, args(f, "creator", { groupId: f.g2, subjectId: f.actors.otherSubject.id })), "FORBIDDEN");
    expect(await state(f)).toEqual(before);
  });

  for (const role of ["subject", "alias", "left", "outsider", "revoked"] as const) {
    it(`[B1.create.sealed.${role}] returns no question, option or context of a created bet to the subject or an outsider before reveal`, async () => {
      const f = await v0Fixture();
      await seedTurn(f);
      vi.setSystemTime(eightAm);
      const secrets = ["SEALEDQUESTIONSENTINEL", "SEALEDCHOICEALPHA", "SEALEDCHOICEBRAVO", "SEALEDCONTEXTSENTINEL"];
      const created = await f.t.mutation(api.v0Bets.create, args(f, "creator", { question: `Will Sage say ${secrets[0]}?`, options: [secrets[1], secrets[2]], contextLine: secrets[3], format: "this_that" }));
      const locator = (await state(f)).bets.find((bet) => bet._id === created.betId)!.locator;
      vi.setSystemTime(eightAm + minute);
      const token = f.actors[role].token;
      const reads: (() => Promise<unknown>)[] = [
        () => f.t.query(api.v0Bets.get, { token, locator }),
        () => f.t.query(api.v0Bets.list, { token, groupId: f.g1 }),
        () => f.t.query(api.v0Bets.history, { token, groupId: f.g1 }),
        () => f.t.query(api.v0Groups.turn, { token, groupId: f.g1 }),
        () => f.t.query(api.v0Groups.board, { token, groupId: f.g1 }),
        () => f.t.query(api.v0Groups.recap, { token, groupId: f.g1 }),
        () => f.t.query(api.v0Auth.me, { token }),
        () => f.t.mutation(api.v0Bets.create, args(f, role, { requestId: `${f.runId}_probe` })),
      ];
      for (const read of reads) {
        let body: unknown;
        try {
          body = await read();
        } catch (error) {
          body = `${String(error)} ${JSON.stringify((error as { data?: unknown }).data ?? null)}`;
          expect(body).not.toMatch(/(?:TypeError|ReferenceError|Could not find|ArgumentValidationError)/);
        }
        noPrivateValues(body, secrets);
      }
      const eligible = JSON.stringify(await f.t.query(api.v0Bets.get, { token: f.actors.friend.token, locator }));
      for (const secret of secrets.slice(0, 3)) expect(eligible).toContain(secret);
      expect(eligible).not.toContain(secrets[3]);
      expect(created.betId as Id<"v0Bets">).toBeDefined();
    });
  }
});
