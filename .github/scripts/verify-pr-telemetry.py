#!/usr/bin/env python3
"""
verify-pr-telemetry.py
Deterministic Antigravity Telemetry Pre-Merge Guard check for GitHub Actions CI and pre-merge hooks.
Includes commit pagination (>100 commits), comment authentication, and commit status bridge.
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
TRUSTED_ASSOCIATIONS = {"OWNER", "MEMBER", "COLLABORATOR"}
TRUSTED_BOT_LOGINS = {"github-actions", "github-actions[bot]"}

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

def get_all_pr_commits_and_head(
    pr_num: int,
    repo: Optional[str] = None,
    timeout: int = DEFAULT_TIMEOUT_SEC
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Fetches all commits across any number of pages using GitHub GraphQL API,
    guaranteeing complete commit coverage for PRs with >100 commits.
    Returns (commits_list, head_sha).
    """
    owner = None
    repo_name = None

    if repo and "/" in repo:
        parts = repo.split("/", 1)
        owner, repo_name = parts[0], parts[1]
    elif os.getenv("GITHUB_REPOSITORY") and "/" in os.environ["GITHUB_REPOSITORY"]:
        parts = os.environ["GITHUB_REPOSITORY"].split("/", 1)
        owner, repo_name = parts[0], parts[1]
    else:
        try:
            res = subprocess.run(
                ["gh", "repo", "view", "--json", "owner,name"],
                capture_output=True, text=True, timeout=timeout
            )
            if res.returncode == 0:
                repo_data = json.loads(res.stdout)
                owner = repo_data.get("owner", {}).get("login")
                repo_name = repo_data.get("name")
        except Exception:
            pass

    commits: List[Dict[str, Any]] = []
    head_sha: Optional[str] = None
    cursor: Optional[str] = None

    if owner and repo_name:
        query = """
        query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pr) {
              headRefOid
              commits(first: 100, after: $cursor) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  commit {
                    oid
                    messageHeadline
                    messageBody
                  }
                }
              }
            }
          }
        }
        """
        while True:
            cmd = ["gh", "api", "graphql", "-F", f"owner={owner}", "-F", f"repo={repo_name}", "-F", f"pr={pr_num}"]
            if cursor:
                cmd.extend(["-F", f"cursor={cursor}"])
            cmd.extend(["-f", f"query={query}"])

            try:
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            except subprocess.TimeoutExpired as te:
                raise RuntimeError(f"GitHub CLI timed out after {timeout}s fetching PR #{pr_num} commits (cursor: {cursor})") from te

            if res.returncode != 0:
                if not cursor and not commits:
                    break  # Fall back to gh pr view on first-page GraphQL failure
                raise RuntimeError(f"GraphQL pagination failed on PR #{pr_num} (cursor {cursor}): {res.stderr.strip()}")

            try:
                data = json.loads(res.stdout)
            except json.JSONDecodeError as je:
                if not cursor and not commits:
                    break
                raise RuntimeError(f"Malformed GraphQL response on PR #{pr_num} (cursor {cursor}): {je}") from je

            pr_obj = data.get("data", {}).get("repository", {}).get("pullRequest")
            if not pr_obj:
                if not cursor and not commits:
                    break
                raise RuntimeError(f"Missing pullRequest data in GraphQL response for PR #{pr_num}")

            if not head_sha:
                head_sha = pr_obj.get("headRefOid")

            commits_obj = pr_obj.get("commits", {})
            for node in commits_obj.get("nodes", []):
                c = node.get("commit", {})
                commits.append({
                    "oid": c.get("oid", ""),
                    "messageHeadline": c.get("messageHeadline", ""),
                    "messageBody": c.get("messageBody", "")
                })

            page_info = commits_obj.get("pageInfo", {})
            if page_info.get("hasNextPage") and page_info.get("endCursor"):
                cursor = page_info.get("endCursor")
            else:
                return commits, head_sha

    # Fallback to standard gh pr view only when GraphQL was never used / failed upfront
    cmd = ["gh", "pr", "view", str(pr_num), "--json", "commits,headRefOid,headRefName"]
    if repo:
        cmd.extend(["-R", repo])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as te:
        raise RuntimeError(f"GitHub CLI timed out after {timeout}s fetching PR #{pr_num} commits") from te

    if res.returncode != 0:
        raise RuntimeError(f"Failed to fetch PR #{pr_num} commits: {res.stderr.strip()}")
    data = json.loads(res.stdout)
    return data.get("commits", []), data.get("headRefOid")

def get_pr_comments(
    pr_num: int,
    repo: Optional[str] = None,
    timeout: int = DEFAULT_TIMEOUT_SEC
) -> List[Dict[str, Any]]:
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
    return data.get("comments", [])

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

    target_repo = repo or os.getenv("GITHUB_REPOSITORY")
    endpoint = f"repos/{target_repo}/statuses/{sha}" if target_repo else f"repos/:owner/:repo/statuses/{sha}"
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
    1. Extracts all Antigravity-Session-ID trailers from all PR commits across all pages.
    2. Verifies that a valid, authenticated Antigravity Telemetry receipt exists in the PR comments.
    3. Asserts that 100% of committed session IDs are covered in the receipt.
    Returns (passed, message, receipt_data, head_sha)
    """
    try:
        commits, head_sha = get_all_pr_commits_and_head(pr_num, repo, timeout=timeout)
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

    for c in reversed(comments):
        body = c.get("body", "") if isinstance(c, dict) else str(c)
        author = c.get("author", {}).get("login", "") if isinstance(c, dict) else ""
        association = (c.get("authorAssociation") or "").upper() if isinstance(c, dict) else ""

        match = receipt_pattern.search(body)
        if not match:
            continue

        # Authenticate commenter provenance: only trust repo owners, members, collaborators, or CI bots
        is_trusted = (
            not isinstance(c, dict)  # fallback when comments are raw strings in unit tests
            or association in TRUSTED_ASSOCIATIONS
            or author in TRUSTED_BOT_LOGINS
        )
        if not is_trusted:
            continue

        try:
            parsed = json.loads(match.group(1))
            if "covered_session_ids" in parsed:
                receipt_data = parsed
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
            f"but NO authenticated Antigravity Telemetry Report comment was found on the PR.\n"
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
