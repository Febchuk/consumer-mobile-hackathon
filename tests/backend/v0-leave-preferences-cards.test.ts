import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { queueNotification } from "../../convex/v0Notifications";
import { hash } from "../../convex/v0Policy";
import { expectCode } from "./auth-support/errors";
import { REVEAL, T0 } from "./fixture";
import { v0Fixture } from "./v0-fixture";

type Fixture = Awaited<ReturnType<typeof v0Fixture>>;
type Role = keyof Fixture["actors"];
const createRef = makeFunctionReference<"mutation">("v0Bets:create");
const pickAt = T0 + 60_000;
const leaveAt = T0 + 120_000;

async function seedBet(f: Fixture, name: string, patch: Partial<Omit<Doc<"v0Bets">, "_id" | "_creationTime">> = {}) {
  return await f.t.run(async (ctx) => ctx.db.insert("v0Bets", { groupId: f.g1, creatorId: f.actors.creator.id, subjectId: f.actors.subject.id, createdAt: T0, question: "Will they suggest a song before the reveal?", contextLine: "A synthetic evening", format: "yes_no", options: ["Yes", "No"], source: "manual", state: "open", cutoffAt: REVEAL, revealAt: REVEAL, locator: await hash(f.runId + ":" + name), ...patch }));
}

