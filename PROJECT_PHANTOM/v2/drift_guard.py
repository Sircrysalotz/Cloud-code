#!/usr/bin/env python3
"""
Phantom Drift Guard — background agent that monitors horizontal drift.

Runs alongside the heartbeat during a session. Periodically checks git diff
stats to detect vertical drilling (one file getting disproportionate changes).
Also checks goal alignment: are the changed files plausibly related to the
stated task?

When drift is detected, writes a warning to session state and exits — waking
the main Claude session so it can self-correct before continuing.

Exit codes:
  0 — clean exit (session complete, rounds done, or SIGTERM)
  1 — drift detected (warning written to session state)

Usage (run as background sub-agent):
  python3 drift_guard.py [options]

Options:
  --interval N      Poll every N seconds (default: 60)
  --threshold N     Warn if any file exceeds N% of changes (default: 40)
  --since REF       Git ref to diff from (default: auto-detect merge-base)
  --min-lines N     Minimum total changed lines before checking (default: 20)
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime

STATE_FILE = os.environ.get("PHANTOM_STATE", "/tmp/phantom_session.json")
TEMP_FILE  = STATE_FILE + ".tmp"


# ─── State I/O ────────────────────────────────────────────────────────────────

def read_state() -> dict | None:
    for _ in range(3):
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except json.JSONDecodeError:
            time.sleep(0.1)
        except FileNotFoundError:
            return None
    return None


def atomic_write(state: dict):
    with open(TEMP_FILE, "w") as f:
        json.dump(state, f, indent=2)
    os.rename(TEMP_FILE, STATE_FILE)


def clear_active_flag():
    state = read_state()
    if state and state.get("drift_guard_active"):
        state["drift_guard_active"] = False
        try:
            atomic_write(state)
            print("\n[drift_guard] Cleared drift_guard_active on exit.")
        except Exception:
            pass


def signal_handler(sig, frame):
    print(f"\n[drift_guard] Signal {sig}. Shutting down.")
    clear_active_flag()
    sys.exit(0)


# ─── Git analysis ─────────────────────────────────────────────────────────────

def git(args, cwd, check=False):
    return subprocess.run(
        ["git"] + args, cwd=cwd,
        capture_output=True, text=True
    )


def find_since(workspace: str, base_branch: str | None = None) -> str | None:
    candidates = [base_branch] if base_branch else ["main", "master"]
    for branch in candidates:
        r = git(["merge-base", "HEAD", branch], workspace)
        if r.returncode == 0:
            return r.stdout.strip()
    r = git(["rev-list", "--count", "HEAD"], workspace)
    if r.returncode == 0:
        count = int(r.stdout.strip())
        n = min(10, max(1, count - 1))
        return f"HEAD~{n}"
    return None


def parse_diff_stat(stat_output: str) -> dict[str, int]:
    files = {}
    for line in stat_output.splitlines():
        m = re.match(r"^\s+(.+?)\s+\|\s+(\d+)", line)
        if m:
            files[m.group(1).strip()] = int(m.group(2))
    return files


def check_scope(workspace: str, since: str, threshold: float, min_lines: int) -> dict:
    """
    Returns a result dict:
      clean     bool
      total     int
      files     list of (name, lines, pct)
      drifters  list of (name, lines, pct) exceeding threshold
      since     str
    """
    r = git(["diff", "--stat", since, "HEAD"], workspace)
    if r.returncode != 0:
        return {"error": r.stderr.strip()}

    files = parse_diff_stat(r.stdout)
    if not files:
        return {"clean": True, "total": 0, "files": [], "drifters": [], "since": since}

    total = sum(files.values())
    if total < min_lines:
        return {"clean": True, "total": total, "files": [], "drifters": [], "since": since,
                "note": f"only {total} lines changed (min {min_lines})"}

    scored = sorted(
        [(name, lines, 100.0 * lines / total) for name, lines in files.items()],
        key=lambda x: -x[2]
    )
    drifters = [(n, l, p) for n, l, p in scored if p > threshold]

    return {
        "clean":    len(drifters) == 0,
        "total":    total,
        "files":    scored,
        "drifters": drifters,
        "since":    since,
    }


def check_goal_alignment(workspace: str, since: str, task: str) -> dict:
    """
    Lightweight keyword-based check: do changed filenames relate to the task?
    Returns alignment score 0.0–1.0 and a note.
    """
    if not task:
        return {"score": 1.0, "note": "no task set"}

    r = git(["diff", "--name-only", since, "HEAD"], workspace)
    if r.returncode != 0:
        return {"score": 1.0, "note": "git diff failed"}

    changed = [f.lower() for f in r.stdout.strip().splitlines() if f]
    if not changed:
        return {"score": 1.0, "note": "no files changed"}

    # Extract keywords from task (words ≥4 chars, skip common words)
    stop = {"with", "that", "this", "from", "have", "will", "also", "into",
            "over", "then", "when", "where", "while", "about", "build",
            "make", "adds", "more", "each", "some", "only", "both", "very"}
    task_words = {w.lower() for w in re.findall(r'\b[a-zA-Z]{4,}\b', task)
                  if w.lower() not in stop}

    if not task_words:
        return {"score": 1.0, "note": "no meaningful keywords in task"}

    # Check how many changed files mention a task keyword (in path or name)
    matched = sum(
        1 for f in changed
        if any(kw in f for kw in task_words)
    )
    score = matched / len(changed) if changed else 1.0

    if score < 0.2 and len(changed) >= 3:
        note = (f"{matched}/{len(changed)} changed files relate to task keywords "
                f"({', '.join(sorted(task_words)[:5])})")
    else:
        note = f"{matched}/{len(changed)} files match task keywords"

    return {"score": score, "note": note}


# ─── Main loop ────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Drift Guard — background horizontal drift monitor")
    p.add_argument("--interval",  type=int,   default=60,   help="Poll interval in seconds")
    p.add_argument("--threshold", type=float, default=40.0, help="Scope drift threshold %%")
    p.add_argument("--since",     default=None,             help="Git ref to diff from")
    p.add_argument("--min-lines", type=int,   default=20,   help="Min changed lines before checking")
    return p.parse_args()


def main():
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT,  signal_handler)

    args = parse_args()

    state = read_state()
    if not state:
        print("ERROR: No session state. Run phantom.py start first.")
        sys.exit(1)

    if not state.get("drift_guard_active"):
        print("ERROR: Not armed. Run phantom.py drift-arm before spawning.")
        sys.exit(1)

    workspace = state.get("workspace_dir", "")
    if not workspace or not os.path.isdir(workspace):
        print(f"ERROR: workspace_dir not set or missing in session state.")
        print("  Start session with an up-to-date phantom.py that stores workspace_dir.")
        clear_active_flag()
        sys.exit(1)

    task     = state.get("task", "")
    since    = args.since or find_since(workspace)
    checks   = 0

    print(f"Drift Guard active")
    print(f"  Workspace: {workspace}")
    print(f"  Threshold: {args.threshold:.0f}% | Poll: {args.interval}s | Since: {since}")
    print(f"  Task:      {task[:60]}{'...' if len(task) > 60 else ''}")

    while True:
        time.sleep(args.interval)
        checks += 1
        ts = datetime.now().strftime("%H:%M:%S")

        state = read_state()
        if not state:
            print(f"[{ts}] ERROR: State file lost.")
            sys.exit(1)

        # Exit if session ended or drift guard disarmed externally
        if state.get("status") in ("complete",):
            print(f"[{ts}] Session complete. Drift guard shutting down.")
            clear_active_flag()
            sys.exit(0)

        if not state.get("drift_guard_active"):
            print(f"[{ts}] Drift guard disarmed externally. Exiting.")
            sys.exit(0)

        # Scope check
        scope = check_scope(workspace, since, args.threshold, args.min_lines)

        if "error" in scope:
            print(f"[{ts}] Scope check error: {scope['error']}")
            continue

        if "note" in scope and scope["total"] == 0:
            print(f"[{ts}] OK — {scope.get('note', 'no changes yet')}")
            continue

        # Build status line
        top = scope["files"][0] if scope["files"] else None
        top_str = f"{top[0]} ({top[2]:.0f}%)" if top else "—"
        print(f"[{ts}] Check #{checks} | {scope['total']} lines | top: {top_str} | {'CLEAN' if scope['clean'] else 'DRIFT'}")

        if scope["clean"]:
            continue

        # Goal alignment check
        alignment = check_goal_alignment(workspace, since, state.get("task", ""))

        # Build warning message
        drifters = scope["drifters"]
        warning_parts = [
            f"DRIFT DETECTED after {checks} check(s):",
            f"  Scope: {drifters[0][0]} has {drifters[0][2]:.0f}% of {scope['total']} changed lines (threshold: {args.threshold:.0f}%)",
        ]
        if len(drifters) > 1:
            for n, l, p in drifters[1:]:
                warning_parts.append(f"  Also: {n} ({p:.0f}%)")
        if alignment["score"] < 0.3:
            warning_parts.append(f"  Alignment: {alignment['note']}")
        warning_parts.append(f"  Since: {since}")

        warning = "\n".join(warning_parts)

        # Write warning to state, clear active flag, exit
        state["drift_warning"]      = warning
        state["drift_warned_at"]    = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        state["drift_guard_active"] = False
        atomic_write(state)

        print("=" * 54)
        print(warning)
        print("=" * 54)
        print("ACTION: Spread changes more horizontally, then re-arm drift guard.")
        sys.exit(1)


if __name__ == "__main__":
    main()
