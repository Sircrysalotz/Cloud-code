#!/usr/bin/env python3
"""
scope_guard.py — Portable git diff scope checker.

Warns if any single file is receiving a disproportionate share of changes,
indicating vertical drilling rather than horizontal improvement.

Exit codes:
  0 — clean (no file exceeds threshold)
  1 — drift detected (one or more files exceed threshold)
  2 — error (not a git repo, no commits, etc.)

Usage:
  python3 scope_guard.py [options]

Examples:
  python3 scope_guard.py
  python3 scope_guard.py --repo /path/to/repo --threshold 40 --since HEAD~5
  python3 scope_guard.py --since main --threshold 30 --quiet
"""

import argparse
import json
import os
import re
import subprocess
import sys


def parse_args():
    p = argparse.ArgumentParser(
        description="Check git diff for disproportionate file changes (scope drift).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--repo", default=".",
        help="Path to git repository root (default: current directory)"
    )
    p.add_argument(
        "--threshold", type=float, default=40.0,
        help="Warn if any file exceeds this %% of total changes (default: 40)"
    )
    p.add_argument(
        "--since", default=None,
        help="Git ref to diff from (default: auto-detect merge-base with main/master, "
             "or HEAD~10 if no base branch found)"
    )
    p.add_argument(
        "--base-branch", default=None,
        help="Branch to find merge-base against (default: tries 'main' then 'master')"
    )
    p.add_argument(
        "--session", action="store_true",
        help="Use session_start_ref from phantom session state as diff base "
             "(reads /tmp/phantom_session.json or PHANTOM_STATE env var)"
    )
    p.add_argument(
        "--state-file", default=None,
        help="Path to phantom session state file (overrides PHANTOM_STATE env var)"
    )
    p.add_argument(
        "--quiet", action="store_true",
        help="Suppress output; use exit code only"
    )
    p.add_argument(
        "--json", action="store_true",
        help="Output results as JSON"
    )
    return p.parse_args()


def read_session_start_ref(state_file: str | None = None) -> str | None:
    """Read session_start_ref from phantom session state file."""
    path = state_file or os.environ.get("PHANTOM_STATE", "/tmp/phantom_session.json")
    try:
        with open(path) as f:
            state = json.load(f)
        ref = state.get("session_start_ref")
        return ref if ref else None
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return None


def git(args, repo, check=True):
    result = subprocess.run(
        ["git"] + args,
        cwd=repo,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return result


def find_since(repo, base_branch):
    """Auto-detect a sensible diff base."""
    # Try explicit base branch first
    if base_branch:
        candidates = [base_branch]
    else:
        candidates = ["main", "master"]

    for branch in candidates:
        r = git(["merge-base", "HEAD", branch], repo, check=False)
        if r.returncode == 0:
            return r.stdout.strip()

    # Fall back to HEAD~10 (or all commits if fewer than 10)
    r = git(["rev-list", "--count", "HEAD"], repo, check=False)
    if r.returncode == 0:
        count = int(r.stdout.strip())
        n = min(10, max(1, count - 1))
        return f"HEAD~{n}"

    return None


def parse_diff_stat(stat_output):
    """Parse `git diff --stat` output into {filename: lines_changed}."""
    files = {}
    for line in stat_output.splitlines():
        # Format: " path/to/file | 42 +++---"
        m = re.match(r"^\s+(.+?)\s+\|\s+(\d+)", line)
        if m:
            files[m.group(1).strip()] = int(m.group(2))
    return files


def run(args):
    repo = os.path.abspath(args.repo)

    # Verify it's a git repo
    r = git(["rev-parse", "--git-dir"], repo, check=False)
    if r.returncode != 0:
        if not args.quiet:
            print(f"ERROR: Not a git repository: {repo}", file=sys.stderr)
        return 2

    # Determine diff base
    since = args.since
    session_label = ""
    if since is None and getattr(args, "session", False):
        state_file = getattr(args, "state_file", None)
        session_ref = read_session_start_ref(state_file)
        if session_ref:
            since = session_ref
            session_label = " (session)"
        elif not args.quiet:
            print("WARNING: --session specified but no session_start_ref found in state. "
                  "Falling back to auto-detect.", file=sys.stderr)
    if since is None:
        since = find_since(repo, args.base_branch)
    if since is None:
        if not args.quiet:
            print("ERROR: Could not determine diff base. Use --since to specify.", file=sys.stderr)
        return 2

    # Run git diff --stat
    r = git(["diff", "--stat", since, "HEAD"], repo, check=False)
    if r.returncode != 0:
        if not args.quiet:
            print(f"ERROR: git diff failed: {r.stderr.strip()}", file=sys.stderr)
        return 2

    stat = r.stdout.rstrip()
    if not stat:
        if not args.quiet:
            print(f"No changes found since {since}.")
        return 0

    files = parse_diff_stat(stat)
    if not files:
        if not args.quiet:
            print(f"No file-level changes found since {since}.")
        return 0

    total = sum(files.values())
    if total == 0:
        return 0

    # Compute per-file percentages
    scored = sorted(
        [(name, lines, 100.0 * lines / total) for name, lines in files.items()],
        key=lambda x: -x[2],
    )

    drift_files = [(n, l, p) for n, l, p in scored if p > args.threshold]
    clean = len(drift_files) == 0

    if args.json:
        print(json.dumps({
            "since": since,
            "session": bool(session_label),
            "threshold": args.threshold,
            "total_lines": total,
            "files": [{"file": n, "lines": l, "pct": round(p, 1)} for n, l, p in scored],
            "drift": [{"file": n, "lines": l, "pct": round(p, 1)} for n, l, p in drift_files],
            "clean": clean,
        }, indent=2))
        return 0 if clean else 1

    if not args.quiet:
        print(f"Scope check — diff since: {since}{session_label}  |  threshold: {args.threshold:.0f}%  |  total lines: {total}")
        print()
        for name, lines, pct in scored:
            bar = "█" * int(pct / 5)
            flag = "  ← DRIFT" if pct > args.threshold else ""
            print(f"  {pct:5.1f}%  {bar:<20}  {lines:4d}  {name}{flag}")
        print()
        if clean:
            print("  ✓ CLEAN — no file exceeds threshold")
        else:
            print(f"  ✗ DRIFT DETECTED — {len(drift_files)} file(s) over {args.threshold:.0f}%:")
            for name, lines, pct in drift_files:
                print(f"      {name}  ({pct:.1f}% of changes)")

    return 0 if clean else 1


if __name__ == "__main__":
    sys.exit(run(parse_args()))