async function seedPick(f: Fixture, role: Role, betId: Id<"v0Bets">, groupId: Id<"v0Groups">, option = 0, confidence = 0.5) {
  return await f.t.run(async (ctx) => {
    const member = (await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", groupId).eq("accountId", f.actors[role].id)).collect()).find((row) => row.leftAt === undefined);
    return await ctx.db.insert("v0Picks", { betId, groupId, accountId: f.actors[role].id, membershipId: member!._id, option, confidence, placedAt: T0, updatedAt: T0 });
  });
}

async function joinG2(f: Fixture, role: Role) {
  await f.t.run((ctx) => ctx.db.insert("v0Memberships", { groupId: f.g2, accountId: f.actors[role].id, alias: "Synthetic G2 member", joinedAt: T0 - 60_000, points: 40, streak: 2 }));
}

async function rejoin(f: Fixture, role: Role) {
  await f.t.mutation(api.v0Groups.invite, { token: f.actors.creator.token, groupId: f.g1, phone: f.actors[role].phone, requestId: "reinvite-" + role });
  const invitation = (await f.t.query(api.v0Groups.invitations, { token: f.actors[role].token }))[0];
  expect(invitation).toBeDefined();
  await f.t.mutation(api.v0Groups.accept, { token: f.actors[role].token, inviteId: invitation.id, requestId: "reaccept-" + role });
  expect((await f.t.query(api.v0Auth.me, { token: f.actors[role].token })).groups.map((group) => group.id)).toContain(f.g1);
}

const leave = (f: Fixture, role: Role) => f.t.mutation(api.v0Controls.leave, { token: f.actors[role].token, groupId: f.g1, requestId: "leave-" + role });
const noBets = (f: Fixture, value: boolean, requestId: string) => f.t.mutation(api.v0Controls.update, { token: f.actors.subject.token, noBets: value, blockedTopics: [], hostedAiConsent: false, requestId });
const outbox = (f: Fixture) => f.t.run((ctx) => ctx.db.query("v0Outbox").collect());
const picks = (f: Fixture) => f.t.run((ctx) => ctx.db.query("v0Picks").collect());

describe("J8.1 no bets about me on every path that exists today", () => {
  for (const source of ["manual", "template", "history", "hosted_ai"] as const) {
    it("[J8.1.no-bets.create-" + source + "] refuses a bet about an opted-out subject before the creator gate, for any creator, and only while the preference is on", async () => {
      const f = await v0Fixture();
      const args = (role: Role, requestId: string) => ({ token: f.actors[role].token, groupId: f.g1, subjectId: f.actors.subject.id, question: "Will Sage bring a puzzle to the picnic?", contextLine: "A synthetic picnic", format: "yes_no", options: ["Yes", "No"], revealAt: REVEAL, source, requestId });
      await expectCode(f.t.mutation(createRef, args("creator", "before")), "FORBIDDEN");
      await noBets(f, true, "opt-out");
      const before = await f.t.run(async (ctx) => ({ bets: await ctx.db.query("v0Bets").collect(), turns: await ctx.db.query("v0Turns").collect(), outbox: await ctx.db.query("v0Outbox").collect() }));
      for (const role of ["creator", "friend"] as const) await expectCode(f.t.mutation(createRef, args(role, "during-" + role)), "NOT_AVAILABLE");
      expect(await f.t.run(async (ctx) => ({ bets: await ctx.db.query("v0Bets").collect(), turns: await ctx.db.query("v0Turns").collect(), outbox: await ctx.db.query("v0Outbox").collect() }))).toEqual(before);
      expect((await f.t.query(api.v0Groups.members, { token: f.actors.creator.token, groupId: f.g1 })).find((member) => member.accountId === f.actors.subject.id)).toMatchObject({ noBets: true });
      await noBets(f, false, "opt-in");
      await expectCode(f.t.mutation(createRef, args("creator", "after")), "FORBIDDEN");
    });
  }

  for (const useHostedAi of [false, true]) {
    it("[J8.1.no-bets.suggest-" + (useHostedAi ? "hosted" : "templates") + "] offers no idea about an opted-out subject and contacts no provider", async () => {
      const f = await v0Fixture();
      await f.t.mutation(api.v0Controls.update, { token: f.actors.creator.token, noBets: false, blockedTopics: [], hostedAiConsent: true, requestId: "consent" });
      vi.stubEnv("V0_HOSTED_AI_ENABLED", "true");
      vi.stubEnv("V0_HOSTED_AI_PROVIDER", "anthropic");
      vi.stubEnv("V0_HOSTED_AI_CONFIG_VERSION", "synthetic-offline-only");
      const request = { token: f.actors.creator.token, groupId: f.g1, subjectId: f.actors.subject.id, contextLine: "A synthetic picnic", useHostedAi };
      expect((await f.t.action(api.v0Suggestions.get, request)).suggestions.length).toBeGreaterThanOrEqual(3);
      await noBets(f, true, "opt-out");
      await expectCode(f.t.action(api.v0Suggestions.get, request), "NOT_AVAILABLE");
      await expectCode(f.t.action(api.v0Suggestions.get, { ...request, token: f.actors.friend.token }), "NOT_AVAILABLE");
      expect(fetch).not.toHaveBeenCalled();
    });
  }

  it("[J8.1.no-bets.open-bet-shutdown] ends every open bet about the subject at once: no pick, answer, reminder or reveal follows, and opting back in does not revive it", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(pickAt);
    await f.t.mutation(api.v0Bets.pick, { token: f.actors.friend.token, betId: f.bet, option: 0, confidence: 0.4, requestId: "friend-pick" });
    await f.t.run((ctx) => ctx.db.insert("v0Outbox", { key: f.runId + "_pending", groupId: f.g1, betId: f.bet, accountId: f.actors.friend.id, kind: "reveal", state: "pending", attempts: 0, availableAt: pickAt }));
    const optOutAt = pickAt + 1000;
    vi.setSystemTime(optOutAt);
    await noBets(f, true, "opt-out");
    expect(await f.t.run((ctx) => ctx.db.get(f.bet))).toMatchObject({ state: "voided" });
    expect(await picks(f)).toMatchObject([{ accountId: f.actors.friend.id, voidedAt: optOutAt }]);
    expect(await outbox(f)).toEqual([]);
    await expectCode(f.t.mutation(api.v0Bets.pick, { token: f.actors.creator.token, betId: f.bet, option: 1, confidence: 0.6, requestId: "creator-pick" }), "NOT_AVAILABLE");
    await expectCode(f.t.mutation(api.v0Bets.pick, { token: f.actors.friend.token, betId: f.bet, option: 0, confidence: 0.4, requestId: "friend-pick" }), "NOT_AVAILABLE");
    for (const kind of ["turn", "reveal", "result", "recap"] as const) {
      for (const role of ["creator", "friend", "subject"] as const) {
        expect(await f.t.run((ctx) => queueNotification(ctx, { key: "after-" + kind + "-" + role, accountId: f.actors[role].id, groupId: f.g1, betId: f.bet, kind }))).toBeNull();
      }
    }
    await noBets(f, false, "opt-in");
    vi.setSystemTime(REVEAL + 1000);
    expect(await f.t.mutation(internal.v0Jobs.sweep, {})).toEqual({ advanced: 0 });
    await expectCode(f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 0, requestId: "answer" }), "NOT_AVAILABLE");
    expect(await f.t.run((ctx) => ctx.db.get(f.bet))).toMatchObject({ state: "voided" });
    expect((await picks(f))[0].voidedAt).toBe(optOutAt);
    expect(await outbox(f)).toEqual([]);
    for (const role of ["creator", "friend", "subject"] as const) expect(await f.t.query(api.v0Bets.get, { token: f.actors[role].token, locator: f.locator })).toMatchObject({ view: "unavailable" });
  });
});

