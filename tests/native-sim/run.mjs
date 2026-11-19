// One command: node tests/native-sim/run.mjs
// Boots the pinned Convex backend on loopback with synthetic fixtures, creates a dedicated erased simulator, builds the
// QA app and runs the native UI tests against it. See tests/native-sim/README.md.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { actors, bootNativeBackend } from "./backend.mjs";
import { appConnections, assertBuiltAppHasNoEndpoint, buildManifest, applyTestRetries, combineStatuses, expectedTests, failureMessages, inheritedCredentials, networkIsolation, parseTestCases, planParts, ports, referenceRunHasTestRetry, retryPolicy, testRetryCounts } from "./guard.mjs";
import { assertNoAppleAccount, createDedicatedSimulator, destroySimulator, nonLoopbackConnections, pickRuntime, waitForDestination } from "./simulator.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const native = resolve(root, "native-imessage");
const argv = process.argv.slice(2);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const options = (name) => argv.flatMap((value, index) => (value === name ? [argv[index + 1]] : []));
const flag = (name) => argv.includes(name);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const say = (message) => console.log("[native-sim] " + message);
const fixtureSetID = "synthetic-v0-native-journeys";
// Product latency budgets are enforced only when the machine is declared as reference hardware; otherwise they are
// measured and recorded. Waits in the test helpers can be stretched for a slower machine without touching a budget.
const referenceHardware = flag("--reference-hardware");
const waitScale = Number(option("--wait-scale") ?? 1);
assert.ok(Number.isFinite(waitScale) && waitScale >= 1 && waitScale <= 8, "--wait-scale takes a number from 1 to 8");
assert.ok(!(referenceHardware && waitScale !== 1), "Reference hardware runs at wait scale 1");
// Off by default. On a slow shared runner a failed test may be run once more in a fresh launch; a pass on the second attempt is
// recorded as a test-retry and never reads as a clean pass. Refused on reference hardware.
const retryFailedOnce = retryPolicy({ retryFailedOnce: flag("--retry-failed-once"), referenceHardware });
const configVersion = "native-sim.1";

if (flag("--help")) {
  console.log("Usage: node tests/native-sim/run.mjs [--only <Class[/test]>]... [--demo] [--backend-only] [--output <dir>] [--runtime <id|version>] [--device-type <id>] [--keep-simulator] [--reference-hardware] [--wait-scale <1-8>] [--retry-failed-once]");
  process.exit(0);
}

const stripped = inheritedCredentials(process.env);
const environment = { PATH: ["/opt/homebrew/bin", process.env.PATH ?? "/usr/bin:/bin"].join(":"), HOME: homedir(), USER: userInfo().username, LOGNAME: userInfo().username, LANG: "en_US.UTF-8" };
if (process.env.DEVELOPER_DIR) environment.DEVELOPER_DIR = process.env.DEVELOPER_DIR;
process.env.PATH = environment.PATH;
const run = (command, args, extra = {}) => execFileSync(command, args, { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...extra });

const guard = spawnSync(process.execPath, ["--test", resolve(here, "guard.test.mjs")], { cwd: root, env: environment, stdio: "inherit" });
if (guard.status !== 0) { console.error("[native-sim] The loopback guard's own tests failed; nothing was started."); process.exit(1); }

