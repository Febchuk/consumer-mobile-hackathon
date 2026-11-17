import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const folder = await mkdtemp(join(tmpdir(), "UNIT-NOT-RUNTIME-CONTROLLER-"));
after(async () => { await rm(folder, { recursive: true, force: true }); });
const output = join(folder, "controller.mjs");
await build({ entryPoints: [fileURLToPath(new URL("./controller.ts", import.meta.url))], outfile: output, bundle: true, platform: "node", format: "esm" });
const { createLiveProvisioningController, LiveIsolationUnproven } = await import(pathToFileURL(output).href);
const options = () => ({
  contextPath: join(folder, "UNIT-NOT-A-REAL-CONTEXT.json"),
  expectedSourceCardOrigin: "https://cards.qa-runtime.invalid",
  expectedHarnessSources: Object.fromEntries(["status.py", "lease.py", "launch_provenance.py", "provision.py", "job.py", "netprobe.py", "global_pf.py", "controller.ts"].map((name) => [name, "0".repeat(64)])),
  expected: { runID: "11111111-2222-4333-8444-555555555555", simulatorUDID: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE", nativeSourceRevision: "a".repeat(40), backendSourceRevision: "b".repeat(40),
    deploymentID: "qa-11111111-2222-4333-8444-555555555555", configVersion: "UNIT", fixtureSetID: "UNIT-NO-HANDLERS", apiOrigin: "http://127.0.0.1:8199", cardOrigin: "http://127.0.0.1:3211" },
});

test("SIM-CONTROLLER-01 rejects generic/non-Mac admission without spawning a kernel verifier", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "linux" });
  try {
    const controller = createLiveProvisioningController(options());
    await assert.rejects(controller.assertLiveIsolation(), LiveIsolationUnproven);
    await assert.rejects(controller.verify({ receipt: {}, artifacts: new Map() }), LiveIsolationUnproven);
  } finally { Object.defineProperty(process, "platform", descriptor); }
});

test("SIM-CONTROLLER-02 requires independently supplied source pins and the exact approved origin", () => {
  assert.throws(() => createLiveProvisioningController({ ...options(), expectedHarnessSources: {} }), LiveIsolationUnproven);
  assert.throws(() => createLiveProvisioningController({ ...options(), expectedSourceCardOrigin: "https://cards.qa-source.invalid" }), LiveIsolationUnproven);
  assert.throws(() => createLiveProvisioningController({ ...options(), expectedSourceCardOrigin: "https://cards.qa-runtime.invalid/" }), LiveIsolationUnproven);
});

