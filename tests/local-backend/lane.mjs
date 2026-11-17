import { Buffer } from "node:buffer";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const argv = process.argv.slice(2);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const started = performance.now();

if (process.platform !== "linux" || process.arch !== "x64") throw new Error("The real-backend lane is pinned for Linux x64 only; execution is blocked, not passed");
const pins = JSON.parse(readFileSync(resolve(root, "tests/qa-runtime/binary-pins.json"), "utf8"));
const pin = pins.platforms["linux-x64"];
if (!pin.url.startsWith(`${pins.repository}/releases/download/${pins.release}/`)) throw new Error("Pinned asset is not from the pinned official release");

async function pinnedBinary() {
  const cache = resolve(homedir(), ".cache/calledit/convex-local-backend", pins.release);
  const binary = resolve(cache, pins.executableName);
  if (existsSync(binary) && digest(readFileSync(binary)) === pin.executableSHA256) return binary;
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const scratch = mkdtempSync(resolve(cache, "download-"));
  try {
    const response = await fetch(pin.url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error(`Pinned backend download failed with HTTP ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (digest(archive) !== pin.archiveSHA256) throw new Error("Downloaded backend archive does not match the pinned SHA256");
    writeFileSync(resolve(scratch, "backend.zip"), archive, { mode: 0o600 });
    execFileSync("unzip", ["-q", resolve(scratch, "backend.zip"), pins.executableName, "-d", resolve(scratch, "extracted")], { stdio: ["ignore", "inherit", "inherit"] });
    const extracted = resolve(scratch, "extracted", pins.executableName);
    if (digest(readFileSync(extracted)) !== pin.executableSHA256) throw new Error("Extracted backend executable does not match the pinned SHA256");
    chmodSync(extracted, 0o700);
    renameSync(extracted, binary);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return binary;
}

const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "test", CI: "1" };
const guard = spawnSync(process.execPath, ["--test", resolve(here, "loopback.test.mjs")], { cwd: root, env, stdio: "inherit" });
if (guard.error) throw guard.error;
if (guard.status !== 0) process.exit(guard.status ?? 1);

const binary = option("--binary") ? resolve(option("--binary")) : await pinnedBinary();
const output = resolve(option("--output") ?? resolve(mkdtempSync(resolve(tmpdir(), "calledit-local-backend-")), "run"));
const run = spawnSync(process.execPath, [resolve(here, "run.mjs"), "--binary", binary, "--output", output], { cwd: root, env, stdio: "inherit" });
if (run.error) throw run.error;

let evidence;
try {
  evidence = JSON.parse(readFileSync(resolve(output, "evidence.json"), "utf8"));
} catch {
  console.error("No evidence manifest; execution is blocked, not passed");
  process.exit(1);
}
for (const assertion of evidence.assertions) console.log(`${assertion.status === "passing" ? "ok  " : "FAIL"} ${assertion.id} (${Math.round(assertion.durationMs)} ms)`);
if (evidence.error) console.error(evidence.error);
const passing = evidence.assertions.filter((assertion) => assertion.status === "passing").length;
const complete = run.status === 0 && evidence.status === "passing-limited-contract" && evidence.gates.realBackendProtocol === true;
console.log(JSON.stringify({ lane: "local-backend", candidateSha: evidence.candidateSha, backendVersion: evidence.backendVersion, status: complete ? "passing-limited-contract" : evidence.status === "passing-limited-contract" ? "incomplete" : evidence.status, assertions: evidence.assertions.length, passing, seconds: Number(((performance.now() - started) / 1000).toFixed(1)), output }));
process.exit(complete ? 0 : run.status || 1);
