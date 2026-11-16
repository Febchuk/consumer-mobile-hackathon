import { readFileSync } from "node:fs";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { fixture } from "./fixture";
import { syntheticProviders } from "./adapters";
import { qaBundles, requireFixtureTarget } from "./target-guard";

describe("HARNESS isolation (not product coverage)", () => {
  it("[HARNESS.environment] has no inherited credentials or deployment target", () => {
    expect(process.env.E2E_ISOLATED).toBe("network-namespace-v1");
    expect(Object.keys(process.env).filter((key) => /(?:KEY|SECRET|TOKEN|PASSCODE|CONVEX.*(?:URL|DEPLOY))/i.test(key))).toEqual([]);
    expect(readFileSync("/proc/net/route", "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("[HARNESS.fetch-denied] denies unexpected fetch", async () => {
    await expect(fetch("https://example.invalid")).rejects.toThrow("Outbound transport denied");
  });

  it("[HARNESS.socket-denied] denies a direct nonlocal socket outside the fetch mock", async () => {
    const error = await new Promise<Error>((resolve, reject) => {
      const socket = new Socket();
      socket.setTimeout(500, () => { socket.destroy(); reject(new Error("Network isolation did not immediately deny the route")); });
      socket.once("connect", () => { socket.destroy(); reject(new Error("Unexpected external connection")); });
      socket.once("error", (reason) => { socket.destroy(); resolve(reason); });
      socket.connect(443, "192.0.2.1");
    });
    expect(error.message).toMatch(/ENETUNREACH|EHOSTUNREACH|EPERM|EACCES/);
  });

  it("[HARNESS.fresh-db] creates unrelated namespace and fresh schema-validated database", async () => {
    const a = await fixture();
    const b = await fixture();
    expect(a.runId).not.toBe(b.runId);
    const bQuestions = await b.t.run(async (ctx) => (await ctx.db.query("bets").collect()).map((bet) => bet.question));
    expect(bQuestions).toEqual([b.secret]);
    expect(bQuestions).not.toContain(a.secret);
    await expect(b.t.run((ctx) => ctx.db.insert("bets", { question: "invalid missing required schema fields" } as never))).rejects.toThrow();
  });

  it("[HARNESS.providers] starts fake providers denied and keeps independent outboxes/storage", async () => {
    const a = syntheticProviders("e2e_a");
    const b = syntheticProviders("e2e_b");
    expect(await a.verifyOtp("synthetic_phone", "synthetic_code")).toEqual({ approved: false });
    await a.sendPush("e2e_a_1", "synthetic_friend", { kind: "reveal", locator: "opaque" });
    await a.sendPush("e2e_a_1", "synthetic_friend", { kind: "reveal", locator: "opaque" });
    expect(a.outbox).toHaveLength(1);
    expect(b.outbox).toEqual([]);
    await expect(a.sendPush("not_a_run", "real_recipient", {})).rejects.toThrow();
    const media = a.storage.put("synthetic_owner", new Uint8Array([1, 2]), "image/png");
    expect(() => b.storage.get("synthetic_owner", media)).toThrow();
    expect(() => a.storage.get("synthetic_outsider", media)).toThrow();
    a.storage.deleteOwner("synthetic_owner");
    expect(() => a.storage.get("synthetic_owner", media)).toThrow();
  });

  const clockCases = JSON.parse(readFileSync("tests/fixtures/clock-boundaries.json", "utf8")) as { utc: string; zone: string; localDate: string; localHour: string }[];
  for (const clock of clockCases) {
    it(`[HARNESS.clock.${clock.zone}.${clock.utc}] validates the DST/timezone fixture, not worker behavior`, () => {
      vi.setSystemTime(new Date(clock.utc));
      expect(Date.now()).toBe(Date.parse(clock.utc));
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: clock.zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(Date.now());
      const value = (kind: string) => parts.find((p) => p.type === kind)?.value;
      expect(`${value("year")}-${value("month")}-${value("day")}`).toBe(clock.localDate);
      expect(value("hour")).toBe(clock.localHour);
    });
  }

  const target = { mode: "native-simulator", runId: `e2e_${"a".repeat(32)}`, endpoint: "http://127.0.0.1:8199", bundleId: qaBundles.host, fixtureMode: true, candidateSha: "a".repeat(40) };
  it("[HARNESS.allow-local] permits only attested local fixtures", () => {
    expect(() => requireFixtureTarget(target)).not.toThrow();
    expect(() => requireFixtureTarget({ ...target, mode: "memory", endpoint: undefined, bundleId: undefined })).not.toThrow();
  });

  for (const endpoint of ["https://reliable-kookabura-33.convex.cloud", "https://reliable-kookabura-33.convex.site", "http://localhost.evil.invalid:80", "http://127.0.0.1@production.invalid:8199", "http://192.0.2.1:8199", "http://localhost:8199/?target=production", "https://localhost:8199"]) {
    it(`[HARNESS.deny-target.${endpoint}] rejects a nonlocal or ambiguous target`, () => {
      expect(() => requireFixtureTarget({ ...target, endpoint })).toThrow();
    });
  }

  it("[HARNESS.deny-production-bundle] rejects release bundle IDs and missing fixture attestation", () => {
    expect(() => requireFixtureTarget({ ...target, bundleId: "com.mikunad.calledit.messages" })).toThrow();
    expect(() => requireFixtureTarget({ ...target, fixtureMode: false })).toThrow();
    expect(() => requireFixtureTarget({ ...target, runId: "QA Pair" })).toThrow();
  });
});
