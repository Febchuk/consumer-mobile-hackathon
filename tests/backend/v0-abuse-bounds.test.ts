import { readFileSync, readdirSync } from "node:fs";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import http from "../../convex/http";
import { publicApiPolicy } from "../../convex/v0ApiPolicy";
import { hash } from "../../convex/v0Policy";
import { expectCode } from "./auth-support/errors";
import { contractCases, invoke } from "./contract-cases";
import { fakeOtp, syntheticAccountSid, syntheticCode, syntheticOtherPhone, syntheticPhone, syntheticServiceSid, syntheticVerificationSid } from "./fake-otp";
import { REVEAL, T0 } from "./fixture";
import { v0Fixture } from "./v0-fixture";

type Fixture = Awaited<ReturnType<typeof v0Fixture>>;
type Role = keyof Fixture["actors"];
type Overrides = Record<string, unknown> | ((f: Fixture) => Record<string, unknown>);

const tables = ["v0Accounts", "v0Phones", "v0Sessions", "v0Pairs", "v0Groups", "v0Memberships", "v0Invites", "v0ConversationLinks", "v0Bets", "v0Picks", "v0Challenges", "v0Proofs", "v0Ledger", "v0Turns", "v0PushTokens", "v0Outbox", "v0Requests", "v0RateLimits", "v0Blocks", "v0Reports", "v0ProviderCleanup", "v0Goals"] as const;

async function snapshot(f: Fixture) {
  return await f.t.run(async (ctx) => {
    const state: Record<string, unknown[]> = {};
    for (const table of tables) state[table] = await ctx.db.query(table).collect();
    return state;
  });
}

const resolve = (f: Fixture, overrides: Overrides = {}) => typeof overrides === "function" ? overrides(f) : overrides;

async function secondBet(f: Fixture) {
  return await f.t.run(async (ctx) => {
    const bet = (await ctx.db.get(f.bet))!;
    return await ctx.db.insert("v0Bets", { groupId: bet.groupId, creatorId: bet.creatorId, subjectId: bet.subjectId, createdAt: bet.createdAt, question: "Will they suggest a song before the reveal?", contextLine: "A second synthetic bet", format: "yes_no", options: ["Yes", "No"], source: "manual", state: "open", cutoffAt: bet.cutoffAt, revealAt: bet.revealAt, locator: await hash(f.runId + ":second-locator") });
  });
}

const replayCases: Record<string, { role: Role; changed: Overrides }> = {
  "v0Controls:update": { role: "friend", changed: { noBets: true } },
  "v0Controls:alias": { role: "friend", changed: { alias: "Another QA friend" } },
  "v0Controls:leave": { role: "friend", changed: (f) => ({ groupId: f.g2 }) },
  "v0Controls:block": { role: "friend", changed: (f) => ({ accountId: f.actors.creator.id }) },
  "v0Controls:report": { role: "friend", changed: { reason: "Another synthetic QA report" } },
  "v0Bets:veto": { role: "subject", changed: {} },
  "v0Notifications:setPreferences": { role: "friend", changed: { enabled: true } },
};

