import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import crons from "../../convex/crons";
import { deleteAccountData } from "../../convex/v0Cleanup";
import { hash, phoneHash } from "../../convex/v0Policy";
import { cleanupRetryDelayMs, maxCleanupAttempts, removeVerification, runProviderCleanup, type CleanupTransport } from "../../convex/v0ProviderCleanup";
import { expectCode } from "./auth-support/errors";
import { syntheticAccountSid, syntheticServiceSid } from "./fake-otp";
import { T0 } from "./fixture";
import { v0Fixture } from "./v0-fixture";

type Fixture = Awaited<ReturnType<typeof v0Fixture>>;
type Reply = { status: number; body?: unknown; raw?: string } | "outage";

const tables = ["v0Accounts", "v0Phones", "v0OtpAttempts", "v0Sessions", "v0Pairs", "v0Groups", "v0Memberships", "v0Invites", "v0ConversationLinks", "v0Bets", "v0Picks", "v0Challenges", "v0Proofs", "v0Ledger", "v0Turns", "v0PushTokens", "v0Outbox", "v0Requests", "v0RateLimits", "v0Blocks", "v0Reports", "v0ProviderCleanup", "v0Goals"] as const;
const sid = (digit: string) => `VE${digit.repeat(32)}`;
const pendingSid = sid("1");
const consumedSid = sid("2");
const aliasSid = sid("3");
const friendSid = sid("4");
const syntheticAuthToken = "d".repeat(32);
const config = { accountSid: syntheticAccountSid, authToken: syntheticAuthToken, serviceSid: syntheticServiceSid };
const recordRef = makeFunctionReference<"mutation", { id: Id<"v0ProviderCleanup">; attempt: number; removed: string[]; rejected: boolean }, null>("v0ProviderCleanup:record");

async function snapshot(f: Fixture) {
  return await f.t.run(async (ctx) => {
    const state: Record<string, unknown[]> = {};
    for (const table of tables) state[table] = await ctx.db.query(table).collect();
    return state;
  });
}

function fakeProvider(live: string[] = [pendingSid]) {
  vi.stubEnv("V0_OTP_PROVIDER", "twilio_verify");
  vi.stubEnv("V0_OTP_PROVIDER_ENABLED", "true");
  vi.stubEnv("TWILIO_ACCOUNT_SID", syntheticAccountSid);
  vi.stubEnv("TWILIO_AUTH_TOKEN", syntheticAuthToken);
  vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", syntheticServiceSid);
  const pending = new Set(live);
  const calls: string[] = [];
  const replies: Reply[] = [];
  const prefix = `https://verify.twilio.com/v2/Services/${syntheticServiceSid}/Verifications/`;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const reference = String(url).slice(prefix.length);
    if (!String(url).startsWith(prefix) || !/^VE[0-9a-f]{32}$/.test(reference) || init?.method !== "POST" || init.redirect !== "error" || String(init.body) !== "Status=canceled") {
      throw new Error("Synthetic cleanup transport rejected an unexpected request");
    }
    if (new Headers(init.headers).get("authorization") !== `Basic ${btoa(`${syntheticAccountSid}:${syntheticAuthToken}`)}`) throw new Error("Synthetic cleanup transport rejected the credentials");
    calls.push(reference);
    const next = replies.shift();
    if (next === "outage") throw new Error("Synthetic provider outage");
    if (next) return new Response(next.raw ?? JSON.stringify(next.body ?? {}), { status: next.status });
    if (!pending.delete(reference)) return new Response(JSON.stringify({ code: 20404, status: 404 }), { status: 404 });
    return new Response(JSON.stringify({ sid: reference, status: "canceled" }), { status: 200 });
  }));
  return { calls, pending, reply: (...next: Reply[]) => replies.push(...next) };
}

async function seedAttempts(f: Fixture) {
  await f.t.run(async (ctx) => {
    const attempt = (phone: string, providerId: string | undefined, requestId: string, consumed: boolean) => phoneHash(phone).then((digest) => ctx.db.insert("v0OtpAttempts", { phoneHash: digest, requestId: `${f.runId}_${requestId}`, ...(providerId ? { providerId } : {}), createdAt: T0 - 30_000, expiresAt: T0 + 570_000, ...(consumed ? { consumedAt: T0 - 10_000 } : {}), attempts: consumed ? 1 : 0 }));
    await attempt(f.actors.subject.phone, pendingSid, "otp_pending", false);
    await attempt(f.actors.subject.phone, consumedSid, "otp_consumed", true);
    await attempt(f.actors.subject.phone, undefined, "otp_unstarted", false);
    await attempt(f.actors.alias.phone, aliasSid, "otp_alias", true);
    await attempt(f.actors.friend.phone, friendSid, "otp_friend", false);
  });
}

