#!/usr/bin/env python3
"""
tests/test_verify_pr_telemetry.py
Unit tests for .github/scripts/verify-pr-telemetry.py edge cases and error handling.
"""

import sys
import os
import unittest
from unittest.mock import patch, MagicMock
import subprocess

# Add repo root to sys.path so we can import verify-pr-telemetry
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".github", "scripts")))

import importlib.util
spec = importlib.util.spec_from_file_location(
    "verify_pr_telemetry",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".github", "scripts", "verify-pr-telemetry.py"))
)
vpr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vpr)


class TestVerifyPrTelemetry(unittest.TestCase):

    def test_extract_session_ids_from_text(self):
        # Single session ID
        text1 = "feat: add feature\n\nAntigravity-Session-ID: 53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b"
        self.assertEqual(
            vpr.extract_session_ids_from_text(text1),
            ["53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b"]
        )

        # Multiple unique session IDs + duplicates + case insensitivity
        text2 = (
            "commit 1\n"
            "Antigravity-Session-ID: 53AB9A5B-7CA6-4D25-9E39-21463C3BCD6B\n"
            "Antigravity-Session-ID: 11111111-2222-3333-4444-555555555555\n"
            "antigravity-session-id: 53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b\n"
        )
        self.assertEqual(
            vpr.extract_session_ids_from_text(text2),
            ["53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b", "11111111-2222-3333-4444-555555555555"]
        )

        # No session IDs
        self.assertEqual(vpr.extract_session_ids_from_text("regular commit message"), [])

    @patch.object(vpr, "get_pr_details")
    @patch.object(vpr, "get_pr_comments")
    def test_no_antigravity_commits_passes(self, mock_comments, mock_details):
        mock_details.return_value = {
            "headRefOid": "abc12345678",
            "commits": [
                {"oid": "abc12345", "messageHeadline": "human commit", "messageBody": "no session trailer"}
            ]
        }
        mock_comments.return_value = ["regular comment"]

        passed, msg, receipt, head_sha = vpr.verify_pr_telemetry(99)
        self.assertTrue(passed)
        self.assertIn("No Antigravity session commits detected", msg)
        self.assertEqual(head_sha, "abc12345678")

    @patch.object(vpr, "get_pr_details")
    @patch.object(vpr, "get_pr_comments")
    def test_missing_telemetry_receipt_fails(self, mock_comments, mock_details):
        mock_details.return_value = {
            "headRefOid": "abc12345678",
            "commits": [
                {
                    "oid": "abc12345",
                    "messageHeadline": "feat: ai change",
                    "messageBody": "Antigravity-Session-ID: 53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b"
                }
            ]
        }
        mock_comments.return_value = ["looks good to me", "test comment"]

        passed, msg, receipt, head_sha = vpr.verify_pr_telemetry(99)
        self.assertFalse(passed)
        self.assertIn("MISSING TELEMETRY REPORT", msg)
        self.assertIn("53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b", msg)
        self.assertIsNone(receipt)

    @patch.object(vpr, "get_pr_details")
    @patch.object(vpr, "get_pr_comments")
    def test_incomplete_sessions_fails(self, mock_comments, mock_details):
        mock_details.return_value = {
            "headRefOid": "abc12345678",
            "commits": [
                {
                    "oid": "11111111",
                    "messageHeadline": "commit 1",
                    "messageBody": "Antigravity-Session-ID: 53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b"
                },
                {
                    "oid": "22222222",
                    "messageHeadline": "commit 2",
                    "messageBody": "Antigravity-Session-ID: eeee4444-5555-6666-7777-888899990000"
                }
            ]
        }
        # Receipt only covers session 1
        receipt_json = (
            '<!-- ANTIGRAVITY-TELEMETRY-RECEIPT-START\n'
            '{\n'
            '  "covered_session_ids": ["53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b"],\n'
            '  "total_billed_tokens": 10000,\n'
            '  "cache_hit_pct": 90.0\n'
            '}\n'
            'ANTIGRAVITY-TELEMETRY-RECEIPT-END -->'
        )
        mock_comments.return_value = [receipt_json]

        passed, msg, receipt, head_sha = vpr.verify_pr_telemetry(99)
        self.assertFalse(passed)
        self.assertIn("INCOMPLETE SESSION PROVENANCE", msg)
        self.assertIn("eeee4444-5555-6666-7777-888899990000", msg)

    @patch.object(vpr, "get_pr_details")
    @patch.object(vpr, "get_pr_comments")
    def test_all_sessions_covered_passes(self, mock_comments, mock_details):
        mock_details.return_value = {
            "headRefOid": "abc12345678",
            "commits": [
                {
                    "oid": "11111111",
                    "messageHeadline": "commit 1",
                    "messageBody": "Antigravity-Session-ID: 53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b"
                }
            ]
        }
        receipt_json = (
            '<!-- ANTIGRAVITY-TELEMETRY-RECEIPT-START\n'
            '{\n'
            '  "covered_session_ids": ["53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b"],\n'
            '  "total_billed_tokens": 18605309,\n'
            '  "cache_hit_pct": 83.3\n'
            '}\n'
            'ANTIGRAVITY-TELEMETRY-RECEIPT-END -->'
        )
        mock_comments.return_value = [receipt_json]

        passed, msg, receipt, head_sha = vpr.verify_pr_telemetry(99)
        self.assertTrue(passed)
        self.assertIn("ANTIGRAVITY MERGE GUARD PASSED", msg)
        self.assertIn("18,605,309", msg)
        self.assertEqual(receipt.get("total_billed_tokens"), 18605309)

    @patch.object(vpr, "get_pr_details")
    @patch.object(vpr, "get_pr_comments")
    def test_null_covered_session_ids_handled_safely(self, mock_comments, mock_details):
        mock_details.return_value = {
            "headRefOid": "abc12345678",
            "commits": [
                {
                    "oid": "11111111",
                    "messageHeadline": "commit 1",
                    "messageBody": "Antigravity-Session-ID: 53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b"
                }
            ]
        }
        # Explicitly null covered_session_ids
        receipt_json = (
            '<!-- ANTIGRAVITY-TELEMETRY-RECEIPT-START\n'
            '{\n'
            '  "covered_session_ids": null,\n'
            '  "total_billed_tokens": 0\n'
            '}\n'
            'ANTIGRAVITY-TELEMETRY-RECEIPT-END -->'
        )
        mock_comments.return_value = [receipt_json]

        # Should not raise TypeError: 'NoneType' object is not iterable
        passed, msg, receipt, head_sha = vpr.verify_pr_telemetry(99)
        self.assertFalse(passed)
        self.assertIn("INCOMPLETE SESSION PROVENANCE", msg)

    @patch.object(vpr, "get_pr_details")
    @patch.object(vpr, "get_pr_comments")
    def test_malformed_json_receipt_skipped(self, mock_comments, mock_details):
        mock_details.return_value = {
            "headRefOid": "abc12345678",
            "commits": [
                {
                    "oid": "11111111",
                    "messageHeadline": "commit 1",
                    "messageBody": "Antigravity-Session-ID: 53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b"
                }
            ]
        }
        valid_receipt = (
            '<!-- ANTIGRAVITY-TELEMETRY-RECEIPT-START\n'
            '{\n'
            '  "covered_session_ids": ["53ab9a5b-7ca6-4d25-9e39-21463c3bcd6b"],\n'
            '  "total_billed_tokens": 5000\n'
            '}\n'
            'ANTIGRAVITY-TELEMETRY-RECEIPT-END -->'
        )
        corrupted_receipt = (
            '<!-- ANTIGRAVITY-TELEMETRY-RECEIPT-START\n'
            '{ this is not valid json : [[[\n'
            'ANTIGRAVITY-TELEMETRY-RECEIPT-END -->'
        )
        # Old valid receipt followed by later corrupted receipt
        mock_comments.return_value = [valid_receipt, corrupted_receipt]

        # Skips corrupted receipt and uses earlier valid receipt
        passed, msg, receipt, head_sha = vpr.verify_pr_telemetry(99)
        self.assertTrue(passed)
        self.assertIn("ANTIGRAVITY MERGE GUARD PASSED", msg)

    @patch("subprocess.run")
    def test_subprocess_timeout_handling(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["gh", "pr", "view"], timeout=60)
        with self.assertRaises(RuntimeError) as ctx:
            vpr.get_pr_details(99, timeout=60)
        self.assertIn("timed out after 60s", str(ctx.exception))

    @patch("subprocess.run")
    def test_post_commit_status(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ok, msg = vpr.post_commit_status(
            sha="e0f5c98d239ec0b8ad2058b9165f13092202d417",
            state="success",
            description="Verified Antigravity session telemetry",
            repo="wryenmeek/pp-docker",
            target_url="https://github.com/wryenmeek/pp-docker/actions/runs/123"
        )
        self.assertTrue(ok)
        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        self.assertIn("repos/wryenmeek/pp-docker/statuses/e0f5c98d239ec0b8ad2058b9165f13092202d417", cmd)
        self.assertIn("state=success", cmd)
        self.assertIn("context=Antigravity Telemetry Pre-Merge Guard", cmd)


if __name__ == "__main__":
    unittest.main()