describe("SEC5 request idempotency on controls that exist today", () => {
  for (const [path, { role, changed }] of Object.entries(replayCases)) {
    it("[SEC5.idempotent-replay." + path + "] applies one logical change across retries and refuses a reused identifier with different arguments", async () => {
      const f = await v0Fixture();
      const other = await secondBet(f);
      const token = f.actors[role].token;
      const first = await invoke(f, path, token);
      const after = await snapshot(f);
      expect(after.v0Requests).toHaveLength(1);
      vi.setSystemTime(T0 + 1000);
      for (let attempt = 0; attempt < 3; attempt++) expect(await invoke(f, path, token)).toEqual(first);
      expect(await snapshot(f)).toEqual(after);
      await expectCode(invoke(f, path, token, path === "v0Bets:veto" ? { betId: other } : resolve(f, changed)), "IDEMPOTENCY_CONFLICT");
      expect(await snapshot(f)).toEqual(after);
    });
  }

  it("[SEC5.idempotent-replay.account-scope] keeps one account's request identifier from colliding with another account's", async () => {
    const f = await v0Fixture();
    const friend = await invoke(f, "v0Controls:update", f.actors.friend.token, { blockedTopics: ["friend topic"] });
    const creator = await invoke(f, "v0Controls:update", f.actors.creator.token, { blockedTopics: ["creator topic"] });
    expect(friend).toMatchObject({ blockedTopics: ["friend topic"] });
    expect(creator).toMatchObject({ blockedTopics: ["creator topic"] });
    expect(await invoke(f, "v0Controls:update", f.actors.friend.token, { blockedTopics: ["friend topic"] })).toEqual(friend);
    const requests = await f.t.run((ctx) => ctx.db.query("v0Requests").collect());
    expect(requests.map((row) => row.accountId).sort()).toEqual([f.actors.friend.id, f.actors.creator.id].sort());
    expect((await f.t.run((ctx) => ctx.db.get(f.actors.friend.id)))?.blockedTopics).toEqual(["friend topic"]);
  });

  const identifierCases: Record<string, { role: Role; at?: number; provisional?: boolean }> = {
    "v0Auth:revoke": { role: "friend" },
    "v0Auth:createPair": { role: "friend" },
    "v0Groups:create": { role: "friend" },
    "v0Groups:invite": { role: "creator" },
    "v0Groups:accept": { role: "outsider" },
    "v0Groups:linkConversation": { role: "friend" },
    "v0Groups:unlinkConversation": { role: "friend" },
    "v0Groups:passTurn": { role: "friend" },
    "v0Bets:pick": { role: "friend" },
    "v0Bets:veto": { role: "subject" },
    "v0Bets:answer": { role: "subject", at: REVEAL + 1 },
    "v0Bets:challenge": { role: "friend", at: REVEAL + 2, provisional: true },
    "v0Proof:upload": { role: "subject", at: REVEAL + 1 },
    "v0Controls:update": { role: "friend" },
    "v0Controls:alias": { role: "friend" },
    "v0Controls:leave": { role: "friend" },
    "v0Controls:deleteAccount": { role: "friend" },
    "v0Controls:report": { role: "friend" },
    "v0Controls:block": { role: "friend" },
    "v0Notifications:register": { role: "friend" },
    "v0Notifications:unregister": { role: "friend" },
    "v0Notifications:setPreferences": { role: "friend" },
  };

  for (const [path, { role, at, provisional }] of Object.entries(identifierCases)) {
    it("[SEC5.request-id-bounds." + path + "] refuses a missing or oversized request identifier before changing anything", async () => {
      const f = await v0Fixture();
      if (provisional) await f.t.run((ctx) => ctx.db.patch(f.bet, { state: "provisional", answeredAt: REVEAL + 1, provisionalOutcome: 0 }));
      if (at !== undefined) vi.setSystemTime(at);
      const before = await snapshot(f);
      for (const requestId of ["", "x".repeat(129)]) {
        await expectCode(invoke(f, path, f.actors[role].token, { requestId }), "INVALID_INPUT");
        expect(await snapshot(f)).toEqual(before);
      }
      await invoke(f, path, f.actors[role].token, { requestId: "x".repeat(128) });
    });
  }
});

const bounds: [path: string, role: Role, limit: number, windowMs: number][] = [
  ["v0Controls:update", "friend", 60, 60_000],
  ["v0Controls:alias", "friend", 30, 60_000],
  ["v0Controls:report", "friend", 20, 3_600_000],
  ["v0Controls:block", "friend", 30, 3_600_000],
  ["v0Bets:veto", "subject", 60, 60_000],
  ["v0Notifications:setPreferences", "friend", 30, 60_000],
];

