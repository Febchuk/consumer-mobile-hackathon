#!/usr/bin/env python3
import argparse
import ipaddress
import json
import os
import pwd
import re
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

from global_pf import controller_flows, plan_rules, require_no_unowned_states, root_anchor_supported, reject_unreviewed_tree
from launch_provenance import verify_trusted_launch
from provision import clean_environment, digest, regular, require


def identity(pid, command):
    text = command(["/bin/ps", "-p", str(pid), "-o", "uid=,ppid=,pgid=,lstart="]).strip()
    values = text.split(maxsplit=3)
    require(len(values) == 4 and all(value.isdecimal() for value in values[:3]), "process identity unavailable")
    return {"uid": int(values[0]), "ppid": int(values[1]), "pgid": int(values[2]), "birth": " ".join(values[3].split())}


def process_snapshot(command):
    text = command(["/bin/ps", "-axo", "uid=,pid=,ppid=,pgid=,state=,lstart=,comm="])
    require(bool(text.strip()), "authoritative process snapshot unavailable")
    records = {}
    for line in text.splitlines():
        values = line.split(maxsplit=10)
        require(len(values) == 11 and all(value.isdecimal() for value in values[:4]), "unrecognized authoritative process snapshot")
        records[int(values[1])] = {"uid": int(values[0]), "ppid": int(values[2]), "pgid": int(values[3]),
                                   "state": values[4], "birth": " ".join(values[5:10]), "command": values[10]}
    return records


