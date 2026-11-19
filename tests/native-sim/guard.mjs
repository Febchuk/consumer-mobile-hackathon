import assert from "node:assert/strict";

export const ports = Object.freeze({ backend: 3210, site: 3211, api: 8199, control: 8198 });
export const sourceCardOrigin = "https://cards.qa-runtime.invalid";

// The only origins the QA build of the app may be pointed at: numeric IPv4 loopback over HTTP, with an explicit unprivileged port.
export function assertLoopbackOrigin(value) {
  assert.equal(typeof value, "string", "An origin is required");
  const target = new URL(value);
  assert.equal(target.protocol, "http:", "Refusing a non-loopback protocol: " + target.protocol);
  assert.equal(target.hostname, "127.0.0.1", "Refusing a target that is not 127.0.0.1: " + target.hostname);
  assert.ok(Number(target.port) >= 1024, "Refusing a target without an explicit unprivileged port");
  assert.equal(target.username + target.password + target.search + target.hash, "", "Refusing a target with credentials, query or fragment");
  assert.ok(target.pathname === "/" || target.pathname === "", "Refusing a target with a path");
  assert.equal(value, "http://127.0.0.1:" + target.port, "Refusing a target that is not in canonical form");
  return value;
}

const credentialNames = ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT", "CONVEX_URL", "EXPO_PUBLIC_CONVEX_URL", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ADMIN_PASSCODE", "PAIR_CODE"];
const credentialPrefixes = ["TWILIO_", "APNS_", "V0_"];

// Names of inherited variables that could point a run at a deployment or a real provider. The runner never forwards them.
export function inheritedCredentials(environment) {
  return Object.keys(environment).filter((name) => environment[name] && (credentialNames.includes(name) || credentialPrefixes.some((prefix) => name.startsWith(prefix)))).sort();
}

// The QA build must carry no endpoint of its own: the launch manifest is the only way it learns where to talk.
export function assertBuiltAppHasNoEndpoint(info) {
  assert.equal(info.CalledItBuildChannel, "qa", "The app under test is not the QA build");
  assert.equal(info.CalledItFixtureMode, false, "The app under test was built in fixture mode");
  for (const key of ["CalledItAPIURL", "CalledItWebURL", "CalledItExpectedAPIHost", "CalledItExpectedCardHost"]) {
    assert.equal(info[key] ?? "", "", "The QA build carries a built-in endpoint in " + key + "; refusing to run it");
  }
}

// Every record this lane writes carries this, so an observed run can never be read as a denied one.
export const networkIsolation = "observed";

// Connections made by the app, its extension or its test runner, as opposed to the simulator's own system services.
export function appConnections(rows) {
  return rows.filter((row) => /^CalledIt/.test(row.process));
}

// Packs the journey classes, in name order, into runs small enough to finish inside one QA activation.
export function planParts(classes, limit = 16) {
  const parts = [];
  for (const item of classes) {
    assert.ok(item.tests > 0 && item.tests <= limit, item.name + " has " + item.tests + " tests; a class must have between 1 and " + limit);
    const open = parts.find((part) => part.reduce((sum, member) => sum + member.tests, 0) + item.tests <= limit);
    if (open) open.push(item); else parts.push([item]);
  }
  return parts;
}

// The whole run is only as good as its worst part, and a missing part is never a pass.
export function combineStatuses(statuses, planned) {
  if (statuses.length !== planned || statuses.some((status) => !["passed", "passed-with-retries", "failed"].includes(status))) return statuses.includes("failed") ? "failed" : "blocked";
  if (statuses.includes("failed")) return "failed";
  return statuses.includes("passed-with-retries") ? "passed-with-retries" : "passed";
}

// One xcodebuild attempt's results, read from its output.
export function parseTestCases(log) {
  return [...log.matchAll(/Test Case '-\[CalledItUITests\.(\w+) (\w+)\]' (passed|failed|skipped) \(([\d.]+) seconds\)/g)].map((match) => ({ id: match[1] + "/" + match[2], result: match[3], seconds: Number(match[4]) }));
}