const remove = (f: Fixture, token = f.actors.subject.token, requestId = `${f.runId}_delete`) => f.t.mutation(api.v0Controls.deleteAccount, { token, requestId });
const cleanupRows = (f: Fixture) => f.t.run((ctx) => ctx.db.query("v0ProviderCleanup").collect());
const work = (f: Fixture) => f.t.action(runProviderCleanup, {});

async function deleted(live?: string[]) {
  const provider = fakeProvider(live);
  const f = await v0Fixture();
  await seedAttempts(f);
  const response = await remove(f);
  return { f, provider, response };
}

describe("J8.3 deletion is initiated only by the signed-in owner and is acknowledged with a durable record", () => {
  it("[J8.3.initiation.owner-session-only] refuses anonymous, unknown, revoked and expired sessions without changing any row", async () => {
    fakeProvider();
    const f = await v0Fixture();
    await seedAttempts(f);
    const expired = `synthetic_${f.runId}_expired`;
    await f.t.run(async (ctx) => { await ctx.db.insert("v0Sessions", { accountId: f.actors.subject.id, tokenHash: await hash(expired), deviceId: `${f.runId}_expired_device`, createdAt: T0 - 120_000, expiresAt: T0 - 1 }); });
    const before = await snapshot(f);
    for (const token of ["", `synthetic_${f.runId}_unknown`, f.actors.revoked.token, expired, "x".repeat(257)]) await expectCode(remove(f, token), "AUTH_REQUIRED");
    expect(await snapshot(f)).toEqual(before);
    expect(before.v0ProviderCleanup).toEqual([]);
  });

  it("[J8.3.initiation.request-id-required] refuses a signed-in request with no or an oversized request identifier and deletes nothing", async () => {
    fakeProvider();
    const f = await v0Fixture();
    await seedAttempts(f);
    const before = await snapshot(f);
    for (const requestId of ["", "r".repeat(129)]) await expectCode(remove(f, f.actors.subject.token, requestId), "INVALID_INPUT");
    expect(await snapshot(f)).toEqual(before);
    expect((await f.t.query(api.v0Auth.me, { token: f.actors.subject.token }))).toBeTruthy();
  });

  it("[J8.3.initiation.confirmed-and-queued] confirms the deletion and queues exactly one provider cleanup for the caller's own verifications", async () => {
    const { f, provider, response } = await deleted();
    expect(response).toMatchObject({ deleted: true, providerCleanup: "pending" });
    expect(response.copyDeletionCaveat).toContain("cannot erase cards");
    const rows = await cleanupRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: f.actors.subject.id, provider: "twilio_verify", state: "pending", attempts: 0 });
    expect([...rows[0].references].sort()).toEqual([pendingSid, consumedSid, aliasSid].sort());
    expect(provider.calls).toEqual([]);
    const state = await snapshot(f);
    expect((state.v0OtpAttempts as { providerId?: string }[]).map((row) => row.providerId)).toEqual([friendSid]);
    expect((state.v0Accounts as { _id: string; deletedAt?: number }[]).filter((row) => row.deletedAt !== undefined).map((row) => row._id)).toEqual([f.actors.subject.id]);
    expect(await f.t.query(api.v0Auth.me, { token: f.actors.friend.token })).toBeTruthy();
  });

  it("[J8.3.initiation.unconfigured-manual] marks the cleanup as needing manual work when no provider is configured and never calls out", async () => {
    const f = await v0Fixture();
    await seedAttempts(f);
    expect(await remove(f)).toMatchObject({ deleted: true, providerCleanup: "pending" });
    const rows = await cleanupRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "manual_required", attempts: 0 });
    vi.setSystemTime(Date.now() + 86_400_000);
    expect(await work(f)).toEqual({ claimed: 0 });
    expect(await cleanupRows(f)).toEqual(rows);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("J8.3 provider cleanup worker", () => {
  it("[J8.3.cleanup.removes-records] cancels a pending verification, accepts already-removed ones and completes the row", async () => {
    const { f, provider } = await deleted();
    expect(await work(f)).toEqual({ claimed: 1 });
    expect([...provider.calls].sort()).toEqual([pendingSid, consumedSid, aliasSid].sort());
    expect(provider.pending.size).toBe(0);
    expect(await cleanupRows(f)).toMatchObject([{ state: "complete", references: [], attempts: 1 }]);
  });

  it("[J8.3.cleanup.no-references] completes a cleanup that has nothing to remove without calling the provider", async () => {
    const provider = fakeProvider();
    const f = await v0Fixture();
    await remove(f);
    expect(await cleanupRows(f)).toMatchObject([{ state: "pending", references: [] }]);
    expect(await work(f)).toEqual({ claimed: 0 });
    expect(await cleanupRows(f)).toMatchObject([{ state: "complete", references: [], attempts: 0 }]);
    expect(provider.calls).toEqual([]);
  });

  it("[J8.3.cleanup.bounded-retries] backs off after each failure and stops for manual work after the attempt limit", async () => {
    const { f, provider } = await deleted();
    const total = (await cleanupRows(f))[0].references.length;
    for (let attempt = 1; attempt <= maxCleanupAttempts; attempt++) {
      provider.reply("outage");
      const started = Date.now();
      expect(await work(f)).toEqual({ claimed: 1 });
      expect(provider.calls).toHaveLength(attempt);
      const row = (await cleanupRows(f))[0];
      expect(row).toMatchObject({ attempts: attempt, state: attempt < maxCleanupAttempts ? "pending" : "manual_required" });
      expect(row.availableAt).toBeGreaterThanOrEqual(started + cleanupRetryDelayMs(attempt));
      expect(row.availableAt).toBeLessThan(started + cleanupRetryDelayMs(attempt) + 1000);
      expect(row.references).toHaveLength(total);
      vi.setSystemTime(row.availableAt - 1);
      expect(await work(f)).toEqual({ claimed: 0 });
      vi.setSystemTime(row.availableAt);
    }
    vi.setSystemTime(Date.now() + 30 * 86_400_000);
    expect(await work(f)).toEqual({ claimed: 0 });
    expect(provider.calls).toHaveLength(maxCleanupAttempts);
    expect(cleanupRetryDelayMs(1)).toBe(300_000);
    expect(cleanupRetryDelayMs(maxCleanupAttempts)).toBeLessThanOrEqual(86_400_000);
  });

  it("[J8.3.cleanup.partial-progress] keeps only the unfinished references and never asks again for a removed one", async () => {
    const { f, provider } = await deleted();
    const [first, second, third] = (await cleanupRows(f))[0].references;
    provider.reply({ status: 404 }, { status: 503 });
    expect(await work(f)).toEqual({ claimed: 1 });
    expect(provider.calls).toEqual([first, second]);
    const row = (await cleanupRows(f))[0];
    expect(row).toMatchObject({ state: "pending", attempts: 1, references: [second, third] });
    vi.setSystemTime(row.availableAt);
    expect(await work(f)).toEqual({ claimed: 1 });
    expect(provider.calls).toEqual([first, second, second, third]);
    expect(await cleanupRows(f)).toMatchObject([{ state: "complete", references: [], attempts: 2 }]);
  });

  it("[J8.3.cleanup.rejected] hands a refused removal to manual work at once and keeps its reference", async () => {
    const { f, provider } = await deleted();
    const [first, second, third] = (await cleanupRows(f))[0].references;
    provider.reply({ status: 400 });
    expect(await work(f)).toEqual({ claimed: 1 });
    expect(provider.calls).toEqual([first, second, third]);
    expect(await cleanupRows(f)).toMatchObject([{ state: "manual_required", attempts: 1, references: [first] }]);
    vi.setSystemTime(Date.now() + 30 * 86_400_000);
    expect(await work(f)).toEqual({ claimed: 0 });
    expect(provider.calls).toHaveLength(3);
  });

  it("[J8.3.cleanup.provider-switched-off] spends no attempt and makes no call while the provider is switched off, then resumes", async () => {
    const { f, provider } = await deleted();
    const queued = await cleanupRows(f);
    vi.stubEnv("V0_OTP_PROVIDER_ENABLED", "false");
    vi.setSystemTime(Date.now() + 86_400_000);
    expect(await work(f)).toEqual({ claimed: 0 });
    expect(await cleanupRows(f)).toEqual(queued);
    expect(provider.calls).toEqual([]);
    vi.stubEnv("V0_OTP_PROVIDER_ENABLED", "true");
    expect(await work(f)).toEqual({ claimed: 1 });
    expect(await cleanupRows(f)).toMatchObject([{ state: "complete", references: [], attempts: 1 }]);
  });

  it("[J8.3.cleanup.scheduled] is scheduled as a recurring job", () => {
    const jobs = Object.values(crons.crons).filter((job) => job.name === "v0ProviderCleanup:run");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toEqual({ type: "interval", minutes: 5 });
  });

  it("[J8.3.cleanup.stale-result] ignores a result reported for an attempt that is no longer current", async () => {
    const { f } = await deleted();
    const row = (await cleanupRows(f))[0];
    await f.t.mutation(recordRef, { id: row._id, attempt: 1, removed: row.references, rejected: false });
    expect(await cleanupRows(f)).toEqual([row]);
  });

  for (const [name, reply, outcome] of [
    ["canceled", { status: 200, body: JSON.stringify({ sid: pendingSid, status: "canceled" }) }, "removed"],
    ["already-gone", { status: 404, body: "" }, "removed"],
    ["wrong-sid", { status: 200, body: JSON.stringify({ sid: consumedSid, status: "canceled" }) }, "retry"],
    ["not-canceled", { status: 200, body: JSON.stringify({ sid: pendingSid, status: "pending" }) }, "retry"],
    ["malformed", { status: 200, body: "<html>" }, "retry"],
    ["null-body", { status: 200, body: "null" }, "retry"],
    ["unauthorized", { status: 401, body: "" }, "retry"],
    ["forbidden", { status: 403, body: "" }, "retry"],
    ["rate-limited", { status: 429, body: "" }, "retry"],
    ["server-error", { status: 503, body: "" }, "retry"],
    ["bad-request", { status: 400, body: "" }, "rejected"],
    ["redirect", { status: 302, body: "" }, "rejected"],
  ] as const) {
    it(`[J8.3.adapter.${name}] classifies the provider reply as ${outcome}`, async () => {
      const requests: Parameters<CleanupTransport>[0][] = [];
      const transport: CleanupTransport = async (request) => { requests.push(request); return reply; };
      expect(await removeVerification(config, pendingSid, transport)).toBe(outcome);
      expect(requests).toEqual([{ url: `https://verify.twilio.com/v2/Services/${syntheticServiceSid}/Verifications/${pendingSid}`, authorization: `Basic ${btoa(`${syntheticAccountSid}:${syntheticAuthToken}`)}`, body: "Status=canceled" }]);
    });
  }

  it("[J8.3.adapter.transport-failure] treats a transport failure as retryable", async () => {
    expect(await removeVerification(config, pendingSid, async () => { throw new Error("Synthetic provider outage"); })).toBe("retry");
  });

  it("[J8.3.adapter.invalid-reference] never sends a malformed reference to the provider", async () => {
    const transport = vi.fn<CleanupTransport>();
    for (const reference of ["", "VE123", `VA${"1".repeat(32)}`, `${pendingSid}/../../Services`, `${pendingSid}?x=1`]) expect(await removeVerification(config, reference, transport)).toBe("rejected");
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("J8.3 a repeated delete is safe", () => {
  it("[J8.3.idempotent.repeat-request] answers every repeat of a completed delete with AUTH_REQUIRED and changes nothing", async () => {
    const { f, provider } = await deleted();
    const after = await snapshot(f);
    expect(after.v0ProviderCleanup).toHaveLength(1);
    vi.setSystemTime(Date.now() + 1000);
    await expectCode(remove(f), "AUTH_REQUIRED");
    await expectCode(remove(f, f.actors.subject.token, `${f.runId}_delete_again`), "AUTH_REQUIRED");
    await expectCode(remove(f, f.actors.alias.token), "AUTH_REQUIRED");
    expect(await snapshot(f)).toEqual(after);
    expect(provider.calls).toEqual([]);
  });

  it("[J8.3.idempotent.cascade-rerun] leaves a deleted account untouched when the cascade runs again", async () => {
    const { f } = await deleted();
    const after = await snapshot(f);
    vi.setSystemTime(Date.now() + 60_000);
    await f.t.run(async (ctx) => {
      await deleteAccountData(ctx, f.actors.subject.id);
      await deleteAccountData(ctx, f.actors.subject.id);
    });
    expect(await snapshot(f)).toEqual(after);
  });

  it("[J8.3.idempotent.worker-rerun] removes each provider record once however often the worker runs", async () => {
    const { f, provider } = await deleted();
    expect(await work(f)).toEqual({ claimed: 1 });
    const done = await cleanupRows(f);
    const calls = [...provider.calls];
    for (const later of [0, 300_000, 86_400_000]) {
      vi.setSystemTime(Date.now() + later);
      expect(await work(f)).toEqual({ claimed: 0 });
    }
    await expectCode(remove(f), "AUTH_REQUIRED");
    expect(await cleanupRows(f)).toEqual(done);
    expect(provider.calls).toEqual(calls);
  });

  it("[J8.3.idempotent.provider-already-removed] completes when the provider no longer holds any of the records", async () => {
    const { f, provider } = await deleted([]);
    expect(await work(f)).toEqual({ claimed: 1 });
    expect(provider.calls).toHaveLength(3);
    expect(await cleanupRows(f)).toMatchObject([{ state: "complete", references: [] }]);
  });
});
