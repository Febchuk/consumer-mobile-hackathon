import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