describe("SEC5 per-account rate limits on controls that exist today", () => {
  for (const [path, role, limit, windowMs] of bounds) {
    it("[SEC5.rate-bound." + path + "] refuses new requests past the window quota, never charges a cached retry, and recovers at the window boundary", async () => {
      const f = await v0Fixture();
      const call = (index: number) => invoke(f, path, f.actors[role].token, { requestId: "bounded-" + index });
      const first = await call(0);
      for (let index = 1; index < limit; index++) await call(index);
      const full = await snapshot(f);
      expect(full.v0Requests).toHaveLength(limit);
      await expectCode(call(limit), "RATE_LIMITED");
      expect(await snapshot(f)).toEqual(full);
      expect(await call(0)).toEqual(first);
      expect(await snapshot(f)).toEqual(full);
      vi.setSystemTime(T0 + windowMs - 1);
      await expectCode(call(limit), "RATE_LIMITED");
      expect(await snapshot(f)).toEqual(full);
      vi.setSystemTime(T0 + windowMs);
      await call(limit);
      expect((await snapshot(f)).v0Requests).toHaveLength(limit + 1);
    });
  }

  it("[SEC5.rate-bound.per-account] shares one quota across an account's devices without limiting another account", async () => {
    const f = await v0Fixture();
    for (let index = 0; index < 30; index++) await invoke(f, "v0Controls:alias", f.actors.subject.token, { requestId: "subject-" + index });
    await expectCode(invoke(f, "v0Controls:alias", f.actors.alias.token, { requestId: "second-device" }), "RATE_LIMITED");
    expect(await invoke(f, "v0Controls:alias", f.actors.friend.token, { requestId: "other-account" })).toEqual({ alias: "QA friend" });
  });
});

const safeCodes = new Set(["AUTH_REQUIRED", "CONFLICT", "FORBIDDEN", "IDEMPOTENCY_CONFLICT", "INVALID_INPUT", "NOT_AVAILABLE", "POLICY_PENDING", "PROVIDER_UNAVAILABLE", "RATE_LIMITED"]);

function fixtureSecrets(f: Fixture) {
  return [...f.privateValues, f.runId, f.g1, f.g2, f.bet, f.locator, f.proof, f.invite, f.storageId, ...Object.values(f.actors).flatMap((actor) => [actor.token, actor.id, actor.phone, actor.deviceId, actor.session])];
}

