import hashlib
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch


SOURCE = pathlib.Path(__file__).with_name("enforcement-entry.py")
SPEC = importlib.util.spec_from_file_location("enforcement_entry_design_only", SOURCE)
ENTRY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENTRY)


class FakeArchiveEntryDesignTests(unittest.TestCase):
    def exercise(self, manifest, nonce="FAKE_NONCE", supplied_sha=None, sealed=b"original"):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary).resolve()
            (root / "launch-proof").mkdir()
            raw = json.dumps(manifest).encode()
            (root / "launch-proof/source-manifest.json").write_bytes(raw)
            (root / "probe-config.json").write_text(json.dumps({"runID": "FAKE_RUN", "launchNonce": "FAKE_NONCE"}))
            (root / "sealed.txt").write_bytes(sealed)
            with patch.object(ENTRY, "__file__", str(root / "tests/mac-enforcement/enforcement-entry.py")), \
                    patch.object(sys, "argv", ["entry", "--launch-nonce", nonce, "--source-manifest-sha256", supplied_sha or hashlib.sha256(raw).hexdigest()]), \
                    patch.object(ENTRY.subprocess, "run", side_effect=AssertionError("design test must never execute a command")):
                ENTRY.main()

    def test_OPERATOR_SEAL_01_raw_hash_mismatch_stops_before_any_command(self):
        with self.assertRaisesRegex(RuntimeError, "source seal differs"):
            self.exercise({}, supplied_sha="0" * 64)

    def test_OPERATOR_SEAL_02_wrong_nonce_stops_before_any_command(self):
        with self.assertRaisesRegex(RuntimeError, "not this unique launch"):
            self.exercise({"launchNonce": "FAKE_NONCE", "runID": "FAKE_RUN"}, nonce="OTHER_FAKE_NONCE")

    def test_OPERATOR_SEAL_03_changed_archived_bytes_stop_before_any_command(self):
        manifest = {"launchNonce": "FAKE_NONCE", "runID": "FAKE_RUN", "files": {"sealed.txt": hashlib.sha256(b"original").hexdigest()}}
        with self.assertRaisesRegex(RuntimeError, "Archived input changed"):
            self.exercise(manifest, sealed=b"changed")


if __name__ == "__main__":
    unittest.main()
