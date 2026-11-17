import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import type { ProvisioningVerifier } from "../qa-adapter/evidence";
import { canonicalUUID, parseManifest, type ExpectedRun } from "../qa-adapter/manifest";

const execute = promisify(execFile);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export class LiveIsolationUnproven extends Error {
  constructor() { super("Actual authorized runner/kernel isolation provenance is unavailable or changed"); }
}

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new LiveIsolationUnproven();
}

async function bounded(path: string, limit = 1_048_576): Promise<Buffer> {
  requireValue(isAbsolute(path) && await realpath(path) === resolve(path));
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    requireValue(stat.isFile() && stat.size > 0 && stat.size <= limit);
    const bytes = await handle.readFile();
    requireValue(bytes.length > 0 && bytes.length <= limit);
    return bytes;
  } finally { await handle.close(); }
}

type Context = {
  version: number; phase: string; ownerPID: number; simulatorUDID: string; harnessDirectory: string;
  manifestPath: string; receiptPath: string; manifestSHA256: string;
  request: { runID: string; nativeSourceRevision: string; backendSourceRevision: string; fixtureSetID: string; sourceCardOrigin: string };
};

type LiveStatus = {
  runID: string; ownerPID: number; leasePID: number; anchor: string; checkedAt: number;
  leaseReadySHA256: string; networkProofSHA256: string; sourceFingerprints: Record<string, string>;
  device: { runID: string; simulatorUDID: string; independentErase: { exit: number } } | null;
  runnerAuthorization: { buildID: string; launchNonce: string; contextSHA256: string };
};

