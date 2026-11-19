import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { appConnections, assertBuiltAppHasNoEndpoint, assertLoopbackOrigin, buildManifest, combineStatuses, inheritedCredentials, networkIsolation, planParts, applyTestRetries, failureMessages, parseTestCases, referenceRunHasTestRetry, retryPolicy, testRetryCounts } from "./guard.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("only canonical numeric loopback HTTP origins are accepted", () => {
  assert.equal(assertLoopbackOrigin("http://127.0.0.1:8199"), "http://127.0.0.1:8199");
  for (const value of ["https://127.0.0.1:8199", "http://localhost:8199", "http://127.0.0.1", "http://127.0.0.1:80", "http://127.0.0.2:8199", "http://127.0.0.1:8199/api", "http://user@127.0.0.1:8199", "http://127.0.0.1:8199?x=1", "http://reliable-kookabura-33.convex.cloud", "https://reliable-kookabura-33.convex.cloud", "http://127.0.0.1.example.com:8199", "http://[::1]:8199", "http://0.0.0.0:8199", undefined]) {
    assert.throws(() => assertLoopbackOrigin(value), "accepted " + value);
  }
});

test("a manifest cannot be built for a target that is not loopback", () => {
  const base = { runID: "8B5C2B5E-3C0B-4E0B-9B55-0A3D4C6D7E8F", simulatorUDID: "E7E5B8A3-5E4B-40CB-B89B-EB420C2C33E4", nativeSourceRevision: "a".repeat(40), backendSourceRevision: "b".repeat(40), apiOrigin: "http://127.0.0.1:8199", cardOrigin: "http://127.0.0.1:3211", fixtureSetID: "synthetic-v0-native-journeys", configVersion: "native-sim.1", now: 1_000, lifetimeMs: 3_600_000 };
  const manifest = buildManifest(base);
  assert.equal(manifest.deploymentID, "qa-" + base.runID);
  assert.deepEqual([manifest.outboundNetworkDenied, manifest.outboundNetworkObserved, networkIsolation], [false, true, "observed"], "this lane never claims outbound traffic was denied");
  assert.equal(manifest.expiresAt - manifest.issuedAt, 3_600_000);
  assert.throws(() => buildManifest({ ...base, apiOrigin: "https://reliable-kookabura-33.convex.cloud" }));
  assert.throws(() => buildManifest({ ...base, cardOrigin: "https://calledit.example" }));
  assert.throws(() => buildManifest({ ...base, lifetimeMs: 3_600_001 }));
  assert.throws(() => buildManifest({ ...base, nativeSourceRevision: "HEAD" }));
});

test("deployment and provider variables are named, never forwarded", () => {
  assert.deepEqual(inheritedCredentials({ PATH: "/usr/bin", CONVEX_DEPLOY_KEY: "x", TWILIO_AUTH_TOKEN: "y", V0_APNS_PRIVATE_KEY: "z", EMPTY_TWILIO: "", OPENAI_API_KEY: "" }), ["CONVEX_DEPLOY_KEY", "TWILIO_AUTH_TOKEN", "V0_APNS_PRIVATE_KEY"]);
});

test("a QA build with a built-in endpoint is refused", () => {
  const clean = { CalledItBuildChannel: "qa", CalledItFixtureMode: false, CalledItAPIURL: "", CalledItWebURL: "" };
  assertBuiltAppHasNoEndpoint(clean);
  assert.throws(() => assertBuiltAppHasNoEndpoint({ ...clean, CalledItAPIURL: "https://reliable-kookabura-33.convex.cloud" }));
  assert.throws(() => assertBuiltAppHasNoEndpoint({ ...clean, CalledItExpectedAPIHost: "reliable-kookabura-33.convex.cloud" }));
  assert.throws(() => assertBuiltAppHasNoEndpoint({ ...clean, CalledItBuildChannel: "release" }));
  assert.throws(() => assertBuiltAppHasNoEndpoint({ ...clean, CalledItFixtureMode: true }));
});

test("only the app's own processes count as the app leaving loopback", () => {
  const rows = [{ process: "apsd", remote: "17.57.144.10:5223" }, { process: "CalledItMessages", remote: "93.184.216.34:443" }, { process: "CalledItExtension", remote: "93.184.216.34:443" }, { process: "MobileSMS", remote: "17.0.0.1:443" }];
  assert.deepEqual(appConnections(rows).map((row) => row.process), ["CalledItMessages", "CalledItExtension"]);
  assert.deepEqual(appConnections(rows.slice(0, 1)), []);
});