describe("J8.2 leaving a group voids the leaver's open picks", () => {
  it("[J8.2.leave.void-open-picks] voids only the leaver's open picks in that group, keeps settled and other-group picks, and lets the others keep playing", async () => {
    const f = await v0Fixture();
    await joinG2(f, "friend");
    const settled = await seedBet(f, "settled", { createdAt: T0 - 30_000, cutoffAt: T0 - 10_000, revealAt: T0 - 10_000, state: "finalized", outcome: 0, provisionalOutcome: 0, answeredAt: T0 - 9000, finalizedAt: T0 - 1000 });
    const secondOpen = await seedBet(f, "second-open");
    const elsewhere = await seedBet(f, "elsewhere", { groupId: f.g2, creatorId: f.actors.outsider.id, subjectId: f.actors.otherSubject.id });
    const settledPick = await seedPick(f, "friend", settled, f.g1);
    const secondPick = await seedPick(f, "friend", secondOpen, f.g1, 1, 0.8);
    const elsewherePick = await seedPick(f, "friend", elsewhere, f.g2);
    vi.setSystemTime(pickAt);
    await f.t.mutation(api.v0Bets.pick, { token: f.actors.friend.token, betId: f.bet, option: 0, confidence: 0.4, requestId: "friend-pick" });
    await f.t.mutation(api.v0Bets.pick, { token: f.actors.creator.token, betId: f.bet, option: 1, confidence: 0.6, requestId: "creator-pick" });
    expect((await f.t.query(api.v0Bets.get, { token: f.actors.creator.token, locator: f.locator })).card).toMatchObject({ bettorCount: 2 });
    const before = await picks(f);
    vi.setSystemTime(leaveAt);
    expect(await leave(f, "friend")).toEqual({ left: true });
    const after = await picks(f);
    expect(after).toHaveLength(before.length);
    for (const pick of after) {
      const original = before.find((row) => row._id === pick._id)!;
      const voided = pick.accountId === f.actors.friend.id && pick._id !== settledPick && pick._id !== elsewherePick;
      expect(pick).toEqual(voided ? { ...original, voidedAt: leaveAt } : original);
    }
    expect(after.find((pick) => pick._id === secondPick)?.voidedAt).toBe(leaveAt);
    expect(after.filter((pick) => pick.voidedAt !== undefined)).toHaveLength(2);
    for (const betId of [f.bet, secondOpen]) expect(await f.t.run((ctx) => ctx.db.get(betId))).toMatchObject({ state: "open" });
    expect(await f.t.run((ctx) => ctx.db.query("v0Ledger").collect())).toEqual([]);
    const card = (await f.t.query(api.v0Bets.get, { token: f.actors.creator.token, locator: f.locator })).card;
    expect(card).toMatchObject({ bettorCount: 1, bettorInitials: ["C"] });
    await expectCode(f.t.mutation(api.v0Bets.pick, { token: f.actors.friend.token, betId: f.bet, option: 0, confidence: 0.4, requestId: "friend-pick" }), "NOT_AVAILABLE");
    await expectCode(f.t.mutation(api.v0Bets.pick, { token: f.actors.friend.token, betId: secondOpen, option: 0, confidence: 0.4, requestId: "friend-new-pick" }), "NOT_AVAILABLE");
    expect(await f.t.mutation(api.v0Bets.pick, { token: f.actors.creator.token, betId: f.bet, option: 1, confidence: 0.6, requestId: "creator-pick" })).toMatchObject({ saved: true, option: 1 });
    vi.setSystemTime(REVEAL + 1000);
    const revealed = await f.t.query(api.v0Bets.get, { token: f.actors.creator.token, locator: f.locator });
    if (revealed.view !== "bet") throw new Error("Expected the remaining bettor's revealed view");
    expect(revealed.picks.map((pick) => pick.accountId)).toEqual([f.actors.creator.id]);
    expect(await picks(f)).toEqual(after);
  });
});