// A QA activation lasts at most one hour, and the whole suite takes longer than that. A run without --only therefore
// runs the journey classes in parts, each a complete run of this script with its own simulator, backend and activation,
// and writes one combined evidence.json. Every class found in the UI test sources lands in exactly one part.
if (!options("--only").length && !flag("--demo") && !flag("--backend-only")) {
  const sources = resolve(native, "UITests");
  const classes = readdirSync(sources).filter((name) => name.endsWith(".swift")).flatMap((name) => {
    const text = readFileSync(resolve(sources, name), "utf8");
    return [...text.matchAll(/^final class (\w+): JourneyCase/gm)].map((match) => ({ name: match[1], tests: (text.match(/^ {4}func test\w+\(\)/gm) ?? []).length }));
  }).sort((a, b) => a.name.localeCompare(b.name));
  const parts = planParts(classes);
  const combinedOutput = resolve(option("--output") ?? resolve(realpathSync(homedir()) + "/.capy/work", "native-sim-" + randomUUID().slice(0, 8).toUpperCase()));
  assert.ok(!existsSync(combinedOutput), "The output directory already exists: " + combinedOutput);
  mkdirSync(combinedOutput, { recursive: true, mode: 0o700 });
  const passThrough = argv.filter((value, index) => value !== "--output" && argv[index - 1] !== "--output");
  const combined = { lane: "native-sim", networkIsolation, startedAt: new Date().toISOString(), status: "blocked", plannedParts: parts.map((part) => part.map((item) => item.name)), parts: [] };
  let current; let stopped;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { stopped = signal; current?.kill("SIGTERM"); });
  for (const [index, part] of parts.entries()) {
    if (stopped) break;
    const directory = resolve(combinedOutput, "part-" + (index + 1));
    say("part " + (index + 1) + " of " + parts.length + ": " + part.map((item) => item.name).join(", "));
    current = spawn(process.execPath, [fileURLToPath(import.meta.url), ...passThrough, ...part.flatMap((item) => ["--only", item.name]), "--output", directory], { cwd: root, env: process.env, stdio: "inherit" });
    const code = await new Promise((accept) => current.once("exit", accept));
    let evidence = null;
    try { evidence = JSON.parse(readFileSync(resolve(directory, "evidence.json"), "utf8")); } catch { /* a part that wrote no evidence is recorded as such */ }
    combined.parts.push({ part: index + 1, classes: part.map((item) => item.name), exitCode: code, directory, status: evidence?.status ?? "no-evidence", sourceRevision: evidence?.sourceRevision ?? null, simulator: evidence?.simulator ?? null, toolchain: evidence?.toolchain ?? null, tests: evidence?.tests ? { passed: evidence.tests.passed, failed: evidence.tests.failed, blocked: evidence.tests.blocked, cases: evidence.tests.cases } : null, latencyBudgets: evidence?.latencyBudgets ?? null, retries: evidence?.retries ?? [], waitScale: evidence?.waitScale ?? null, testRetries: evidence?.tests?.testRetries ?? [], appCallFailures: evidence?.appCallFailures ?? [], appContactedNonLoopback: evidence?.safety?.outboundNetwork?.appContactedNonLoopback ?? null });
  }
  const statuses = combined.parts.map((part) => part.status);
  combined.interruptedBy = stopped ?? null;
  combined.status = combineStatuses(statuses, parts.length);
  combined.totals = { passed: 0, failed: 0, blocked: 0, retries: 0 };
  for (const part of combined.parts) { combined.totals.passed += part.tests?.passed ?? 0; combined.totals.failed += part.tests?.failed ?? 0; combined.totals.blocked += part.tests?.blocked ?? 0; combined.totals.retries += part.retries.length; }
  // Every test that needed its one retry, by name, and how often across the parts of this run.
  combined.testRetries = combined.parts.flatMap((part) => part.testRetries);
  combined.testRetryCounts = testRetryCounts(combined.testRetries);
  combined.passedOnRetry = combined.testRetries.filter((retry) => retry.passedOnRetry).map((retry) => retry.test);
  combined.notRun = ["MessagesDriveTests", "ProvisioningDriveTests"].map((name) => ({ class: name, status: "blocked", reason: "needs the root simulator provisioner's fixtures" }));
  combined.finishedAt = new Date().toISOString();
  writeFileSync(resolve(combinedOutput, "evidence.json"), JSON.stringify(combined, null, 2) + "\n", { mode: 0o600 });
  say("all parts: status " + combined.status + " (outbound network " + networkIsolation + ", not denied): " + combined.totals.passed + " passed, " + combined.totals.failed + " failed, " + combined.totals.blocked + " blocked, " + combined.totals.retries + " recorded retries" + (combined.passedOnRetry.length ? " (passed only on a second attempt: " + combined.passedOnRetry.join(", ") + ")" : "") + "; evidence in " + combinedOutput);
  process.exit(combined.status === "passed" ? 0 : 1);
}