test("the observed-network code cannot be compiled into a Debug or Release build", () => {
  const project = readFileSync(new URL("../../native-imessage/project.yml", import.meta.url), "utf8");
  const block = (name) => new RegExp("\\n    " + name + ":\\n((?:      .*\\n)+)").exec(project)?.[1] ?? "";
  for (const name of ["Debug", "Release"]) {
    assert.match(block(name), /EXCLUDED_SOURCE_FILE_NAMES: "QA\*\.swift"/, name + " must exclude QA*.swift");
    assert.doesNotMatch(block(name), /SWIFT_ACTIVE_COMPILATION_CONDITIONS/, name + " must not define QA");
  }
  assert.match(block("QA"), /SWIFT_ACTIVE_COMPILATION_CONDITIONS: "\$\(inherited\) QA"/);
  assert.match(readFileSync(new URL("../../native-imessage/Shared/QANetworkIsolation.swift", import.meta.url), "utf8"), /^#if QA\n/);
});

test("every class lands in exactly one part and no part outgrows an activation", () => {
  const classes = [{ name: "A", tests: 7 }, { name: "B", tests: 6 }, { name: "C", tests: 4 }, { name: "D", tests: 3 }, { name: "E", tests: 16 }];
  const parts = planParts(classes);
  assert.deepEqual(parts.flat().map((item) => item.name).sort(), ["A", "B", "C", "D", "E"]);
  for (const part of parts) assert.ok(part.reduce((sum, item) => sum + item.tests, 0) <= 16);
  assert.throws(() => planParts([{ name: "Huge", tests: 17 }]));
  assert.throws(() => planParts([{ name: "Empty", tests: 0 }]));
});

test("a combined run is never better than its worst or missing part", () => {
  assert.equal(combineStatuses(["passed", "passed"], 2), "passed");
  assert.equal(combineStatuses(["passed", "passed-with-retries"], 2), "passed-with-retries");
  assert.equal(combineStatuses(["passed", "failed"], 2), "failed");
  assert.equal(combineStatuses(["passed"], 2), "blocked");
  assert.equal(combineStatuses(["passed", "blocked"], 2), "blocked");
  assert.equal(combineStatuses(["passed", "no-evidence"], 2), "blocked");
});

test("the one-time test retry is refused on reference hardware", () => {
  assert.equal(retryPolicy({ retryFailedOnce: false, referenceHardware: true }), false);
  assert.equal(retryPolicy({ retryFailedOnce: true, referenceHardware: false }), true);
  assert.throws(() => retryPolicy({ retryFailedOnce: true, referenceHardware: true }), /refused with --reference-hardware/);
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("./run.mjs", import.meta.url)), "--reference-hardware", "--retry-failed-once"], { encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /refused with --reference-hardware/);
});

test("a test that passes on its second attempt is recorded, and one that fails twice stays failed", () => {
  const log = [
    "/x/A.swift:9: error: -[CalledItUITests.A testOne] : failed - first message",
    "Test Case '-[CalledItUITests.A testOne]' failed (10.5 seconds).",
    "Test Case '-[CalledItUITests.A testTwo]' passed (3.0 seconds).",
    "/x/B.swift:4: error: -[CalledItUITests.B testThree] : failed - other message",
    "Test Case '-[CalledItUITests.B testThree]' failed (7.0 seconds).",
    "Test Case '-[CalledItUITests.B testFour]' failed (1.0 seconds).",
  ].join("\n");
  const cases = parseTestCases(log).map((item) => item.result === "failed" ? { ...item, failures: failureMessages(log, item.id), resultBundle: "first" } : item);
  assert.deepEqual(cases.map((item) => item.id + ":" + item.result), ["A/testOne:failed", "A/testTwo:passed", "B/testThree:failed", "B/testFour:failed"]);
  assert.deepEqual(cases[0].failures, ["failed - first message"]);
  const settled = applyTestRetries(cases, new Map([["A/testOne", { result: "passed", seconds: 9, failures: [], resultBundle: "second" }], ["B/testThree", { result: "failed", seconds: 8, failures: ["failed - again"], resultBundle: "third" }]]));
  assert.deepEqual(settled.cases.map((item) => item.id + ":" + item.result + ":" + (item.attempts ?? 1)), ["A/testOne:passed:2", "A/testTwo:passed:1", "B/testThree:failed:2", "B/testFour:failed:1"]);
  assert.deepEqual(settled.cases[0].firstAttempt, { result: "failed", seconds: 10.5, failures: ["failed - first message"], resultBundle: "first" });
  assert.deepEqual(settled.retries.map((retry) => retry.test + ":" + retry.passedOnRetry), ["A/testOne:true", "B/testThree:false"]);
  assert.deepEqual(testRetryCounts([...settled.retries, ...settled.retries]), { "A/testOne": 2, "B/testThree": 2 });
  // Nothing is retried, nothing changes.
  assert.deepEqual(applyTestRetries(cases, new Map()), { cases, retries: [] });
});

test("a reference-hardware record with a retried test is recognised", () => {
  const retried = { retries: [{ kind: "test-retry" }], tests: { cases: [{ attempts: 2 }], testRetries: [{}] } };
  assert.equal(referenceRunHasTestRetry({ latencyBudgets: { mode: "enforced" }, ...retried }), true);
  assert.equal(referenceRunHasTestRetry({ latencyBudgets: { mode: "enforced" }, retries: [], tests: { cases: [{ attempts: 2 }] } }), true);
  assert.equal(referenceRunHasTestRetry({ latencyBudgets: { mode: "enforced" }, retries: [{ kind: "retype" }], tests: { cases: [{}], testRetries: [] } }), false);
  assert.equal(referenceRunHasTestRetry({ latencyBudgets: { mode: "measured-only" }, ...retried }), false);
});
