import json
import os
import re
import time
import subprocess
import uuid
from pathlib import Path


REVYL_URL = "https://docs.revyl.com/remote-builds/caching"
CAPY_URL = "https://docs.capy.ai/cloud-phones"
REVIEWED_READABLE_SHA256 = "24c2eacdef14a2d9ae80a3aa7a83851d209ef4b8b379f9df479890f9305fadd5"
REQUIRED = {"tests/simulator-provisioner/" + name for name in
            ("provision.py", "global_pf.py", "lease.py", "job.py", "netprobe.py", "status.py", "controller.ts", "launch_provenance.py")}


def verify_trusted_launch(path, expected_sha256, run_id, consume=False):
    from provision import digest, regular, require
    require(isinstance(expected_sha256, str) and re.fullmatch(r"[a-f0-9]{64}", expected_sha256), "parent-pinned trusted launch-context hash required")
    path = Path(path)
    raw = regular(str(path), 65_536)
    require(digest(raw) == expected_sha256, "trusted parent launch context changed")
    context = json.loads(raw)
    require(set(context) == {"version", "runID", "launchNonce", "reviewedAuthority", "toolLaunchRecord", "sourceManifest"} and
            type(context["version"]) is int and context["version"] == 1 and context["runID"] == str(uuid.UUID(run_id)).upper(), "exact trusted mobile-build launch provenance required")
    nonce = str(uuid.UUID(context["launchNonce"])).upper()
    def reference(value, limit):
        require(isinstance(value, dict) and set(value) == {"file", "sha256"} and re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}", value["file"]) and
                re.fullmatch(r"[a-f0-9]{64}", value["sha256"]), "bounded captured provenance artifact required")
        content = regular(str(path.parent / value["file"]), limit)
        require(digest(content) == value["sha256"], "captured provenance artifact changed")
        return content
    authority_raw = reference(context["reviewedAuthority"], 1_048_576)
    authority = json.loads(authority_raw)
    source = authority.get("source", {})
    snapshot = source.get("snapshot", "")
    require(authority.get("kind") == "reviewed-provider-guarantee-and-trusted-tool-route" and
            source.get("url") == REVYL_URL and source.get("readableContentSHA256") == REVIEWED_READABLE_SHA256 and
            digest((snapshot.rstrip("\n") + "\n").encode()) == REVIEWED_READABLE_SHA256 and
            "Every remote build runs in a clean, single-use VM" in snapshot and "Concurrent builds work in private VMs" in snapshot,
            "actual reviewed authoritative provider guarantee snapshot required")
    route = authority.get("toolRoute", {})
    require(route.get("documentation") == CAPY_URL and route.get("sourceKind") == "workspace" and
            "mobile.build" in route.get("authority", "") and "Revyl remote build commands" in route.get("execution", ""),
            "actual reviewed mobile.build-to-Revyl workspace route required")
    manifest_raw = reference(context["sourceManifest"], 1_048_576)
    manifest = json.loads(manifest_raw)
    require(set(manifest) == {"version", "launchNonce", "files"} and type(manifest["version"]) is int and manifest["version"] == 1 and manifest["launchNonce"] == nonce and
            isinstance(manifest["files"], dict) and REQUIRED.issubset(manifest["files"]) and len(manifest["files"]) <= 10_000,
            "unique archived launch nonce and reviewed source manifest required")
    root = Path(__file__).resolve().parents[2]
    for name, fingerprint in manifest["files"].items():
        relative = Path(name)
        require(not relative.is_absolute() and ".." not in relative.parts and re.fullmatch(r"[a-f0-9]{64}", fingerprint), "invalid archived source binding")
        require(digest(regular(str(root / relative), 64 * 1024 * 1024)) == fingerprint, "actual archived harness source differs from parent-observed launch")
    record_raw = reference(context["toolLaunchRecord"], 1_048_576)
    record = json.loads(record_raw)
    require(set(record) == {"version", "observer", "tool", "provider", "runID", "launchNonce", "sourceManifestSHA256", "capturedAt", "bootSessionUUID", "invocation", "result"} and
            type(record["version"]) is int and record["version"] == 1 and record["observer"] == "trusted-parent-launcher" and record["tool"] == "mobile.build" and
            record["provider"] == "revyl-remote-builds" and record["runID"] == context["runID"] and
            record["launchNonce"] == nonce and record["sourceManifestSHA256"] == digest(manifest_raw),
            "actual parent-observed mobile.build launch chain required; generic/local/paired entry refused")
    now = int(time.time() * 1000)
    invocation = record["invocation"]
    require(type(record["capturedAt"]) is int and now - 7_200_000 <= record["capturedAt"] <= now + 5_000 and
            isinstance(invocation, dict) and invocation.get("action") == "start" and invocation.get("platform") == "ios" and
            invocation.get("source", {}).get("type") == "workspace" and isinstance(invocation.get("source", {}).get("commands"), list),
            "bounded actual workspace mobile.build invocation required; uploads/generic/local routes do not authorize mutation")
    commands = json.dumps(invocation["source"]["commands"])
    require(nonce in commands and digest(manifest_raw) in commands and re.fullmatch(r"[A-Z0-9]{26}", record.get("result", {}).get("build_id", "")),
            "actual captured build ID and archived command nonce/source binding required")
    boot = subprocess.run(["/usr/sbin/sysctl", "-n", "kern.bootsessionuuid"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=5, check=False)
    require(boot.returncode == 0 and str(uuid.UUID(boot.stdout.decode().strip())).upper() == str(uuid.UUID(record["bootSessionUUID"])).upper(),
            "actual guest boot identity does not match the trusted per-job launch witness")
    if consume:
        marker = path.parent / ("consumed-" + nonce + ".json")
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as file:
            json.dump({"runID": context["runID"], "launchNonce": nonce, "consumedAt": now}, file)
        os.chmod(marker, 0o644)
    return {"authority": "parent-observed mobile.build route plus captured authoritative Revyl/Capy documentation",
            "runID": context["runID"], "launchNonce": nonce, "contextSHA256": digest(raw), "sourceManifestSHA256": digest(manifest_raw),
            "toolLaunchRecordSHA256": digest(record_raw), "reviewedAuthoritySHA256": digest(authority_raw),
            "providerReadableSHA256": REVIEWED_READABLE_SHA256, "buildID": record["result"]["build_id"],
            "guestBootSessionUUID": str(uuid.UUID(record["bootSessionUUID"])).upper(), "checkedAt": now,
            "trustBoundary": "context/hash and captured invocation supplied by the trusted parent launcher, never untrusted adapter/app input"}
