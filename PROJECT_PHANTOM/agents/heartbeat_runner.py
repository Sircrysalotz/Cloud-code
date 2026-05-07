#!/usr/bin/env python3
"""
Phantom Heartbeat Runner v8.

Fires ONLY when ALL of these are true:
  1. gap since last activity >= idle_threshold
  2. agents_running == 0  (not waiting on sub-agents)
  3. cooldown since last_heartbeat_fired >= idle_threshold * cooldown_factor
  4. rounds_remaining > 0
  5. consecutive_idle >= min_idle_polls  (prevents single-poll false positives)

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

v4 additions:
  - consecutive_idle / min_idle_polls: requires N back-to-back polls above threshold
    before firing (configurable in state, default 1 = same as before)
  - Writes last_activity_source, last_activity_ts, next_heartbeat_at to state
    when activity signal changes — enables status panel ETA display

v5 additions:
  - tracked_extensions read from state — configurable per-session via phantom.py start
  - scan_depth read from state — limits os.walk depth (default 5)
  - Watchdog events written to state (watchdog_events list, last 10)
    so stuck-cycle stalls are visible in report/status even after runner exits

v6 additions:
  - Anchor context in fire banner: shows anchor_b goal + done criteria
    so re-orientation is automatic on every heartbeat fire
  - RESUME line updated to include anchor check step

v7 additions:
  - eval_criteria_quick: ETA corrects for min_idle_polls extra delay
  - eval_criteria_quick: reads coverage_full from state (written by check/anchor-check)
    so coverage criterion shows [x] without git ops

v8 additions:
  - Fire banner shows session elapsed time for marathon context
  - Fire banner shows ALL criteria (not just first 3)
  - Startup banner updated to v8

v3.5 (criteria module):
  - eval_criteria_quick now delegates to criteria.py shared module
  - Fire banner and phantom.py anchor check always show identical criterion results
"""

import json
import os
import signal
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from criteria import eval_criteria

STATE_FILE = os.environ.get("PHANTOM_STATE", "/tmp/phantom_session.json")
TEMP_FILE  = STATE_FILE + ".tmp"
LOCK_FILE  = STATE_FILE.replace(".json", ".lock")
LOCK_TIMEOUT = 5

DEFAULT_TRACKED_EXTS = {'.py', '.md', '.json', '.sh', '.txt', '.yaml', '.yml',
                        '.toml', '.js', '.ts', '.go', '.rs', '.rb', '.java', '.c', '.cpp'}
SKIP_DIRS    = {'.git', '__pycache__', 'node_modules', '.venv', 'venv',
                'dist', 'build', '.tox', '.mypy_cache', 'logs'}
DEFAULT_SCAN_DEPTH = 5


def acquire_lock() -> bool:
    deadline = time.time() + LOCK_TIMEOUT
    while time.time() < deadline:
        try:
            fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            time.sleep(0.05)
    return False


def release_lock():
    try:
        os.unlink(LOCK_FILE)
    except FileNotFoundError:
        pass


def atomic_write(state: dict):
    if not acquire_lock():
        print("WARNING: Could not acquire lock — phantom.py may be writing. Proceeding anyway.")
    try:
        with open(TEMP_FILE, "w") as f:
            json.dump(state, f, indent=2)
        os.rename(TEMP_FILE, STATE_FILE)
    finally:
        release_lock()


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


def scan_workspace(workspace: str,
                   tracked_exts: set | None = None,
                   max_depth: int = DEFAULT_SCAN_DEPTH) -> tuple[float, str | None]:
    """
    Walk workspace for recently modified tracked files.
    Returns (latest_mtime_timestamp, filepath_of_most_recent).
    Skips noise dirs (logs, __pycache__, .git, etc).
    tracked_exts defaults to DEFAULT_TRACKED_EXTS if not supplied.
    """
    if tracked_exts is None:
        tracked_exts = DEFAULT_TRACKED_EXTS

    latest_mtime = 0.0
    latest_path  = None

    try:
        for root, dirs, files in os.walk(workspace):
            # Prune noise dirs in-place
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]

            # Depth limit
            depth = root[len(workspace):].count(os.sep)
            if depth >= max_depth:
                dirs.clear()

            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in tracked_exts:
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


