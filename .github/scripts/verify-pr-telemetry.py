#!/usr/bin/env python3
"""
verify-pr-telemetry.py
Deterministic Antigravity Telemetry Pre-Merge Guard check for GitHub Actions CI and pre-merge hooks.
"""

import sys
import os
import re
import json
import argparse
import subprocess
from typing import List, Tuple, Optional, Dict, Any

RECEIPT_START = "<!-- ANTIGRAVITY-TELEMETRY-RECEIPT-START"
RECEIPT_END = "ANTIGRAVITY-TELEMETRY-RECEIPT-END -->"

def extract_session_ids_from_text(text: str) -> List[str]:
    matches = re.findall(r"Antigravity-Session-ID:\s*([a-f0-9\-]{36})", text, re.IGNORECASE)
    seen = set()
    result = []
    for m in matches:
        m_lower = m.lower()
        if m_lower not in seen:
            seen.add(m_lower)
            result.append(m_lower)
    return result

def get_pr_commits(pr_num: int, repo: Optional[str] = None) -> List[Dict[str, Any]]:
    cmd = ["gh", "pr", "view", str(pr_num), "--json", "commits,headRefOid,headRefName"]
    if repo:
        cmd.extend(["-R", repo])
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Failed to fetch PR #{pr_num} commits: {res.stderr.strip()}")
    data = json.loads(res.stdout)
    return data.get("commits", [])

def get_pr_comments(pr_num: int, repo: Optional[str] = None) -> List[str]:
    cmd = ["gh", "pr", "view", str(pr_num), "--json", "comments"]
    if repo:
        cmd.extend(["-R", repo])
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Failed to fetch PR #{pr_num} comments: {res.stderr.strip()}")
    data = json.loads(res.stdout)
    return [c.get("body", "") for c in data.get("comments", [])]

def verify_pr_telemetry(pr_num: int, repo: Optional[str] = None) -> Tuple[bool, str]:
    try:
        commits = get_pr_commits(pr_num, repo)
    except Exception as e:
        return False, f"Could not inspect PR commits: {e}"

    committed_sessions: List[Tuple[str, str]] = []
    all_committed_cids = set()

    for c in commits:
        sha = c.get("oid", "")[:8]
        msg = c.get("messageHeadline", "") + "\n" + c.get("messageBody", "")
        cids = extract_session_ids_from_text(msg)
        for cid in cids:
            committed_sessions.append((sha, cid))
            all_committed_cids.add(cid)

    try:
        comments = get_pr_comments(pr_num, repo)
    except Exception as e:
        return False, f"Could not inspect PR comments: {e}"

    receipt_data = None
    receipt_pattern = re.compile(re.escape(RECEIPT_START) + r"\s*(\{.*?\})\s*" + re.escape(RECEIPT_END), re.DOTALL)
    
    for body in reversed(comments):
        match = receipt_pattern.search(body)
        if match:
            try:
                receipt_data = json.loads(match.group(1))
                break
            except Exception:
                continue

    if not all_committed_cids:
        if receipt_data:
            return True, f"[ANTIGRAVITY MERGE GUARD PASSED]\nPR #{pr_num} verified via Antigravity telemetry receipt (Billed: {receipt_data.get('total_billed_tokens', 0):,})."
        return True, f"No Antigravity session commits detected on PR #{pr_num}; guard passed."

    if not receipt_data:
        return False, (
            f"[ANTIGRAVITY MERGE GUARD FAILED: MISSING TELEMETRY REPORT]\n"
            f"PR #{pr_num} contains {len(all_committed_cids)} Antigravity session(s) across {len(committed_sessions)} commit(s),\n"
            f"but NO verified Antigravity Telemetry Report comment was found on the PR.\n"
            f"Committed Sessions: {sorted(list(all_committed_cids))}\n"
            f"Action Required: Run 'antigravity-telemetry post --pr {pr_num}' to publish verified telemetry before merging."
        )

    covered_cids = set(cid.lower() for cid in receipt_data.get("covered_session_ids", []))
    missing_cids = all_committed_cids - covered_cids

    if missing_cids:
        return False, (
            f"[ANTIGRAVITY MERGE GUARD FAILED: INCOMPLETE SESSION PROVENANCE]\n"
            f"PR #{pr_num} has commits with Antigravity Session IDs that are NOT included in the PR telemetry report!\n"
            f"Missing Session IDs: {sorted(list(missing_cids))}\n"
            f"Covered Session IDs in Report: {sorted(list(covered_cids))}\n"
            f"Action Required: Re-run 'antigravity-telemetry post --pr {pr_num}' to aggregate all sessions before merging."
        )

    return True, (
        f"[ANTIGRAVITY MERGE GUARD PASSED]\n"
        f"All {len(all_committed_cids)} committed session IDs verified across {len(commits)} PR commits.\n"
        f"Billed Tokens: {receipt_data.get('total_billed_tokens', 0):,} | Cache Hit: {receipt_data.get('cache_hit_pct', 0)}%"
    )

def main():
    parser = argparse.ArgumentParser(description="Antigravity Telemetry Pre-Merge Guard Verification")
    parser.add_argument("--pr", type=int, required=True, help="Pull Request number")
    parser.add_argument("--repo", type=str, default=None, help="Optional owner/repo")
    args = parser.parse_args()

    passed, msg = verify_pr_telemetry(args.pr, args.repo)
    if passed:
        print(msg)
        sys.exit(0)
    else:
        sys.stderr.write(msg + "\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
