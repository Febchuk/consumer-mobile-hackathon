// One command: node tests/native-sim/run.mjs
// Boots the pinned Convex backend on loopback with synthetic fixtures, creates a dedicated erased simulator, builds the
// QA app and runs the native UI tests against it. See tests/native-sim/README.md.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { actors, bootNativeBackend } from "./backend.mjs";
import { assertBuiltAppHasNoEndpoint, buildManifest, inheritedCredentials, ports } from "./guard.mjs";
import { assertNoAppleAccount, createDedicatedSimulator, destroySimulator, nonLoopbackConnections, pickRuntime } from "./simulator.mjs";

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
const configVersion = "native-sim.1";

if (flag("--help")) {
  console.log("Usage: node tests/native-sim/run.mjs [--only <Class[/test]>]... [--backend-only] [--output <dir>] [--runtime <id|version>] [--device-type <id>] [--keep-simulator]");
  process.exit(0);
}

const stripped = inheritedCredentials(process.env);
const environment = { PATH: ["/opt/homebrew/bin", process.env.PATH ?? "/usr/bin:/bin"].join(":"), HOME: homedir(), LANG: "en_US.UTF-8" };
if (process.env.DEVELOPER_DIR) environment.DEVELOPER_DIR = process.env.DEVELOPER_DIR;
process.env.PATH = environment.PATH;
const run = (command, args, extra = {}) => execFileSync(command, args, { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...extra });

const guard = spawnSync(process.execPath, ["--test", resolve(here, "guard.test.mjs")], { cwd: root, env: environment, stdio: "inherit" });
if (guard.status !== 0) { console.error("[native-sim] The loopback guard's own tests failed; nothing was started."); process.exit(1); }

const runID = randomUUID().toUpperCase();
const scratchRoot = realpathSync(homedir()) + "/.capy/work";
mkdirSync(scratchRoot, { recursive: true });
const output = resolve(option("--output") ?? resolve(scratchRoot, "native-sim-" + runID.slice(0, 8)));
assert.ok(!existsSync(output), "The output directory already exists: " + output);
mkdirSync(output, { recursive: true, mode: 0o700 });
const log = (name, text) => writeFileSync(resolve(output, name), text, { mode: 0o600 });
const evidence = { lane: "native-sim", runID, startedAt: new Date().toISOString(), status: "blocked", strippedEnvironment: stripped, fixtureSetID, configVersion, safety: {} };
let backend; let simulator; let sampler; let exitCode = 1;
const egress = new Map();

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
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  evidence.manifestSHA256 = sha256(manifestBytes);
  evidence.safety.apiTarget = manifest.apiOrigin;
  evidence.safety.cardTarget = manifest.cardOrigin;

  say("booting the local backend on loopback");
  backend = await bootNativeBackend({ root, directory: resolve(scratchRoot, "ns-" + runID.slice(0, 8).toLowerCase()), binary: pinned.binary, expectedBinarySHA256: pinned.sha, runID, manifestSHA256: evidence.manifestSHA256, backendRevision: sourceRevision, configVersion, log });
  evidence.backend.selfCheck = await selfCheck();
  say("backend self-check passed: real handlers, fake code provider, policy " + evidence.backend.selfCheck.policy.status);
  if (flag("--backend-only")) { evidence.status = "backend-only"; exitCode = 0; return; }

  sampler = setInterval(() => {
    try { for (const row of nonLoopbackConnections(simulator.udid)) egress.set(row.process + " " + row.remote, (egress.get(row.process + " " + row.remote) ?? 0) + 1); } catch { /* observation only */ }
  }, 5000);
  const only = options("--only");
  const selection = (only.length ? only : ["CalledItUITests"]).map((name) => "-only-testing:" + (name.startsWith("CalledItUITests") ? name : "CalledItUITests/" + name));
  const bundle = resolve(output, "native-ui.xcresult");
  say("running " + selection.join(" "));
  const testEnvironment = { ...environment, TEST_RUNNER_CALLED_IT_QA_RUN_ID: runID, TEST_RUNNER_CALLED_IT_QA_MANIFEST_BASE64: manifestBytes.toString("base64"), TEST_RUNNER_CALLED_IT_QA_CONTROL_URL: backend.controlOrigin + "/control", TEST_RUNNER_CALLED_IT_QA_CONTROL_TOKEN: backend.controlToken };
  const tests = spawn("xcodebuild", ["test-without-building", "-project", "CalledItMessages.xcodeproj", "-scheme", "CalledItMessages", "-configuration", "QA", "-destination", "platform=iOS Simulator,id=" + simulator.udid, "-derivedDataPath", evidence.derived, "-parallel-testing-enabled", "NO", "-resultBundlePath", bundle, ...selection], { cwd: native, env: testEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  let testLog = "";
  const onData = (data) => { const text = data.toString(); testLog += text; for (const line of text.split("\n")) if (/Test Case .*(passed|failed)|error:|\*\* TEST/.test(line)) console.log(backend.redact(line)); };
  tests.stdout.on("data", onData); tests.stderr.on("data", onData);
  const status = await new Promise((accept) => tests.once("exit", accept));
  log("test.log", backend.redact(testLog));
  const cases = [...testLog.matchAll(/Test Case '-\[CalledItUITests\.(\w+) (\w+)\]' (passed|failed) \(([\d.]+) seconds\)/g)].map((match) => ({ id: match[1] + "/" + match[2], result: match[3], seconds: Number(match[4]) }));
  evidence.tests = { selection, exitStatus: status, passed: cases.filter((test) => test.result === "passed").length, failed: cases.filter((test) => test.result === "failed").length, cases, resultBundle: bundle };
  evidence.status = status === 0 && cases.length > 0 && evidence.tests.failed === 0 ? "passed" : cases.length === 0 ? "blocked" : "failed";
  exitCode = evidence.status === "passed" ? 0 : 1;
}

try {
  await main();
} catch (error) {
  evidence.error = backend ? backend.redact(error?.stack ?? error) : String(error?.stack ?? error);
  if (error?.backendLog) log("backend.log", error.backendLog);
  console.error("[native-sim] " + (error?.message ?? error));
} finally {
  clearInterval(sampler);
  if (simulator) {
    evidence.safety.outboundNetwork = { enforced: false, reason: "macOS offers no unprivileged way to deny a simulator outbound traffic; the app itself accepts only the loopback targets in its manifest", observedNonLoopbackConnections: [...egress.entries()].map(([connection, samples]) => ({ connection, samples })) };
    if (!flag("--keep-simulator")) evidence.simulator.deleted = destroySimulator(simulator.udid);
  }
  if (backend) {
    try { const retained = await backend.close(); log("backend.log", retained.backendLog); evidence.backend.providerStats = retained.providerStats; evidence.backend.scratchRemoved = true; }
    catch { evidence.backend.scratchRemoved = false; }
  }
  evidence.finishedAt = new Date().toISOString();
  log("evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  say("status " + evidence.status + (evidence.tests ? ": " + evidence.tests.passed + " passed, " + evidence.tests.failed + " failed" : "") + "; evidence in " + output);
}
process.exit(exitCode);