const runID = randomUUID().toUpperCase();
const scratchRoot = realpathSync(homedir()) + "/.capy/work";
mkdirSync(scratchRoot, { recursive: true });
const output = resolve(option("--output") ?? resolve(scratchRoot, "native-sim-" + runID.slice(0, 8)));
assert.ok(!existsSync(output), "The output directory already exists: " + output);
mkdirSync(output, { recursive: true, mode: 0o700 });
const log = (name, text) => writeFileSync(resolve(output, name), text, { mode: 0o600 });
const runnerRetries = [];
const evidence = { lane: "native-sim", runID, startedAt: new Date().toISOString(), status: "blocked", networkIsolation, latencyBudgets: { mode: referenceHardware ? "enforced" : "measured-only", measurements: [] }, waitScale, retries: [], strippedEnvironment: stripped, fixtureSetID, configVersion, safety: {} };
let backend; let closeBackend; let simulator; let sampler; let exitCode = 1; let activationEnds = 0;
const egress = new Map();
const appEgress = new Set();
// The two older UI test classes need the root provisioner's fixtures (tests/simulator-provisioner), which this lane does not supply.
const provisionerOnly = ["MessagesDriveTests", "ProvisioningDriveTests"];
// One place handles an interrupt at any point, so the simulator, the backend and the scratch data are always removed.
let child; let interrupt;
const interrupted = new Promise((_, reject) => {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => {
    if (interrupt) return interrupt();
    evidence.interruptedBy = signal;
    child?.kill("SIGTERM");
    reject(new Error("interrupted by " + signal));
  });
});
interrupted.catch(() => {});

async function portFree(port) {
  return await new Promise((accept) => {
    const probe = createServer();
    probe.once("error", () => accept(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => accept(true)));
  });
}

