#!/usr/bin/env python3
"""
Phantom Heartbeat Runner v2.

Fires ONLY when ALL of these are true:
  1. gap since last activity >= idle_threshold
  2. agents_running == 0  (not waiting on sub-agents)
  3. cooldown since last_heartbeat_fired >= idle_threshold * cooldown_factor
  4. rounds_remaining > 0

v2 additions:
  - Poll interval read from state file (check_interval_seconds), not hardcoded
  - SIGTERM/SIGINT handler — clears heartbeat_active before exit
  - Drift reporting — shows how far past threshold the fire actually happened
  - Per-poll status line includes gap, cooldown, and agent count
  - Watchdog — detects poll cycles taking >3x interval

v3 activity signals:
  - Filesystem scan — tracks most recent mtime of code/doc files in workspace
  - Git index watch — git add/stage operations update .git/index
  - Uses max(ping_timestamp, file_mtime, git_index_mtime) as effective last_active
  - Eliminates false positives when Claude is coding but not pinging
"""

import json
import os
import signal
import sys
import time
from datetime import datetime

STATE_FILE = os.environ.get("PHANTOM_STATE", "/tmp/phantom_session.json")
TEMP_FILE  = STATE_FILE + ".tmp"

TRACKED_EXTS = {'.py', '.md', '.json', '.sh', '.txt', '.yaml', '.yml',
                '.toml', '.js', '.ts', '.go', '.rs', '.rb', '.java', '.c', '.cpp'}
SKIP_DIRS    = {'.git', '__pycache__', 'node_modules', '.venv', 'venv',
                'dist', 'build', '.tox', '.mypy_cache', 'logs'}
MAX_SCAN_DEPTH = 5


def atomic_write(state: dict):
    with open(TEMP_FILE, "w") as f:
        json.dump(state, f, indent=2)
    os.rename(TEMP_FILE, STATE_FILE)


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


def parse_dt(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")


def scan_workspace(workspace: str) -> tuple[float, str | None]:
    """
    Walk workspace for recently modified tracked files.
    Returns (latest_mtime_timestamp, filepath_of_most_recent).
    Skips noise dirs (logs, __pycache__, .git, etc).
    """
    latest_mtime = 0.0
    latest_path  = None

    try:
        for root, dirs, files in os.walk(workspace):
            # Prune noise dirs in-place
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]

            # Depth limit
            depth = root[len(workspace):].count(os.sep)
            if depth >= MAX_SCAN_DEPTH:
                dirs.clear()

            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in TRACKED_EXTS:
                    continue
                fpath = os.path.join(root, fname)
                try:
                    mtime = os.path.getmtime(fpath)
                    if mtime > latest_mtime:
                        latest_mtime = mtime
                        latest_path  = os.path.relpath(fpath, workspace)
                except OSError:
                    pass
    except OSError:
        pass

    return latest_mtime, latest_path


def git_index_mtime(workspace: str) -> float:
    """Return mtime of .git/index (updates on every git add/stage)."""
    index = os.path.join(workspace, ".git", "index")
    try:
        return os.path.getmtime(index)
    except OSError:
        return 0.0


def get_last_activity(state: dict) -> tuple[float, str]:
    """
    Return (timestamp, source_label) of the most recent observable activity.

    Sources checked (in order of precedence by recency):
      1. explicit ping (last_active in state)
      2. filesystem scan of workspace_dir
      3. git index mtime (git add operations)
    """
    candidates = []

    # Source 1: explicit ping
    last_active_str = state.get("last_active", "")
    if last_active_str:
        try:
            ping_ts = parse_dt(last_active_str).timestamp()
            candidates.append((ping_ts, "ping"))
        except ValueError:
            pass

    workspace = state.get("workspace_dir", "")
    if workspace and os.path.isdir(workspace):
        # Source 2: filesystem scan
        fs_mtime, fs_path = scan_workspace(workspace)
        if fs_mtime > 0:
            label = f"file:{fs_path}" if fs_path else "file:scan"
            candidates.append((fs_mtime, label))

        # Source 3: git index
        gi_mtime = git_index_mtime(workspace)
        if gi_mtime > 0:
            candidates.append((gi_mtime, "git:index"))

    if not candidates:
        return 0.0, "none"

    return max(candidates, key=lambda x: x[0])