function expectSafeError(error: unknown, f: Fixture, extra: string[] = []) {
  expect(error).toBeInstanceOf(ConvexError);
  const data = (error as ConvexError<{ code: string; message: string }>).data;
  expect(Object.keys(data).sort()).toEqual(["code", "message"]);
  expect(safeCodes.has(data.code)).toBe(true);
  expect(typeof data.message).toBe("string");
  expect(data.message.length).toBeGreaterThan(0);
  expect(data.message.length).toBeLessThanOrEqual(160);
  expect(data.message).toMatch(/^[A-Za-z0-9 ,.'-]+$/);
  const serialized = String(error) + " " + JSON.stringify(data);
  for (const secret of [...fixtureSecrets(f), ...extra]) expect(serialized).not.toContain(secret);
  expect(serialized).not.toMatch(/(?:\bat .+:\d+:\d+|node_modules|convex\/v0|\.ts\b)/);
}

const malformed: [name: string, path: string, role: Role | "anonymous", overrides: Overrides, code: string][] = [
  ["pick-option", "v0Bets:pick", "friend", { option: 7 }, "INVALID_INPUT"],
  ["pick-option-fraction", "v0Bets:pick", "friend", { option: 0.5 }, "INVALID_INPUT"],
  ["pick-confidence-nan", "v0Bets:pick", "friend", { confidence: Number.NaN }, "INVALID_INPUT"],
  ["pick-confidence-infinite", "v0Bets:pick", "friend", { confidence: Number.POSITIVE_INFINITY }, "INVALID_INPUT"],
  ["pick-confidence-zero", "v0Bets:pick", "friend", { confidence: 0 }, "INVALID_INPUT"],
  ["pick-confidence-negative", "v0Bets:pick", "friend", { confidence: -0.5 }, "INVALID_INPUT"],
  ["pick-confidence-over", "v0Bets:pick", "friend", { confidence: 1.01 }, "INVALID_INPUT"],
  ["pick-risk-points", "v0Bets:pick", "friend", { riskPoints: 5 }, "INVALID_INPUT"],
  ["bet-locator-path", "v0Bets:get", "friend", { locator: "../../c/SECRET_LOCATOR_PROBE" }, "NOT_AVAILABLE"],
  ["bet-locator-uppercase", "v0Bets:get", "friend", (f) => ({ locator: f.locator.toUpperCase() }), "NOT_AVAILABLE"],
  ["controls-topics-count", "v0Controls:update", "friend", { blockedTopics: Array.from({ length: 21 }, (_, index) => "topic " + index) }, "INVALID_INPUT"],
  ["controls-topic-control-character", "v0Controls:update", "friend", { blockedTopics: ["hidden\u0000PROBE_TOPIC"] }, "INVALID_INPUT"],
  ["controls-topic-markup", "v0Controls:update", "friend", { blockedTopics: ["<script>PROBE_TOPIC</script>"] }, "INVALID_INPUT"],
  ["controls-topic-long", "v0Controls:update", "friend", { blockedTopics: ["PROBE_TOPIC".repeat(12)] }, "INVALID_INPUT"],
  ["alias-blank", "v0Controls:alias", "friend", { alias: "   " }, "INVALID_INPUT"],
  ["alias-long", "v0Controls:alias", "friend", { alias: "PROBE_ALIAS".repeat(9) }, "INVALID_INPUT"],
  ["alias-direction-override", "v0Controls:alias", "friend", { alias: "PROBE_ALIAS\u202E" }, "INVALID_INPUT"],
  ["report-blank", "v0Controls:report", "friend", { reason: " " }, "INVALID_INPUT"],
  ["report-long", "v0Controls:report", "friend", { reason: "PROBE_REASON".repeat(170) }, "INVALID_INPUT"],
  ["report-control-character", "v0Controls:report", "friend", { reason: "PROBE_REASON\u0007" }, "INVALID_INPUT"],
  ["block-self", "v0Controls:block", "friend", (f) => ({ accountId: f.actors.friend.id }), "INVALID_INPUT"],
  ["push-device-token", "v0Notifications:register", "friend", { deviceToken: "PROBE_DEVICE_TOKEN" }, "INVALID_INPUT"],
  ["group-name-blank", "v0Groups:create", "friend", { name: " " }, "INVALID_INPUT"],
  ["group-timezone", "v0Groups:create", "friend", { timezone: "Mars/PROBE_ZONE" }, "INVALID_INPUT"],
  ["invite-phone", "v0Groups:invite", "creator", { phone: "2025550190" }, "INVALID_INPUT"],
  ["conversation-key", "v0Groups:linkConversation", "friend", { conversationKey: "PROBE_KEY\u0000" }, "INVALID_INPUT"],
  ["session-token-empty", "v0Auth:me", "anonymous", { token: "" }, "AUTH_REQUIRED"],
  ["session-token-oversized", "v0Auth:me", "anonymous", { token: "PROBE_TOKEN".repeat(24) }, "AUTH_REQUIRED"],
];

describe("SEC5 safe error bodies from every canonical V0 export", () => {
  for (const path of Object.keys(contractCases)) {
    for (const role of ["anonymous", "revoked", "outsider", "unadmittedAlias", "new", "left", "subject", "friend"] as const) {
      it("[SEC5.safe-error." + path + "." + role + "] fails only with a fixed code and a plain sentence that names no account, group, bet or session", async () => {
        const f = await v0Fixture();
        try {
          await invoke(f, path, role === "anonymous" ? "synthetic_anonymous" : f.actors[role].token);
        } catch (error) {
          expectSafeError(error, f, ["synthetic_anonymous"]);
        }
      });
    }
  }

  for (const [name, path, role, overrides, code] of malformed) {
    it("[SEC5.safe-error.malformed." + name + "] rejects malformed input with a safe body that does not echo it and changes nothing", async () => {
      const f = await v0Fixture();
      const before = await snapshot(f);
      const input = resolve(f, overrides);
      const echoes = Object.values(input).flat().filter((value): value is string => typeof value === "string" && value.length >= 6);
      let failure: unknown;
      try {
        await invoke(f, path, role === "anonymous" ? "synthetic_anonymous" : f.actors[role].token, input);
      } catch (error) {
        failure = error;
      }
      expectSafeError(failure, f, [...echoes, "PROBE_"]);
      expect((failure as ConvexError<{ code: string }>).data.code).toBe(code);
      expect(await snapshot(f)).toEqual(before);
    });
  }
});

type Registered = { isPublic?: boolean; isInternal?: boolean; isHttp?: boolean; isMutation?: boolean; exportArgs?: () => string };
type Shape = { type: string; value?: unknown };

function sample(shape: Shape): unknown {
  if (shape.type === "object") return Object.fromEntries(Object.entries(shape.value as Record<string, { optional: boolean; fieldType: Shape }>).filter(([, field]) => !field.optional).map(([name, field]) => [name, sample(field.fieldType)]));
  if (shape.type === "string") return "synthetic";
  if (shape.type === "number") return 1;
  if (shape.type === "boolean") return false;
  if (shape.type === "array") return [];
  if (shape.type === "null") return null;
  if (shape.type === "literal") return shape.value;
  if (shape.type === "union") return sample((shape.value as Shape[])[0]);
  throw new Error("Unsupported argument shape " + shape.type);
}
const modules = import.meta.glob<Record<string, Registered>>("../../convex/**/*.ts");
const testOnlyWord = /^(?:test|tests|testing|clock|reset|seed|seeds|fixture|fixtures|debug|mock|fake|demo|qa|backdoor|bypass)$/;
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).map((word) => word.toLowerCase());
const clientClockArguments = new Set(["now", "time", "clock", "date", "timestamp", "servertime", "at", "testmode", "debug", "bypass", "admin", "passcode", "fixture"]);

describe("SEC5 no test, clock or reset route in the deployable surface", () => {
  it("[SEC5.no-test-routes.functions] registers no test, clock, reset, seed or debug function outside the retired exports that always refuse", async () => {
    const registered: { path: string; fn: Registered }[] = [];
    for (const [file, load] of Object.entries(modules)) {
      if (file.includes("/_generated/")) continue;
      const moduleName = file.replace("../../convex/", "").replace(/\.ts$/, "");
      expect(words(moduleName).some((word) => testOnlyWord.test(word))).toBe(false);
      for (const [name, value] of Object.entries(await load())) {
        if (value && (value.isPublic || value.isInternal || value.isHttp)) registered.push({ path: moduleName + ":" + name, fn: value });
      }
    }
    expect(registered.length).toBeGreaterThan(Object.keys(contractCases).length);
    const policies = publicApiPolicy as Record<string, string>;
    const legacyInternal: typeof registered = [];
    for (const { path, fn } of registered) {
      const [, name] = path.split(":");
      if (words(name).some((word) => testOnlyWord.test(word))) {
        if (fn.isPublic) expect(policies[path], path).toBe("retired");
        else legacyInternal.push({ path, fn });
      }
      if (fn.isPublic && policies[path] !== "retired" && fn.exportArgs) {
        const validator = JSON.parse(fn.exportArgs()) as { type: string; value?: Record<string, unknown> };
        for (const argument of Object.keys(validator.type === "object" ? validator.value ?? {} : {})) expect(clientClockArguments.has(argument.toLowerCase()), path + " " + argument).toBe(false);
      }
    }
    const f = await v0Fixture();
    const before = await snapshot(f);
    for (const { path, fn } of legacyInternal) {
      const moduleName = path.split(":")[0];
      expect(moduleName.startsWith("v0"), path).toBe(false);
      const builders = readFileSync("convex/" + moduleName + ".ts", "utf8").split("\n").filter((line) => /^import .*\b(?:query|mutation|action|internalQuery|internalMutation|internalAction)\b/.test(line));
      expect(builders.length, path).toBeGreaterThan(0);
      for (const line of builders) expect(line, path).toContain('from "./v0Legacy"');
      expect(fn.isMutation, path).toBe(true);
      await expectCode(f.t.mutation(makeFunctionReference<"mutation">(path), sample(JSON.parse(fn.exportArgs!()) as Shape) as Record<string, unknown>), "NOT_AVAILABLE");
    }
    expect(await snapshot(f)).toEqual(before);
  });

  it("[SEC5.no-test-routes.http] routes only read-only GET requests and answers test, clock and reset paths without touching state", async () => {
    const f = await v0Fixture();
    const routes = http.getRoutes();
    expect(routes.length).toBeGreaterThan(0);
    for (const [, method] of routes) expect(method).toBe("GET");
    const before = await snapshot(f);
    for (const path of ["/test", "/test/reset", "/__test__/clock", "/reset", "/clock", "/clock/advance", "/seed", "/debug", "/admin", "/api/test/advance", "/qa/fixture", "/fixtures/reset"]) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const response = await f.t.fetch(path, { method, headers: { Authorization: "Bearer " + f.actors.creator.token }, ...(method === "GET" ? {} : { body: JSON.stringify({ now: REVEAL, reset: true }) }) });
        expect(response.status, method + " " + path).toBeGreaterThanOrEqual(400);
        const body = await response.text();
        for (const secret of fixtureSecrets(f)) expect(body).not.toContain(secret);
      }
    }
    expect(await snapshot(f)).toEqual(before);
    expect(Date.now()).toBe(T0);
  });

  it("[SEC5.no-test-routes.attestation] never reports test adapters or a test environment whatever the configuration says", async () => {
    const f = await v0Fixture();
    vi.stubEnv("V0_TEST_ADAPTERS", "true");
    vi.stubEnv("V0_ENVIRONMENT", "test");
    vi.stubEnv("V0_FIXTURE_MODE", "true");
    expect(await f.t.query(api.v0Runtime.attestation, {})).toMatchObject({ testAdapters: false, environment: "unconfigured" });
  });
});