async function pinnedBinary() {
  const pins = JSON.parse(readFileSync(resolve(root, "tests/qa-runtime/binary-pins.json"), "utf8"));
  const pin = pins.platforms["darwin-arm64"];
  assert.ok(pin.url.startsWith(pins.repository + "/releases/download/" + pins.release + "/"), "The pinned backend is not from the pinned official release");
  const cache = resolve(homedir(), ".cache/calledit/convex-local-backend", pins.release);
  const binary = resolve(cache, pins.executableName);
  if (!existsSync(binary) || sha256(readFileSync(binary)) !== pin.executableSHA256) {
    say("downloading the pinned Convex local backend for Darwin arm64");
    mkdirSync(cache, { recursive: true, mode: 0o700 });
    const scratch = mkdtempSync(resolve(cache, "download-"));
    try {
      const response = await fetch(pin.url, { signal: AbortSignal.timeout(300_000) });
      assert.ok(response.ok, "The pinned backend download failed with HTTP " + response.status);
      const archive = Buffer.from(await response.arrayBuffer());
      assert.equal(sha256(archive), pin.archiveSHA256, "The downloaded backend archive does not match its pin");
      writeFileSync(resolve(scratch, "backend.zip"), archive, { mode: 0o600 });
      run("unzip", ["-q", resolve(scratch, "backend.zip"), pins.executableName, "-d", resolve(scratch, "extracted")]);
      const extracted = resolve(scratch, "extracted", pins.executableName);
      assert.equal(sha256(readFileSync(extracted)), pin.executableSHA256, "The extracted backend executable does not match its pin");
      chmodSync(extracted, 0o700);
      renameSync(extracted, binary);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  return { binary, sha: pin.executableSHA256, release: pins.release };
}

// What the app does first on a real launch, done here through the same gateway before any simulator time is spent.
async function selfCheck() {
  const headers = { "content-type": "application/json", "x-calledit-qa-run-id": runID, "x-calledit-qa-manifest-sha256": evidence.manifestSHA256 };
  const call = async (kind, path, args, extra = {}) => {
    const response = await fetch(backend.apiOrigin + "/api/" + kind, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify({ path, args: [args], format: "convex_encoded_json" }) });
    return { status: response.status, envelope: await response.json() };
  };
  await backend.operations.reset({});
  const attestation = (await call("query", "v0Runtime:attestation", {})).envelope.value;
  assert.deepEqual([attestation.environment, attestation.testAdapters, attestation.qaRunID, attestation.qaManifestSHA256, attestation.deploymentId], ["local", true, runID, evidence.manifestSHA256, "qa-" + runID]);
  assert.equal((await call("query", "v0Runtime:attestation", {}, { "x-calledit-qa-run-id": randomUUID() })).status, 403, "The gateway answered a different run");
  assert.equal((await call("mutation", "qaNative:reset", { runID })).status, 403, "The gateway exposed a fixture function");
  assert.equal((await call("query", "chat:home", {})).status, 403, "The gateway exposed a retired function");
  const requestId = randomUUID();
  const started = await call("action", "v0Auth:requestCode", { phone: actors.finn.phone, requestId });
  assert.equal(started.envelope.status, "success", "The fake code provider did not issue a challenge: " + JSON.stringify(started.envelope.errorData ?? null));
  const wrong = await call("action", "v0Auth:verifyCode", { phone: actors.finn.phone, code: "111111", requestId, deviceId: "self-check" });
  assert.equal(wrong.envelope.status, "error", "A wrong code was accepted");
  const verified = await call("action", "v0Auth:verifyCode", { phone: actors.finn.phone, code: "000000", requestId, deviceId: "self-check" });
  assert.equal(verified.envelope.status, "success", "The fake code was not accepted");
  const me = (await call("query", "v0Auth:me", { token: verified.envelope.value.token })).envelope.value;
  assert.equal(me.account.displayName, actors.finn.alias);
  assert.deepEqual(me.policy.status, "approved", "The backend does not report an approved policy");
  assert.equal(me.groups.length, 2);
  await backend.operations.seedBet({ key: "self-check", group: "G1", creator: "cora", subject: "sage", format: "yes_no" });
  const list = (await call("query", "v0Bets:list", { token: verified.envelope.value.token, groupId: me.groups[0].id })).envelope;
  assert.ok(list.value.every((bet) => bet.card.url.startsWith(backend.cardOrigin + "/c/")), "A card link left loopback");
  const state = await backend.operations.inspect({});
  assert.equal(state.provider.starts, 1);
  assert.deepEqual(state.outbox, []);
  await backend.operations.reset({});
  return { policy: me.policy, providerStarts: 1 };
}

// Leaves the app running in a visible simulator for a person to click through, until the QA activation expires.
async function demo(manifest, manifestBytes) {
  await backend.operations.demo({});
  const app = resolve(evidence.derived, "Build/Products/QA-iphonesimulator/CalledItMessages.app");
  run("xcrun", ["simctl", "install", simulator.udid, app]);
  const launch = () => run("xcrun", ["simctl", "launch", "--terminate-running-process", simulator.udid, "com.mikunad.calledit.qa.host"], { env: { ...environment, SIMCTL_CHILD_CALLED_IT_QA_RUN_ID: runID, SIMCTL_CHILD_CALLED_IT_QA_MANIFEST_BASE64: manifestBytes.toString("base64") } });
  launch();
  spawnSync("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", simulator.udid], { env: environment });
  const until = new Date(manifest.expiresAt - 60_000);
  evidence.status = "demo";
  console.log(["", "Called It is running in the simulator '" + simulator.name + "' against a local backend with made-up data.", "",
    "Sign in with any of these numbers and the code 000000:",
    ...Object.entries(actors).map(([, actor]) => "  " + actor.phone + "  " + actor.alias),
    "", "Start as QA Cora (" + actors.cora.phone + "). Then open Messages, tap OK on the first-run sheet, open a conversation,",
    "tap +, choose Called It and link the conversation to a group.",
    "", "This session ends at " + until.toLocaleTimeString() + " (the test build allows one hour). Press Ctrl-C to stop sooner.",
    "If the Called It app is closed, press Return here to launch it again; opening it from the home screen will not work.", ""].join("\n"));
  process.stdin.on("data", () => { try { launch(); say("relaunched the app"); } catch (error) { say("relaunch failed: " + error.message); } });
  process.stdin.on("error", () => {});
  await new Promise((accept) => {
    const timer = setTimeout(accept, Math.max(0, until.getTime() - Date.now()));
    interrupt = () => { clearTimeout(timer); accept(); };
  });
  say("stopping the demo and removing its simulator and data");
  exitCode = 0;
}