export function createLiveProvisioningController(options: {
  contextPath: string;
  expected: ExpectedRun;
  expectedHarnessSources: Readonly<Record<string, string>>;
  expectedSourceCardOrigin: string;
}): { verify: ProvisioningVerifier; assertLiveIsolation: () => Promise<void> } {
  requireValue(isAbsolute(options.contextPath) && Object.keys(options.expectedHarnessSources).length >= 8);
  requireValue(Object.values(options.expectedHarnessSources).every((value) => /^[a-f0-9]{64}$/.test(value)));
  requireValue(options.expectedHarnessSources["status.py"] && options.expectedHarnessSources["lease.py"] && options.expectedHarnessSources["launch_provenance.py"]);
  const sourcePins = Object.freeze({ ...options.expectedHarnessSources });
  requireValue(options.expectedSourceCardOrigin === "https://cards.qa-runtime.invalid");
  const expectedRun = canonicalUUID(options.expected.runID);
  const folder = dirname(options.contextPath);

  async function inspect(): Promise<{ context: Context; live: LiveStatus }> {
    try {
      requireValue(process.platform === "darwin");
      const context = JSON.parse((await bounded(options.contextPath, 65_536)).toString()) as Context;
      requireValue(context.version === 1 && context.phase === "isolated-runtime" && context.ownerPID > 1 &&
        canonicalUUID(context.request.runID) === expectedRun && canonicalUUID(context.simulatorUDID) === canonicalUUID(options.expected.simulatorUDID) &&
        context.request.nativeSourceRevision === options.expected.nativeSourceRevision && context.request.backendSourceRevision === options.expected.backendSourceRevision &&
        context.request.fixtureSetID === options.expected.fixtureSetID && context.request.sourceCardOrigin === options.expectedSourceCardOrigin);
      requireValue(dirname(context.manifestPath) === folder && dirname(context.receiptPath) === folder && isAbsolute(context.harnessDirectory));
      const script = join(context.harnessDirectory, "status.py");
      for (const [name, fingerprint] of Object.entries(sourcePins)) {
        requireValue(/^[A-Za-z0-9_-]+\.(?:py|ts)$/.test(name) && sha256(await bounded(join(context.harnessDirectory, name))) === fingerprint);
      }
      const result = await execute("/usr/bin/python3", ["-E", "-s", script, "--directory", folder, "--run-id", expectedRun, "--owner-pid", String(context.ownerPID)], {
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: userInfo().homedir, TMPDIR: folder, LANG: "en_US.UTF-8", NODE_ENV: "test" },
        timeout: 15_000, maxBuffer: 1_048_576,
      });
      const live = JSON.parse(result.stdout) as LiveStatus;
      requireValue(canonicalUUID(live.runID) === expectedRun && live.ownerPID === context.ownerPID && live.leasePID > 1 &&
        live.checkedAt <= Date.now() + 1_000 && live.checkedAt >= Date.now() - 15_000 &&
        isDeepStrictEqual(live.sourceFingerprints, sourcePins));
      requireValue(live.device && canonicalUUID(live.device.simulatorUDID) === canonicalUUID(options.expected.simulatorUDID) && live.device.independentErase.exit === 0);
      requireValue(/^[A-Z0-9]{26}$/.test(live.runnerAuthorization.buildID) && /^[a-f0-9]{64}$/.test(live.runnerAuthorization.contextSHA256));
      return { context, live };
    } catch { throw new LiveIsolationUnproven(); }
  }

  const assertLiveIsolation = async () => { await inspect(); };
  const verify: ProvisioningVerifier = async ({ receipt, artifacts }) => {
    try {
      const { context, live } = await inspect();
      const manifest = parseManifest(await bounded(context.manifestPath, 16_384), options.expected);
      requireValue(manifest.sha256 === receipt.manifestSHA256 && manifest.sha256 === context.manifestSHA256 &&
        canonicalUUID(receipt.runID) === expectedRun && canonicalUUID(receipt.simulatorUDID) === canonicalUUID(options.expected.simulatorUDID));
      const records = new Map<string, Record<string, unknown>>();
      for (const artifact of receipt.artifacts) {
        requireValue(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(artifact.file));
        const bytes = await bounded(join(folder, artifact.file));
        requireValue(sha256(bytes) === artifact.sha256 && sha256(bytes) === sha256(artifacts.get(artifact.kind) ?? new Uint8Array()));
        records.set(artifact.kind, JSON.parse(bytes.toString()) as Record<string, unknown>);
      }
      requireValue(records.size === 4);
      const created = records.get("simulator-created");
      const erased = records.get("simulator-erased");
      const empty = records.get("empty-state-verified");
      const denied = records.get("outbound-denied");
      requireValue(created && erased && empty && denied);
      for (const record of [created, erased, empty, denied]) {
        requireValue(canonicalUUID(record.runID) === expectedRun && canonicalUUID(record.simulatorUDID) === canonicalUUID(options.expected.simulatorUDID));
      }
      requireValue(isDeepStrictEqual(erased.independentLeaseErase, live.device));
      requireValue(empty.priorQAAppGroupFiles === 0 && Array.isArray(empty.systemBundleIDs) && !empty.systemBundleIDs.includes("com.mikunad.calledit.qa.host"));
      const messages = empty.messages as { counts: Record<string, number> }[];
      const contacts = empty.contacts as { count: number }[];
      requireValue(Array.isArray(messages) && messages.every((entry) => Object.values(entry.counts).every((count) => count === 0)) &&
        Array.isArray(contacts) && contacts.every((entry) => entry.count === 0));
      requireValue(denied.leaseReadySHA256 === live.leaseReadySHA256 && denied.networkProofSHA256 === live.networkProofSHA256 &&
        denied.sourceCardOrigin === options.expectedSourceCardOrigin);
      const kernel = denied.kernelVerification as { verifiedAt: number };
      requireValue(typeof kernel.verifiedAt === "number" && typeof denied.simulatorBootStartedAt === "number" && kernel.verifiedAt <= denied.simulatorBootStartedAt);
      await assertLiveIsolation();
      return Object.freeze({ approved: true as const, verificationID: "revyl-live-" + expectedRun.replaceAll("-", "").toLowerCase() });
    } catch { throw new LiveIsolationUnproven(); }
  };
  return Object.freeze({ verify, assertLiveIsolation });
}