class Lease:
    def __init__(self, folder, owner_pid, run_id, seconds, launch_context, launch_sha256):
        self.folder = Path(folder)
        self.owner_pid = owner_pid
        self.run_id = str(uuid.UUID(run_id)).upper()
        self.seconds = seconds
        self.uid = int(os.environ.get("SUDO_UID", "-1"))
        require(os.geteuid() == 0 and self.uid >= 0 and self.uid != 0, "lease must run through sudo from the original cloud workload user")
        self.home = Path(pwd.getpwuid(self.uid).pw_dir)
        self.environment = clean_environment(self.home, self.folder)
        self.anchor = None
        self.token = None
        self.owns_anchor = False
        self.groups = {}
        self.audit = []
        self.device = None
        self.parent_identity = None
        self.reason = "not-started"
        self.enable_attempted = False
        self.owns_pflog = False
        self.folder_verified = False
        self.prior_simulators = set()
        self.launch_context = launch_context
        self.launch_sha256 = launch_sha256
        self.baseline_processes = {}
        self.descendants = {}
        self.escaped = {}

    def command(self, argv, timeout=10, check=True, combined=False):
        result = subprocess.run(argv, env=self.environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
        self.audit.append({"argv": argv, "exit": result.returncode, "stdoutSHA256": digest(result.stdout), "stderrSHA256": digest(result.stderr)})
        require(not check or result.returncode == 0, "independent lease command failed: " + " ".join(argv[:3]) + ": " + result.stderr.decode(errors="replace")[:2048])
        return (result.stdout + (result.stderr if combined else b"")).decode()

    def record(self, name, content):
        path = self.folder / name
        data = json.dumps(content, sort_keys=True).encode() + b"\n"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.chown(path, self.uid, -1)

    def pf(self, *argv, **kwargs):
        return self.command(["/sbin/pfctl", *argv], **kwargs)

    def prepare(self):
        require(self.folder.is_absolute() and self.folder.resolve() == self.folder and self.folder.stat().st_uid == self.uid and
                self.folder.stat().st_mode & 0o077 == 0, "private run-owned lease directory required")
        self.folder_verified = True
        self.authorization = verify_trusted_launch(self.launch_context, self.launch_sha256, self.run_id, consume=True)
        self.record("runner-authorized.json", self.authorization)
        request = json.loads(regular(str(self.folder / "lease-request.json"), 32_768))
        require(set(request) == {"runID", "controlPIDs"} and request["runID"] == self.run_id, "exact lease request required")
        self.parent_identity = identity(self.owner_pid, self.command)
        require(self.parent_identity["uid"] == self.uid, "lease owner identity mismatch")
        directory = self.home / "Library/Developer/CoreSimulator/Devices"
        self.prior_simulators = {path.name.upper() for path in directory.glob("*") if re.fullmatch(r"[A-Fa-f0-9-]{36}", path.name)}
        info = self.pf("-s", "info")
        require(re.search(r"Status:\s*Disabled", info), "this lane only supports the independently observed disabled-PF baseline")
        self.root = self.pf("-sr")
        root_anchor_supported(self.root)
        self.baseline_filter_tree = self.pf("-a", "*", "-sr")
        self.baseline_translation_tree = self.pf("-a", "*", "-sn")
        reject_unreviewed_tree(self.baseline_filter_tree)
        reject_unreviewed_tree(self.baseline_translation_tree, translation=True)
        self.command(["/usr/bin/sudo", "-n", "-H", "-u", "#" + str(self.uid), "/usr/bin/xcrun", "simctl", "list", "devices", "--json"], timeout=30)
        self.baseline_processes = self.snapshot()
        raw = self.command(["/usr/sbin/lsof", "-nP", "-a", "-p", ",".join(map(str, request["controlPIDs"])), "-iTCP", "-sTCP:ESTABLISHED", "-FpcuftPnT"])
        self.flows = controller_flows(raw, request["controlPIDs"])
        require(all(ipaddress.ip_address(flow["remoteIP"]).version == 4 for flow in self.flows),
                "IPv6 controller transport needs an explicitly verified neighbor-discovery preservation policy; refusing an unsafe global change")
        require(all(flow["remotePort"] not in {53, 853} for flow in self.flows), "resolver connections cannot be controller exceptions")
        states = self.pf("-ss")
        require_no_unowned_states(states, self.flows)
        require(not states.strip(), "disabled baseline unexpectedly has PF state; preserve it and refuse this lane")
        self.anchor, rules = plan_rules(self.run_id, self.flows)
        self.initial_anchor_inventory = self.pf("-a", "com.apple", "-s", "Anchors")
        require(self.anchor.split("/")[-1] not in [line.strip().split("/")[-1] for line in self.initial_anchor_inventory.splitlines()],
                "run anchor namespace already exists; no preexisting anchor may be adopted")
        require(not self.pf("-a", self.anchor, "-sr").strip(), "run anchor already exists")
        path = self.folder / "owned.pf"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as file:
            file.write(rules)
        self.pf("-n", "-a", self.anchor, "-f", str(path))
        require(time.monotonic() + 30 < self.deadline, "insufficient bounded lease time remains before mutation")
        available = self.command(["/sbin/ifconfig", "-l"]).split()
        self.initial_pflog_exists = "pflog0" in available
        if "pflog0" not in available:
            self.command(["/sbin/ifconfig", "pflog0", "create"])
            self.owns_pflog = True
        self.owns_anchor = True
        self.pf("-a", self.anchor, "-f", str(path))
        self.anchor_inventory = self.pf("-a", "com.apple", "-s", "Anchors")
        children = [line.strip().split("/")[-1] for line in self.anchor_inventory.splitlines() if line.strip()]
        require(self.anchor.split("/")[-1] in children and max(children) == self.anchor.split("/")[-1],
                "run anchor is not the final child under the existing wildcard hook")
        self.enable_attempted = True
        output = self.pf("-E", combined=True)
        match = re.search(r"Token\s*:\s*(\d+)", output)
        require(match is not None, "PF enable token missing: retain isolation for administrative cleanup")
        self.token = match.group(1)
        self.rules = self.pf("-a", self.anchor, "-sr")
        self.active_filter_tree = self.pf("-a", "*", "-sr")
        require("Enabled" in self.pf("-s", "info"), "kernel PF did not enable")
        self.record("lease-ready.json", {"runID": self.run_id, "ownerPID": self.owner_pid, "ownerIdentity": self.parent_identity,
                    "leasePID": os.getpid(), "leaseIdentity": identity(os.getpid(), self.command), "lifetimeSeconds": self.seconds,
                    "leaseExpiresAt": int(time.time() * 1000 + max(0, self.deadline - time.monotonic()) * 1000),
                    "runnerAuthorization": self.authorization, "launchContext": self.launch_context, "launchContextSHA256": self.launch_sha256,
                    "anchor": self.anchor, "activeRules": self.rules, "rootRules": self.root, "controllerFlows": self.flows,
                    "activeFilterTree": self.active_filter_tree, "baselineTranslationTree": self.baseline_translation_tree,
                    "initialPFInfo": info, "initialStates": states, "preexistingSimulatorUDIDs": sorted(self.prior_simulators),
                    "recordedAt": int(time.time() * 1000), "audit": self.audit[:]})

    def register_jobs(self):
        for path in (self.folder / "jobs").glob("*.json"):
            request = json.loads(regular(str(path), 4096))
            require(set(request) == {"pid", "ppid", "uid", "argvSHA256"} and type(request["pid"]) is int and
                    path.stem == str(request["pid"]), "invalid workload registration")
            pid = request["pid"]
            if pid in self.groups:
                continue
            require(len(self.groups) < 8, "bounded run workload count exceeded")
            actual = identity(pid, self.command)
            require(actual["uid"] == self.uid and actual["ppid"] == self.owner_pid and actual["pgid"] == pid and
                    request["ppid"] == self.owner_pid and request["uid"] == self.uid, "unowned workload or controller registration rejected")
            self.groups[pid] = actual
            self.record("jobs/" + str(pid) + ".approved", {"pid": pid, "birth": actual["birth"]})

    def snapshot(self):
        return process_snapshot(self.command)

    def observe_descendants(self, snapshot):
        owned = set()
        for pid, record in snapshot.items():
            expected = self.groups.get(record["pgid"])
            if expected and not record["state"].startswith("Z"):
                try:
                    if os.getsid(pid) == record["pgid"]:
                        owned.add(pid)
                except ProcessLookupError:
                    continue
            elif pid in self.descendants and record["birth"] == self.descendants[pid]["birth"]:
                owned.add(pid)
        changed = True
        while changed:
            changed = False
            for pid, record in snapshot.items():
                if pid not in owned and record["ppid"] in owned:
                    owned.add(pid)
                    changed = True
        for pid in owned:
            self.descendants[pid] = snapshot[pid]
            if snapshot[pid]["pgid"] not in self.groups:
                self.escaped[pid] = snapshot[pid]

    def register_device(self):
        path = self.folder / "device.json"
        if self.device is not None or not path.exists():
            return
        request = json.loads(regular(str(path), 4096))
        require(set(request) == {"runID", "simulatorUDID"} and request["runID"] == self.run_id, "invalid run device registration")
        device = str(uuid.UUID(request["simulatorUDID"])).upper()
        require(device not in self.prior_simulators, "refusing a simulator that existed before the independently controlled lease")
        import plistlib
        metadata = plistlib.loads(regular(str(self.home / "Library/Developer/CoreSimulator/Devices" / device / "device.plist")))
        require(metadata.get("UDID", "").upper() == device and metadata.get("name") == "CalledIt-QA-" + self.run_id, "device is not owned by this run")
        self.device = device
        self.command(["/usr/bin/sudo", "-n", "-H", "-u", "#" + str(self.uid), "/usr/bin/xcrun", "simctl", "erase", device], timeout=30)
        self.record("device-approved.json", {"runID": self.run_id, "simulatorUDID": device,
                    "independentErase": self.audit[-1], "recordedAt": int(time.time() * 1000)})

    def cleanup(self):
        if not self.folder_verified:
            return
        if not (self.owns_anchor or self.enable_attempted or self.owns_pflog or self.groups or self.device):
            self.record("lease-cleanup.json", {"runID": self.run_id, "reason": self.reason, "failures": [], "isolationRetained": False,
                        "registeredGroups": [], "simulatorUDID": None, "restoration": {"noOwnedMutationAttempted": True}, "audit": self.audit[-100:]})
            return
        failures = []
        restoration = {"mutationStarted": self.owns_anchor or self.enable_attempted or self.owns_pflog}
        snapshot = None
        try:
            snapshot = self.snapshot()
            self.observe_descendants(snapshot)
        except Exception:
            failures.append("authoritative process ownership observation unavailable; no signal permission inferred")
        for sig in (signal.SIGTERM, signal.SIGKILL):
            if snapshot is not None:
                for group, expected in self.groups.items():
                    members = {pid: record for pid, record in snapshot.items() if record["pgid"] == group and not record["state"].startswith("Z")}
                    if not members:
                        continue
                    leader = snapshot.get(group)
                    try:
                        require(leader is None or (leader["birth"] == expected["birth"] and leader["uid"] == expected["uid"]),
                                "registered group leader identity changed")
                        require(all(os.getsid(pid) == group for pid in members), "registered session/group ownership unproven")
                        os.killpg(group, sig)
                    except ProcessLookupError:
                        pass
                    except Exception:
                        failures.append("registered group ownership/signal unavailable; isolation retained")
            time.sleep(1 if sig == signal.SIGTERM else 0.2)
            try:
                snapshot = self.snapshot()
                self.observe_descendants(snapshot)
            except Exception:
                snapshot = None
                failures.append("post-signal process observation unavailable")
        if self.device:
            try:
                self.command(["/usr/bin/sudo", "-n", "-H", "-u", "#" + str(self.uid), "/usr/bin/xcrun", "simctl", "shutdown", self.device], timeout=30, check=False)
                self.command(["/usr/bin/sudo", "-n", "-H", "-u", "#" + str(self.uid), "/usr/bin/xcrun", "simctl", "delete", self.device], timeout=30)
                directory = self.home / "Library/Developer/CoreSimulator/Devices" / self.device
                deadline = time.monotonic() + 5
                while directory.exists() and time.monotonic() < deadline:
                    time.sleep(0.1)
                require(not directory.exists(), "deleted simulator directory still exists")
                restoration["deviceDeletionObserved"] = True
            except Exception:
                failures.append("run-owned simulator not proven stopped/deleted")
        try:
            snapshot = self.snapshot()
            self.observe_descendants(snapshot)
            survivors = {pid: record for pid, record in snapshot.items() if not record["state"].startswith("Z") and
                         (record["pgid"] in self.groups or (pid in self.escaped and record["birth"] == self.escaped[pid]["birth"]))}
            unbound = {pid: record for pid, record in snapshot.items() if record["uid"] in {self.uid, 0} and not record["state"].startswith("Z") and
                       not (record["ppid"] == os.getpid() and Path(record["command"]).name == "ps") and
                       (pid not in self.descendants or record["birth"] != self.descendants[pid]["birth"]) and
                       (pid not in self.baseline_processes or record["birth"] != self.baseline_processes[pid]["birth"])}
            restoration["survivingOwnedOrEscapedProcesses"] = survivors
            restoration["unattributedNewUserProcesses"] = unbound
            require(not survivors and not unbound, "escaped, surviving or unattributed workload descendants remain")
        except Exception:
            failures.append("all run-owned/escaped descendant termination could not be proven")
        if self.enable_attempted and self.token is None:
            failures.append("PF enable reference token unavailable; never force-disable host PF")
        if not failures:
            try:
                if self.owns_anchor:
                    self.pf("-a", self.anchor, "-F", "rules")
                    restoration["ownedRulesAfterFlush"] = self.pf("-a", self.anchor, "-sr")
                    restoration["anchorInventoryAfterFlush"] = self.pf("-a", "com.apple", "-s", "Anchors")
                    restoration["ownedAnchorStillListed"] = self.anchor.split("/")[-1] in [line.strip().split("/")[-1] for line in restoration["anchorInventoryAfterFlush"].splitlines()]
                    require(not restoration["ownedRulesAfterFlush"].strip(), "owned filtering rules remain")
                    require(restoration["anchorInventoryAfterFlush"] == self.initial_anchor_inventory, "actual anchor inventory not restored; no unowned namespace is destroyed")
                if self.token:
                    self.pf("-X", self.token)
                    restoration["ownEnableReferenceReleased"] = True
                restoration["actualPFInfoAfterRelease"] = self.pf("-s", "info")
                restoration["rootRulesAfterRelease"] = self.pf("-sr")
                restoration["statesAfterRelease"] = self.pf("-ss")
                restoration["filterTreeAfterRelease"] = self.pf("-a", "*", "-sr")
                require(re.search(r"Status:\s*Disabled", restoration["actualPFInfoAfterRelease"]) and
                        restoration["rootRulesAfterRelease"] == self.root and not restoration["statesAfterRelease"].strip(),
                        "actual disabled/empty-state baseline not restored; never force-disable another reference")
                reject_unreviewed_tree(restoration["filterTreeAfterRelease"])
                if self.owns_pflog:
                    self.command(["/sbin/ifconfig", "pflog0", "destroy"])
                restoration["pflogPresentAfterCleanup"] = "pflog0" in self.command(["/sbin/ifconfig", "-l"]).split()
                require(restoration["pflogPresentAfterCleanup"] == self.initial_pflog_exists,
                        "actual PFLOG ownership/baseline not restored")
            except Exception as error:
                failures.append("owned-state restoration query failed: " + str(error))
        isolation_active = False if not self.owns_anchor else None
        if self.owns_anchor:
            try:
                restoration["actualOwnedRulesAtExit"] = self.pf("-a", self.anchor, "-sr")
                restoration["actualPFInfoAtExit"] = self.pf("-s", "info")
                isolation_active = bool(restoration["actualOwnedRulesAtExit"].strip()) and "Enabled" in restoration["actualPFInfoAtExit"]
            except Exception:
                failures.append("final isolation state could not be observed")
        self.record("lease-cleanup.json", {"runID": self.run_id, "reason": self.reason, "failures": failures,
                    "isolationRetained": isolation_active, "registeredGroups": list(self.groups), "simulatorUDID": self.device,
                    "restoration": restoration, "ownedEnableReference": self.token, "audit": self.audit[-100:]})
        require(not failures, "lease retained isolation or restoration is unproven; administrative cleanup required")

    def run(self):
        require(30 <= self.seconds <= 3600, "bounded independent lease lifetime required")
        started = time.monotonic()
        self.deadline = started + self.seconds
        last_sequence = -1
        last_heartbeat = started
        try:
            self.prepare()
            checked = 0
            self.reason = "lease-expired"
            while time.monotonic() - started < self.seconds:
                current = identity(self.owner_pid, self.command)
                require(current["uid"] == self.parent_identity["uid"] and current["birth"] == self.parent_identity["birth"], "provisioner exited/reused PID")
                heartbeat = json.loads(regular(str(self.folder / "heartbeat.json"), 4096))
                require(set(heartbeat) == {"runID", "sequence"} and heartbeat["runID"] == self.run_id and type(heartbeat["sequence"]) is int,
                        "invalid independent lease heartbeat")
                if heartbeat["sequence"] > last_sequence:
                    last_sequence = heartbeat["sequence"]
                    last_heartbeat = time.monotonic()
                require(time.monotonic() - last_heartbeat < 8, "provisioner heartbeat stopped")
                self.register_jobs()
                current_processes = self.snapshot()
                self.observe_descendants(current_processes)
                require(not any(pid in current_processes and current_processes[pid]["birth"] == value["birth"] for pid, value in self.escaped.items()), "workload escaped its independently registered process group")
                self.register_device()
                if (self.folder / "lease-stop.json").exists():
                    stop = json.loads(regular(str(self.folder / "lease-stop.json"), 4096))
                    require(stop == {"runID": self.run_id}, "invalid lease stop request")
                    self.reason = "owner-requested-stop"
                    return
                if time.monotonic() - checked >= 2:
                    require(self.pf("-sr") == self.root and self.pf("-a", self.anchor, "-sr") == self.rules and "Enabled" in self.pf("-s", "info"),
                            "kernel isolation rules changed during lease")
                    require(self.pf("-a", "com.apple", "-s", "Anchors") == self.anchor_inventory and self.pf("-a", "*", "-sr") == self.active_filter_tree and
                            self.pf("-a", "*", "-sn") == self.baseline_translation_tree, "PF nested filtering/translation or anchor ordering changed")
                    require(not self.pf("-ss").strip(), "unexpected state could bypass the stateless global-deny rules")
                    checked = time.monotonic()
                time.sleep(0.1)
            raise RuntimeError("bounded lease expired")
        except BaseException as error:
            self.reason = type(error).__name__ + ": " + str(error)
            if self.folder_verified:
                self.record("lease-blocked.json", {"runID": self.run_id, "reason": self.reason, "audit": self.audit[-100:]})
            raise
        finally:
            self.cleanup()


def main():
    parser = argparse.ArgumentParser(description="Independent run-owned global-PF lease; only invoked by the provisioner")
    parser.add_argument("--directory", required=True)
    parser.add_argument("--owner-pid", required=True, type=int)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--seconds", required=True, type=int)
    parser.add_argument("--trusted-launch-context", required=True)
    parser.add_argument("--trusted-launch-sha256", required=True)
    args = parser.parse_args()
    def interrupted(_signum, _frame):
        raise RuntimeError("independent lease interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    Lease(args.directory, args.owner_pid, args.run_id, args.seconds, args.trusted_launch_context, args.trusted_launch_sha256).run()


if __name__ == "__main__":
    main()