describe("J9.2 no settlement rights, reminders or old state after leaving", () => {
  it("[J9.2.no-settlement-after-leave.challenge] gives a former bettor no challenge on a retained bet, by a new request, a replayed one, or after rejoining", async () => {
    const f = await v0Fixture();
    vi.setSystemTime(pickAt);
    await f.t.mutation(api.v0Bets.pick, { token: f.actors.friend.token, betId: f.bet, option: 0, confidence: 0.4, requestId: "friend-pick" });
    vi.setSystemTime(REVEAL + 1000);
    await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 1, requestId: "answer" });
    expect(await f.t.mutation(api.v0Bets.challenge, { token: f.actors.friend.token, betId: f.bet, requestId: "challenge-before-leaving" })).toEqual({ recorded: true });
    vi.setSystemTime(REVEAL + 2000);
    await leave(f, "friend");
    const before = await f.t.run(async (ctx) => ({ bet: await ctx.db.get(f.bet), challenges: await ctx.db.query("v0Challenges").collect(), ledger: await ctx.db.query("v0Ledger").collect() }));
    expect(before.bet).toMatchObject({ state: "provisional", provisionalOutcome: 1 });
    const attempt = async () => {
      for (const requestId of ["challenge-before-leaving", "challenge-after-leaving"]) await expectCode(f.t.mutation(api.v0Bets.challenge, { token: f.actors.friend.token, betId: f.bet, requestId }), "NOT_AVAILABLE");
      await expectCode(f.t.mutation(api.v0Bets.answer, { token: f.actors.friend.token, betId: f.bet, option: 0, requestId: "answer-as-former-member" }), "NOT_AVAILABLE");
      await expectCode(f.t.mutation(api.v0Bets.veto, { token: f.actors.friend.token, betId: f.bet, requestId: "veto-as-former-member" }), "NOT_AVAILABLE");
      await expectCode(f.t.query(api.v0Bets.get, { token: f.actors.friend.token, locator: f.locator }), "NOT_AVAILABLE");
      expect(await f.t.run(async (ctx) => ({ bet: await ctx.db.get(f.bet), challenges: await ctx.db.query("v0Challenges").collect(), ledger: await ctx.db.query("v0Ledger").collect() }))).toEqual(before);
    };
    await attempt();
    vi.setSystemTime(REVEAL + 3000);
    await rejoin(f, "friend");
    await attempt();
    expect(await f.t.mutation(api.v0Bets.challenge, { token: f.actors.creator.token, betId: f.bet, requestId: "current-member-challenge" })).toEqual({ recorded: true });
  });

  for (const answered of [false, true]) {
    it("[J9.2.no-settlement-after-leave.subject-" + (answered ? "answered" : "unanswered") + "] voids a retained bet when its subject leaves and accepts no answer, veto or proof from them afterwards, even after rejoining", async () => {
      const f = await v0Fixture();
      vi.setSystemTime(REVEAL + 1000);
      if (answered) await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 1, requestId: "answer" });
      vi.setSystemTime(REVEAL + 2000);
      await leave(f, "subject");
      const voided = await f.t.run((ctx) => ctx.db.get(f.bet));
      expect(voided).toMatchObject({ state: "voided" });
      for (const field of ["provisionalOutcome", "outcome", "answeredAt", "challengeDeadline"] as const) expect(voided).not.toHaveProperty(field);
      const attempt = async () => {
        for (const token of [f.actors.subject.token, f.actors.alias.token]) {
          for (const requestId of ["answer", "answer-after-leaving"]) await expectCode(f.t.mutation(api.v0Bets.answer, { token, betId: f.bet, option: 1, requestId }), "NOT_AVAILABLE");
          await expectCode(f.t.mutation(api.v0Bets.veto, { token, betId: f.bet, requestId: "veto-after-leaving" }), "NOT_AVAILABLE");
          await expectCode(f.t.query(api.v0Proof.list, { token, betId: f.bet }), "NOT_AVAILABLE");
        }
        expect(await f.t.run((ctx) => ctx.db.get(f.bet))).toEqual(voided);
        expect(await f.t.run((ctx) => ctx.db.query("v0Ledger").collect())).toEqual([]);
      };
      await attempt();
      vi.setSystemTime(REVEAL + 3000);
      await rejoin(f, "subject");
      await attempt();
      await expectCode(f.t.mutation(api.v0Bets.challenge, { token: f.actors.friend.token, betId: f.bet, requestId: "challenge-voided" }), "NOT_AVAILABLE");
    });
  }

  it("[J9.2.no-reminders.after-leave] deletes the leaver's queued reminders for that group, queues none afterwards, and sends them no reveal, even after rejoining", async () => {
    const f = await v0Fixture();
    await joinG2(f, "friend");
    vi.setSystemTime(pickAt);
    await f.t.mutation(api.v0Bets.pick, { token: f.actors.friend.token, betId: f.bet, option: 0, confidence: 0.4, requestId: "friend-pick" });
    await f.t.mutation(api.v0Bets.pick, { token: f.actors.creator.token, betId: f.bet, option: 1, confidence: 0.6, requestId: "creator-pick" });
    const kept = await f.t.run(async (ctx) => {
      const row = (key: string, extra: Partial<Doc<"v0Outbox">>) => ctx.db.insert("v0Outbox", { key: f.runId + "_" + key, accountId: f.actors.friend.id, kind: "reveal", state: "pending", attempts: 0, availableAt: pickAt, ...extra });
      await row("turn", { groupId: f.g1, kind: "turn" });
      await row("recap", { groupId: f.g1, kind: "recap", state: "failed", attempts: 6 });
      await row("reveal", { groupId: f.g1, betId: f.bet });
      await row("result", { groupId: f.g1, betId: f.bet, kind: "result", state: "delivering", attempts: 1, leaseUntil: pickAt + 120_000 });
      return [await row("other-group", { groupId: f.g2, kind: "recap" }), await row("other-member", { groupId: f.g1, betId: f.bet, accountId: f.actors.creator.id })];
    });
    vi.setSystemTime(leaveAt);
    await leave(f, "friend");
    expect((await outbox(f)).map((row) => row._id).sort()).toEqual([...kept].sort());
    const refused = async (label: string) => {
      for (const kind of ["turn", "recap"] as const) expect(await f.t.run((ctx) => queueNotification(ctx, { key: label + "-" + kind, accountId: f.actors.friend.id, groupId: f.g1, kind }))).toBeNull();
      for (const kind of ["reveal", "result"] as const) expect(await f.t.run((ctx) => queueNotification(ctx, { key: label + "-" + kind, accountId: f.actors.friend.id, groupId: f.g1, betId: f.bet, kind }))).toBeNull();
    };
    await refused("left");
    vi.setSystemTime(REVEAL);
    expect(await f.t.mutation(internal.v0Jobs.sweep, {})).toEqual({ advanced: 1 });
    const revealRows = (await outbox(f)).filter((row) => !kept.includes(row._id));
    expect(revealRows.map((row) => row.accountId).sort()).toEqual([f.actors.subject.id, f.actors.creator.id].sort());
    expect((await outbox(f)).filter((row) => row.accountId === f.actors.friend.id).map((row) => row.groupId)).toEqual([f.g2]);
    vi.setSystemTime(REVEAL + 1000);
    await rejoin(f, "friend");
    for (const kind of ["reveal", "result"] as const) expect(await f.t.run((ctx) => queueNotification(ctx, { key: "rejoined-" + kind, accountId: f.actors.friend.id, groupId: f.g1, betId: f.bet, kind }))).toBeNull();
    expect((await outbox(f)).filter((row) => row.accountId === f.actors.friend.id).map((row) => row.groupId)).toEqual([f.g2]);
  });

  it("[J9.2.cascade.leave-and-rejoin] closes the membership interval with its links, invitations and turns, leaves the other group alone, and starts a clean interval on rejoining", async () => {
    const f = await v0Fixture();
    await joinG2(f, "friend");
    await f.t.mutation(api.v0Groups.linkConversation, { token: f.actors.friend.token, groupId: f.g1, conversationKey: "g1-conversation", requestId: "link-g1" });
    await f.t.mutation(api.v0Groups.linkConversation, { token: f.actors.friend.token, groupId: f.g2, conversationKey: "g2-conversation", requestId: "link-g2" });
    await f.t.mutation(api.v0Groups.invite, { token: f.actors.friend.token, groupId: f.g1, phone: "+12025550177", requestId: "friend-invite" });
    const turns = await f.t.run(async (ctx) => {
      const turn = (localDate: string, creator: Role, subject: Role, status: Doc<"v0Turns">["status"]) => ctx.db.insert("v0Turns", { groupId: f.g1, localDate, creatorId: f.actors[creator].id, subjectId: f.actors[subject].id, status, assignedAt: T0 - 1000, passAt: T0 + 60_000 });
      return { asCreator: await turn("2026-11-16", "friend", "subject", "assigned"), asSubject: await turn("2026-11-15", "creator", "friend", "passed"), done: await turn("2026-11-14", "friend", "subject", "created"), unrelated: await turn("2026-11-13", "creator", "subject", "assigned") };
    });
    const g2Before = await f.t.run(async (ctx) => ({ members: await ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", f.g2)).collect(), board: await ctx.runQuery(api.v0Groups.board, { token: f.actors.creator.token, groupId: f.g2 }) }));
    const fixtureInvite = await f.t.run((ctx) => ctx.db.get(f.invite));
    vi.setSystemTime(leaveAt);
    await leave(f, "friend");
    const state = await f.t.run(async (ctx) => ({
      memberships: await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.friend.id)).collect(),
      links: await ctx.db.query("v0ConversationLinks").collect(),
      invites: await ctx.db.query("v0Invites").collect(),
      turns: Object.fromEntries(await Promise.all(Object.entries(turns).map(async ([name, id]) => [name, (await ctx.db.get(id))?.status]))),
    }));
    expect(state.memberships).toMatchObject([{ leftAt: leaveAt, joinedAt: T0 - 60_000, points: 1000 }]);
    expect(state.links.map((link) => link.groupId)).toEqual([f.g2]);
    expect(state.invites.find((row) => row.inviterId === f.actors.friend.id)).toMatchObject({ revokedAt: leaveAt });
    expect(state.invites.find((row) => row._id === f.invite)).toEqual(fixtureInvite);
    expect(state.turns).toEqual({ asCreator: "expired", asSubject: "expired", done: "created", unrelated: "assigned" });
    expect(await f.t.query(api.v0Groups.resolveConversation, { token: f.actors.friend.token, conversationKey: "g1-conversation" })).toBeNull();
    expect(await f.t.query(api.v0Groups.resolveConversation, { token: f.actors.friend.token, conversationKey: "g2-conversation" })).toEqual({ groupId: f.g2 });
    expect((await f.t.query(api.v0Auth.me, { token: f.actors.friend.token })).groups.map((group) => group.id)).toEqual([f.g2]);
    expect((await f.t.query(api.v0Groups.members, { token: f.actors.creator.token, groupId: f.g1 })).map((member) => member.accountId)).not.toContain(f.actors.friend.id);
    expect(await f.t.run(async (ctx) => ({ members: await ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", f.g2)).collect(), board: await ctx.runQuery(api.v0Groups.board, { token: f.actors.creator.token, groupId: f.g2 }) }))).toEqual(g2Before);
    await expectCode(f.t.mutation(api.v0Controls.leave, { token: f.actors.friend.token, groupId: f.g1, requestId: "leave-again" }), "NOT_AVAILABLE");
    const rejoinAt = leaveAt + 60_000;
    vi.setSystemTime(rejoinAt);
    await rejoin(f, "friend");
    const rows = await f.t.run((ctx) => ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.friend.id)).collect());
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.leftAt !== undefined)).toMatchObject({ leftAt: leaveAt, points: 1000 });
    expect(rows.find((row) => row.leftAt === undefined)).toMatchObject({ joinedAt: rejoinAt, points: 0, streak: 0 });
    expect(await f.t.query(api.v0Groups.resolveConversation, { token: f.actors.friend.token, conversationKey: "g1-conversation" })).toBeNull();
    expect(await f.t.query(api.v0Bets.list, { token: f.actors.friend.token, groupId: f.g1 })).toEqual([]);
    expect((await f.t.run((ctx) => ctx.db.get(turns.asCreator)))?.status).toBe("expired");
  });
});

