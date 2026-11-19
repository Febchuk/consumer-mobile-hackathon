import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { appConnections, assertBuiltAppHasNoEndpoint, assertLoopbackOrigin, buildManifest, combineStatuses, inheritedCredentials, networkIsolation, planParts } from "./guard.mjs";

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
