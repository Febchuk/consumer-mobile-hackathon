import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture } from "./fixture";
import { noPrivateValues } from "./assertions";

const PATH = "/.well-known/apple-app-site-association";
const PREFIX = "SYNTHTEAM1";
const HOST = "org.synthetic.calledit.host";

function configure(prefix: string | undefined, bundles: string | undefined) {
  if (prefix !== undefined) vi.stubEnv("V0_APPLE_APP_ID_PREFIX", prefix);
  if (bundles !== undefined) vi.stubEnv("V0_APPLE_BUNDLE_IDS", bundles);
}

async function expectRefused(response: Response) {
  const body = await response.text();
  expect(response.status).toBe(410);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Type")?.toLowerCase()).toContain("text/plain");
  expect(response.headers.get("Location")).toBeNull();
  expect(body).toBe("This legacy web page is no longer available.");
  expect(body).not.toContain("applinks");
  expect(body).not.toContain("appIDs");
}

afterEach(() => vi.unstubAllEnvs());

describe("universal-link association document", () => {
  it("[AASA.configured] serves the association for the configured app identifiers, scoped to card links", async () => {
    const f = await fixture();
    configure(PREFIX, HOST);
    const response = await f.t.fetch(PATH, { method: "GET", redirect: "manual" });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.redirected).toBe(false);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(JSON.parse(body)).toEqual({ applinks: { details: [{ appIDs: [`${PREFIX}.${HOST}`], components: [{ "/": `/c/${"?".repeat(64)}` }] }] } });
    noPrivateValues(body, f.privateValues);
  });

  it("[AASA.configured.multiple] lists every configured bundle under the one prefix, in order", async () => {
    const f = await fixture();
    configure(PREFIX, `${HOST},org.synthetic.calledit.qa-host`);
    const document = await (await f.t.fetch(PATH, { method: "GET" })).json();
    expect(document.applinks.details).toHaveLength(1);
    expect(document.applinks.details[0].appIDs).toEqual([`${PREFIX}.${HOST}`, `${PREFIX}.org.synthetic.calledit.qa-host`]);
    expect(Object.keys(document)).toEqual(["applinks"]);
  });

  it("[AASA.configured.same-for-every-caller] ignores credentials and query strings", async () => {
    const f = await fixture();
    configure(PREFIX, HOST);
    const anonymous = await (await f.t.fetch(PATH, { method: "GET" })).text();
    for (const role of ["creator", "outsider", "revoked"] as const) {
      const response = await f.t.fetch(`${PATH}?viewer=${role}`, { method: "GET", headers: { Authorization: `Bearer ${f.actors[role].token}` } });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(anonymous);
    }
  });

  it("[AASA.configured.pattern] the path pattern admits card locators and nothing else the backend serves", async () => {
    const f = await fixture();
    configure(PREFIX, HOST);
    const document = await (await f.t.fetch(PATH, { method: "GET" })).json();
    const components = document.applinks.details[0].components as Record<string, unknown>[];
    expect(components).toHaveLength(1);
    expect(Object.keys(components[0])).toEqual(["/"]);
    const pattern = new RegExp(`^${(components[0]["/"] as string).replace(/[?*]/g, (wildcard) => wildcard === "?" ? "." : ".*")}$`);
    expect(pattern.test(`/c/${"a".repeat(64)}`)).toBe(true);
    for (const path of ["/", "/c/", `/c/${"a".repeat(63)}`, `/c/${"a".repeat(65)}`, `/bet/${"a".repeat(64)}`, PATH, `/c/${"a".repeat(64)}/extra`]) expect(pattern.test(path)).toBe(false);
  });

  it("[AASA.configured.other-paths] leaves the landing page and retired paths unchanged", async () => {
    const f = await fixture();
    configure(PREFIX, HOST);
    for (const path of ["/", `/c/${"a".repeat(64)}`]) {
      const response = await f.t.fetch(path, { method: "GET" });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(await response.text()).not.toContain(PREFIX);
    }
    for (const path of ["/apple-app-site-association", `${PATH}/`, `${PATH}.json`, "/.well-known/assetlinks.json", "/.well-known/"]) await expectRefused(await f.t.fetch(path, { method: "GET" }));
  });

  for (const [name, prefix, bundles] of [
    ["none", undefined, undefined],
    ["prefix-only", PREFIX, undefined],
    ["bundles-only", undefined, HOST],
    ["empty", "", ""],
  ] as const) {
    it(`[AASA.unconfigured.${name}] refuses with 410 when configuration is absent`, async () => {
      const f = await fixture();
      configure(prefix, bundles);
      await expectRefused(await f.t.fetch(PATH, { method: "GET", redirect: "manual" }));
    });
  }

  for (const [name, prefix, bundles] of [
    ["prefix-short", "SYNTHTEAM", HOST],
    ["prefix-long", "SYNTHTEAM12", HOST],
    ["prefix-lowercase", "synthteam1", HOST],
    ["prefix-punctuation", "SYNTH.EAM1", HOST],
    ["prefix-padded", " SYNTHTEAM1", HOST],
    ["prefix-build-variable", "$(CALLED_IT_DEVELOPMENT_TEAM)", HOST],
    ["prefix-documentation-example", "ABCDE12345", HOST],
    ["bundle-documentation-example", PREFIX, "com.example.app"],
    ["bundle-build-variable", PREFIX, "$(PRODUCT_BUNDLE_IDENTIFIER)"],
    ["bundle-single-label", PREFIX, "calledit"],
    ["bundle-wildcard", PREFIX, "org.synthetic.*"],
    ["bundle-quote", PREFIX, 'org.synthetic."calledit'],
    ["bundle-whitespace", PREFIX, `${HOST} `],
    ["bundle-empty-entry", PREFIX, `${HOST},,org.synthetic.other`],
    ["bundle-trailing-comma", PREFIX, `${HOST},`],
    ["bundle-space-after-comma", PREFIX, `${HOST}, org.synthetic.other`],
    ["bundle-duplicate", PREFIX, `${HOST},${HOST}`],
    ["bundle-one-bad", PREFIX, `${HOST},bad_bundle.id`],
    ["bundle-too-many", PREFIX, ["a", "b", "c", "d", "e"].map((name) => `org.synthetic.${name}`).join(",")],
    ["bundle-overlong", PREFIX, `org.synthetic.${"a".repeat(150)}`],
  ]) {
    it(`[AASA.malformed.${name}] refuses with 410 and emits no identifier`, async () => {
      const f = await fixture();
      configure(prefix, bundles);
      await expectRefused(await f.t.fetch(PATH, { method: "GET", redirect: "manual" }));
    });
  }
});
