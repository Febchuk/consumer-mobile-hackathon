import ast
import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch


SOURCE = pathlib.Path(__file__).with_name("inspect-namespace.py")
SPEC = importlib.util.spec_from_file_location("namespace_inspection_design_only", SOURCE)
ENTRY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENTRY)


class ReadonlyNamespaceDesignTests(unittest.TestCase):
    def test_NAMESPACE_00_root_entry_stops_before_carrier_import_scratch_or_queries(self):
        with patch.object(sys, "argv", ["inspect", "--nonce", "A2222222-2222-4222-8222-222222222222"]), \
                patch.object(ENTRY.os, "geteuid", return_value=0), \
                patch.object(ENTRY.importlib.util, "spec_from_file_location", side_effect=AssertionError("no carrier import as root")), \
                patch.object(ENTRY.subprocess, "run", side_effect=AssertionError("no process as root")), \
                patch.object(ENTRY.tempfile, "mkdtemp", side_effect=AssertionError("no scratch as root")), \
                self.assertRaisesRegex(RuntimeError, "nonroot build user"):
            ENTRY.main()

    def test_NAMESPACE_01_invalid_nonce_stops_before_any_process_or_write(self):
        with patch.object(sys, "argv", ["inspect", "--nonce", "not-a-launch-nonce"]), \
                patch.object(ENTRY.subprocess, "run", side_effect=AssertionError("no process in invalid input design test")), \
                patch.object(ENTRY.tempfile, "mkdtemp", side_effect=AssertionError("no write in invalid input design test")), \
                self.assertRaises(ValueError):
            ENTRY.main()

    def test_NAMESPACE_02_privileged_literal_has_no_mutating_file_operations(self):
        tree = ast.parse(ENTRY.ROOT_READONLY)
        compile(tree, "namespace-readonly-literal", "exec")
        forbidden = {"mkdir", "chmod", "chown", "unlink", "rename", "replace", "write_text", "write_bytes", "symlink", "rmdir", "truncate", "execv", "execve"}
        self.assertFalse(any(isinstance(node, ast.Attribute) and node.attr in forbidden for node in ast.walk(tree)))
        self.assertNotIn("pfctl", ENTRY.ROOT_READONLY)
        self.assertNotIn("simctl", ENTRY.ROOT_READONLY)

    def test_NAMESPACE_03_privileged_subprocess_is_only_fixed_acl_metadata_query(self):
        calls = [node for node in ast.walk(ast.parse(ENTRY.ROOT_READONLY)) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "run"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(ast.literal_eval(ast.List(elts=calls[0].args[0].elts[:2], ctx=ast.Load())), ["/bin/ls", "-lde"])
        self.assertIsInstance(calls[0].args[0].elts[2], ast.Name)

    def test_NAMESPACE_04_opened_handles_are_readonly_nofollow_directory_descriptors(self):
        calls = [node for node in ast.walk(ast.parse(ENTRY.ROOT_READONLY)) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "open"]
        self.assertEqual(len(calls), 1)
        flags = {node.attr for node in ast.walk(calls[0].args[1]) if isinstance(node, ast.Attribute)}
        self.assertEqual(flags, {"O_RDONLY", "O_DIRECTORY", "O_NOFOLLOW", "O_NONBLOCK"})


if __name__ == "__main__":
    unittest.main()
