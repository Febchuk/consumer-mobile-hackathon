import json
import os
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import drive
import provision as p
import global_pf as firewall
import lease
import netprobe
import job
import launch_provenance


RUN = "11111111-2222-4333-8444-555555555555"
SIMULATOR = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"


def unit_request():
    return {"runID": RUN, "nativeSourceRevision": "a" * 40, "backendSourceRevision": "b" * 40,
            "fixtureSetID": "UNIT-FABRICATED-NO-SIMULATOR", "configVersion": "unit-v1",
            "runtimeID": "com.apple.CoreSimulator.SimRuntime.iOS-27-0", "deviceTypeID": "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
            "apiPort": 8199, "cardPort": 3211, "lifetimeSeconds": 600, "appPath": "/UNIT-NOT-REAL/CalledItMessages.app",
            "nativeBuildRecord": "/UNIT-NOT-REAL/native.json", "backendBuildRecord": "/UNIT-NOT-REAL/backend.json",
            "controlPIDs": [91], "sourceCardOrigin": "https://cards.qa-runtime.invalid"}


class ProvisionerUnitTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="UNIT-NO-SIMULATOR-")
        self.folder = Path(self.temporary.name).resolve()

    def tearDown(self):
        self.temporary.cleanup()

    def request_file(self, value):
        path = self.folder / "unit-request.json"
        path.write_text(json.dumps(value))
        return str(path)

    def test_SIM_GUARD_01_exact_request_and_no_secret_or_manifest_boolean_override(self):
        self.assertEqual(p.load_request(self.request_file(unit_request()))["runID"], RUN)
        for extra in ("token", "phone", "otp", "erasedSimulator", "outboundNetworkDenied"):
            with self.subTest(extra=extra), self.assertRaises(p.Blocked):
                p.load_request(self.request_file({**unit_request(), extra: True}))

    def test_SIM_GUARD_02_rejects_bad_ports_pins_lifetime_and_controller_identity(self):
        for change in ({"apiPort": 0}, {"cardPort": True}, {"lifetimeSeconds": 3601}, {"nativeSourceRevision": "main"},
                       {"controlPIDs": []}, {"controlPIDs": [True]}, {"controlPIDs": [1]},
                       {"sourceCardOrigin": "https://cards.qa-source.invalid"}, {"sourceCardOrigin": "https://cards.qa-runtime.invalid/"}):
            with self.subTest(change=change), self.assertRaises(p.Blocked):
                p.load_request(self.request_file({**unit_request(), **change}))

    def test_SIM_GUARD_03_regular_artifacts_reject_symlinks_empty_and_traversal(self):
        target = self.folder / "record.json"
        target.write_text("unit")
        linked = self.folder / "link.json"
        linked.symlink_to(target)
        for path in (str(linked), str(self.folder / ".." / self.folder.name / "record.json")):
            with self.assertRaises(p.Blocked):
                p.regular(path)
        target.write_bytes(b"")
        with self.assertRaises(p.Blocked):
            p.regular(str(target))

    def test_SIM_GUARD_04_fresh_records_are_exclusive_and_hash_exact_bytes(self):
        path = self.folder / "exclusive.json"
        expected = p.write_new(path, {"unitOnly": "NO ACTUAL SIMULATOR EVIDENCE"})
        self.assertEqual(expected, p.digest(path.read_bytes()))
        with self.assertRaises(FileExistsError):
            p.write_new(path, {"overwrite": True})
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def unit_flows(self):
        return firewall.controller_flows("p91\nccontroller\nu501\nf12u\nPTCP\nn10.0.0.2:50001->203.0.113.7:443\nTST=ESTABLISHED\n", [91])

    def test_SIM_EGRESS_01_global_anchor_preserves_only_actual_existing_control_tuple(self):
        anchor, rules = firewall.plan_rules(RUN, self.unit_flows())
        self.assertEqual(anchor, "com.apple/zzzz_calledit_" + RUN.replace("-", "").lower())
        self.assertIn("from 10.0.0.2 port 50001 to 203.0.113.7 port 443 flags any no state", rules)
        self.assertTrue(rules.endswith('block drop quick all label "zzzz_calledit_' + RUN.replace('-', '').lower() + '_deny"\n'))
        self.assertIn("pass in quick inet proto tcp from 203.0.113.7 port 443 to 10.0.0.2 port 50001 flags any no state", rules)
        self.assertNotIn("user ", rules)
        self.assertIn("proto udp to 198.51.100.77 port 65432", rules)
        self.assertNotIn("keep state", rules)
        with self.assertRaises(firewall.IsolationUnproven):
            firewall.plan_rules(RUN, [])

    def test_SIM_EGRESS_02_unsupported_root_rules_never_get_replaced(self):
        firewall.root_anchor_supported('anchor "com.apple/*" all\n')
        for rules in ('pass out quick all\nanchor "com.apple/*" all\n', 'block all\n', ''):
            with self.assertRaises(firewall.IsolationUnproven):
                firewall.root_anchor_supported(rules)

    def test_SIM_EGRESS_03_kernel_counter_delta_not_timeout_is_denial_proof(self):
        name = "zzzz_calledit_" + RUN.replace("-", "").lower() + "_deny"
        def counters(count):
            return f'block drop out quick on ! lo0 all label "{name}"\n  [ Evaluations: 9 Packets: {count} Bytes: 500 States: 0 ]\n'
        self.assertEqual(firewall.denial_delta(counters(2), counters(3), RUN), 1)
        for after in (counters(2), counters(1), "NXDOMAIN", "no route", "request timed out"):
            with self.assertRaises(firewall.IsolationUnproven):
                firewall.denial_delta(counters(2), after, RUN)

    def test_SIM_EGRESS_04_existing_resolver_or_unknown_states_block_without_flushing(self):
        flows = self.unit_flows()
        firewall.require_no_unowned_states("", flows)
        firewall.require_no_unowned_states("all tcp 10.0.0.2:50001 -> 203.0.113.7:443 ESTABLISHED:ESTABLISHED\n", flows)
        for states in ("all udp 10.0.0.2:53001 -> 192.0.2.53:53 MULTIPLE:MULTIPLE", "all tcp 10.0.0.2:51000 -> 198.51.100.4:443 ESTABLISHED:ESTABLISHED"):
            with self.assertRaises(firewall.IsolationUnproven):
                firewall.require_no_unowned_states(states, flows)

    def test_SIM_EGRESS_05_controller_must_be_observed_established_and_not_a_listener(self):
        for raw in ("", "p91\nu501\nf1u\nPTCP\nn*:443\nTST=LISTEN\n", "p92\nu501\nf1u\nPTCP\nn10.0.0.2:50001->203.0.113.7:443\nTST=ESTABLISHED\n"):
            with self.assertRaises(firewall.IsolationUnproven):
                firewall.controller_flows(raw, [91])

    def test_SIM_EGRESS_06_ipv6_control_tuple_is_numeric_and_exact(self):
        flows = firewall.controller_flows("p91\nu501\nf1u\nPTCP\nTST=ESTABLISHED\nn[2001:db8::1]:50001->[2001:db8::2]:443\n", [91])
        _, rules = firewall.plan_rules(RUN, flows)
        self.assertIn("inet6 proto tcp from 2001:db8::1 port 50001 to 2001:db8::2 port 443", rules)
        for value in ("example.com:443", "[::]:443", "10.0.0.2:0", "10.0.0.2:65536"):
            with self.assertRaises((firewall.IsolationUnproven, ValueError)):
                firewall.endpoint(value)

    def test_SIM_GUARD_05_missing_admin_privilege_blocks_without_rule_write(self):
        calls = []
        def execute(argv, **_kwargs):
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 1, b"", b"UNIT missing sudo privilege")
        instance = p.Provisioner(unit_request(), self.folder / "output", execute=execute)
        with patch.object(p.platform, "system", return_value="Darwin"), self.assertRaises(p.Blocked):
            instance.preflight()
        self.assertFalse(any("pfctl" in argument for call in calls for argument in call))

    def test_SIM_GUARD_06_linux_cannot_publish_manifest_or_receipt(self):
        instance = p.Provisioner(unit_request(), self.folder / "blocked")
        with patch.object(p.platform, "system", return_value="Linux"), self.assertRaises(p.Blocked):
            instance.inspect()
        self.assertTrue((instance.output / "blocked.json").exists())
        self.assertFalse((instance.output / "receipt.json").exists())
        self.assertFalse((instance.output / "manifest.json").exists())

    def test_SIM_CLEANUP_01_only_owned_uuid_is_removed(self):
        instance = p.Provisioner(unit_request(), self.folder / "cleanup")
        instance.udid = SIMULATOR
        calls = []
        instance.simctl = lambda *argv, **_kwargs: calls.append(argv)
        instance.cleanup()
        self.assertEqual(calls, [("shutdown", SIMULATOR), ("delete", SIMULATOR)])
        self.assertNotIn("all", str(calls))

    def test_SIM_GUARD_07_children_inherit_only_explicit_nonsecret_environment(self):
        with patch.dict(os.environ, {"CONVEX_DEPLOY_KEY": "UNIT-NOT-A-SECRET", "TWILIO_AUTH_TOKEN": "UNIT-NOT-A-SECRET"}):
            environment = p.clean_environment(self.folder, self.folder)
        self.assertEqual(set(environment), {"PATH", "HOME", "TMPDIR", "LANG"})

    def test_SIM_UI_01_generated_xctestrun_selects_only_driver_without_editing_original(self):
        original = {"TestConfigurations": [{"TestTargets": [{"BlueprintName": "CalledItUITests", "IsUITestBundle": True,
                    "TestBundlePath": "__TESTROOT__/UITests.xctest", "EnvironmentVariables": {"OLD": "value"}}]}]}
        raw = plistlib.dumps(original)
        rewritten = plistlib.loads(drive.prepare_test_run(raw, self.folder, RUN, SIMULATOR, b"UNIT NOT NATIVE PROOF", "+12025550101"))
        target = rewritten["TestConfigurations"][0]["TestTargets"][0]
        self.assertEqual(target["OnlyTestIdentifiers"], [drive.METHOD.split("/", 1)[1]])
        self.assertEqual(target["EnvironmentVariables"]["CALLED_IT_PROVISIONER_SIMULATOR_UDID"], SIMULATOR)
        self.assertEqual(target["TestBundlePath"], str(self.folder / "UITests.xctest"))
        self.assertEqual(raw, plistlib.dumps(original))

    def test_SIM_UI_02_missing_actual_ui_target_and_inherited_credentials_block(self):
        for target in ({"BlueprintName": "FakeMessages", "IsUITestBundle": True},
                       {"BlueprintName": "CalledItUITests", "IsUITestBundle": True, "EnvironmentVariables": {"ADMIN_TOKEN": "UNIT"}}):
            with self.assertRaises(p.Blocked):
                drive.prepare_test_run(plistlib.dumps({"target": target}), self.folder, RUN, SIMULATOR, b"UNIT NOT NATIVE PROOF", "+12025550101")

    def test_SIM_EGRESS_07_dns_filter_matches_only_complete_owned_nonce_and_case_folds(self):
        expression = netprobe.dns_filter("a" * 32)
        self.assertIn("udp dst port 53", expression)
        self.assertIn("udp[20] = 32", expression)
        self.assertEqual(expression.count("0xdfdfdfdf"), 8)
        with self.assertRaises(p.Blocked):
            netprobe.dns_filter("anything or ip")

    def test_SIM_EGRESS_08_no_route_or_eperm_without_matching_kernel_counter_is_unproven(self):
        probe = netprobe.NetworkProbe(self.folder, RUN)
        class FakeSocket:
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def settimeout(self, _value): pass
            def connect(self, _target): raise OSError(self.error, "UNIT OS error alone is not denial proof")
        label = "zzzz_calledit_" + RUN.replace("-", "").lower() + "_probe_tcp4"
        counters = f'block drop out label "{label}"\n [ Evaluations: 10 Packets: 0 Bytes: 0 ]\n'
        for code in (1, 13, 101, 110):
            fake = FakeSocket()
            fake.error = code
            with self.subTest(errno=code), patch.object(netprobe.socket, "socket", return_value=fake), patch.object(probe, "counters", return_value=counters), self.assertRaisesRegex(p.Blocked, "no attributable kernel"):
                probe.raw_denials()

    def test_SIM_EGRESS_09_nested_filter_or_translation_quick_paths_are_not_trusted(self):
        empty = 'anchor "com.apple/*" all {\n anchor "250.ApplicationFirewall" all {\n }\n}\n'
        firewall.reject_unreviewed_tree(empty)
        for rule in ('pass out quick all', 'block in all', 'anchor "foreign" quick', 'rdr on en0 to any -> 127.0.0.1'):
            with self.subTest(rule=rule), self.assertRaises(firewall.IsolationUnproven):
                firewall.reject_unreviewed_tree(empty.replace(' }', ' ' + rule + '\n }'))

    def unit_lease(self):
        instance = object.__new__(lease.Lease)
        instance.folder_verified = True
        instance.uid = os.getuid()
        instance.groups = {}
        instance.device = None
        instance.enable_attempted = True
        instance.token = "12345"
        instance.anchor = "com.apple/zzzz_calledit_" + RUN.replace("-", "").lower()
        instance.owns_anchor = True
        instance.owns_pflog = False
        instance.reason = "UNIT FABRICATED, NO ACTUAL PF OR SIMULATOR"
        instance.run_id = RUN
        instance.audit = []
        instance.home = self.folder
        instance.folder = self.folder
        instance.owner_pid = 99
        instance.parent_identity = {"uid": os.getuid(), "birth": "UNIT original"}
        instance.seconds = 30
        instance.root = 'anchor "com.apple/*" all\n'
        instance.initial_pflog_exists = False
        instance.initial_anchor_inventory = ""
        instance.baseline_processes = {}
        instance.descendants = {}
        instance.escaped = {}
        instance.snapshot = Mock(return_value={})
        instance.command = Mock(return_value="")
        def pf(*argv):
            if argv == ("-s", "info"):
                return "Status: Disabled\n"
            if argv in (("-sr",), ("-a", "*", "-sr")):
                return instance.root
            return ""
        instance.pf = Mock(side_effect=pf)
        instance.record = Mock()
        return instance

    def test_SIM_LEASE_01_cleanup_releases_only_owned_anchor_and_enable_token(self):
        instance = self.unit_lease()
        with patch.object(lease.time, "sleep"):
            instance.cleanup()
        mutations = [call.args for call in instance.pf.call_args_list if "-F" in call.args or "-X" in call.args]
        self.assertEqual(mutations, [("-a", instance.anchor, "-F", "rules"), ("-X", "12345")])
        recorded = instance.record.call_args.args[1]
        self.assertFalse(recorded["isolationRetained"])
        self.assertNotIn("states", str(instance.pf.call_args_list))
        self.assertNotIn("-d", str(instance.pf.call_args_list))
        self.assertIn("Status: Disabled", recorded["restoration"]["actualPFInfoAfterRelease"])
        self.assertFalse(recorded["restoration"]["pflogPresentAfterCleanup"])

    def test_SIM_LEASE_02_unproven_device_stop_retains_firewall_instead_of_false_restore(self):
        instance = self.unit_lease()
        instance.device = SIMULATOR
        instance.command = Mock(side_effect=RuntimeError("UNIT shutdown failure"))
        with patch.object(lease.time, "sleep"), self.assertRaisesRegex(p.Blocked, "retained isolation"):
            instance.cleanup()
        self.assertFalse(any("-F" in call.args or "-X" in call.args for call in instance.pf.call_args_list))
        self.assertTrue(instance.record.call_args.args[1]["failures"])

    def test_SIM_LEASE_03_orphaned_owned_group_is_stopped_even_after_leader_exits(self):
        instance = self.unit_lease()
        instance.groups = {535: {"uid": os.getuid(), "pgid": 535, "birth": "UNIT old"}}
        alive = [True]
        instance.snapshot = Mock(side_effect=lambda: {536: {"uid": os.getuid(), "ppid": 1, "pgid": 535, "birth": "UNIT child", "state": "S", "command": "UNIT worker"}} if alive[0] else {})
        def stop(_pid, _signal):
            alive[0] = False
        with patch.object(lease.time, "sleep"), patch.object(lease.os, "getsid", return_value=535), patch.object(lease.os, "killpg", side_effect=stop) as kill:
            instance.cleanup()
        kill.assert_called_once_with(535, lease.signal.SIGTERM)

    def test_SIM_LEASE_04_parent_identity_change_always_enters_independent_cleanup(self):
        instance = self.unit_lease()
        instance.prepare = Mock()
        instance.cleanup = Mock()
        with patch.object(lease.time, "monotonic", side_effect=[0, 1]), patch.object(lease, "identity", return_value={"uid": os.getuid(), "birth": "UNIT reused"}), self.assertRaisesRegex(p.Blocked, "reused PID"):
            instance.run()
        instance.cleanup.assert_called_once()

    def test_SIM_LEASE_05_bounded_expiry_always_enters_independent_cleanup(self):
        instance = self.unit_lease()
        instance.prepare = Mock()
        instance.cleanup = Mock()
        with patch.object(lease.time, "monotonic", side_effect=[0, 31]), self.assertRaisesRegex(RuntimeError, "bounded lease expired"):
            instance.run()
        instance.cleanup.assert_called_once()

    def test_SIM_LEASE_06_failed_identity_observation_never_grants_kill_permission(self):
        instance = self.unit_lease()
        instance.groups = {535: {"uid": os.getuid(), "pgid": 535, "birth": "UNIT old"}}
        instance.snapshot = Mock(side_effect=RuntimeError("UNIT observation unavailable, not ESRCH"))
        with patch.object(lease.time, "sleep"), patch.object(lease.os, "killpg") as kill, self.assertRaises(p.Blocked):
            instance.cleanup()
        kill.assert_not_called()
        self.assertFalse(any("-F" in call.args or "-X" in call.args for call in instance.pf.call_args_list))

    def test_SIM_LEASE_07_escaped_descendant_survivor_prevents_firewall_release(self):
        instance = self.unit_lease()
        instance.groups = {535: {"uid": os.getuid(), "pgid": 535, "birth": "UNIT old"}}
        alive = [True]
        parent = {"uid": os.getuid(), "ppid": 99, "pgid": 535, "birth": "UNIT old", "state": "S", "command": "UNIT supervised"}
        child = {"uid": os.getuid(), "ppid": 535, "pgid": 536, "birth": "UNIT escaped", "state": "S", "command": "UNIT detached"}
        instance.snapshot = Mock(side_effect=lambda: {**({535: parent} if alive[0] else {}), 536: child})
        def stop(_pid, _signal): alive[0] = False
        with patch.object(lease.time, "sleep"), patch.object(lease.os, "getsid", side_effect=lambda pid: pid), patch.object(lease.os, "killpg", side_effect=stop) as kill, self.assertRaises(p.Blocked):
            instance.cleanup()
        self.assertTrue(all(call.args[0] == 535 for call in kill.call_args_list))
        self.assertFalse(any("-F" in call.args or "-X" in call.args for call in instance.pf.call_args_list))
        self.assertIn(536, instance.record.call_args.args[1]["restoration"]["survivingOwnedOrEscapedProcesses"])

    def test_SIM_LEASE_08_successful_release_command_without_restored_kernel_baseline_fails(self):
        instance = self.unit_lease()
        previous = instance.pf.side_effect
        instance.pf.side_effect = lambda *argv: "Status: Enabled\n" if argv == ("-s", "info") else previous(*argv)
        with patch.object(lease.time, "sleep"), self.assertRaises(p.Blocked):
            instance.cleanup()
        record = instance.record.call_args.args[1]
        self.assertIn("Status: Enabled", record["restoration"]["actualPFInfoAfterRelease"])
        self.assertTrue(record["failures"])
        self.assertNotIn("-d", str(instance.pf.call_args_list))

    def test_SIM_AUTH_01_generic_entry_cannot_start_an_isolation_lease(self):
        instance = p.Provisioner(unit_request(), self.folder / "untrusted-generic")
        instance.start_lease = Mock()
        instance.preflight = Mock()
        with self.assertRaisesRegex(p.Blocked, "trusted parent"):
            instance.run(enforcement_probe=True)
        instance.start_lease.assert_not_called()
        instance.preflight.assert_not_called()

    def test_SIM_AUTH_02_root_preparation_checks_launch_authority_before_any_pf_query_or_mutation(self):
        instance = self.unit_lease()
        instance.launch_context = str(self.folder / "UNIT-unbound.json")
        instance.launch_sha256 = "0" * 64
        with patch.object(lease, "verify_trusted_launch", side_effect=p.Blocked("UNIT unbound launch")), self.assertRaises(p.Blocked):
            instance.prepare()
        instance.pf.assert_not_called()
        instance.command.assert_not_called()

    def test_SIM_AUTH_03_supplied_exclusivity_booleans_are_not_authority(self):
        path = self.folder / "UNIT-fabricated-claim.json"
        path.write_text(json.dumps({"dedicated": True, "ephemeral": True, "exclusive": True}))
        with patch.object(launch_provenance.subprocess, "run") as query, self.assertRaises(p.Blocked):
            launch_provenance.verify_trusted_launch(str(path), p.digest(path.read_bytes()), RUN)
        query.assert_not_called()

    def test_SIM_GATE_01_unapproved_workload_never_executes(self):
        (self.folder / "jobs").mkdir()
        command = self.folder / "unit-argv.json"
        command.write_text(json.dumps([str(Path(sys.executable).resolve()), "-c", "raise SystemExit(0)"]))
        with patch.object(sys, "argv", ["job.py", str(self.folder), str(command)]), patch.object(job.os, "getpid", return_value=535), patch.object(job.os, "getppid", return_value=99), patch.object(job.os, "getpgid", return_value=535), patch.object(job.time, "monotonic", side_effect=[0, 11]), patch.object(job.os, "execve") as execute, self.assertRaisesRegex(RuntimeError, "did not approve"):
            job.main()
        execute.assert_not_called()
        self.assertTrue((self.folder / "jobs/535.json").exists())

    def test_SIM_RECEIPT_01_exact_manifest_and_existing_receipt_hashes_unit_fabricated_only(self):
        instance = p.Provisioner(unit_request(), self.folder)
        instance.udid = SIMULATOR
        instance.lease_ready = {"recordedAt": int(p.time.time() * 1000), "leaseExpiresAt": int(p.time.time() * 1000) + 600_000, "unitOnly": "FABRICATED"}
        instance.network_proof = {"runID": RUN, "verifiedAt": 1, "unitOnly": "FABRICATED"}
        instance.lease_child = Mock()
        instance.lease_child.poll.return_value = None
        instance.boot_started = 2
        instance.builds = {"unitOnly": "FABRICATED"}
        instance.created = instance.erased = instance.empty = {"unitOnly": "FABRICATED, NOT SIMULATOR EVIDENCE"}
        p.write_new(self.folder / "lease-ready.json", instance.lease_ready)
        p.write_new(self.folder / "network-verified.json", instance.network_proof)
        instance.publish()
        receipt = json.loads((self.folder / "receipt.json").read_bytes())
        manifest_bytes = (self.folder / "manifest.json").read_bytes()
        self.assertEqual(set(receipt), {"version", "runID", "simulatorUDID", "nativeSourceRevision", "backendSourceRevision", "fixtureSetID", "hostBundleID", "extensionBundleID", "manifestSHA256", "recordedAt", "artifacts"})
        self.assertEqual(receipt["manifestSHA256"], p.digest(manifest_bytes))
        self.assertEqual({entry["kind"] for entry in receipt["artifacts"]}, {"simulator-created", "simulator-erased", "empty-state-verified", "outbound-denied"})
        for artifact in receipt["artifacts"]:
            data = (self.folder / artifact["file"]).read_bytes()
            self.assertEqual(artifact["sha256"], p.digest(data))
            self.assertIn(b"FABRICATED", data)
        manifest = json.loads(manifest_bytes)
        self.assertEqual(set(manifest), {"version", "runID", "simulatorUDID", "nativeSourceRevision", "backendSourceRevision", "deploymentID", "configVersion", "fixtureSetID", "apiOrigin", "cardOrigin", "issuedAt", "expiresAt", "erasedSimulator", "syntheticDataOnly", "outboundNetworkDenied"})
        self.assertEqual(manifest["apiOrigin"], "http://127.0.0.1:8199")
        self.assertEqual(manifest["cardOrigin"], "http://127.0.0.1:3211")
        self.assertNotIn("sourceCardOrigin", manifest)

    def test_SIM_RECEIPT_02_cleanup_failure_never_writes_completed_record(self):
        instance = p.Provisioner(unit_request(), self.folder)
        instance.lease_child = Mock()
        instance.lease_child.poll.return_value = 1
        instance.pending_completion = {"unitOnly": "must not become completed"}
        p.write_new(self.folder / "lease-cleanup.json", {"failures": ["UNIT retained isolation"]})
        with self.assertRaises(p.Blocked):
            instance.cleanup()
        self.assertFalse((self.folder / "completed.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
