#!/usr/bin/env python3
import argparse
import json
import os
import platform
import pwd
import plistlib
import re
import subprocess
import time
import uuid
from pathlib import Path

from provision import clean_environment, digest, regular, require
from launch_provenance import root_launch_witness, verify_trusted_launch


def source_fingerprints():
    folder = Path(__file__).resolve().parent
    return {path.name: digest(regular(str(path))) for pattern in ("*.py", "*.ts") for path in sorted(folder.glob(pattern))}


def live_status(folder, run_id, owner_pid):
    require(platform.system() == "Darwin", "real macOS kernel isolation required")
    folder = Path(folder)
    run = str(uuid.UUID(run_id)).upper()
    home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    environment = clean_environment(home, folder)
    def command(argv):
        result = subprocess.run(argv, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=False)
        require(result.returncode == 0, "live isolation query failed")
        return result.stdout.decode()
    for marker in ("lease-cleanup.json", "lease-blocked.json", "lease-stop.json"):
        require(not (folder / marker).exists(), "independent isolation is stopping or no longer valid")
    ready_raw = regular(str(folder / "lease-ready.json"))
    ready = json.loads(ready_raw)
    require(ready["runID"] == run and ready["ownerPID"] == owner_pid, "live controller identity mismatch")
    require(int(time.time() * 1000) < ready["leaseExpiresAt"], "independent isolation lease expired")
    authorization = verify_trusted_launch(ready["launchContext"], ready["launchContextSHA256"], run)
    require(authorization["chainSHA256"] == ready["runnerAuthorization"]["chainSHA256"],
            "live platform launch authority changed")
    witness, witness_hash = root_launch_witness(authorization, ready["leasePID"])
    require(witness["rootGuard"]["birth"] == ready["leaseIdentity"]["birth"] and witness["consumedAt"] <= ready["recordedAt"],
            "independent root launch consumption must precede this exact lease/process")
    heartbeat = json.loads(regular(str(folder / "heartbeat.json"), 4096))
    require(heartbeat["runID"] == run and 0 <= time.time() - (folder / "heartbeat.json").stat().st_mtime < 8, "live controller heartbeat is stale")
    pid = ready["leasePID"]
    uid = command(["/bin/ps", "-p", str(pid), "-o", "uid="]).strip()
    birth = " ".join(command(["/bin/ps", "-p", str(pid), "-o", "lstart="]).split())
    arguments = command(["/usr/bin/sudo", "-n", "/bin/ps", "-p", str(pid), "-o", "args="])
    require(uid == "0" and birth == ready["leaseIdentity"]["birth"] and str(Path(__file__).resolve().parent / "lease.py") in arguments and
            str(folder) in arguments and run in arguments, "independent root lease process is absent or reused")
    require(command(["/usr/bin/sudo", "-n", "/sbin/pfctl", "-sr"]) == ready["rootRules"], "root PF policy changed")
    require(ready["anchor"] == "com.apple/zzzz_calledit_" + uuid.UUID(run).hex and
            command(["/usr/bin/sudo", "-n", "/sbin/pfctl", "-a", ready["anchor"], "-sr"]) == ready["activeRules"], "run-owned PF policy changed")
    require(command(["/usr/bin/sudo", "-n", "/sbin/pfctl", "-a", "*", "-sr"]) == ready["activeFilterTree"] and
            command(["/usr/bin/sudo", "-n", "/sbin/pfctl", "-a", "*", "-sn"]) == ready["baselineTranslationTree"], "nested PF policy changed")
    require("Enabled" in command(["/usr/bin/sudo", "-n", "/sbin/pfctl", "-s", "info"]) and
            not command(["/usr/bin/sudo", "-n", "/sbin/pfctl", "-ss"]).strip(), "PF disabled or unexpected state can bypass the stateless policy")
    proof_raw = regular(str(folder / "network-verified.json"))
    proof = json.loads(proof_raw)
    require(proof["runID"] == run and ready["recordedAt"] <= proof["verifiedAt"] <= int(time.time() * 1000),
            "kernel proof must follow this nonce/boot-bound lease, not a previous run")
    broker = proof["resolverBroker"]
    require(broker["pcapFile"] == "resolver-blocked.pcap", "unrecognized broker capture path")
    capture = regular(str(folder / "resolver-blocked.pcap"))
    require(digest(capture) == broker["pcapSHA256"], "owned blocked DNS capture changed")
    decoded = command(["/usr/sbin/tcpdump", "-n", "-e", "-vv", "-r", str(folder / "resolver-blocked.pcap")]).lower()
    require(broker["hostname"] in decoded and "block out" in decoded, "actual kernel broker block is missing")
    approved_raw = regular(str(folder / "device-approved.json")) if (folder / "device-approved.json").exists() else None
    device = json.loads(approved_raw) if approved_raw else None
    if device:
        require(device["runID"] == run and device["simulatorUDID"] not in ready["preexistingSimulatorUDIDs"] and device["independentErase"]["exit"] == 0,
                "actual independent fresh-device/erase provenance missing")
        directory = home / "Library/Developer/CoreSimulator/Devices" / device["simulatorUDID"]
        metadata = plistlib.loads(regular(str(directory / "device.plist")))
        require(metadata.get("UDID", "").upper() == device["simulatorUDID"] and metadata.get("name") == "CalledIt-QA-" + run,
                "actual run-owned simulator disappeared or changed")
    return {"runID": run, "ownerPID": owner_pid, "leasePID": pid, "anchor": ready["anchor"], "checkedAt": int(time.time() * 1000),
            "leaseReadySHA256": digest(ready_raw), "networkProofSHA256": digest(proof_raw),
            "runnerAuthorization": authorization,
            "rootLaunchWitnessSHA256": witness_hash,
            "deviceApprovedSHA256": digest(approved_raw) if approved_raw else None, "device": device,
            "sourceFingerprints": source_fingerprints()}


def main():
    parser = argparse.ArgumentParser(description="Read actual live root lease/kernel state for the explicitly trusted adapter verifier")
    parser.add_argument("--directory")
    parser.add_argument("--run-id")
    parser.add_argument("--owner-pid", type=int)
    parser.add_argument("--fingerprint-only", action="store_true")
    args = parser.parse_args()
    result = source_fingerprints() if args.fingerprint_only else live_status(args.directory, args.run_id, args.owner_pid)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
