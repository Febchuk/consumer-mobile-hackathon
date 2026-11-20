import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

// The only application a simulated notification may be handed to: the QA host app.
export const hostBundle = "com.mikunad.calledit.qa.host";

// The alert the product's APNs worker sends, read from its source so a simulated arrival cannot invent a text of its own.
export function alertFromSource(source) {
  const found = [...String(source).matchAll(/aps: \{ alert: \{ title: "([^"\\]+)", body: "([^"\\]+)" \}, sound: "default" \}/g)];
  assert.equal(found.length, 1, "The APNs worker's alert changed; review the simulated notification before running");
  return { title: found[0][1], body: found[0][2] };
}

/**
 * The payload the product's worker would send for one outbox row: the fixed alert, the row's kind, and the two opaque
 * identifiers the worker adds (v0Notifications:authorizeDevice and v0Apns:sendApnsRequest). `row`, `groups` and `bets`
 * come from the control server's inspect of the real tables.
 */
export function payloadForRow({ row, groups, bets, alert }) {
  assert.ok(row && ["turn", "reveal", "result", "recap"].includes(row.kind), "Not an outbox row the worker would send");
  assert.ok(row.state !== "failed", "The server gave up on this notification");
  const groupId = row.group ? groups[row.group] : undefined;
  assert.ok(!row.group || typeof groupId === "string", "The outbox row's group is not a fixture group");
  const bet = row.betId ? bets.find((item) => item.id === row.betId) : undefined;
  assert.ok(!row.betId || (bet && /^[a-f0-9]{64}$/.test(bet.locator)), "The outbox row's bet has no usable locator");
  assert.ok(groupId || bet, "The outbox row names neither a group nor a bet");
  const payload = { aps: { alert: { title: alert.title, body: alert.body }, sound: "default" }, kind: row.kind, ...(groupId ? { groupId } : {}), ...(bet ? { locator: bet.locator } : {}) };
  return assertNeutralPayload(payload);
}

// What may be in a payload at all: the alert, the kind and opaque identifiers. Anything else is refused before delivery.
export function assertNeutralPayload(payload) {
  assert.deepEqual(Object.keys(payload).filter((key) => !["aps", "kind", "groupId", "locator"].includes(key)), [], "A notification carries only its alert, kind and opaque identifiers");
  assert.deepEqual(Object.keys(payload.aps ?? {}).sort(), ["alert", "sound"], "Unexpected alert fields");
  assert.deepEqual(Object.keys(payload.aps.alert).sort(), ["body", "title"], "Unexpected alert fields");
  for (const key of ["groupId", "locator"]) assert.ok(payload[key] === undefined || /^[A-Za-z0-9_-]{1,256}$/.test(payload[key]), key + " is not an opaque identifier");
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 4096, "A notification payload is at most 4096 bytes");
  return payload;
}

// The simctl arguments for one delivery. The device is never taken from a caller: it is the simulator the run created, and
// the application must be the QA host app. simctl push talks to no Apple service.
export function pushArguments({ runSimulator, bundle, file }) {
  assert.match(String(runSimulator ?? ""), /^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/, "This run has no simulator of its own");
  assert.equal(bundle, hostBundle, "Refusing an application that is not the QA host app");
  assert.ok(typeof file === "string" && file.startsWith("/") && file.endsWith(".json"), "A payload file is required");
  return ["simctl", "push", runSimulator, bundle, file];
}
