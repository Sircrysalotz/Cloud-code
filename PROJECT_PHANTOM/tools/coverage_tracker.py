#!/usr/bin/env python3
"""
coverage_tracker.py — Portable file coverage checker for autonomous sessions.

Tracks which target files have been modified since a reference point.
Useful for enforcing horizontal improvement discipline: makes sure all
planned files get touched, not just the easy ones.

Exit codes:
  0 — full coverage (all targets touched)
  1 — incomplete coverage (some targets not yet modified)
  2 — error

Usage:
  python3 coverage_tracker.py --targets file1.py file2.py file3.py [options]
  python3 coverage_tracker.py --targets-file targets.txt [options]

Target file format (--targets-file):
  One path per line. Lines starting with # are comments. Blank lines ignored.

Examples:
  python3 coverage_tracker.py --targets agents/phantom.py agents/heartbeat_runner.py
  python3 coverage_tracker.py --targets-file plan_targets.txt --since main
  python3 coverage_tracker.py --targets src/ --repo /other/project --since HEAD~5
"""

import argparse
import os
import subprocess
import sys


def parse_args():
    p = argparse.ArgumentParser(
        description="Check which target files have been modified since a git ref.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--targets", nargs="+", default=None,
        help="List of file paths (or directories) to track"
    )
    p.add_argument(
        "--targets-file", default=None,
        help="File containing one target path per line (# comments ok)"
    )
    p.add_argument(
        "--repo", default=".",
        help="Path to git repository root (default: current directory)"
    )
    p.add_argument(
        "--since", default=None,
        help="Git ref to diff from (default: merge-base with main/master, or HEAD~10)"
    )
    p.add_argument(
        "--base-branch", default=None,
        help="Branch to find merge-base against (default: tries 'main' then 'master')"
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
    if base_branch:
        candidates = [base_branch]
    else:
        candidates = ["main", "master"]

    for branch in candidates:
        r = git(["merge-base", "HEAD", branch], repo, check=False)
        if r.returncode == 0:
            return r.stdout.strip()

    r = git(["rev-list", "--count", "HEAD"], repo, check=False)
    if r.returncode == 0:
        count = int(r.stdout.strip())
        n = min(10, max(1, count - 1))
        return f"HEAD~{n}"

    return None


def load_targets(args, repo):
    targets = []

    if args.targets:
        targets.extend(args.targets)

    if args.targets_file:
        path = args.targets_file
        if not os.path.isabs(path):
            path = os.path.join(repo, path)
        if not os.path.exists(path):
            print(f"ERROR: targets file not found: {path}", file=sys.stderr)
            sys.exit(2)
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    targets.append(line)

    return targets


def get_changed_files(repo, since):
    """Return set of files changed since `since`."""
    r = git(["diff", "--name-only", since, "HEAD"], repo, check=False)
    if r.returncode != 0:
        return None, r.stderr.strip()
    return set(r.stdout.strip().splitlines()), None


def normalize(path, repo):
    """Normalize a path relative to the repo root."""
    if os.path.isabs(path):
        try:
            return os.path.relpath(path, repo)
        except ValueError:
            return path
    # Relative paths are already relative to the repo root (same convention as git diff --name-only)
    return os.path.normpath(path)


def target_touched(target_rel, changed_files):
    """Check if target (file or directory prefix) appears in changed files."""
    # Exact match
    if target_rel in changed_files:
        return True
    # Directory prefix match
    prefix = target_rel.rstrip("/") + "/"
    return any(f.startswith(prefix) for f in changed_files)


def run(args):
    repo = os.path.abspath(args.repo)

    r = git(["rev-parse", "--git-dir"], repo, check=False)
    if r.returncode != 0:
        if not args.quiet:
            print(f"ERROR: Not a git repository: {repo}", file=sys.stderr)
        return 2

    targets_raw = load_targets(args, repo)
    if not targets_raw:
        if not args.quiet:
            print("ERROR: No targets specified. Use --targets or --targets-file.", file=sys.stderr)
        return 2

    since = args.since
    if since is None:
        since = find_since(repo, args.base_branch)
    if since is None:
        if not args.quiet:
            print("ERROR: Could not determine diff base. Use --since.", file=sys.stderr)
        return 2

    changed, err = get_changed_files(repo, since)
    if changed is None:
        if not args.quiet:
            print(f"ERROR: {err}", file=sys.stderr)
        return 2

    # Normalize targets relative to repo root
    targets_norm = [(t, normalize(t, repo)) for t in targets_raw]

    touched = []
    untouched = []
    for raw, rel in targets_norm:
        if target_touched(rel, changed):
            touched.append((raw, rel))
        else:
            untouched.append((raw, rel))

    total = len(targets_norm)
    done = len(touched)
    pct = 100.0 * done / total if total else 0.0
    full_coverage = len(untouched) == 0

    if args.json:
        import json
        print(json.dumps({
            "since": since,
            "total": total,
            "touched": done,
            "coverage_pct": round(pct, 1),
            "full_coverage": full_coverage,
            "touched_files": [r for _, r in touched],
            "untouched_files": [r for _, r in untouched],
        }, indent=2))
        return 0 if full_coverage else 1

    if not args.quiet:
        print(f"Coverage check — diff since: {since}  |  {done}/{total} targets touched ({pct:.0f}%)")
        print()
        for raw, rel in touched:
            print(f"  ✓  {raw}")
        for raw, rel in untouched:
            print(f"  ✗  {raw}  ← not yet modified")
        print()
        if full_coverage:
            print(f"  ✓ FULL COVERAGE — all {total} targets touched")
        else:
            print(f"  ✗ INCOMPLETE — {len(untouched)}/{total} targets not yet modified")

    return 0 if full_coverage else 1


if __name__ == "__main__":
    sys.exit(run(parse_args()))