// The failure messages xcodebuild printed for one test, without the file path in front.
export function failureMessages(log, id) {
  const [suite, name] = id.split("/");
  const marker = "error: -[CalledItUITests." + suite + " " + name + "] : ";
  return log.split("\n").filter((line) => line.includes(marker)).map((line) => line.slice(line.indexOf(marker) + marker.length).trim().slice(0, 400));
}

// The one-time retry of a failed test is for slow shared runners only. The reference run is the zero-retry release gate.
export function retryPolicy({ retryFailedOnce, referenceHardware }) {
  assert.ok(!(retryFailedOnce && referenceHardware), "--retry-failed-once is refused with --reference-hardware: the reference run is the zero-retry release gate");
  return Boolean(retryFailedOnce);
}

/**
 * Folds second attempts into the first results. A test counts as passed only if its second attempt passed, it then carries
 * attempts: 2 and its first failure, and every second attempt, passed or not, is returned as a retry record. A failed test
 * with no second attempt stays failed.
 */
export function applyTestRetries(cases, secondAttempts) {
  const retries = [];
  const settled = cases.map((test) => {
    const again = secondAttempts.get(test.id);
    if (test.result !== "failed" || !again) return test;
    const firstAttempt = { result: "failed", seconds: test.seconds, failures: test.failures ?? [], resultBundle: test.resultBundle ?? null };
    const secondAttempt = { result: again.result === "passed" ? "passed" : "failed", seconds: again.seconds ?? null, failures: again.failures ?? [], resultBundle: again.resultBundle ?? null };
    retries.push({ test: test.id, passedOnRetry: secondAttempt.result === "passed", firstAttempt, secondAttempt });
    return { id: test.id, result: secondAttempt.result, seconds: secondAttempt.seconds ?? test.seconds, attempts: 2, firstAttempt, ...(secondAttempt.result === "failed" ? { failures: secondAttempt.failures } : {}) };
  });
  return { cases: settled, retries };
}

// How often each test needed its retry, so a test that needs one again and again across runs can be seen.
export function testRetryCounts(retries) {
  const counts = {};
  for (const retry of retries) counts[retry.test] = (counts[retry.test] ?? 0) + 1;
  return counts;
}

// A reference-hardware record must never contain a retried test, whatever produced it.
export function referenceRunHasTestRetry(evidence) {
  if (evidence.latencyBudgets?.mode !== "enforced") return false;
  return (evidence.retries ?? []).some((retry) => retry.kind === "test-retry") || (evidence.tests?.testRetries ?? []).length > 0 || (evidence.tests?.cases ?? []).some((test) => (test.attempts ?? 1) > 1);
}

export function buildManifest({ runID, simulatorUDID, nativeSourceRevision, backendSourceRevision, apiOrigin, cardOrigin, fixtureSetID, configVersion, now, lifetimeMs }) {
  assertLoopbackOrigin(apiOrigin);
  assertLoopbackOrigin(cardOrigin);
  assert.ok(lifetimeMs > 0 && lifetimeMs <= 3_600_000, "A QA activation lasts at most one hour");
  for (const revision of [nativeSourceRevision, backendSourceRevision]) assert.match(revision, /^[a-f0-9]{40}$/, "Exact source revisions are required");
  return {
    version: 1, runID, simulatorUDID, nativeSourceRevision, backendSourceRevision, deploymentID: "qa-" + runID, configVersion, fixtureSetID,
    apiOrigin, cardOrigin, issuedAt: now, expiresAt: now + lifetimeMs,
    // Nothing on this Mac lane blocks outbound traffic, so the manifest says so: observed, not denied.
    erasedSimulator: true, syntheticDataOnly: true, outboundNetworkDenied: false, outboundNetworkObserved: true,
  };
}
