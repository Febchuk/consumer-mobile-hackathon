import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

const simctl = (args, options = {}) => execFileSync("xcrun", ["simctl", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000, ...options });

export function listDevices() {
  return Object.entries(JSON.parse(simctl(["list", "devices", "--json"])).devices).flatMap(([runtime, devices]) => devices.map((device) => ({ ...device, runtime })));
}

export function pickRuntime(requested) {
  const runtimes = JSON.parse(simctl(["list", "runtimes", "--json"])).runtimes.filter((runtime) => runtime.isAvailable && runtime.platform === "iOS");
  const found = requested ? runtimes.find((runtime) => runtime.identifier === requested || runtime.version === requested) : runtimes.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  assert.ok(found, "No usable iOS simulator runtime" + (requested ? " matching " + requested : ""));
  return found;
}

/**
 * Creates the one simulator this run owns. It is new, erased before first boot, and never one that existed before the
 * run: the caller's own simulators are only read to prove that.
 */
export function createDedicatedSimulator({ runID, deviceType, runtime }) {
  const before = new Set(listDevices().map((device) => device.udid));
  const name = "CalledIt-QA-" + runID.slice(0, 8);
  const udid = simctl(["create", name, deviceType, runtime.identifier]).trim();
  assert.match(udid, /^[0-9A-F-]{36}$/, "simctl did not return a device identifier");
  assert.ok(!before.has(udid), "Refusing a simulator that existed before this run");
  simctl(["erase", udid]);
  simctl(["boot", udid]);
  simctl(["bootstatus", udid, "-b"], { timeout: 600_000 });
  return { udid, name };
}

// A fresh simulator has no Apple account. This proves it rather than assuming it: the account store must be empty.
export function assertNoAppleAccount(udid) {
  const accounts = spawnSync("xcrun", ["simctl", "spawn", udid, "defaults", "read", "MobileMeAccounts", "Accounts"], { encoding: "utf8" });
  const text = (accounts.stdout ?? "").replace(/\s/g, "");
  assert.ok(accounts.status !== 0 || text === "()" || text === "", "The run's simulator has an Apple account; refusing to continue");
}

export function destroySimulator(udid) {
  spawnSync("xcrun", ["simctl", "shutdown", udid], { stdio: "ignore", timeout: 120_000 });
  const removed = spawnSync("xcrun", ["simctl", "delete", udid], { stdio: "ignore", timeout: 120_000 });
  return removed.status === 0 && !listDevices().some((device) => device.udid === udid);
}

/**
 * Lists established TCP connections from the simulator's own processes to anything that is not loopback. macOS gives an
 * unprivileged user no way to deny a simulator outbound traffic, so this observes it instead of preventing it.
 */
export function nonLoopbackConnections(udid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\n").map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map((match) => ({ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }));
  const owned = new Map();
  for (const row of rows) if (row.command.includes("launchd_sim") && row.command.includes(udid)) owned.set(row.pid, row);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) if (!owned.has(row.pid) && owned.has(row.parent)) { owned.set(row.pid, row); grew = true; }
  }
  if (!owned.size) return [];
  const listing = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:ESTABLISHED", "-a", "-p", [...owned.keys()].join(",")], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout ?? "";
  const found = [];
  for (const line of listing.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    const remote = /->(\[[^\]]+\]|[^:]+):(\d+)/.exec(fields[8] ?? "");
    if (!remote || /^(127\.|\[::1\])/.test(remote[1])) continue;
    found.push({ process: fields[0], remote: remote[1] + ":" + remote[2] });
  }
  return found;
}