describe("J4.1 and SEC3 shared card representation before reveal", () => {
  const viewers = ["creator", "friend", "subject", "alias"] as const;

  async function cards(f: Fixture) {
    const result: Record<string, unknown> = {};
    for (const role of viewers) result[role] = (await f.t.query(api.v0Bets.get, { token: f.actors[role].token, locator: f.locator })).card;
    return result;
  }

  it("[J4.1.card-sentinel-scan] serializes one identical card for every viewer with bettor initials and a count only: no question, option, context, proof, side, confidence or session", async () => {
    const f = await v0Fixture();
    const creatorPick = await seedPick(f, "creator", f.bet, f.g1, 0, 0.93);
    const friendPick = await seedPick(f, "friend", f.bet, f.g1, 1, 0.07);
    vi.setSystemTime(REVEAL - 1);
    const first = await cards(f);
    const card = first.creator as Record<string, unknown>;
    expect(Object.keys(card).sort()).toEqual(["accessibilityLabel", "bettorCount", "bettorInitials", "caption", "subjectAlias", "url"]);
    expect(card).toEqual({ url: "https://cards.e2e.invalid/c/" + f.locator, caption: "Secret bet on Sage", accessibilityLabel: "Called It card. Secret bet on Sage", subjectAlias: "Sage", bettorCount: 2, bettorInitials: ["C", "F"] });
    for (const role of viewers) expect(first[role]).toEqual(card);
    const url = new URL(card.url as string);
    expect([url.protocol, url.username, url.password, url.search, url.hash, url.port]).toEqual(["https:", "", "", "", "", ""]);
    const serialized = JSON.stringify(first);
    for (const secret of [...f.privateValues, ...Object.values(f.actors).flatMap((actor) => [actor.token, actor.id, actor.phone, actor.deviceId]), f.g1, f.bet, f.runId, "0.93", "0.07", "option", "confidence"]) expect(serialized).not.toContain(secret);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(creatorPick, { option: 1, confidence: 0.07 });
      await ctx.db.patch(friendPick, { option: 0, confidence: 0.93 });
    });
    expect(await cards(f)).toEqual(first);
    const sealed = await f.t.query(api.v0Bets.get, { token: f.actors.subject.token, locator: f.locator });
    expect(Object.keys(sealed).sort()).toEqual(["betId", "canVeto", "card", "cutoffAt", "groupId", "revealAt", "serverTime", "state", "view"]);
    const listed = await f.t.query(api.v0Bets.list, { token: f.actors.subject.token, groupId: f.g1 });
    expect(listed.map((view) => view.card)).toEqual([card]);
    for (const secret of f.privateValues) expect(JSON.stringify(listed)).not.toContain(secret);
  });

  it("[J4.1.card-voiceover-label] gives VoiceOver the same neutral sentence as the caption, in every bet state and for every viewer", async () => {
    const f = await v0Fixture();
    await seedPick(f, "friend", f.bet, f.g1, 1, 0.8);
    await f.t.mutation(api.v0Controls.alias, { token: f.actors.subject.token, groupId: f.g1, alias: "Sagebrush", requestId: "alias" });
    const check = async () => {
      for (const role of viewers) {
        const card = (await f.t.query(api.v0Bets.get, { token: f.actors[role].token, locator: f.locator })).card;
        expect(card.caption).toBe("Secret bet on Sagebrush");
        expect(card.accessibilityLabel).toBe("Called It card. Secret bet on Sagebrush");
        for (const secret of f.privateValues) expect(JSON.stringify(card)).not.toContain(secret);
      }
    };
    await check();
    vi.setSystemTime(REVEAL + 1000);
    await check();
    await f.t.mutation(api.v0Bets.answer, { token: f.actors.subject.token, betId: f.bet, option: 0, requestId: "answer" });
    await check();
    await leave(f, "subject");
    const afterLeave = (await f.t.query(api.v0Bets.get, { token: f.actors.friend.token, locator: f.locator })).card;
    expect(afterLeave).toMatchObject({ caption: "Secret bet on a friend", accessibilityLabel: "Called It card. Secret bet on a friend", bettorCount: 0, bettorInitials: [] });
  });

  it("[SEC3.shared-payload.card-link] answers a real card link exactly like an unknown one, with no group, member or bet content, signed in or not", async () => {
    const f = await v0Fixture();
    await seedPick(f, "friend", f.bet, f.g1, 1, 0.8);
    const unknown = await (await f.t.fetch("/c/" + "0".repeat(64), { method: "GET" })).text();
    for (const headers of [{}, { Authorization: "Bearer " + f.actors.creator.token }, { Cookie: "session=" + f.actors.friend.token }] as Record<string, string>[]) {
      for (const path of ["/c/" + f.locator, "/c/" + f.locator + "?token=" + f.actors.creator.token]) {
        const response = await f.t.fetch(path, { method: "GET", headers });
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
        const body = await response.text();
        expect(body).toBe(unknown);
        for (const secret of [...f.privateValues, f.locator, f.runId, "Sage", "Cora", "Finn", "ROOM_G1", f.actors.creator.token, f.actors.friend.token]) expect(body).not.toContain(secret);
      }
    }
  });
});
