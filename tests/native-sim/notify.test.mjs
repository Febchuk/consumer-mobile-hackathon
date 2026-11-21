import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { alertFromSource, assertNeutralPayload, hostBundle, payloadForRow, pushArguments } from "./notify.mjs";

const alert = { title: "Called It", body: "Open Called It for an update." };
const groups = { G1: "k57group" };
const bets = [{ id: "k57bet", locator: "a".repeat(64) }];

test("the simulated alert is the one the product's APNs worker sends", () => {
  const source = readFileSync(fileURLToPath(new URL("../../convex/v0Apns.ts", import.meta.url)), "utf8");
  assert.deepEqual(alertFromSource(source), alert);
  assert.throws(() => alertFromSource("no alert here"));
  assert.throws(() => alertFromSource(source + source), "two alerts must be reviewed, not guessed between");
});

test("a payload is built from an outbox row and carries only the alert, the kind and opaque identifiers", () => {
  assert.deepEqual(payloadForRow({ row: { kind: "reveal", actor: "finn", group: "G1", betId: "k57bet", state: "pending" }, groups, bets, alert }), { aps: { alert, sound: "default" }, kind: "reveal", groupId: "k57group", locator: "a".repeat(64) });
  assert.deepEqual(payloadForRow({ row: { kind: "turn", actor: "cora", group: "G1", betId: null, state: "pending" }, groups, bets, alert }), { aps: { alert, sound: "default" }, kind: "turn", groupId: "k57group" });
  assert.throws(() => payloadForRow({ row: undefined, groups, bets, alert }), "no row, no notification");
  assert.throws(() => payloadForRow({ row: { kind: "chat", group: "G1", betId: null, state: "pending" }, groups, bets, alert }));
  assert.throws(() => payloadForRow({ row: { kind: "turn", group: "G9", betId: null, state: "pending" }, groups, bets, alert }));
  assert.throws(() => payloadForRow({ row: { kind: "reveal", group: "G1", betId: "unknown", state: "pending" }, groups, bets, alert }));
  assert.throws(() => payloadForRow({ row: { kind: "reveal", group: "G1", betId: "k57bet", state: "failed" }, groups, bets, alert }));
  assert.throws(() => payloadForRow({ row: { kind: "turn", group: null, betId: null, state: "pending" }, groups, bets, alert }));
});

test("a payload with anything but neutral fields is refused", () => {
  const base = { aps: { alert, sound: "default" }, kind: "reveal", groupId: "k57group" };
  assertNeutralPayload(base);
  assert.throws(() => assertNeutralPayload({ ...base, question: "Will Sage be late?" }));
  assert.throws(() => assertNeutralPayload({ ...base, aps: { alert: { ...alert, subtitle: "QA Sage" }, sound: "default" } }));
  assert.throws(() => assertNeutralPayload({ ...base, aps: { alert, sound: "default", badge: 1 } }));
  assert.throws(() => assertNeutralPayload({ ...base, locator: "https://example.com/c/1" }));
});

test("a delivery can only name the run's own simulator and the QA host app", () => {
  const runSimulator = "E7E5B8A3-5E4B-40CB-B89B-EB420C2C33E4";
  const file = "/tmp/payload.json";
  assert.deepEqual(pushArguments({ runSimulator, bundle: hostBundle, file }), ["simctl", "push", runSimulator, hostBundle, file]);
  assert.deepEqual(pushArguments({ runSimulator, bundle: hostBundle, file, udid: "booted", device: "booted" }).slice(2, 3), [runSimulator], "a device named by a caller is ignored");
  assert.throws(() => pushArguments({ runSimulator, bundle: "com.apple.MobileSMS", file }));
  assert.throws(() => pushArguments({ runSimulator, bundle: "com.mikunad.calledit.host", file }), "the release app is not the QA host app");
  assert.throws(() => pushArguments({ runSimulator, bundle: hostBundle + ".messages", file }), "the extension is not the QA host app");
  assert.throws(() => pushArguments({ runSimulator: undefined, bundle: hostBundle, file }), "a backend-only run has no simulator");
  assert.throws(() => pushArguments({ runSimulator: "booted", bundle: hostBundle, file }));
  assert.throws(() => pushArguments({ runSimulator, bundle: hostBundle, file: "payload.json" }));
});
