import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { hash } from "../../convex/v0Policy";
import { noPrivateValues } from "./assertions";
import { T0 } from "./fixture";
import { v0Fixture } from "./v0-fixture";

describe("J1/J8/J9 real invited groups and controls", () => {
  it("[V0.group-create-idempotent] creates one explicit creator membership across retries", async () => {
    const f = await v0Fixture();
    const args = { token: f.actors.outsider.token, name: "Synthetic puzzle group", timezone: "Asia/Tokyo", requestId: `${f.runId}_create` };
    const first = await f.t.mutation(api.v0Groups.create, args);
    expect(await f.t.mutation(api.v0Groups.create, args)).toEqual(first);
    const members = await f.t.query(api.v0Groups.members, { token: args.token, groupId: first.id });
    expect(members.map((member) => member.accountId)).toEqual([f.actors.outsider.id]);
    await expect(f.t.mutation(api.v0Groups.create, { ...args, timezone: "UTC" })).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("[V0.invite-consent-interval] requires the targeted account and excludes pre-join bets after acceptance", async () => {
    const f = await v0Fixture();
    await expect(f.t.query(api.v0Bets.get, { token: f.actors.outsider.token, locator: f.locator })).rejects.toMatchObject({ data: { code: "NOT_AVAILABLE" } });
    expect(await f.t.query(api.v0Groups.invitations, { token: f.actors.unadmittedAlias.token })).toEqual([]);
    const invitations = await f.t.query(api.v0Groups.invitations, { token: f.actors.outsider.token });
    expect(invitations.map((invite) => invite.id)).toEqual([f.invite]);
    await expect(f.t.mutation(api.v0Groups.accept, { token: f.actors.unadmittedAlias.token, inviteId: f.invite, requestId: `${f.runId}_wrong` })).rejects.toMatchObject({ data: { code: "NOT_AVAILABLE" } });
    vi.setSystemTime(T0 + 2);
    const args = { token: f.actors.outsider.token, inviteId: f.invite, requestId: `${f.runId}_accept` };
    const group = await f.t.mutation(api.v0Groups.accept, args);
    expect(group.id).toBe(f.g1);
    expect(await f.t.mutation(api.v0Groups.accept, args)).toEqual(group);
    await expect(f.t.mutation(api.v0Groups.accept, { ...args, requestId: `${f.runId}_replay` })).rejects.toMatchObject({ data: { code: "NOT_AVAILABLE" } });
    await expect(f.t.query(api.v0Bets.get, { token: args.token, locator: f.locator })).rejects.toMatchObject({ data: { code: "NOT_AVAILABLE" } });
    expect(await f.t.query(api.v0Bets.list, { token: args.token, groupId: f.g1 })).toEqual([]);
  });

  it("[V0.invite-nonenumerating] never tells the inviter whether a phone already has an account", async () => {
    const f = await v0Fixture();
    const existing = await f.t.mutation(api.v0Groups.invite, { token: f.actors.creator.token, groupId: f.g1, phone: f.actors.outsider.phone, requestId: `${f.runId}_known` });
    const unknown = await f.t.mutation(api.v0Groups.invite, { token: f.actors.creator.token, groupId: f.g1, phone: "+12025550199", requestId: `${f.runId}_unknown` });
    expect(existing).toEqual({ invited: true });
    expect(unknown).toEqual(existing);
  });

  it("[V0.link-device-scope] isolates accounts/devices/conversations and refuses a silent conflicting link", async () => {
    const f = await v0Fixture();
    const tokenB = `synthetic_${f.runId}_creator_device_b`;
    await f.t.run(async (ctx) => { await ctx.db.insert("v0Sessions", { accountId: f.actors.creator.id, tokenHash: await hash(tokenB), deviceId: `${f.runId}_device_b`, createdAt: T0 - 1000, expiresAt: T0 + 60_000 }); });
    const conversationKey = `${f.runId}_chat_a`;
    const args = { token: f.actors.creator.token, groupId: f.g1, conversationKey, requestId: `${f.runId}_link` };
    expect(await f.t.mutation(api.v0Groups.linkConversation, args)).toEqual({ groupId: f.g1 });
    expect(await f.t.mutation(api.v0Groups.linkConversation, args)).toEqual({ groupId: f.g1 });
    expect(await f.t.query(api.v0Groups.resolveConversation, { token: args.token, conversationKey })).toEqual({ groupId: f.g1 });
    for (const token of [tokenB, f.actors.friend.token, f.actors.outsider.token]) expect(await f.t.query(api.v0Groups.resolveConversation, { token, conversationKey })).toBeNull();
    expect(await f.t.query(api.v0Groups.resolveConversation, { token: args.token, conversationKey: `${conversationKey}_unknown` })).toBeNull();
    await expect(f.t.mutation(api.v0Groups.linkConversation, { ...args, groupId: f.g2, requestId: `${f.runId}_conflict` })).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    expect(await f.t.mutation(api.v0Groups.unlinkConversation, { token: args.token, conversationKey, requestId: `${f.runId}_unlink` })).toEqual({ unlinked: true });
    expect(await f.t.query(api.v0Groups.resolveConversation, { token: args.token, conversationKey })).toBeNull();
  });

  for (const name of ["members", "board"] as const) {
    it(`[V0.future-member-hidden.${name}] excludes memberships whose server interval has not started`, async () => {
      const f = await v0Fixture();
      const value = name === "members" ? await f.t.query(api.v0Groups.members, { token: f.actors.friend.token, groupId: f.g1 }) : (await f.t.query(api.v0Groups.board, { token: f.actors.friend.token, groupId: f.g1 })).rows;
      expect(value.some((member) => member.accountId === f.actors.new.id)).toBe(false);
      expect(value.some((member) => member.accountId === f.actors.left.id)).toBe(false);
    });
  }

  it("[V0.quiet-veto] voids picks and queued events once while keeping old opens neutral", async () => {
    const f = await v0Fixture();
    await f.t.run(async (ctx) => {
      const member = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", f.g1).eq("accountId", f.actors.friend.id)).unique();
      await ctx.db.insert("v0Picks", { groupId: f.g1, betId: f.bet, accountId: f.actors.friend.id, membershipId: member!._id, option: 0, confidence: 0.5, placedAt: T0, updatedAt: T0 });
      await ctx.db.insert("v0Outbox", { key: `${f.runId}_reveal`, groupId: f.g1, betId: f.bet, accountId: f.actors.friend.id, kind: "reveal", state: "pending", attempts: 0, availableAt: T0 });
    });
    const vetoAt = T0 + 1000;
    vi.setSystemTime(vetoAt);
    const args = { token: f.actors.subject.token, betId: f.bet, requestId: `${f.runId}_veto` };
    expect(await f.t.mutation(api.v0Bets.veto, args)).toEqual({ voided: true });
    const picks = await f.t.run((ctx) => ctx.db.query("v0Picks").collect());
    expect(picks).toHaveLength(1);
    expect(picks[0].voidedAt).toBe(vetoAt);
    expect(await f.t.mutation(api.v0Bets.veto, args)).toEqual({ voided: true });
    expect(await f.t.run((ctx) => ctx.db.query("v0Picks").collect())).toEqual(picks);
    expect(await f.t.run((ctx) => ctx.db.query("v0Outbox").collect())).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.query("v0Ledger").collect())).toEqual([]);
    for (const role of ["creator", "friend", "subject", "alias"] as const) {
      const value = await f.t.query(api.v0Bets.get, { token: f.actors[role].token, locator: f.locator });
      expect(value.view).toBe("unavailable");
      noPrivateValues(value, f.privateValues);
      expect(JSON.stringify(value).toLowerCase()).not.toContain("veto");
    }
  });

  it("[V0.subject-leave-cascade] cancels subject bets and revokes G1 without changing G2", async () => {
    const f = await v0Fixture();
    const g2Before = await f.t.query(api.v0Groups.board, { token: f.actors.creator.token, groupId: f.g2 });
    expect(await f.t.mutation(api.v0Controls.leave, { token: f.actors.subject.token, groupId: f.g1, requestId: `${f.runId}_leave` })).toEqual({ left: true });
    expect((await f.t.run((ctx) => ctx.db.get(f.bet)))?.state).toBe("voided");
    await expect(f.t.query(api.v0Bets.get, { token: f.actors.subject.token, locator: f.locator })).rejects.toMatchObject({ data: { code: "NOT_AVAILABLE" } });
    expect(await f.t.query(api.v0Groups.board, { token: f.actors.creator.token, groupId: f.g2 })).toEqual(g2Before);
    const friendView = await f.t.query(api.v0Bets.get, { token: f.actors.friend.token, locator: f.locator });
    expect(friendView.view).toBe("unavailable");
    noPrivateValues(friendView, f.privateValues);
  });

  it("[V0.no-bets-server] enforces no-bets immediately on existing bets and every create/suggest path", async () => {
    const f = await v0Fixture();
    const response = await f.t.mutation(api.v0Controls.update, { token: f.actors.subject.token, noBets: true, blockedTopics: ["  Synthetic Topic "], hostedAiConsent: false, requestId: `${f.runId}_controls` });
    expect(response).toMatchObject({ noBets: true, blockedTopics: ["synthetic topic"] });
    expect((await f.t.run((ctx) => ctx.db.get(f.bet)))?.state).toBe("voided");
    await expect(f.t.action(api.v0Suggestions.get, { token: f.actors.creator.token, groupId: f.g1, subjectId: f.actors.subject.id, contextLine: "", useHostedAi: false })).rejects.toMatchObject({ data: { code: "NOT_AVAILABLE" } });
  });

  it("[V0.delete-cascade] removes private serving data and revokes sessions with honest pending provider cleanup", async () => {
    const f = await v0Fixture();
    const g2Before = await f.t.query(api.v0Groups.board, { token: f.actors.creator.token, groupId: f.g2 });
    const response = await f.t.mutation(api.v0Controls.deleteAccount, { token: f.actors.subject.token, requestId: `${f.runId}_delete` });
    expect(response).toMatchObject({ deleted: true, providerCleanup: "pending" });
    expect(response.copyDeletionCaveat).toContain("cannot erase cards");
    const data = await f.t.run(async (ctx) => ({ bet: await ctx.db.get(f.bet), sessions: await ctx.db.query("v0Sessions").withIndex("by_account", (q) => q.eq("accountId", f.actors.subject.id)).collect(), phones: await ctx.db.query("v0Phones").withIndex("by_account", (q) => q.eq("accountId", f.actors.subject.id)).collect(), proofs: await ctx.db.query("v0Proofs").collect(), outbox: await ctx.db.query("v0Outbox").collect(), cleanup: await ctx.db.query("v0ProviderCleanup").collect(), media: await ctx.storage.get(f.storageId) }));
    expect(data.bet).toBeNull();
    expect(data.sessions).toEqual([]);
    expect(data.phones).toEqual([]);
    expect(data.proofs).toEqual([]);
    expect(data.outbox).toEqual([]);
    expect(data.media).toBeNull();
    expect(data.cleanup).toHaveLength(1);
    expect(data.cleanup[0].state).toBe("manual_required");
    await expect(f.t.query(api.v0Auth.me, { token: f.actors.alias.token })).rejects.toMatchObject({ data: { code: "AUTH_REQUIRED" } });
    await expect(f.t.mutation(api.v0Controls.deleteAccount, { token: f.actors.subject.token, requestId: `${f.runId}_delete` })).rejects.toMatchObject({ data: { code: "AUTH_REQUIRED" } });
    expect(await f.t.run((ctx) => ctx.db.query("v0ProviderCleanup").collect())).toEqual(data.cleanup);
    expect(await f.t.query(api.v0Groups.board, { token: f.actors.creator.token, groupId: f.g2 })).toEqual(g2Before);
  });
});