def eval_criteria_quick(state: dict) -> list[tuple[str, bool]]:
    """Delegates to shared criteria.eval_criteria — single implementation."""
    return eval_criteria(state)


def get_last_activity(state: dict,
                      tracked_exts: set | None = None,
                      scan_depth: int = DEFAULT_SCAN_DEPTH) -> tuple[float, str]:
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
        fs_mtime, fs_path = scan_workspace(workspace, tracked_exts, scan_depth)
        if fs_mtime > 0:
            label = f"file:{fs_path}"
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

    min_idle_polls = state.get("min_idle_polls", 1)

    # Configurable scan settings (v5)
    raw_exts   = state.get("tracked_extensions")
    tracked_exts = set(raw_exts) if raw_exts else None  # None → use DEFAULT_TRACKED_EXTS
    scan_depth   = state.get("scan_depth", DEFAULT_SCAN_DEPTH)

    print(f"Heartbeat v8 active")
    print(f"  Threshold: {idle_threshold}s | Cooldown: {cooldown_window:.0f}s ({cooldown_factor}x) | Poll: {check_interval}s | Rounds: {state.get('rounds_remaining')}")
    print(f"  Watchdog:  {watchdog_limit}s max per cycle | Min idle polls: {min_idle_polls}")
    if workspace:
        print(f"  Workspace: {workspace}")
    else:
        print(f"  Workspace: not set — filesystem activity signals disabled")
    if raw_exts:
        print(f"  Tracked exts: {', '.join(sorted(tracked_exts))}")
    print(f"  Scan depth: {scan_depth}")

    # Track across polls (not persisted — runner-local state)
    prev_activity_ts     = 0.0
    prev_activity_source = ""
    consecutive_idle     = 0
    first_iteration      = True  # skip sleep on first poll so agent gets output fast

    while True:
        cycle_start = time.monotonic()
        if first_iteration:
            first_iteration = False
            print(f"[heartbeat] Initial check (no sleep) — fires immediately if already idle.")
        else:
            time.sleep(check_interval)
        cycle_elapsed = time.monotonic() - cycle_start
        if cycle_elapsed > watchdog_limit:
            print(f"[WATCHDOG] Poll cycle took {cycle_elapsed:.0f}s (limit {watchdog_limit}s) — possible stall.")
            # Write watchdog event to state so report/status can surface it
            _state = read_state()
            if _state:
                wd_event = {
                    "at":           datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "cycle_secs":   round(cycle_elapsed),
                    "limit_secs":   round(watchdog_limit),
                    "turns":        _state.get("turns_taken", 0),
                }
                history = _state.get("watchdog_events", [])
                history.append(wd_event)
                _state["watchdog_events"] = history[-10:]
                try:
                    atomic_write(_state)
                except Exception:
                    pass

        state = read_state()
        if not state:
            print("ERROR: State file lost mid-session.")
            clear_active_flag()
            return

        if state.get("status") == "complete":
            print("Session explicitly completed. Heartbeat shutting down.")
            state["heartbeat_active"] = False
            atomic_write(state)
            return

        rounds_remaining = state.get("rounds_remaining", 0)
        if rounds_remaining <= 0:
            print("Rounds exhausted. Heartbeat shutting down.")
            print("  To continue: increase rounds at session start (--rounds N)")
            print("  or re-arm manually: phantom.py heartbeat-arm")
            state["heartbeat_active"] = False
            atomic_write(state)
            return

        now = datetime.now()
        ts  = now.strftime("%H:%M:%S")

        # Observe activity before any guards — so ETA is always written
        # even when agents are running or cooldown is active
        last_activity_ts, activity_source = get_last_activity(state, tracked_exts, scan_depth)
        if last_activity_ts > 0:
            activity_moved = (last_activity_ts - prev_activity_ts) >= check_interval * 0.5
            source_changed = activity_source != prev_activity_source
            if activity_moved or source_changed:
                prev_activity_ts     = last_activity_ts
                prev_activity_source = activity_source
                consecutive_idle     = 0  # new activity resets idle streak
                # ETA accounts for min_idle_polls: threshold + (polls-1)*interval
                extra_secs = max(0, min_idle_polls - 1) * check_interval
                fire_eta = datetime.fromtimestamp(last_activity_ts + idle_threshold + extra_secs)
                state["last_activity_source"] = activity_source
                state["last_activity_ts"]     = datetime.fromtimestamp(last_activity_ts).strftime("%Y-%m-%d %H:%M:%S")
                state["next_heartbeat_at"]    = fire_eta.strftime("%Y-%m-%d %H:%M:%S")
                atomic_write(state)

        # Guard 1: agents still running
        agents_running = state.get("agents_running", 0)
        if agents_running > 0:
            print(f"[{ts}] HOLD — {agents_running} agent(s) running.")
            continue

        # Guard 2: idle gap
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
            consecutive_idle = 0
            print(f"[{ts}] HOLD — active {gap:.0f}s ago (need {idle_threshold}s) [{activity_source}]")
            continue

        # Gap exceeded threshold — check consecutive idle requirement
        consecutive_idle += 1
        if consecutive_idle < min_idle_polls:
            print(f"[{ts}] HOLD — idle {gap:.0f}s ({consecutive_idle}/{min_idle_polls} polls) [{activity_source}]")
            continue

        # All guards passed — fire
        drift = gap - idle_threshold
        state["rounds_remaining"]     = max(0, rounds_remaining - 1)
        state["rounds_used"]          = state.get("rounds_used", 0) + 1
        state["last_heartbeat_fired"] = now.strftime("%Y-%m-%d %H:%M:%S")
        state["heartbeat_active"]     = False

        # Append to fire history (keep last 10)
        fire_event = {
            "fired_at":     now.strftime("%Y-%m-%d %H:%M:%S"),
            "signal":       activity_source,
            "gap_seconds":  round(gap),
            "idle_polls":   consecutive_idle,
            "turns":        state.get("turns_taken", 0),
        }
        history = state.get("heartbeat_fires", [])
        history.append(fire_event)
        state["heartbeat_fires"] = history[-10:]

        atomic_write(state)

        dg_active = state.get("drift_guard_active", False)
        dw        = state.get("drift_warning")

        rounds_used  = state.get("rounds_used", 0)
        rounds_total = rounds_used + state["rounds_remaining"]  # used + remaining = original
        # Session elapsed for marathon context
        session_elapsed = ""
        started = state.get("started", "")
        if started:
            try:
                delta = now - datetime.strptime(started, "%Y-%m-%d %H:%M:%S")
                m, s = divmod(int(delta.total_seconds()), 60)
                h, m = divmod(m, 60)
                session_elapsed = f" | session: {h}h {m}m"
            except Exception:
                pass
        print("=" * 54)
        print(f"  HEARTBEAT FIRED  (round {rounds_used}/{rounds_total})")
        print(f"  Idle:      {gap:.0f}s (threshold: {idle_threshold}s, drift: +{drift:.0f}s{session_elapsed})")
        print(f"  Polls:     {consecutive_idle} consecutive above threshold")
        print(f"  Signal:    {activity_source}")
        print(f"  Task:      {state.get('task', '—')}")
        print(f"  Progress:  {state.get('progress_note', 'none')}")
        print(f"  Turns:     {state.get('turns_taken')}/{state.get('turns_target')}")
        print(f"  Rounds left: {state['rounds_remaining']}")
        # Anchor re-orientation: show Point B goal + ALL criteria on every fire
        anchor_b = state.get("anchor_b") or {}
        if anchor_b:
            goal = anchor_b.get("goal", "")
            if goal:
                print(f"  ── Anchor B: {goal[:70]}{'...' if len(goal) > 70 else ''}")
            evaluated = eval_criteria_quick(state)
            met_count = sum(1 for _, done in evaluated if done)
            total = len(evaluated)
            if total > 0:
                print(f"  Criteria:  {met_count}/{total} met")
            for c, done in evaluated:
                mark = "x" if done else " "
                print(f"    [{mark}] {c}")
        if dg_active:
            print(f"  Drift Guard: ARMED (still running)")
        elif dw:
            print(f"  Drift Guard: idle  ⚠ WARNING PENDING — run drift-done")
        print("=" * 54)
        print("RESUME: phantom.py ping [note] → phantom.py anchor check → phantom.py heartbeat-arm")
        return


if __name__ == "__main__":
    main()