def clear_active_flag():
    """Best-effort: clear heartbeat_active on exit so session isn't orphaned."""
    state = read_state()
    if state and state.get("heartbeat_active"):
        state["heartbeat_active"] = False
        try:
            atomic_write(state)
            print("\n[heartbeat] Cleared heartbeat_active flag on exit.")
        except Exception:
            pass


def signal_handler(sig, frame):
    print(f"\n[heartbeat] Received signal {sig}. Shutting down gracefully.")
    clear_active_flag()
    sys.exit(0)


def main():
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT,  signal_handler)

    state = read_state()
    if not state:
        print("ERROR: No session state. Run phantom.py start first.")
        return

    if not state.get("heartbeat_active"):
        print("ERROR: Not armed. Run phantom.py heartbeat-arm before spawning.")
        return

    idle_threshold  = state.get("idle_threshold_seconds", 180)
    check_interval  = state.get("check_interval_seconds", 30)
    cooldown_factor = state.get("cooldown_factor", 1.0)
    cooldown_window = idle_threshold * cooldown_factor
    watchdog_limit  = check_interval * 3
    workspace       = state.get("workspace_dir", "")

    print(f"Heartbeat v2 active")
    print(f"  Threshold: {idle_threshold}s | Cooldown: {cooldown_window:.0f}s ({cooldown_factor}x) | Poll: {check_interval}s | Rounds: {state.get('rounds_remaining')}")
    print(f"  Watchdog:  {watchdog_limit}s max per cycle")
    if workspace:
        print(f"  Workspace: {workspace}")
    else:
        print(f"  Workspace: not set — filesystem activity signals disabled")

    while True:
        cycle_start = time.monotonic()
        time.sleep(check_interval)
        cycle_elapsed = time.monotonic() - cycle_start
        if cycle_elapsed > watchdog_limit:
            print(f"[WATCHDOG] Poll cycle took {cycle_elapsed:.0f}s (limit {watchdog_limit}s) — possible stall.")

        state = read_state()
        if not state:
            print("ERROR: State file lost mid-session.")
            clear_active_flag()
            return

        rounds_remaining = state.get("rounds_remaining", 0)
        if rounds_remaining <= 0:
            print("Rounds exhausted. Heartbeat shutting down.")
            state["heartbeat_active"] = False
            atomic_write(state)
            return

        now = datetime.now()
        ts  = now.strftime("%H:%M:%S")

        # Guard 1: agents still running
        agents_running = state.get("agents_running", 0)
        if agents_running > 0:
            print(f"[{ts}] HOLD — {agents_running} agent(s) running.")
            continue

        # Guard 2: idle gap — use all available activity signals
        last_activity_ts, activity_source = get_last_activity(state)
        if last_activity_ts == 0:
            continue
        gap = now.timestamp() - last_activity_ts

        # Guard 3: cooldown
        last_fired_str = state.get("last_heartbeat_fired")
        if last_fired_str:
            cooldown_elapsed = (now - parse_dt(last_fired_str)).total_seconds()
            if cooldown_elapsed < cooldown_window:
                print(f"[{ts}] HOLD — cooldown {cooldown_elapsed:.0f}s/{cooldown_window:.0f}s | gap {gap:.0f}s [{activity_source}]")
                continue

        if gap < idle_threshold:
            print(f"[{ts}] HOLD — active {gap:.0f}s ago (need {idle_threshold}s) [{activity_source}]")
            continue

        # All guards passed — fire
        drift = gap - idle_threshold
        state["rounds_remaining"]     = max(0, rounds_remaining - 1)
        state["rounds_used"]          = state.get("rounds_used", 0) + 1
        state["last_heartbeat_fired"] = now.strftime("%Y-%m-%d %H:%M:%S")
        state["heartbeat_active"]     = False
        atomic_write(state)

        print("=" * 54)
        print("  HEARTBEAT FIRED")
        print(f"  Idle:      {gap:.0f}s (threshold: {idle_threshold}s, drift: +{drift:.0f}s)")
        print(f"  Signal:    {activity_source}")
        print(f"  Task:      {state.get('task', '—')}")
        print(f"  Progress:  {state.get('progress_note', 'none')}")
        print(f"  Turns:     {state.get('turns_taken')}/{state.get('turns_target')}")
        print(f"  Rounds left: {state['rounds_remaining']}")
        print("=" * 54)
        print("RESUME: phantom.py ping [note] → phantom.py heartbeat-arm → spawn next round.")
        return


if __name__ == "__main__":
    main()