const unitOutput = join(folder, "UNIT-FABRICATED-VERIFIER.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("./controller.ts", import.meta.url))], outfile: unitOutput, bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "UNIT-only-no-kernel-process", setup(builder) {
    builder.onResolve({ filter: /^node:child_process$/ }, () => ({ path: "UNIT-only", namespace: "UNIT" }));
    builder.onLoad({ filter: /.*/, namespace: "UNIT" }, () => ({ contents: "export function execFile(path, args, options, callback) { globalThis.unitVerifierCalls++; callback(null, {stdout: JSON.stringify(globalThis.unitFabricatedStatus), stderr: ''}); }" }));
  } }],
});
const unitController = (await import(pathToFileURL(unitOutput).href)).createLiveProvisioningController;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function unitLiveFixture() {
  const directory = await mkdtemp(join(folder, "UNIT-NOT-REAL-PROVENANCE-"));
  const harnessDirectory = join(directory, "harness");
  await mkdir(harnessDirectory);
  const supplied = options();
  const sources = {};
  for (const name of Object.keys(supplied.expectedHarnessSources)) {
    const bytes = Buffer.from("UNIT FABRICATED SOURCE, NEVER EXECUTED: " + name);
    await writeFile(join(harnessDirectory, name), bytes);
    sources[name] = hash(bytes);
  }
  const launch = { version: 2, runID: supplied.expected.runID, launchNonce: "77777777-8888-4999-AAAA-BBBBBBBBBBBB" };
  const launchBytes = Buffer.from(JSON.stringify(launch));
  const trustedLaunchContext = join(directory, "UNIT-prelaunch.json");
  await writeFile(trustedLaunchContext, launchBytes);
  const context = { version: 1, phase: "isolated-runtime", ownerPID: 535, simulatorUDID: supplied.expected.simulatorUDID,
    harnessDirectory, manifestPath: join(directory, "manifest.json"), receiptPath: join(directory, "receipt.json"),
    trustedLaunchContext, trustedLaunchSHA256: hash(launchBytes), request: { ...supplied.expected, sourceCardOrigin: supplied.expectedSourceCardOrigin } };
  const contextPath = join(directory, "context.json");
  await writeFile(contextPath, JSON.stringify(context));
  const fingerprint = "a".repeat(64);
  const harness = Object.fromEntries(Object.keys(sources).sort().map((name) => ["tests/simulator-provisioner/" + name, sources[name]]));
  const status = { runID: supplied.expected.runID, ownerPID: 535, leasePID: 536, checkedAt: Date.now(), sourceFingerprints: sources,
    device: { runID: supplied.expected.runID, simulatorUDID: supplied.expected.simulatorUDID, independentErase: { exit: 0 } },
    rootLaunchWitnessSHA256: fingerprint,
    runnerAuthorization: { version: 2, runID: launch.runID, launchNonce: launch.launchNonce, guestBootSessionUUID: "BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF",
      contextSHA256: context.trustedLaunchSHA256, sourceManifestSHA256: fingerprint, launchPlanSHA256: fingerprint,
      harnessSHA256: hash(Buffer.from(JSON.stringify(harness))), guardSHA256: fingerprint, configurationSHA256: fingerprint,
      reviewedAuthoritySHA256: fingerprint, providerReadableSHA256: fingerprint,
      authorityScope: { tool: "mobile.build", platform: "ios", source: "workspace", provider: "revyl-remote-builds",
        guest: "one-clean-single-use-private-vm", cache: "compilation-only", entry: "archived-build-commands" } } };
  status.runnerAuthorization.chainSHA256 = hash(Buffer.from(JSON.stringify(status.runnerAuthorization, (_key, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    return entry;
  })));
  status.runnerAuthorization.checkedAt = Date.now();
  return { options: { ...supplied, contextPath, expectedHarnessSources: sources }, status };
}

test("SIM-CONTROLLER-03 design-only mocked status accepts nonce/source/current-boot chain with no job ID", async () => {
  const fixture = await unitLiveFixture();
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "darwin" });
  globalThis.unitFabricatedStatus = fixture.status;
  globalThis.unitVerifierCalls = 0;
  try {
    await unitController(fixture.options).assertLiveIsolation();
    assert.equal(globalThis.unitVerifierCalls, 1);
    assert.equal("buildID" in fixture.status.runnerAuthorization, false);
  } finally {
    Object.defineProperty(process, "platform", descriptor);
    delete globalThis.unitFabricatedStatus;
    delete globalThis.unitVerifierCalls;
  }
});

test("SIM-CONTROLLER-04 design-only mocked status rejects missing boot, nonce/context/source/configuration mismatches", async () => {
  const fixture = await unitLiveFixture();
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "darwin" });
  try {
    for (const change of [{ guestBootSessionUUID: undefined }, { launchNonce: fixture.options.expected.runID },
      { contextSHA256: "0".repeat(64) }, { harnessSHA256: "0".repeat(64) }, { configurationSHA256: "0".repeat(64) }]) {
      globalThis.unitFabricatedStatus = { ...fixture.status, runnerAuthorization: { ...fixture.status.runnerAuthorization, ...change } };
      await assert.rejects(unitController(fixture.options).assertLiveIsolation(), /Actual authorized runner/);
    }
  } finally {
    Object.defineProperty(process, "platform", descriptor);
    delete globalThis.unitFabricatedStatus;
    delete globalThis.unitVerifierCalls;
  }
});