function logged(value: unknown): string {
  if (value instanceof Error) return String(value) + " " + (value.stack ?? "") + " " + logged((value as { data?: unknown }).data);
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

describe("SEC2 secret-free logs", () => {
  it("[SEC2.secret-free-logs.runtime] writes no session, code, phone, provider credential or sealed content to the function log across sign-in, pairing and every canonical export reached by an eligible actor", async () => {
    const levels = ["log", "info", "warn", "error", "debug", "trace"] as const;
    const spies = levels.map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const provider = fakeOtp();
    const f = await v0Fixture();
    const pepper = process.env.V0_PHONE_PEPPER!;
    await f.t.action(api.v0Auth.requestCode, { phone: syntheticPhone, requestId: "log-start" });
    await expectCode(f.t.action(api.v0Auth.verifyCode, { phone: syntheticPhone, code: "135791", deviceId: "synthetic-log-device", requestId: "log-start" }), "INVALID_INPUT");
    const session = await f.t.action(api.v0Auth.verifyCode, { phone: syntheticPhone, code: syntheticCode, deviceId: "synthetic-log-device", requestId: "log-start" });
    provider.reply({ outage: true });
    await expectCode(f.t.action(api.v0Auth.requestCode, { phone: syntheticOtherPhone, requestId: "log-outage" }), "PROVIDER_UNAVAILABLE");
    vi.setSystemTime(T0 + 120_000);
    provider.reply({ status: 500, raw: "PROVIDER_INTERNAL_DETAIL " + syntheticOtherPhone });
    await expectCode(f.t.action(api.v0Auth.requestCode, { phone: syntheticOtherPhone, requestId: "log-provider-error" }), "PROVIDER_UNAVAILABLE");
    const pair = await f.t.mutation(api.v0Auth.createPair, { token: session.token, requestId: "log-pair" });
    const paired = await f.t.action(api.v0Auth.redeemPair, { code: pair.code, deviceId: "synthetic-log-paired-device", requestId: "log-redeem" });
    await expectCode(f.t.action(api.v0Auth.redeemPair, { code: pair.code, deviceId: "synthetic-log-paired-device", requestId: "log-redeem-replay" }), "CONFLICT");
    await f.t.query(api.v0Auth.me, { token: paired.token });
    await f.t.mutation(api.v0Auth.revoke, { token: paired.token, allDevices: false, requestId: "log-revoke" });
    await expectCode(f.t.query(api.v0Auth.me, { token: paired.token }), "AUTH_REQUIRED");
    const secrets = [...fixtureSecrets(f).filter((value) => value !== f.runId), session.token, paired.token, pair.code, syntheticPhone, syntheticOtherPhone, syntheticCode, "135791", pepper, "d".repeat(32), syntheticAccountSid, syntheticServiceSid, syntheticVerificationSid, "PROVIDER_INTERNAL_DETAIL", await hash(session.token), await hash(pair.code)];
    const reached = new Set<string>();
    for (const role of ["anonymous", "revoked", "outsider", "creator", "friend", "subject"] as const) {
      for (const path of Object.keys(contractCases)) {
        for (const at of [T0, REVEAL + 1]) {
          vi.setSystemTime(at);
          const each = await v0Fixture();
          secrets.push(...fixtureSecrets(each).filter((value) => value !== each.runId));
          try {
            await invoke(each, path, role === "anonymous" ? "synthetic_anonymous" : each.actors[role].token);
            reached.add(role + " " + path);
          } catch (error) {
            expect(error).toBeInstanceOf(ConvexError);
          }
        }
      }
    }
    const authenticated = ["v0Auth:me", "v0Auth:revoke", "v0Auth:createPair", "v0Groups:create", "v0Groups:invitations", "v0Groups:members", "v0Groups:linkConversation", "v0Groups:resolveConversation", "v0Groups:unlinkConversation", "v0Groups:turn", "v0Groups:passTurn", "v0Groups:recap", "v0Groups:board", "v0Bets:get", "v0Bets:list", "v0Bets:history", "v0Proof:list", "v0Proof:read", "v0Controls:get", "v0Controls:update", "v0Controls:alias", "v0Controls:leave", "v0Controls:deleteAccount", "v0Controls:report", "v0Controls:block", "v0Suggestions:get", "v0Notifications:register", "v0Notifications:unregister", "v0Notifications:preferences", "v0Notifications:setPreferences"];
    for (const path of [...authenticated, "v0Bets:pick", "v0Groups:invite"]) expect(reached.has("friend " + path) || reached.has("creator " + path), path).toBe(true);
    for (const path of ["v0Bets:veto", "v0Bets:answer", "v0Proof:upload"]) expect(reached.has("subject " + path), path).toBe(true);
    expect(reached.has("outsider v0Groups:accept")).toBe(true);
    const output = spies.flatMap((spy) => spy.mock.calls).map((entry) => entry.map(logged).join(" ")).join("\n");
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(output).not.toMatch(/Basic [A-Za-z0-9+/=]{8,}/);
  });

  it("[SEC2.secret-free-logs.source] has no log statement in backend source that names a credential, phone, code or session", () => {
    const files = readdirSync("convex").filter((name) => name.endsWith(".ts"));
    expect(files).toContain("v0Auth.ts");
    for (const name of files) {
      for (const line of readFileSync("convex/" + name, "utf8").split("\n")) {
        if (/console\s*\.\s*\w+\s*\(/.test(line)) expect(line, name).not.toMatch(/token|phone|code|secret|pepper|authorization|password|passcode|session|key|sid|bytes|\bargs?\b|request|account/i);
      }
    }
  });
});
