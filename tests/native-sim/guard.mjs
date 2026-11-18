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

export function buildManifest({ runID, simulatorUDID, nativeSourceRevision, backendSourceRevision, apiOrigin, cardOrigin, fixtureSetID, configVersion, now, lifetimeMs }) {
  assertLoopbackOrigin(apiOrigin);
  assertLoopbackOrigin(cardOrigin);
  assert.ok(lifetimeMs > 0 && lifetimeMs <= 3_600_000, "A QA activation lasts at most one hour");
  for (const revision of [nativeSourceRevision, backendSourceRevision]) assert.match(revision, /^[a-f0-9]{40}$/, "Exact source revisions are required");
  return {
    version: 1, runID, simulatorUDID, nativeSourceRevision, backendSourceRevision, deploymentID: "qa-" + runID, configVersion, fixtureSetID,
    apiOrigin, cardOrigin, issuedAt: now, expiresAt: now + lifetimeMs,
    erasedSimulator: true, syntheticDataOnly: true, outboundNetworkDenied: true,
  };
}