async function main() {
  assert.ok(process.platform === "darwin" && process.arch === "arm64", "This lane runs on an Apple silicon Mac only; elsewhere it is blocked, not passed");
  if (stripped.length) say("not forwarding inherited deployment or provider variables: " + stripped.join(", "));
  assert.ok(!existsSync(resolve(native, "Configuration/QA.local.xcconfig")), "native-imessage/Configuration/QA.local.xcconfig exists and could give the QA build an endpoint; remove it first");
  for (const port of [ports.backend, ports.site, ports.api, ports.control, 43128]) assert.ok(await portFree(port), "Loopback port " + port + " is in use; another run may still be alive");
  const sourceRevision = run("git", ["rev-parse", "HEAD"], { cwd: root }).trim();
  evidence.sourceRevision = sourceRevision;
  evidence.workingTreeDirty = run("git", ["status", "--porcelain", "--", "convex", "native-imessage", "tests"], { cwd: root }).trim() !== "";
  evidence.toolchain = { xcode: run("xcodebuild", ["-version"]).trim().replace(/\n/g, " / "), macOS: run("sw_vers", ["-productVersion"]).trim(), node: process.version };
  const pinned = await pinnedBinary();
  evidence.backend = { release: pinned.release, executableSHA256: pinned.sha };

  if (!flag("--backend-only")) {
    const runtime = pickRuntime(option("--runtime"));
    const deviceType = option("--device-type") ?? "com.apple.CoreSimulator.SimDeviceType.iPhone-17";
    say("creating a dedicated simulator (" + deviceType.split(".").pop() + ", iOS " + runtime.version + ")");
    simulator = createDedicatedSimulator({ runID, deviceType, runtime });
    assertNoAppleAccount(simulator.udid);
    evidence.simulator = { udid: simulator.udid, name: simulator.name, deviceType, runtime: runtime.identifier, runtimeVersion: runtime.version, runtimeBuild: runtime.buildversion, createdForThisRun: true, erasedBeforeBoot: true, appleAccount: "none" };
    say("simulator " + simulator.udid + " is booted");

    say("building the QA app and UI tests");
    run("xcodegen", ["generate"], { cwd: native });
    await waitForDestination(simulator.udid, { project: "CalledItMessages.xcodeproj", scheme: "CalledItMessages", cwd: native, env: environment });
    const derived = resolve(native, "build/native-sim");
    const build = spawnSync("xcodebuild", ["build-for-testing", "-project", "CalledItMessages.xcodeproj", "-scheme", "CalledItMessages", "-configuration", "QA", "-destination", "platform=iOS Simulator,id=" + simulator.udid, "-derivedDataPath", derived, "CALLED_IT_SOURCE_REVISION=" + sourceRevision, "DEVELOPMENT_TEAM=", "CODE_SIGN_IDENTITY=-"], { cwd: native, env: environment, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    log("build.log", (build.stdout ?? "") + (build.stderr ?? ""));
    assert.equal(build.status, 0, "The QA build failed; see build.log in " + output);
    const products = resolve(derived, "Build/Products/QA-iphonesimulator");
    for (const plist of ["CalledItMessages.app/Info.plist", "CalledItMessages.app/PlugIns/CalledItExtension.appex/Info.plist"]) {
      const info = JSON.parse(run("plutil", ["-convert", "json", "-o", "-", resolve(products, plist)]));
      assertBuiltAppHasNoEndpoint(info);
      assert.equal(info.CalledItSourceRevision, sourceRevision, "The built app does not carry this commit");
    }
    evidence.safety.builtAppEndpoint = "none; the launch manifest is the only source of an API target";
    evidence.derived = derived;
  }

  const manifest = buildManifest({ runID, simulatorUDID: simulator?.udid ?? randomUUID().toUpperCase(), nativeSourceRevision: sourceRevision, backendSourceRevision: sourceRevision, apiOrigin: "http://127.0.0.1:" + ports.api, cardOrigin: "http://127.0.0.1:" + ports.site, fixtureSetID, configVersion, now: Date.now() - 5000, lifetimeMs: 3_600_000 });
  activationEnds = Date.now() - 5000 + 3_600_000;
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  evidence.manifestSHA256 = sha256(manifestBytes);
  evidence.safety.apiTarget = manifest.apiOrigin;
  evidence.safety.cardTarget = manifest.cardOrigin;

  say("booting the local backend on loopback");
  backend = await bootNativeBackend({ root, directory: resolve(scratchRoot, "ns-" + runID.slice(0, 8).toLowerCase()), binary: pinned.binary, expectedBinarySHA256: pinned.sha, runID, manifestSHA256: evidence.manifestSHA256, backendRevision: sourceRevision, configVersion, log, crons: flag("--demo"), onClose: (close) => { closeBackend = close; } });
  evidence.backend.selfCheck = await selfCheck();
  say("backend self-check passed: real handlers, fake code provider, policy " + evidence.backend.selfCheck.policy.status);
  if (flag("--backend-only")) { evidence.status = "backend-only"; exitCode = 0; return; }

  if (flag("--demo")) return await demo(manifest, manifestBytes);

  sampler = setInterval(() => {
    try {
      const rows = nonLoopbackConnections(simulator.udid);
      for (const row of rows) egress.set(row.process + " " + row.remote, (egress.get(row.process + " " + row.remote) ?? 0) + 1);
      for (const row of appConnections(rows)) appEgress.add(row.process + " " + row.remote);
    } catch { /* a failed sample is a missed observation, not a result */ }
  }, 5000);
  const only = options("--only");
  const selection = only.length ? only.map((name) => "-only-testing:" + (name.startsWith("CalledItUITests") ? name : "CalledItUITests/" + name)) : ["-only-testing:CalledItUITests", ...provisionerOnly.map((name) => "-skip-testing:CalledItUITests/" + name)];
  if (!only.length) evidence.notRun = provisionerOnly.map((name) => ({ class: name, status: "blocked", reason: "needs the root simulator provisioner's fixtures" }));
  const bundle = resolve(output, "native-ui.xcresult");
  say("running " + selection.join(" "));
  const testEnvironment = { ...environment, TEST_RUNNER_CALLED_IT_QA_RUN_ID: runID, TEST_RUNNER_CALLED_IT_QA_MANIFEST_BASE64: manifestBytes.toString("base64"), TEST_RUNNER_CALLED_IT_QA_CONTROL_URL: backend.controlOrigin + "/control", TEST_RUNNER_CALLED_IT_QA_CONTROL_TOKEN: backend.controlToken, TEST_RUNNER_CALLED_IT_QA_WAIT_SCALE: String(waitScale), ...(referenceHardware ? { TEST_RUNNER_CALLED_IT_QA_REFERENCE_HARDWARE: "1" } : {}) };
  let testLog = ""; let status;
  // The build and the backend boot take minutes, and xcodebuild can lose sight of the simulator meanwhile. The device is
  // checked again before the tests start, and a start that still cannot find it is repeated once and recorded as a retry.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const waited = await waitForDestination(simulator.udid, { project: "CalledItMessages.xcodeproj", scheme: "CalledItMessages", cwd: native, env: environment });
    evidence.simulator.destinationWaitMs = (evidence.simulator.destinationWaitMs ?? 0) + waited.waitedMs;
    rmSync(bundle, { recursive: true, force: true });
    const tests = spawn("xcodebuild", ["test-without-building", "-project", "CalledItMessages.xcodeproj", "-scheme", "CalledItMessages", "-configuration", "QA", "-destination", "platform=iOS Simulator,id=" + simulator.udid, "-derivedDataPath", evidence.derived, "-parallel-testing-enabled", "NO", "-resultBundlePath", bundle, ...selection], { cwd: native, env: testEnvironment, stdio: ["ignore", "pipe", "pipe"] });
    child = tests;
    let attemptLog = "";
    const onData = (data) => { const text = data.toString(); attemptLog += text; for (const line of text.split("\n")) if (/Test Case .*(passed|failed|skipped)|error:|\*\* TEST/.test(line)) console.log(backend.redact(line)); };
    tests.stdout.on("data", onData); tests.stderr.on("data", onData);
    status = await new Promise((accept) => tests.once("exit", accept));
    testLog += attemptLog;
    if (attempt === 2 || /Test Case '/.test(attemptLog) || !/Unable to find a device matching the provided destination specifier/.test(attemptLog)) break;
    runnerRetries.push({ at: Date.now(), test: "(runner)", kind: "destination", detail: "xcodebuild could not find the run's simulator when starting the tests; started once more" });
  }
  log("test.log", backend.redact(testLog));
  let cases = parseTestCases(testLog).map((test) => test.result === "failed" ? { ...test, failures: failureMessages(backend.redact(testLog), test.id), resultBundle: bundle } : test);
  const firstFailures = cases.filter((test) => test.result === "failed");
  let testRetries = []; const notRetried = [];
  // xcodebuild prints one of these lines only when the whole session ran to its end; a session that was killed or crashed
  // prints neither, and no retry can turn such a run into a pass.
  const sessionCompleted = status !== null && /\*\* TEST EXECUTE (SUCCEEDED|FAILED) \*\*/.test(testLog);
  // The end line alone does not prove every selected test reported, so the results are also compared with the tests the
  // selection names in the sources. A selected test with no result line blocks any recovery by retry.
  const sources = resolve(native, "UITests");
  const classes = new Map(readdirSync(sources).filter((name) => name.endsWith(".swift")).flatMap((name) => {
    const text = readFileSync(resolve(sources, name), "utf8");
    return [...text.matchAll(/^final class (\w+): JourneyCase/gm)].map((match) => [match[1], [...text.matchAll(/^ {4}func (test\w+)\(\)/gm)].map((found) => found[1])]);
  }));
  const expected = expectedTests(only, classes);
  const summarise = () => {
    const failed = cases.filter((test) => test.result === "failed").length;
    evidence.tests = { selection, exitStatus: status, sessionCompleted, passed: cases.filter((test) => test.result === "passed").length, failed, blocked: cases.filter((test) => test.result === "skipped").length, cases, resultBundle: bundle, retryFailedOnce, testRetries, testRetryCounts: testRetryCounts(testRetries), notRetried };
    // A run whose only failures were tests that then passed on their one retry is a pass with retries, never a clean pass.
    const missing = expected ? expected.filter((id) => !cases.some((test) => test.id === id)) : null;
    evidence.tests.missing = missing;
    const recovered = sessionCompleted && missing !== null && missing.length === 0 && testRetries.length > 0 && testRetries.length === firstFailures.length;
    evidence.status = cases.length === 0 ? "blocked" : failed === 0 && (status === 0 || recovered) ? "passed" : "failed";
  };
  // The first attempt's results are on record before any retry starts, so a retry that cannot run loses nothing.
  summarise();
  if (retryFailedOnce && firstFailures.length) {
    // Each failed test gets one more attempt, by itself, in a new xcodebuild session: the test's own set-up ends both apps and
    // resets the backend, so nothing of the first attempt is left. The first attempt's log and result bundle are kept.
    const secondAttempts = new Map(); let retryLog = "";
    for (const [index, test] of firstFailures.entries()) {
      if (activationEnds - Date.now() < 8 * 60_000) { notRetried.push({ test: test.id, reason: "the QA activation was about to expire" }); continue; }
      say("retrying " + test.id + " once in a fresh launch");
      const retryBundle = resolve(output, "native-ui-retry-" + (index + 1) + ".xcresult");
      try { await waitForDestination(simulator.udid, { project: "CalledItMessages.xcodeproj", scheme: "CalledItMessages", cwd: native, env: environment }); }
      catch (error) { secondAttempts.set(test.id, { result: "failed", seconds: null, failures: ["the second attempt could not start: " + String(error?.message ?? error).slice(0, 200)], resultBundle: null }); continue; }
      const again = spawn("xcodebuild", ["test-without-building", "-project", "CalledItMessages.xcodeproj", "-scheme", "CalledItMessages", "-configuration", "QA", "-destination", "platform=iOS Simulator,id=" + simulator.udid, "-derivedDataPath", evidence.derived, "-parallel-testing-enabled", "NO", "-resultBundlePath", retryBundle, "-only-testing:CalledItUITests/" + test.id], { cwd: native, env: testEnvironment, stdio: ["ignore", "pipe", "pipe"] });
      child = again;
      let attemptLog = "";
      const onData = (data) => { const text = data.toString(); attemptLog += text; for (const line of text.split("\n")) if (/Test Case .*(passed|failed|skipped)|error:|\*\* TEST/.test(line)) console.log(backend.redact(line)); };
      again.stdout.on("data", onData); again.stderr.on("data", onData);
      const retryStatus = await new Promise((accept) => again.once("exit", accept));
      retryLog += attemptLog;
      const result = parseTestCases(attemptLog).find((item) => item.id === test.id);
      // A printed pass counts only when the retry's own session also ended cleanly.
      if (result?.result === "passed" && retryStatus !== 0) secondAttempts.set(test.id, { result: "failed", seconds: result.seconds, failures: ["the second attempt's session ended with status " + retryStatus + " after the test reported a pass"], resultBundle: retryBundle });
      else secondAttempts.set(test.id, result ? { ...result, failures: failureMessages(backend.redact(attemptLog), test.id), resultBundle: retryBundle } : { result: "failed", seconds: null, failures: ["the second attempt produced no result"], resultBundle: retryBundle });
    }
    log("test-retry.log", backend.redact(retryLog));
    const settled = applyTestRetries(cases, secondAttempts);
    cases = settled.cases; testRetries = settled.retries;
    for (const retry of testRetries) runnerRetries.push({ at: Date.now(), test: "-[" + retry.test.replace("/", " ") + "]", kind: "test-retry", detail: (retry.passedOnRetry ? "failed once, then passed in a fresh launch" : "failed twice") + "; first failure: " + (retry.firstAttempt.failures[0] ?? "no message captured") });
  }
  summarise();
  if (appEgress.size) {
    evidence.status = "failed";
    console.error("[native-sim] the app contacted an address that is not loopback: " + [...appEgress].join(", "));
  }
  exitCode = evidence.status === "passed" ? 0 : 1;
}

try {
  await Promise.race([main(), interrupted]);
} catch (error) {
  evidence.error = backend ? backend.redact(error?.stack ?? error) : String(error?.stack ?? error);
  if (error?.backendLog) log("backend.log", error.backendLog);
  console.error("[native-sim] " + (error?.message ?? error));
} finally {
  clearInterval(sampler);
  if (simulator) {
    evidence.safety.outboundNetwork = { mode: networkIsolation, enforced: false, appContactedNonLoopback: [...appEgress], reason: "macOS offers no unprivileged way to deny a simulator outbound traffic; the app itself accepts only the loopback targets in its manifest", observedNonLoopbackConnections: [...egress.entries()].map(([connection, samples]) => ({ connection, samples })) };
    if (!flag("--keep-simulator")) evidence.simulator.deleted = destroySimulator(simulator.udid);
  }
  if (backend) {
    const notes = backend.notes();
    evidence.latencyBudgets.measurements = notes.filter((note) => note.kind === "latency");
    evidence.retries = [...runnerRetries, ...notes.filter((note) => note.kind !== "latency")];
    // App calls that ended in an error with no product code, with the server's message and HTTP status. "injected" ones were asked for by a test.
    evidence.appCallFailures = backend.failures();
    // A pass that needed a retry is never reported as a clean pass.
    if (evidence.status === "passed" && evidence.retries.length) evidence.status = "passed-with-retries";
    // Belt and braces: the option is refused up front, and a reference record that somehow held a retried test is failed here.
    if (referenceRunHasTestRetry(evidence)) { evidence.status = "failed"; evidence.error = "A reference-hardware run contained a test retry"; exitCode = 1; }
  }
  if (closeBackend) {
    evidence.backend ??= {};
    try { const retained = await closeBackend(); log("backend.log", retained.backendLog); evidence.backend.providerStats = retained.providerStats; evidence.backend.scratchRemoved = true; }
    catch { evidence.backend.scratchRemoved = false; }
  }
  evidence.finishedAt = new Date().toISOString();
  log("evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  say("status " + evidence.status + " (outbound network " + networkIsolation + ", not denied; latency budgets " + evidence.latencyBudgets.mode + "; " + evidence.retries.length + " recorded retries)" + (evidence.tests ? ": " + evidence.tests.passed + " passed, " + evidence.tests.failed + " failed, " + evidence.tests.blocked + " blocked" : "") + "; evidence in " + output);
}
process.exit(exitCode);
