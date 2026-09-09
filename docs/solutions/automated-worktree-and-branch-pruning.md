---
title: "Automated Git Worktree and Merged Local Branch Pruning"
date: "2026-09-09"
category: "developer-tooling-and-workflows"
module: "antigravity-telemetry-guard"
problem_type: "worktree_accumulation_and_workspace_drift"
component: "post-tool-hook-and-cli"
symptoms:
  - "Stale git worktrees accumulated in .worktrees/ across multi-branch and subagent tasks"
  - "Local branches persisted indefinitely after remote GitHub PR merges"
  - "Worktree tracking locks prevented fast context switching and branch cleanup"
root_cause: "lack_of_automated_post_merge_lifecycle_cleanup_hooks"
resolution_type: "automation_and_tooling"
severity: "medium"
tags:
  - "git"
  - "worktrees"
  - "cleanup"
  - "branch-pruning"
  - "harness-hooks"
  - "lifecycle"
---

# Automated Git Worktree and Merged Local Branch Pruning

## Problem
Autonomous agent workflows (e.g. `ce-worktree`, branch-isolated subagents) spawn temporary git worktrees (often under `.worktrees/`) and dedicated task branches. Once pull requests are merged on the remote repository:
1. Local git branches remain present on disk, gradually polluting `git branch` output.
2. Linked worktrees remain registered in git metadata, consuming disk space and holding worktree lockfiles that cause collisions if the same branch name is reused.
3. Manual cleanup is tedious, error-prone, and frequently neglected by autonomous agent loops.

## Symptoms
- Accumulation of stale directories under `.worktrees/`.
- Local branches whose remote tracking references were deleted (`gone` status) remained unpruned.
- `git worktree list` showed defunct worktree paths.
- Developers had to manually run multi-step branch and worktree pruning commands after merging PRs.

## What Didn't Work
- `git fetch -p` alone: Prunes remote tracking branches (`origin/*`), but leaves local branches and worktrees untouched.
- `git branch --merged`: In squash-merge or rebase-merge workflows, local commit hashes differ from the squash commit on `main`. As a result, standard `git branch --merged main` fails to detect that the feature branch was squash-merged.
- Hardcoded shell alias scripts: Depended on local workstation config and were not executed by agent harness tool runs.

## Solution
1. **Remote Upstream Gone Detection (`git branch -vv`):**
   - The CLI executes `git fetch -p` to refresh remote tracking status.
   - It inspects `git branch -vv` output for branches tracking `origin/*` with the `[gone]` indicator.
   - It safety-checks against protected branches (`main`, `master`, `develop`, `release/*`).
2. **Worktree Association and Safe Removal:**
   - The command cross-references `git worktree list --porcelain`.
   - If a `[gone]` branch has an attached worktree, `git worktree remove --force <path>` is executed first to prevent git metadata corruption.
   - The local branch is then safely removed using `git branch -D <branch>`.
3. **Automated PostToolUse Harness Hook:**
   - A `PostToolUse` lifecycle hook intercepts `gh pr merge` and `git merge` commands in Antigravity sessions.
   - Upon successful merge completion, the hook automatically runs `antigravity-telemetry prune` in the repository root.
4. **Standalone CLI & npm Command:**
   - Repositories expose a direct npm script:
     ```json
     "prune": "antigravity-telemetry prune"
     ```
   - Engineers can run `bun run prune` or `antigravity-telemetry prune` anytime on demand.

## Why This Works
- Relying on `[gone]` status instead of git commit ancestry correctly identifies squash-merged and rebase-merged branches where commit SHAs have diverged.
- Removing worktrees before deleting their branches prevents orphaned worktree entries and dangling directory locks.
- Integrating via `PostToolUse` hooks guarantees seamless cleanup without disrupting the primary merge flow.

## Prevention
- Always delete remote branches upon PR merge (configured via GitHub repository auto-delete settings).
- Use `bun run prune` or rely on the automated `PostToolUse` harness hook after PR merges.

## Related Artifacts & Commits
- Plugin: `~/.gemini/config/plugins/antigravity-telemetry-guard/`
- Binary: `/Users/wryen/.local/bin/antigravity-telemetry`
- Upstream Repo: `https://github.com/wryenmeek/antigravity-telemetry-guard`
