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
DEFAULT_TIMEOUT_SEC = 60

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

def get_pr_details(pr_num: int, repo: Optional[str] = None, timeout: int = DEFAULT_TIMEOUT_SEC) -> Dict[str, Any]:
    cmd = ["gh", "pr", "view", str(pr_num), "--json", "commits,headRefOid,headRefName"]
    if repo:
        cmd.extend(["-R", repo])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as te:
        raise RuntimeError(f"GitHub CLI timed out after {timeout}s fetching PR #{pr_num} details") from te

    if res.returncode != 0:
        raise RuntimeError(f"Failed to fetch PR #{pr_num} commits: {res.stderr.strip()}")
    return json.loads(res.stdout)

def get_pr_comments(pr_num: int, repo: Optional[str] = None, timeout: int = DEFAULT_TIMEOUT_SEC) -> List[str]:
    cmd = ["gh", "pr", "view", str(pr_num), "--json", "comments"]
    if repo:
        cmd.extend(["-R", repo])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as te:
        raise RuntimeError(f"GitHub CLI timed out after {timeout}s fetching PR #{pr_num} comments") from te

    if res.returncode != 0:
        raise RuntimeError(f"Failed to fetch PR #{pr_num} comments: {res.stderr.strip()}")
    data = json.loads(res.stdout)
    return [c.get("body", "") for c in data.get("comments", [])]

def post_commit_status(
    sha: str,
    state: str,
    description: str,
    repo: Optional[str] = None,
    target_url: Optional[str] = None,
    timeout: int = 30
) -> Tuple[bool, str]:
    if not sha or len(sha) < 8:
        return False, "Invalid commit SHA for status check"

    endpoint = f"repos/{repo}/statuses/{sha}" if repo else f":owner/:repo/statuses/{sha}"
    cmd = [
        "gh", "api", "--method", "POST",
        endpoint,
        "-f", f"state={state}",
        "-f", "context=Antigravity Telemetry Pre-Merge Guard",
        "-f", f"description={description[:140]}",
    ]
    if target_url:
        cmd.extend(["-f", f"target_url={target_url}"])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if res.returncode != 0:
            return False, f"Failed to post commit status: {res.stderr.strip()}"
        return True, "Commit status posted successfully."
    except Exception as e:
        return False, f"Error posting commit status: {e}"

def verify_pr_telemetry(
    pr_num: int,
    repo: Optional[str] = None,
    timeout: int = DEFAULT_TIMEOUT_SEC
) -> Tuple[bool, str, Optional[Dict[str, Any]], Optional[str]]:
    """
    Deterministically validates that a PR satisfies the Antigravity Telemetry Pre-Merge Guard:
    1. Extracts all Antigravity-Session-ID trailers from all PR commits.
    2. Verifies that a valid Antigravity Telemetry receipt exists in the PR comments.
    3. Asserts that 100% of committed session IDs are covered in the receipt.
    Returns (passed, message, receipt_data, head_sha)
    """
    try:
        pr_data = get_pr_details(pr_num, repo, timeout=timeout)
        commits = pr_data.get("commits", [])
        head_sha = pr_data.get("headRefOid")
    except Exception as e:
        return False, f"Could not inspect PR commits: {e}", None, None

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
        comments = get_pr_comments(pr_num, repo, timeout=timeout)
    except Exception as e:
        return False, f"Could not inspect PR comments: {e}", None, head_sha

    receipt_data = None
    receipt_pattern = re.compile(re.escape(RECEIPT_START) + r"\s*(\{.*\})\s*" + re.escape(RECEIPT_END), re.DOTALL)

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
            return True, f"[ANTIGRAVITY MERGE GUARD PASSED]\nPR #{pr_num} verified via Antigravity telemetry receipt (Billed: {receipt_data.get('total_billed_tokens', 0):,}).", receipt_data, head_sha
        return True, f"No Antigravity session commits detected on PR #{pr_num}; guard passed.", None, head_sha

    if not receipt_data:
        return False, (
            f"[ANTIGRAVITY MERGE GUARD FAILED: MISSING TELEMETRY REPORT]\n"
            f"PR #{pr_num} contains {len(all_committed_cids)} Antigravity session(s) across {len(committed_sessions)} commit(s),\n"
            f"but NO verified Antigravity Telemetry Report comment was found on the PR.\n"
            f"Committed Sessions: {sorted(list(all_committed_cids))}\n"
            f"Action Required: Run 'antigravity-telemetry post --pr {pr_num}' to publish verified telemetry before merging."
        ), None, head_sha

    # Safely handle null or missing covered_session_ids
    raw_covered = receipt_data.get("covered_session_ids") or []
    covered_cids = set(cid.lower() for cid in raw_covered)
    missing_cids = all_committed_cids - covered_cids

    if missing_cids:
        return False, (
            f"[ANTIGRAVITY MERGE GUARD FAILED: INCOMPLETE SESSION PROVENANCE]\n"
            f"PR #{pr_num} has commits with Antigravity Session IDs that are NOT included in the PR telemetry report!\n"
            f"Missing Session IDs: {sorted(list(missing_cids))}\n"
            f"Covered Session IDs in Report: {sorted(list(covered_cids))}\n"
            f"Action Required: Re-run 'antigravity-telemetry post --pr {pr_num}' to aggregate all sessions before merging."
        ), receipt_data, head_sha

    return True, (
        f"[ANTIGRAVITY MERGE GUARD PASSED]\n"
        f"All {len(all_committed_cids)} committed session IDs verified across {len(commits)} PR commits.\n"
        f"Billed Tokens: {receipt_data.get('total_billed_tokens', 0):,} | Cache Hit: {receipt_data.get('cache_hit_pct', 0)}%"
    ), receipt_data, head_sha

def main():
    parser = argparse.ArgumentParser(description="Antigravity Telemetry Pre-Merge Guard Verification")
    parser.add_argument("--pr", type=int, required=True, help="Pull Request number")
    parser.add_argument("--repo", type=str, default=None, help="Optional owner/repo")
    parser.add_argument("--post-status", action="store_true", help="Post commit status check to PR head commit")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC, help="Subprocess timeout in seconds")
    args = parser.parse_args()

    passed, msg, receipt_data, head_sha = verify_pr_telemetry(args.pr, args.repo, timeout=args.timeout)

    if args.post_status and head_sha:
        state = "success" if passed else "failure"
        desc = "Verified Antigravity session telemetry" if passed else "Missing/incomplete Antigravity session telemetry"
        if receipt_data:
            desc = f"Verified: {receipt_data.get('total_billed_tokens', 0):,} billed ({receipt_data.get('cache_hit_pct', 0)}% cache)"
        
        target_url = None
        if os.getenv("GITHUB_REPOSITORY") and os.getenv("GITHUB_RUN_ID"):
            target_url = f"https://github.com/{os.getenv('GITHUB_REPOSITORY')}/actions/runs/{os.getenv('GITHUB_RUN_ID')}"

        ok, status_msg = post_commit_status(head_sha, state, desc, repo=args.repo, target_url=target_url, timeout=args.timeout)
        if not ok:
            sys.stderr.write(f"Warning: {status_msg}\n")

    if passed:
        print(msg)
        sys.exit(0)
    else:
        sys.stderr.write(msg + "\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
