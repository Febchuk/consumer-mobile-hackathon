import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { convexToJson, jsonToConvex } from "convex/values";
import { fixtureProviderSettings } from "../qa-runtime/tls-provider.mjs";
import { startFakeOtp } from "./fake-otp.mjs";
import { assertLoopbackOrigin, ports, sourceCardOrigin } from "./guard.mjs";

// The audit's four fixture people. The phone numbers are the reserved synthetic ones the fake code provider accepts.
export const actors = Object.freeze({
  cora: { phone: "+12025550104", alias: "QA Cora" }, finn: { phone: "+12025550101", alias: "QA Finn" },
  sage: { phone: "+12025550103", alias: "QA Sage" }, oli: { phone: "+12025550102", alias: "QA Oli" },
});
const cardPaths = new Set(["v0Bets:get", "v0Bets:list", "v0Bets:history", "v0Bets:create"]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function listen(server, port) {
  return new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); accept(); });
  });
}

async function body(request, limit = 1_048_576) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new Error("Request too large"); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

/**
 * Boots the pinned official Convex backend on loopback with the repository's real handlers, a per-run scratch copy of convex/
 * plus the test-only overlay, the fake phone-code provider, the app-facing gateway and the test-control server.
 */
export async function bootNativeBackend({ root, directory, binary, expectedBinarySHA256, runID, manifestSHA256, backendRevision, configVersion, log, crons = false, onClose = () => {} }) {
  assert.equal(sha256(readFileSync(binary)), expectedBinarySHA256, "The backend executable does not match its pin");
  assert.ok(!existsSync(directory) && realpathSync(dirname(directory)) === dirname(directory), "A fresh canonical scratch directory is required");
  assert.ok(!resolve(directory).startsWith(resolve(root) + "/") && Buffer.byteLength(directory) + 45 < 104, "Use a short scratch directory outside the repository");
  const origin = assertLoopbackOrigin("http://127.0.0.1:" + ports.backend);
  const apiOrigin = assertLoopbackOrigin("http://127.0.0.1:" + ports.api);
  const cardOrigin = assertLoopbackOrigin("http://127.0.0.1:" + ports.site);
  const controlOrigin = assertLoopbackOrigin("http://127.0.0.1:" + ports.control);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const project = resolve(directory, "project"); const home = resolve(directory, "home");
  mkdirSync(project); mkdirSync(home);
  const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: directory, CI: "1", NODE_ENV: "test", EXPO_NO_DOTENV: "1", CONVEX_AGENT_MODE: "anonymous", DISABLE_BEACON: "1", DO_NOT_TRACK: "1" };
  const secrets = new Set();
  const secret = (value) => { secrets.add(value); return value; };
  const redact = (input) => { let text = String(input); for (const value of secrets) text = text.replaceAll(value, "[redacted]"); return text; };
  let backend; let provider; let gateway; let control; let backendLog = ""; let closing;
  const calls = [];
  const notes = [];
  // Calls from the app that ended in an error with no product code, kept for the whole run so the cause can be read from evidence.
  const failures = [];
  // Faults a test asked for: the next calls to a path are answered with a server error and never reach the backend.
  const faults = new Map();
  // For a fault asked for one program only (the host app or the extension): the path's caller, as the call log names it.
  const faultCallers = new Map();
  // Replies a test asked to lose: the next calls to a path reach the backend and take effect, and the app is told the server failed.
  const lostReplies = new Map();
  let currentTest = "";
  const sockets = new Set();
  const track = (server) => server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });

  const close = () => closing ??= (async () => {
    for (const server of [gateway, control]) if (server?.listening) await new Promise((accept) => { server.close(accept); for (const socket of sockets) socket.destroy(); });
    if (backend && backend.exitCode === null && backend.signalCode === null) {
      const exited = new Promise((accept) => backend.once("exit", accept));
      backend.kill("SIGTERM");
      await Promise.race([exited, delay(5000)]);
      if (backend.exitCode === null && backend.signalCode === null) { backend.kill("SIGKILL"); await Promise.race([exited, delay(3000)]); }
    }
    await provider?.close();
    rmSync(directory, { recursive: true, force: true });
    return { backendLog: redact(backendLog), providerStats: provider?.stats };
  })();
  // Handed out before anything is started, so a caller interrupted during boot can still stop what boot began.
  onClose(close);

  try {
    cpSync(resolve(root, "convex"), resolve(project, "convex"), { recursive: true });
    const overlay = readFileSync(resolve(root, "tests/native-sim/overlay.ts.txt"), "utf8").replaceAll("__QA_RUN_ID__", runID).replace("__QA_ACTORS__", JSON.stringify(actors));
    writeFileSync(resolve(project, "convex/qaNative.ts"), overlay, { mode: 0o600 });
    // For tests, crons are replaced by an empty schedule: jobs run only when a test asks for them.
    if (!crons) writeFileSync(resolve(project, "convex/crons.ts"), 'import { cronJobs } from "convex/server";\nexport default cronJobs();\n');
    writeFileSync(resolve(project, "package.json"), JSON.stringify({ name: "calledit-native-sim", version: "0.0.0", private: true, dependencies: { convex: JSON.parse(readFileSync(resolve(root, "node_modules/convex/package.json"), "utf8")).version } }));
    symlinkSync(resolve(root, "node_modules"), resolve(project, "node_modules"), "dir");
    const providerPath = resolve(project, "convex/v0AuthProvider.ts");
    const providerSource = readFileSync(providerPath, "utf8");
    provider = await startFakeOtp({ phones: Object.values(actors).map((actor) => actor.phone) });
    assert.equal(providerSource.split("https://verify.twilio.com").length, 2, "The phone-code provider module changed; review the fake provider before running");
    writeFileSync(providerPath, providerSource.replace("https://verify.twilio.com", provider.origin));
    const instanceSecret = secret(randomBytes(32).toString("hex"));
    const adminKey = secret(execFileSync(binary, ["keygen", "admin-key", "--instance-name", "qa-" + runID, "--instance-secret", instanceSecret], { env: environment, encoding: "utf8", stdio: "pipe" }).trim());
    assert.ok(!closing, "The backend was closed while it was starting");
    backend = spawn(binary, ["--interface", "127.0.0.1", "--port", String(ports.backend), "--site-proxy-port", String(ports.site), "--convex-http-proxy", provider.origin, "--instance-name", "qa-" + runID, "--instance-secret", instanceSecret, "--disable-beacon", "--local-storage", resolve(directory, "storage"), resolve(directory, "backend.sqlite3")], {
      cwd: project, env: { ...environment, HTTPS_PROXY: provider.origin, HTTP_PROXY: provider.origin }, stdio: ["ignore", "pipe", "pipe"],
    });
    if (closing) backend.kill("SIGKILL");
    const collect = (data) => { backendLog = (backendLog + data.toString()).slice(-400_000); };
    backend.stdout.on("data", collect); backend.stderr.on("data", collect);
    const localFetch = async (input, init) => {
      const request = new Request(input, init);
      assert.equal(new URL(request.url).origin, origin, "Refusing a backend call that is not loopback");
      return fetch(request, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    };
    let ready = false;
    for (let index = 0; index < 120 && !ready; index++) {
      if (backend.exitCode !== null) throw new Error("The backend exited before it was ready");
      try { ready = (await localFetch(origin + "/version")).ok; } catch { /* not listening yet */ }
      if (!ready) await delay(250);
    }
    assert.ok(ready, "The backend did not become ready");
    const cli = (args, name) => {
      const result = spawnSync(process.execPath, [resolve(root, "node_modules/convex/bin/main.js"), ...args], { cwd: project, env: { ...environment, CONVEX_SELF_HOSTED_URL: origin, CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey }, encoding: "utf8", timeout: 180_000 });
      log(name, redact((result.stdout ?? "") + (result.stderr ?? "")));
      assert.equal(result.status, 0, "The local push step '" + name + "' failed; see its log");
    };
    cli(["dev", "--once", "--typecheck", "disable", "--codegen", "disable", "--tail-logs", "disable"], "local-push.log");
    const settings = { ...fixtureProviderSettings, V0_PHONE_PEPPER: secret(randomBytes(32).toString("hex")), V0_ENVIRONMENT: "local", V0_SOURCE_SHA: backendRevision, V0_DEPLOYMENT_ID: "qa-" + runID, V0_CONFIG_VERSION: configVersion, V0_CARD_ORIGIN: sourceCardOrigin };
    const envPath = resolve(directory, "backend.env");
    writeFileSync(envPath, Object.entries(settings).map(([key, value]) => key + "=" + value).join("\n"), { mode: 0o600 });
    cli(["env", "set", "--from-file", envPath], "local-env.log");

    const admin = new ConvexHttpClient(origin, { logger: false, skipConvexDeploymentUrlCheck: true, fetch: localFetch }); admin.setAdminAuth(adminKey);
    const client = new ConvexHttpClient(origin, { logger: false, skipConvexDeploymentUrlCheck: true, fetch: localFetch });
    const attestation = await client.query(makeFunctionReference("v0Runtime:attestation"), {});
    assert.deepEqual(attestation, { app: "called-it", contractVersion: "v0.2", schemaVersion: "v0.2", environment: "local", sourceSha: backendRevision, deploymentId: "qa-" + runID, configVersion, testAdapters: false }, "The backend did not attest the expected local source");

    const policies = JSON.parse(readFileSync(resolve(root, "tests/coverage/v0-public-policies.json"), "utf8"));
    const allowed = new Map([["v0Runtime:attestation", "query"], ...Object.entries(policies).map(([name, policy]) => [name, policy.kind])]);
    const tokens = Object.fromEntries(Object.keys(actors).map((name) => [name, secret(randomBytes(32).toString("hex"))]));
    let fixture;

    // App-facing gateway. It forwards only public V0 functions to the real backend and changes two things in the replies:
    // the attestation gains the QA run identity the test build demands, and card links move from the product's HTTPS
    // origin to the loopback card site. Nothing else is rewritten and there is no fixture or control route here.
    gateway = createServer(async (request, response) => {
      const started = performance.now();
      const reply = (status, payload) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(payload)); };
      const match = /^\/api\/(query|mutation|action)$/.exec(request.url ?? "");
      let path = "invalid"; let outcome = "refused"; let conversation; let status; let failure;
      try {
        if (!match || request.method !== "POST" || request.socket.remoteAddress !== "127.0.0.1") return reply(404, { status: "error", errorMessage: "Not found", errorData: { code: "NOT_AVAILABLE" } });
        if ((request.headers["x-calledit-qa-run-id"] ?? "").toLowerCase() !== runID.toLowerCase() || request.headers["x-calledit-qa-manifest-sha256"] !== manifestSHA256) return reply(403, { status: "error", errorMessage: "Wrong QA run", errorData: { code: "FORBIDDEN" } });
        const input = JSON.parse((await body(request)).toString("utf8"));
        path = String(input.path);
        // A one-way fingerprint, so a test can tell whether Messages kept the same conversation identity without seeing it.
        if (typeof input.args?.[0]?.conversationKey === "string") conversation = createHash("sha256").update(input.args[0].conversationKey).digest("hex").slice(0, 8);
        if (allowed.get(path) !== match[1] || input.format !== "convex_encoded_json" || !Array.isArray(input.args) || input.args.length !== 1) return reply(403, { status: "error", errorMessage: "Not a public V0 function", errorData: { code: "NOT_AVAILABLE" } });
        const planned = faults.get(path) ?? 0;
        const faultCaller = faultCallers.get(path);
        if (planned > 0 && (!faultCaller || faultCaller === String(request.headers["user-agent"] ?? "unknown").split("/")[0].slice(0, 40))) {
          faults.set(path, planned - 1);
          outcome = "injected"; status = 560; failure = "Injected by the test";
          return reply(560, { status: "error", errorMessage: "Injected failure" });
        }
        const upstream = await localFetch(origin + "/api/" + match[1], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, args: input.args, format: "convex_encoded_json" }) });
        const envelope = await upstream.json();
        const lost = lostReplies.get(path) ?? 0;
        if (lost > 0 && envelope.status === "success") {
          lostReplies.set(path, lost - 1);
          outcome = "reply_lost"; status = 560;
          return reply(560, { status: "error", errorMessage: "Reply lost" });
        }
        if (envelope.status === "success") {
          outcome = "success";
          if (path === "v0Runtime:attestation") envelope.value = { ...envelope.value, testAdapters: true, qaRunID: runID, qaManifestSHA256: manifestSHA256 };
          if (cardPaths.has(path)) {
            const move = (item) => {
              assert.ok(typeof item?.card?.url === "string" && item.card.url.startsWith(sourceCardOrigin + "/c/"), "Unexpected card origin from the backend");
              return { ...item, card: { ...item.card, url: cardOrigin + item.card.url.slice(sourceCardOrigin.length) } };
            };
            envelope.value = Array.isArray(envelope.value) ? envelope.value.map(move) : move(envelope.value);
          }
        } else {
          const data = typeof envelope.errorData === "string" ? (() => { try { return JSON.parse(envelope.errorData); } catch { return { code: envelope.errorData }; } })() : envelope.errorData;
          outcome = data?.code ?? "UNKNOWN";
          status = upstream.status;
          if (!data?.code) failure = redact(String(envelope.errorMessage ?? "no error message")).replace(/\s+/g, " ").trim().slice(0, 300);
        }
        reply(upstream.status, envelope);
      } catch (error) {
        outcome = "gateway_error";
        failure = redact(String(error?.message ?? error)).replace(/\s+/g, " ").trim().slice(0, 300);
        if (!response.headersSent) reply(502, { status: "error", errorMessage: "Gateway failure", errorData: { code: "PROVIDER_UNAVAILABLE" } });
      } finally {
        const call = { at: Date.now(), kind: match?.[1] ?? "invalid", path, outcome, ms: Math.round(performance.now() - started), caller: String(request.headers["user-agent"] ?? "unknown").split("/")[0].slice(0, 40), ...(conversation ? { conversation } : {}), ...(status ? { status } : {}), ...(failure ? { error: failure } : {}) };
        if (path !== "v0Runtime:attestation") calls.push(call);
        if (failure) failures.push({ ...call, test: currentTest });
      }
    });
    track(gateway);

    const resolveArgs = (value, state) => {
      if (typeof value === "string" && value.startsWith("@")) {
        const [kind, key] = value.slice(1).split(":");
        const found = key === undefined ? state.accounts[kind] ?? state.groups[kind] : kind === "bet" ? state.bets[key]?.betId : kind === "locator" ? state.bets[key]?.locator : undefined;
        assert.ok(found, "Unknown fixture reference " + value);
        return found;
      }
      if (Array.isArray(value)) return value.map((item) => resolveArgs(item, state));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveArgs(item, state)]));
      return value;
    };
    // Under load the local backend can exceed its one-second function limit. A function that timed out changed nothing, so the
    // fixture call is repeated, at most twice, and each repeat is written to the run's evidence as a retry.
    const patient = async (name, attempt) => {
      for (let tries = 1; ; tries++) {
        try { return await attempt(); } catch (error) {
          if (tries === 3 || !/Function execution timed out/.test(String(error?.message))) throw error;
          notes.push({ at: Date.now(), test: currentTest || "(outside a test)", kind: "fixture-retry", detail: name + " hit the backend's function time limit on attempt " + tries });
          await delay(500 * tries);
        }
      }
    };
    const internal = (kind, path, args) => patient(path, () => kind === "query" ? admin.query(makeFunctionReference(path), args) : admin.mutation(makeFunctionReference(path), args));
    const operations = {
      async reset(input) {
        const seeded = await internal("mutation", "qaNative:reset", { runID, tokens, ...(input.points ? { points: input.points } : {}) });
        fixture = { ...seeded, bets: {} };
        calls.length = 0;
        faults.clear();
        faultCallers.clear();
        lostReplies.clear();
        return { groups: Object.keys(seeded.groups), actors: Object.keys(seeded.accounts), timezone: seeded.timezone };
      },
      async seedTurn(input) { return await internal("mutation", "qaNative:seedTurn", { runID, group: input.group, creator: input.creator, subject: input.subject }); },
      // Moves a fixture group and today's unused turn to an hour past the group's noon; the turns job then does the pass.
      async turnPastNoon(input) { return await internal("mutation", "qaNative:shiftTurnPastNoon", { runID, group: input.group }); },
      async seedBet(input) {
        const seeded = await internal("mutation", "qaNative:seedBet", { runID, key: input.key, group: input.group, creator: input.creator, subject: input.subject, format: input.format, ...(input.question ? { question: input.question } : {}), ...(input.revealInMs ? { revealInMs: input.revealInMs } : {}) });
        fixture.bets[input.key] = seeded;
        return seeded;
      },
      // Adds a fixture person to a fixture group as a member of long standing; the groups reset builds are not changed.
      async seedMember(input) { return await internal("mutation", "qaNative:seedMember", { runID, group: input.group, actor: input.actor }); },
      // A settled past bet stored directly, for the suggestion tests: see seedHistoryBet in the overlay.
      async seedHistoryBet(input) {
        const seeded = await internal("mutation", "qaNative:seedHistoryBet", { runID, key: input.key, group: input.group, creator: input.creator, subject: input.subject, question: input.question, ...(input.format ? { format: input.format } : {}), ...(input.options ? { options: input.options } : {}), ...(typeof input.contextLine === "string" ? { contextLine: input.contextLine } : {}) });
        fixture.bets[input.key] = seeded;
        return seeded;
      },
      // Moves one fixture bet through time, then lets the product's own sweep perform the transition.
      async shiftBet(input) {
        const target = input.key ? fixture.bets[input.key] : undefined;
        await internal("mutation", "qaNative:shiftBet", { runID, to: input.to, ...(target ? { betId: target.betId } : { betId: resolveArgs(input.betId, fixture) }) });
        return await internal("mutation", "v0Jobs:sweep", {});
      },
      // Moves every sign-in code still waiting past its expiry, as shiftBet moves a bet: the server clock cannot move.
      async expireCodes() { return await internal("mutation", "qaNative:expireCodes", { runID }); },
      async runJob(input) {
        assert.ok(["sweep", "turns", "recaps"].includes(input.job), "Unknown job");
        return await internal("mutation", "v0Jobs:" + input.job, {});
      },
      // Another fixture person acts through the real public handler, with their own control session.
      async act(input) {
        assert.ok(tokens[input.actor] && allowed.get(input.path) === input.kind, "Unknown actor or not a public V0 function");
        const args = { ...resolveArgs(input.args ?? {}, fixture), token: tokens[input.actor] };
        const reference = makeFunctionReference(input.path);
        try {
          const value = await patient(input.path, () => input.kind === "query" ? client.query(reference, args) : input.kind === "mutation" ? client.mutation(reference, args, { skipQueue: true }) : client.action(reference, args));
          if (input.remember && value?.betId) fixture.bets[input.remember] = { betId: value.betId, locator: value.card.url.split("/c/")[1] };
          return { ok: true, value: convexToJson(value ?? null) };
        } catch (error) {
          if (error?.data?.code) return { ok: false, code: error.data.code };
          throw error;
        }
      },
      async inspect() {
        const state = await internal("query", "qaNative:inspect", { runID });
        const keys = Object.fromEntries(Object.entries(fixture?.bets ?? {}).map(([key, bet]) => [bet.betId, key]));
        return { ...state, bets: state.bets.map((bet) => ({ ...bet, key: keys[bet.id] ?? null })), picks: state.picks.map((pick) => ({ ...pick, bet: keys[pick.betId] ?? pick.betId })), ledger: state.ledger.map((row) => ({ ...row, bet: keys[row.betId] ?? row.betId })), provider: { starts: provider.stats.starts, checks: provider.stats.checks, invalidCodes: provider.stats.invalidCodes } };
      },
      async calls() { return calls.slice(); },
      // The next `count` calls the app makes to one public function fail the way an overloaded server fails: an error with no code.
      async failNext(input) {
        assert.ok(allowed.has(input.path) && input.path !== "v0Runtime:attestation", "Not a public V0 function");
        assert.ok(Number.isInteger(Number(input.count)) && Number(input.count) >= 1 && Number(input.count) <= 10, "count must be between 1 and 10");
        faults.set(input.path, Number(input.count));
        // Optional: only calls from this program fail, and the other program's calls to the same function pass through.
        if (typeof input.caller === "string") faultCallers.set(input.path, input.caller); else faultCallers.delete(input.path);
      },
      // The backend applies the app's next "count" calls to one public mutation, and the app gets a server error with no code
      // instead of the reply: the change happened and the answer was lost. They are logged with outcome "reply_lost".
      async loseNextReply(input) {
        assert.ok(allowed.get(input.path) === "mutation", "Not a public V0 mutation");
        assert.ok(Number.isInteger(Number(input.count)) && Number(input.count) >= 1 && Number(input.count) <= 10, "count must be between 1 and 10");
        lostReplies.set(input.path, Number(input.count));
      },
      // Moves a fixture group's pending invitations past their seven days, since the server clock cannot move.
      async expireInvites(input) { return await internal("mutation", "qaNative:expireInvites", { runID, group: input.group }); },
      // Moves one fixture person's app sign-ins past their expiry, as time would. The harness's control sessions are left alone.
      async expireSessions(input) {
        assert.ok(tokens[input.actor], "Unknown actor");
        return await internal("mutation", "qaNative:expireSessions", { runID, actor: input.actor });
      },
      // A retry or a measurement reported by a test, kept for the whole run and written to evidence.json.
      async note(input) {
        assert.ok(["retype", "relaunch", "retap", "draft-cancel", "latency"].includes(input.kind), "Unknown note kind");
        notes.push({ at: Date.now(), test: String(input.test).slice(0, 200), kind: input.kind, detail: redact(String(input.detail).slice(0, 300)) });
      },
      // The click-through scenario: points on both boards, Cora's turn in G1, an open bet to pick in G2, a hidden bet
      // about Cora in G1 and a shared goal in G1 waiting for one more confirmation.
      async demo() {
        await operations.reset({ points: { G1: { cora: 120, finn: 210, sage: 95 }, G2: { cora: 60, finn: 35, oli: 150 } } });
        await operations.seedTurn({ group: "G1", creator: "cora", subject: "sage" });
        await operations.seedBet({ key: "demo-open", group: "G2", creator: "finn", subject: "oli", format: "yes_no", question: "Will Oli be late to dinner on Friday?", revealInMs: 30 * 60_000 });
        await operations.seedBet({ key: "demo-hidden", group: "G1", creator: "finn", subject: "cora", format: "yes_no", question: "Will Cora finish her book this week?", revealInMs: 30 * 60_000 });
        await operations.act({ actor: "sage", kind: "mutation", path: "v0Bets:pick", args: { betId: "@bet:demo-hidden", option: 0, confidence: 0.7, requestId: "demo-pick-sage" } });
        const goal = await operations.act({ actor: "finn", kind: "mutation", path: "v0Groups:proposeGoal", args: { groupId: "@G1", label: "Group dinner", targetPoints: 500, requestId: "demo-goal" } });
        assert.ok(goal.ok, "The demo goal was refused: " + goal.code);
        return { seeded: true };
      },
    };

    const controlToken = secret(randomBytes(32).toString("hex"));
    control = createServer(async (request, response) => {
      const reply = (status, payload) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(payload)); };
      try {
        const presented = Buffer.from(String(request.headers.authorization ?? ""));
        const expected = Buffer.from("Bearer " + controlToken);
        if (request.method !== "POST" || request.url !== "/control" || request.socket.remoteAddress !== "127.0.0.1" || presented.length !== expected.length || !timingSafeEqual(presented, expected)) return reply(403, { ok: false, error: "refused" });
        const input = jsonToConvex(JSON.parse((await body(request)).toString("utf8")));
        if (typeof input.test === "string") currentTest = input.test.slice(0, 200);
        const operation = operations[input.op];
        if (!operation || (input.op !== "reset" && !fixture)) return reply(400, { ok: false, error: "unknown operation or no fixture" });
        reply(200, { ok: true, result: convexToJson((await operation(input)) ?? null) });
      } catch (error) {
        reply(500, { ok: false, error: redact(error?.message ?? error) });
      }
    });
    track(control);
    await listen(gateway, ports.api);
    await listen(control, ports.control);
    return Object.freeze({ origin, apiOrigin, cardOrigin, controlOrigin, controlToken, operations, redact, close, notes: () => notes.slice(), failures: () => failures.slice(), backendLog: () => redact(backendLog), providerStats: () => provider.stats, pid: backend.pid });
  } catch (error) {
    const retained = await close().catch(() => ({ backendLog: redact(backendLog) }));
    const failure = new Error("The local backend failed to start: " + redact(error?.message ?? error));
    failure.backendLog = retained.backendLog;
    throw failure;
  }
}
