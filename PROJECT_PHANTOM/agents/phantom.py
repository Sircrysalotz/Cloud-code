#!/usr/bin/env python3
"""
Phantom session manager v2.6. Single interface for all session state operations.
All writes are atomic (write-to-temp + rename) with a lock file to prevent races.

Session lifecycle:
  phantom.py start "task" [--turns N] [--rounds N] [--threshold N] [--interval N]
                          [--scope f1 f2] [--coverage-targets f1 f2]
                          [--scope-threshold N] [--min-idle-polls N]
                          [--profile NAME] [--force]
  phantom.py ping ["note"]          # call at start of every turn
  phantom.py status                 # rich session status panel
  phantom.py report                 # full session overview (fires, scope, watchdog)
  phantom.py history                # turn history and fire log
  phantom.py check                  # unified scope + coverage check
  phantom.py scope [--session]      # git diff horizontal balance
  phantom.py complete               # mark session done, print summary
  phantom.py save / restore         # persist/recover state across container restarts
  phantom.py recover                # clear stuck flags (heartbeat_active, agents_running)
  phantom.py reset                  # emergency: clear all state and lock files
  phantom.py env                    # environment check: paths, tools, session

Heartbeat and drift guard:
  phantom.py heartbeat-arm          # arm heartbeat; check exit code before spawning
  phantom.py drift-arm / drift-done # arm/read drift guard
  phantom.py drift-status           # show drift guard state and last warning

Worker sub-agents (NOT for heartbeat or drift guard):
  phantom.py agent-start [--id ID]
  phantom.py agent-done  [--id ID]

Profile management:
  phantom.py config create|list|show|set|delete [NAME] [flags]

Paths are self-located from __file__ — no hardcoded machine paths.
PHANTOM_STATE env var overrides the default state file (/tmp/phantom_session.json).
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime

_AGENTS_DIR  = os.path.dirname(os.path.abspath(__file__))
_PROJECT_DIR = os.path.dirname(_AGENTS_DIR)

def _find_repo_dir() -> str:
    """Find git repo root from this file's location; fall back to parent of project dir."""
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=_AGENTS_DIR, capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return os.path.dirname(_PROJECT_DIR)

REPO_DIR         = _find_repo_dir()
SAVED_STATE_FILE = os.path.join(_PROJECT_DIR, "logs", "last_session_state.json")
_SAVED_REL       = os.path.relpath(SAVED_STATE_FILE, REPO_DIR)
# Prefix used to normalize git diff paths (repo-relative) to project-relative.
# e.g. "PROJECT_PHANTOM/" — stripped so coverage targets match without full prefix.
_PROJECT_PREFIX  = os.path.relpath(_PROJECT_DIR, REPO_DIR) + os.sep

STATE_FILE = os.environ.get("PHANTOM_STATE", "/tmp/phantom_session.json")
TEMP_FILE  = STATE_FILE + ".tmp"
LOCK_FILE  = STATE_FILE.replace(".json", ".lock")
LOCK_TIMEOUT = 5  # seconds

PROFILES_FILE = os.environ.get(
    "PHANTOM_PROFILES",
    os.path.join(os.path.expanduser("~"), ".phantom_profiles.json")
)


def acquire_lock():
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
        print("WARNING: Could not acquire lock — another phantom.py may be writing. Proceeding anyway.")
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


def require_state() -> dict:
    state = read_state()
    if not state:
        print("ERROR: No active session. Run: phantom.py start \"task\"")
        sys.exit(1)
    return state


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def elapsed(started: str) -> str:
    try:
        delta = datetime.now() - datetime.strptime(started, "%Y-%m-%d %H:%M:%S")
        m, s = divmod(int(delta.total_seconds()), 60)
        h, m = divmod(m, 60)
        return f"{h}h {m}m {s}s"
    except Exception:
        return "unknown"


# --- Commands ---

def cmd_start(args):
    existing = read_state()
    if existing and not args.force:
        print("WARNING: Active session already exists.")
        print(f"  Task:    {existing.get('task', '?')}")
        print(f"  Started: {existing.get('started', '?')} ({elapsed(existing.get('started', now_str()))} ago)")
        print(f"  Turns:   {existing.get('turns_taken', 0)}/{existing.get('turns_target', '?')}")
        print()
        print("Use --force to overwrite, or continue the existing session.")
        sys.exit(1)

    # Load profile defaults, then let explicit CLI args override
    profile_defaults = {}
    if hasattr(args, "profile") and args.profile:
        profile_defaults = load_profile(args.profile)
        if profile_defaults is None:
            print(f"ERROR: Profile '{args.profile}' not found. Run: phantom.py config list")
            sys.exit(1)

    turns     = getattr(args, "turns",          None) or profile_defaults.get("turns",     10)
    rounds    = getattr(args, "rounds",         None) or profile_defaults.get("rounds",    5)
    threshold = getattr(args, "threshold",      None) or profile_defaults.get("threshold", 180)
    interval  = getattr(args, "interval",       None) or profile_defaults.get("interval",  30)
    cf        = getattr(args, "cooldown_factor",None) or profile_defaults.get("cooldown_factor", 1.0)

    # argparse gives defaults even when not specified — re-read raw to detect user overrides
    # Use profile value if CLI is at default AND profile has the key
    def resolve(cli_val, cli_default, profile_key, fallback):
        if args.profile and cli_val == cli_default and profile_key in profile_defaults:
            return profile_defaults[profile_key]
        return cli_val if cli_val != cli_default else fallback

    turns           = resolve(args.turns,          10,  "turns",           10)
    rounds          = resolve(args.rounds,          5,   "rounds",          5)
    threshold       = resolve(args.threshold,       180, "threshold",       180)
    interval        = resolve(args.interval,        30,  "interval",        30)
    cf              = resolve(args.cooldown_factor, 1.0, "cooldown_factor", 1.0)
    min_idle_polls  = resolve(getattr(args, "min_idle_polls",  1), 1, "min_idle_polls",  1)
    auto_save_every = resolve(getattr(args, "auto_save_every", None), None, "auto_save_every", 5)

    # Capture current HEAD so drift guard only checks this session's changes
    session_start_ref = None
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            session_start_ref = r.stdout.strip()
    except Exception:
        pass

    state = {
        "task":                   args.task,
        "last_active":            now_str(),
        "turns_taken":            0,
        "turns_target":           turns,
        "rounds_remaining":       rounds,
        "idle_threshold_seconds": threshold,
        "check_interval_seconds": interval,
        "cooldown_factor":        cf,
        "min_idle_polls":         min_idle_polls,
        "rounds_used":            0,
        "agents_running":         0,
        "active_agent_ids":       [],
        "heartbeat_active":       False,
        "last_heartbeat_fired":   None,
        "progress_note":          "",
        "started":                now_str(),
        "status":                 "active",
        "workspace_dir":          os.getcwd(),
        "profile":                args.profile if hasattr(args, "profile") and args.profile else None,
        "scope_files":        (getattr(args, "scope", None)
                              or profile_defaults.get("scope_files") or []),
        "coverage_targets":   (getattr(args, "coverage_targets", None)
                              or profile_defaults.get("coverage_targets") or []),
        "scope_threshold":    (getattr(args, "scope_threshold", None)
                              or profile_defaults.get("scope_threshold") or 50.0),
        "session_start_ref":  session_start_ref,
        "tracked_extensions": (getattr(args, "tracked_exts", None)
                              or profile_defaults.get("tracked_extensions") or []),
        "scan_depth":         (getattr(args, "scan_depth", None)
                              or profile_defaults.get("scan_depth") or 5),
        "auto_save_every":    auto_save_every,
        # runtime fields — initialized here so state is fully self-describing on start
        "drift_guard_active": False,
        "drift_warning":      None,
        "drift_warned_at":    None,
        "heartbeat_fires":    [],
        "watchdog_events":    [],
        "ping_log":           [],
        "last_activity_source": "ping",
        "last_activity_ts":   now_str(),
        "next_heartbeat_at":  None,
        "completed":          None,
        "saved_at":           None,
        # Anchor-based navigation — Point A (origin) and Point B (destination)
        "anchor_a": {
            "ref":       session_start_ref,
            "timestamp": now_str(),
        },
        "anchor_b": {
            "goal":          args.task,
            "done_criteria": getattr(args, "done_criteria", None) or [],
            "set_at":        now_str(),
        },
    }
    atomic_write(state)
    print(f"Session started.")
    if profile_defaults:
        print(f"  Profile:   {args.profile}")
    print(f"  Task:      {args.task}")
    print(f"  Turns:     {turns}")
    print(f"  Rounds:    {rounds}")
    print(f"  Threshold: {threshold}s ({threshold // 60}m {threshold % 60}s)")
    print(f"  Poll:      every {interval}s")
    print(f"  Workspace: {os.getcwd()}")
    if getattr(args, "tracked_exts", None):
        print(f"  Tracked:   {' '.join(args.tracked_exts)}")
    if getattr(args, "scan_depth", None):
        print(f"  ScanDepth: {args.scan_depth}")
    if getattr(args, "coverage_targets", None):
        print(f"  Coverage:  {' '.join(args.coverage_targets)}")
    st = state.get("scope_threshold", 50.0)
    if st != 50.0:
        print(f"  ScopeThreshold: {st:.0f}%")


def _quick_coverage(state: dict) -> str | None:
    """Return one-line coverage summary string, or None if no targets declared."""
    targets = state.get("coverage_targets") or state.get("scope_files") or []
    if not targets:
        return None
    session_ref = state.get("session_start_ref")
    diff_range = [session_ref, "HEAD"] if session_ref else ["HEAD~5", "HEAD"]
    try:
        r = subprocess.run(
            ["git", "diff", "--name-only"] + diff_range,
            cwd=REPO_DIR, capture_output=True, text=True, timeout=10
        )
        raw = set(r.stdout.strip().splitlines())
        changed = {(c[len(_PROJECT_PREFIX):] if c.startswith(_PROJECT_PREFIX) else c) for c in raw}
        def _hit(t):
            t = t.rstrip("/")
            return t in changed or any(c.startswith(t + "/") for c in changed)
        done = sum(1 for t in targets if _hit(t))
        pct = int(100 * done / len(targets))
        return f"{done}/{len(targets)} ({pct}%) — {'FULL COVERAGE' if done == len(targets) else 'incomplete'}"
    except Exception:
        return None


def print_session_summary(state: dict):
    print()
    print("=" * 54)
    print("  SESSION COMPLETE")
    print("=" * 54)
    print(f"  Task:      {state.get('task', '?')}")
    print(f"  Started:   {state.get('started', '?')}")
    print(f"  Finished:  {now_str()}")
    print(f"  Duration:  {elapsed(state.get('started', now_str()))}")
    print(f"  Turns:     {state.get('turns_taken')}/{state.get('turns_target')}")
    print(f"  HB rounds used: {state.get('rounds_used', '?')}")
    print(f"  Last note: {state.get('progress_note', '—')}")
    cov = _quick_coverage(state)
    if cov:
        print(f"  Coverage:  {cov}")
    dw = state.get("drift_warning")
    if dw:
        print()
        print(f"  ⚠ Unresolved drift warning — run 'drift-done' to review:")
        for line in dw.strip().splitlines()[:3]:
            print(f"    {line}")
    print("=" * 54)


def print_turn_milestone(state: dict):
    """Printed when turns_taken hits turns_target — session keeps running."""
    print()
    print("=" * 54)
    print("  TURN TARGET REACHED — keep working")
    print("=" * 54)
    print(f"  Task:      {state.get('task', '?')}")
    print(f"  Turns:     {state.get('turns_taken')}/{state.get('turns_target')} (target met)")
    print(f"  Elapsed:   {elapsed(state.get('started', now_str()))}")
    print(f"  HB rounds: {state.get('rounds_remaining', 0)} remaining")
    print(f"  Note:      {state.get('progress_note', '—')}")
    print()
    print("  Session is still ACTIVE. Call phantom.py complete to end it.")
    print("  Or keep pinging — turns beyond target are counted normally.")
    print("=" * 54)


def auto_save(state: dict):
    """Save state to git every AUTO_SAVE_EVERY pings."""
    AUTO_SAVE_EVERY = state.get("auto_save_every", 5)
    if state.get("turns_taken", 0) % AUTO_SAVE_EVERY == 0:
        state["saved_at"] = now_str()
        os.makedirs(os.path.dirname(SAVED_STATE_FILE), exist_ok=True)
        with open(SAVED_STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
        try:
            subprocess.run(["git", "add", _SAVED_REL],
                           cwd=REPO_DIR, capture_output=True, timeout=30)
            subprocess.run(["git", "commit", "-m",
                            f"[phantom] auto-save turn {state.get('turns_taken')}"],
                           cwd=REPO_DIR, capture_output=True, timeout=30)
            r = subprocess.run(["git", "push"], cwd=REPO_DIR, capture_output=True, timeout=30)
            if r.returncode == 0:
                print(f"  [auto-saved to git]")
            else:
                print(f"  [auto-save: local only — git push failed: {r.stderr.strip().decode(errors='replace') if r.stderr else 'unknown'}]")
        except Exception as e:
            print(f"  [auto-save failed — state written locally: {e}]")


def cmd_ping(args):
    state = require_state()
    state["last_active"]  = now_str()
    state["turns_taken"]  = state.get("turns_taken", 0) + 1
    if args.note:
        state["progress_note"] = args.note
        # Append to ping_log (last 20 entries)
        log_entry = {"turn": state["turns_taken"], "note": args.note, "at": state["last_active"]}
        ping_log = state.get("ping_log", [])
        ping_log.append(log_entry)
        state["ping_log"] = ping_log[-20:]
    tests_passed = getattr(args, "tests", None)
    if tests_passed is not None:
        state["tests_last_count"] = tests_passed
    atomic_write(state)
    agents      = state.get("agents_running", 0)
    rounds      = state.get("rounds_remaining", 0)
    elapsed_str = elapsed(state.get("started", now_str()))
    turns_taken = state["turns_taken"]
    turns_target = state.get("turns_target", "?")
    print(f"PING — Turn {turns_taken}/{turns_target} | Rounds left: {rounds} | Agents: {agents} | Elapsed: {elapsed_str}")
    if args.note:
        print(f"  Note: {args.note}")
    if tests_passed is not None:
        print(f"  Tests recorded: {tests_passed}")
    auto_save(state)
    if isinstance(turns_target, int) and turns_taken == turns_target:
        # Turn budget met — print milestone but keep session active
        # Only phantom.py complete ends the session
        print_turn_milestone(state)


def cmd_agent_start(args):
    state = require_state()
    state["agents_running"] = state.get("agents_running", 0) + 1
    if args.id:
        ids = state.get("active_agent_ids", [])
        ids.append(args.id)
        state["active_agent_ids"] = ids
    atomic_write(state)
    print(f"Agent registered. agents_running: {state['agents_running']}")
    if args.id:
        print(f"  ID: {args.id}")


def cmd_agent_done(args):
    state = require_state()
    current = state.get("agents_running", 0)
    if current <= 0:
        print("WARNING: agents_running is already 0 — possible agent-done called without matching agent-start.")
    state["agents_running"] = max(0, current - 1)
    if args.id:
        ids = state.get("active_agent_ids", [])
        if args.id in ids:
            ids.remove(args.id)
        else:
            print(f"WARNING: Agent ID '{args.id}' not found in active_agent_ids.")
        state["active_agent_ids"] = ids
    atomic_write(state)
    print(f"Agent completed. agents_running: {state['agents_running']}")


def cmd_heartbeat_arm(args):
    state = require_state()
    if state.get("heartbeat_active"):
        print("WARNING: Heartbeat already active. Not re-arming — skip spawn.")
        sys.exit(2)
    if state.get("rounds_remaining", 0) <= 0:
        print("No rounds remaining. Session complete — do not spawn heartbeat.")
        sys.exit(2)
    state["heartbeat_active"] = True
    atomic_write(state)
    rounds = state["rounds_remaining"]
    threshold = state.get("idle_threshold_seconds", 180)
    print(f"Heartbeat armed. Rounds remaining: {rounds}")
    # Show estimated fire time — use last_activity_ts (runner-observed) if available and more recent
    from datetime import timedelta
    last_active_str    = state.get("last_active", "")
    last_activity_str  = state.get("last_activity_ts", "")
    activity_source    = state.get("last_activity_source", "ping")
    # Pick whichever timestamp is more recent
    best_str = last_active_str
    if last_activity_str:
        try:
            la_ts = datetime.strptime(last_active_str, "%Y-%m-%d %H:%M:%S").timestamp() if last_active_str else 0
            act_ts = datetime.strptime(last_activity_str, "%Y-%m-%d %H:%M:%S").timestamp()
            if act_ts > la_ts:
                best_str = last_activity_str
        except Exception:
            pass
    if best_str:
        try:
            fire_dt = datetime.strptime(best_str, "%Y-%m-%d %H:%M:%S") + timedelta(seconds=threshold)
            remaining = (fire_dt - datetime.now()).total_seconds()
            src_tag = f"  [{activity_source}]" if activity_source else ""
            if remaining > 0:
                print(f"  Est. fire:  ~{remaining:.0f}s from now ({fire_dt.strftime('%H:%M:%S')}){src_tag}")
            else:
                print(f"  Est. fire:  overdue by {-remaining:.0f}s{src_tag}")
        except Exception:
            pass


def cmd_status(args):
    state = read_state()
    if not state:
        print("No active session.")
        return

    brief = getattr(args, "brief", False)
    if brief:
        # One-line compact summary: Turn | HB ETA | Coverage | Drift | Note
        turns    = f"T{state.get('turns_taken',0)}/{state.get('turns_target','?')}"
        rounds   = f"R{state.get('rounds_remaining',0)}"
        hb       = "HB:idle"
        if state.get("heartbeat_active"):
            nxt = state.get("next_heartbeat_at")
            if nxt:
                try:
                    secs = (datetime.strptime(nxt, "%Y-%m-%d %H:%M:%S") - datetime.now()).total_seconds()
                    hb = f"HB:~{max(0,int(secs))}s"
                except Exception:
                    hb = "HB:armed"
            else:
                hb = "HB:armed"
        cov  = _quick_coverage(state)
        cov_s = cov.split(" ")[0] if cov else "cov:?"
        drift = "⚠drift" if state.get("drift_warning") else "drift:ok"
        note  = (state.get("progress_note") or "—")[:40]
        print(f"[{state.get('status','?')}] {turns} {rounds} | {hb} | {cov_s} | {drift} | {note}")
        return

    # Rich status display
    started = state.get("started", "?")
    print("=" * 50)
    print("  PHANTOM SESSION STATUS")
    print("=" * 50)
    print(f"  Task:       {state.get('task', '?')}")
    print(f"  Status:     {state.get('status', '?')}")
    print(f"  Started:    {started} ({elapsed(started)} ago)")
    print(f"  Turns:      {state.get('turns_taken', 0)}/{state.get('turns_target', '?')}")
    print(f"  Rounds:     {state.get('rounds_remaining', 0)} remaining")
    print(f"  Threshold:  {state.get('idle_threshold_seconds', '?')}s")
    print(f"  Poll:       every {state.get('check_interval_seconds', 30)}s")
    print(f"  Agents:     {state.get('agents_running', 0)} running {state.get('active_agent_ids', [])}")

    # Heartbeat status with ETA and held-by signal
    if state.get("heartbeat_active"):
        next_fire_str = state.get("next_heartbeat_at")
        src           = state.get("last_activity_source", "")
        hb_line       = "ARMED"
        if next_fire_str:
            try:
                remaining = (datetime.strptime(next_fire_str, "%Y-%m-%d %H:%M:%S") - datetime.now()).total_seconds()
                if remaining > 0:
                    hb_line = f"ARMED — fires in ~{remaining:.0f}s"
                else:
                    hb_line = f"ARMED — overdue by {-remaining:.0f}s"
            except ValueError:
                pass
        if src:
            hb_line += f"  (held: {src})"
        print(f"  Heartbeat:  {hb_line}")
    else:
        print(f"  Heartbeat:  idle")

    # Drift guard status
    if state.get("drift_guard_active"):
        print(f"  Drift Guard: ARMED")
    else:
        dw = state.get("drift_warning")
        if dw:
            print(f"  Drift Guard: idle  ⚠ WARNING PENDING — run 'drift-done' to review")
        else:
            print(f"  Drift Guard: idle")

    print(f"  Last ping:  {state.get('last_active', '?')}")
    print(f"  Last fired: {state.get('last_heartbeat_fired', 'never')}")
    if state.get("min_idle_polls", 1) > 1:
        print(f"  Min polls:  {state.get('min_idle_polls')} consecutive idle polls required")
    print(f"  Progress:   {state.get('progress_note', '—')}")
    cov_targets = state.get("coverage_targets") or []
    scope_files = state.get("scope_files") or []
    if cov_targets:
        cov_line = _quick_coverage(state)
        print(f"  Coverage:  {cov_line or ' '.join(cov_targets)}")
    if scope_files:
        print(f"  Scope:     {' '.join(scope_files)}")
    tests_count = state.get("tests_last_count")
    if tests_count:
        print(f"  Tests:     {tests_count} (recorded via ping --tests)")

    # Pending drift warning block
    dw = state.get("drift_warning")
    if dw:
        print()
        print(f"  ⚠ DRIFT WARNING:")
        for line in dw.strip().splitlines():
            print(f"    {line}")

    fires = state.get("heartbeat_fires", [])
    if fires:
        print(f"  Fire log:   (last {len(fires)})")
        for ev in fires[-3:]:
            print(f"    {ev['fired_at']}  gap={ev['gap_seconds']}s  signal={ev['signal']}  turn={ev['turns']}")
    wdevents = state.get("watchdog_events", [])
    if wdevents:
        last_wd = wdevents[-1]
        print(f"  Watchdog:   {len(wdevents)} stall(s) — last: {last_wd['at']} ({last_wd['cycle_secs']}s cycle)")
    print("=" * 50)


def _soft_checkpoint(state: dict) -> list[str]:
    """Return list of checkpoint failures without side effects or exit calls."""
    issues = []
    last_active = state.get("last_active", "")
    threshold   = state.get("idle_threshold_seconds", 180)
    if last_active:
        try:
            age = (datetime.now() - datetime.strptime(last_active, "%Y-%m-%d %H:%M:%S")).total_seconds()
            if age > threshold * 0.75:
                issues.append(f"stale ping ({age:.0f}s since last ping)")
        except Exception:
            pass
    if state.get("drift_warning"):
        issues.append("unresolved drift warning")
    targets = state.get("coverage_targets") or []
    if targets:
        cov = _quick_coverage(state)
        if cov and int(cov.split("/")[0]) == 0:
            issues.append("zero coverage — no targets touched")
    return issues


def cmd_complete(args):
    state = require_state()
    # Soft pre-complete checkpoint — warn on issues but don't block
    issues = _soft_checkpoint(state)
    if issues:
        print("⚠  Pre-complete check found issues (run 'checkpoint' to review):")
        for iss in issues:
            print(f"    • {iss}")
        print()
    state["status"]    = "complete"
    state["completed"] = now_str()
    atomic_write(state)
    print_session_summary(state)


def cmd_save(args):
    """Persist current session state to git so it survives container restarts."""
    state = require_state()
    state["saved_at"] = now_str()
    os.makedirs(os.path.dirname(SAVED_STATE_FILE), exist_ok=True)
    with open(SAVED_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
    try:
        subprocess.run(["git", "add", _SAVED_REL],
                       cwd=REPO_DIR, capture_output=True, timeout=30)
        subprocess.run(["git", "commit", "-m",
                        f"[phantom] session state saved — turn {state.get('turns_taken')}"],
                       cwd=REPO_DIR, capture_output=True, timeout=30)
        result = subprocess.run(["git", "push"], cwd=REPO_DIR, capture_output=True, timeout=30)
        if result.returncode == 0:
            print(f"Session state saved and pushed to git.")
        else:
            print(f"State saved locally but push failed: {result.stderr.decode().strip()[:80]}")
    except Exception as e:
        print(f"State saved locally but git error: {e}")
    print(f"  Saved: {SAVED_STATE_FILE}")
    print(f"  Turn: {state.get('turns_taken')}/{state.get('turns_target')}")


def cmd_restore(args):
    """Restore session state from git-saved copy (use after container restart)."""
    if os.path.exists(STATE_FILE) and not args.force:
        print("WARNING: Active session state exists. Use --force to restore over it.")
        sys.exit(1)
    try:
        with open(SAVED_STATE_FILE) as f:
            state = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: No saved state found at {SAVED_STATE_FILE}")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"ERROR: Saved state file is corrupt.")
        sys.exit(1)
    saved_at = state.pop("saved_at", "unknown")
    state["heartbeat_active"]   = False  # always clear on restore — process is gone
    state["drift_guard_active"] = False  # same — drift guard process is gone
    state["agents_running"]     = 0
    state["active_agent_ids"]   = []
    atomic_write(state)
    print(f"Session restored from git save ({saved_at}).")
    print(f"  Task:  {state.get('task', '?')}")
    print(f"  Turns: {state.get('turns_taken', 0)}/{state.get('turns_target', '?')}")
    print(f"  Rounds remaining: {state.get('rounds_remaining', 0)}")
    if state.get("drift_warning"):
        print(f"  ⚠ Drift warning pending — run 'drift-done' to review")
    print("NOTE: heartbeat_active, drift_guard_active, and agents_running cleared. Re-arm before spawning.")


def cmd_scope(args):
    """Check git diff stats for horizontal balance — warns if one file dominates."""
    try:
        state = read_state()
        # Determine diff range — prefer session_start_ref for current-session view
        session_ref = state.get("session_start_ref") if state else None
        if args.session and session_ref:
            diff_range = [session_ref, "HEAD"]
            label = "this session"
        else:
            diff_range = [f"HEAD~{args.depth}", "HEAD"]
            label = f"last {args.depth} commits"

        result = subprocess.run(
            ["git", "diff", "--stat"] + diff_range,
            cwd=REPO_DIR, capture_output=True, text=True, timeout=15
        )
        if result.returncode != 0:
            print(f"git diff failed: {result.stderr.strip()}")
            return
        lines = [l for l in result.stdout.splitlines() if "|" in l]
        if not lines:
            print(f"No file changes found ({label}).")
            return
        # Filter auto-save state file (same as drift_guard v4 default ignore)
        _saved_rel = os.path.relpath(SAVED_STATE_FILE, REPO_DIR) if SAVED_STATE_FILE else ""
        totals = {}
        for line in lines:
            parts = line.split("|")
            fname = parts[0].strip()
            if _saved_rel and fname == _saved_rel:
                continue
            try:
                changes = int(parts[1].strip().split()[0])
                totals[fname] = changes
            except (IndexError, ValueError):
                pass
        if not totals:
            print(f"No file changes found ({label}) after filtering.")
            return
        grand_total = sum(totals.values()) or 1
        # Use session scope_threshold when CLI threshold is at default and session active
        cli_threshold = getattr(args, "threshold", 50.0)
        threshold = (state.get("scope_threshold", cli_threshold)
                     if state and cli_threshold == 50.0 else cli_threshold)
        print("=" * 50)
        print(f"  SCOPE CHECK ({label})")
        print("=" * 50)
        for fname, count in sorted(totals.items(), key=lambda x: -x[1]):
            pct = count / grand_total * 100
            bar = "█" * min(int(pct / 5), 20)
            warn = f" ⚠ CONCENTRATED" if pct > threshold else ""
            print(f"  {pct:4.0f}% {bar:<20} {count:4d} lines  {fname}{warn}")
        print("=" * 50)
        max_pct = max(totals.values()) / grand_total * 100 if totals else 0
        if max_pct > threshold:
            print(f"  WARNING: One file has {max_pct:.0f}% of changes (threshold {threshold}%) — possible vertical drift.")
        else:
            print(f"  OK: Changes distributed (max {max_pct:.0f}%, threshold {threshold}%).")
    except Exception as e:
        print(f"scope check error: {e}")


def cmd_history(args):
    state = read_state()
    if not state:
        print("No active session.")
        return
    print("=" * 50)
    print("  SESSION HISTORY")
    print("=" * 50)
    print(f"  Task:    {state.get('task', '?')}")
    print(f"  Started: {state.get('started', '?')}")
    print(f"  Elapsed: {elapsed(state.get('started', now_str()))}")
    print(f"  Turns:   {state.get('turns_taken', 0)}/{state.get('turns_target', '?')}")
    print(f"  HB rounds used: {state.get('rounds_used', 0)}")
    print(f"  Last note: {state.get('progress_note', '—')}")
    # Ping log
    ping_log = state.get("ping_log", [])
    if ping_log:
        print(f"\n  Ping log ({len(ping_log)} entries):")
        for entry in ping_log:
            print(f"    Turn {entry['turn']:3d}  {entry['at']}  {entry['note'][:60]}")
    fires = state.get("heartbeat_fires", [])
    if fires:
        print(f"\n  Heartbeat fires ({len(fires)} total):")
        for ev in fires:
            print(f"    {ev['fired_at']}  gap={ev['gap_seconds']}s  "
                  f"signal={ev['signal']}  idle_polls={ev.get('idle_polls', '?')}  turn={ev['turns']}")
    else:
        print(f"\n  Heartbeat fires: none yet")
    scope = state.get("scope_files", [])
    if scope:
        print(f"\n  Declared scope: {', '.join(scope)}")
    cov_line = _quick_coverage(state)
    if cov_line:
        print(f"  Coverage: {cov_line}")
    print("=" * 50)


def cmd_check(args):
    """Run scope + optional coverage check in one shot using session_start_ref."""
    state = read_state()
    if not state:
        print("No active session — cannot run session-anchored checks.")
        sys.exit(1)

    session_ref = state.get("session_start_ref")
    threshold = getattr(args, "threshold", 50)
    use_json = getattr(args, "json", False)
    diff_range = [session_ref, "HEAD"] if session_ref else ["HEAD~5", "HEAD"]

    # ── Scope analysis ──────────────────────────────────────────────────────
    scope_result = {"files": {}, "max_pct": 0.0, "clean": True, "error": None}
    try:
        r = subprocess.run(["git", "diff", "--stat"] + diff_range,
                           cwd=REPO_DIR, capture_output=True, text=True, timeout=15)
        lines = [l for l in r.stdout.splitlines() if "|" in l]
        if lines:
            for line in lines:
                parts = line.split("|")
                fname = parts[0].strip()
                if fname == _SAVED_REL:
                    continue  # filter auto-save file same as drift_guard/scope
                try:
                    scope_result["files"][fname] = int(parts[1].strip().split()[0])
                except (IndexError, ValueError):
                    pass
            grand = sum(scope_result["files"].values()) or 1
            scope_result["max_pct"] = max(scope_result["files"].values()) / grand * 100 if scope_result["files"] else 0
            scope_result["clean"] = scope_result["max_pct"] <= threshold
    except Exception as e:
        scope_result["error"] = str(e)

    # ── Coverage analysis ────────────────────────────────────────────────────
    coverage_targets = (
        getattr(args, "targets", None)
        or state.get("coverage_targets") or []
        or state.get("scope_files") or []
    )
    cov_result = {"targets": coverage_targets, "touched": [], "untouched": [],
                  "pct": 0.0, "full": False, "error": None}
    if coverage_targets:
        try:
            r2 = subprocess.run(["git", "diff", "--name-only"] + diff_range,
                                cwd=REPO_DIR, capture_output=True, text=True, timeout=15)
            raw2 = set(r2.stdout.strip().splitlines())
            changed = {(c[len(_PROJECT_PREFIX):] if c.startswith(_PROJECT_PREFIX) else c) for c in raw2}
            def _hit(t):
                t = t.rstrip("/")
                return t in changed or any(c.startswith(t + "/") for c in changed)
            cov_result["touched"]   = [t for t in coverage_targets if _hit(t)]
            cov_result["untouched"] = [t for t in coverage_targets if t not in cov_result["touched"]]
            n = len(coverage_targets)
            cov_result["pct"]  = 100.0 * len(cov_result["touched"]) / n if n else 0.0
            cov_result["full"] = len(cov_result["untouched"]) == 0
        except Exception as e:
            cov_result["error"] = str(e)

    # ── Output ───────────────────────────────────────────────────────────────
    if use_json:
        grand = sum(scope_result["files"].values()) or 1
        print(json.dumps({
            "task":         state.get("task", "?"),
            "turns":        state.get("turns_taken", 0),
            "turns_target": state.get("turns_target", "?"),
            "since":        session_ref or "HEAD~5",
            "scope": {
                "files": {f: round(c / grand * 100, 1)
                          for f, c in scope_result["files"].items()},
                "max_pct":   round(scope_result["max_pct"], 1),
                "threshold": threshold,
                "clean":     scope_result["clean"],
                "error":     scope_result["error"],
            },
            "coverage": {
                "targets":   coverage_targets,
                "touched":   cov_result["touched"],
                "untouched": cov_result["untouched"],
                "pct":       round(cov_result["pct"], 1),
                "full":      cov_result["full"],
                "error":     cov_result["error"],
            },
        }, indent=2))
        return

    sep = "=" * 56
    print(sep)
    print("  SESSION CHECK")
    print(sep)
    print(f"  Task:   {state.get('task', '?')}")
    print(f"  Turns:  {state.get('turns_taken', 0)}/{state.get('turns_target', '?')}")
    print(f"  Since:  {session_ref or 'HEAD~5'} (session_start_ref)")
    print()

    if scope_result["error"]:
        print(f"  SCOPE: error — {scope_result['error']}")
    elif scope_result["files"]:
        grand = sum(scope_result["files"].values()) or 1
        print(f"  SCOPE ({len(scope_result['files'])} files, {grand} lines):")
        for fname, cnt in sorted(scope_result["files"].items(), key=lambda x: -x[1])[:5]:
            pct = cnt / grand * 100
            bar = "█" * min(int(pct / 5), 20)
            warn = " ⚠" if pct > threshold else ""
            print(f"    {pct:4.0f}% {bar:<20} {cnt:4d}  {fname}{warn}")
        if not scope_result["clean"]:
            print(f"  ⚠ DRIFT RISK: one file has {scope_result['max_pct']:.0f}% of changes "
                  f"(threshold {threshold}%)")
        else:
            print(f"  ✓ SCOPE OK: max {scope_result['max_pct']:.0f}% (threshold {threshold}%)")
    else:
        print(f"  SCOPE: no changes since session start")
    print()

    if not coverage_targets:
        print(f"  COVERAGE: no targets declared (use --coverage-targets on start or --targets here)")
    elif cov_result["error"]:
        print(f"  COVERAGE: error — {cov_result['error']}")
    else:
        print(f"  COVERAGE ({len(cov_result['touched'])}/{len(coverage_targets)} targets, "
              f"{cov_result['pct']:.0f}%):")
        for t in cov_result["touched"]:
            print(f"    ✓  {t}")
        for t in cov_result["untouched"]:
            print(f"    ✗  {t}  ← not yet modified")
        if cov_result["untouched"]:
            print(f"  ⚠ INCOMPLETE: {len(cov_result['untouched'])} target(s) not yet touched")
        else:
            print(f"  ✓ FULL COVERAGE: all {len(coverage_targets)} targets touched")
    print(sep)


def cmd_recover(args):
    """Soft reset: clears stuck flags without touching task, turns, or history."""
    state = read_state()
    if not state:
        print("No active session to recover.")
        return
    cleared = []
    if state.get("heartbeat_active"):
        state["heartbeat_active"] = False
        cleared.append("heartbeat_active → False")
    if state.get("agents_running", 0) != 0:
        old_ids = state.get("active_agent_ids", [])
        state["agents_running"]   = 0
        state["active_agent_ids"] = []
        cleared.append(f"agents_running → 0  (cleared {old_ids})")
    elif state.get("active_agent_ids"):
        state["active_agent_ids"] = []
        cleared.append("active_agent_ids → []")
    if state.get("drift_guard_active"):
        state["drift_guard_active"] = False
        cleared.append("drift_guard_active → False")
    if cleared:
        atomic_write(state)
        print("Recovered — cleared stuck flags:")
        for c in cleared:
            print(f"  {c}")
        print(f"Task:  {state.get('task', '?')}")
        print(f"Turns: {state.get('turns_taken', 0)}/{state.get('turns_target', '?')}")
        print("Re-arm heartbeat/drift guard if needed.")
    else:
        print("No stuck flags found — session state looks clean.")
        print(f"  heartbeat_active: {state.get('heartbeat_active', False)}")
        print(f"  agents_running:   {state.get('agents_running', 0)}")
        print(f"  drift_guard_active: {state.get('drift_guard_active', False)}")


def cmd_report(args):
    """Print a full session report: overview, fire history, scope snapshot."""
    state = read_state()
    if not state:
        print("No active session.")
        return
    sep = "=" * 56
    print(sep)
    print("  SESSION REPORT")
    print(sep)
    print(f"  Task:    {state.get('task', '?')}")
    print(f"  Status:  {state.get('status', '?').upper()}")
    print(f"  Started: {state.get('started', '?')}")
    print(f"  Elapsed: {elapsed(state.get('started', now_str()))}")
    print(f"  Profile: {state.get('profile') or '(none)'}")
    print()

    turns_taken  = state.get("turns_taken", 0)
    turns_target = state.get("turns_target", "?")
    rounds_rem   = state.get("rounds_remaining", 0)
    rounds_used  = state.get("rounds_used", 0)
    print(f"  Turns:  {turns_taken}/{turns_target}  (budget floor — session stays active past target)")
    print(f"  Rounds: {rounds_used} used, {rounds_rem} remaining")
    print(f"  Last note: {state.get('progress_note', '—')}")

    # Ping log — last 5 entries in report
    ping_log = state.get("ping_log", [])
    if ping_log:
        print(f"\n  Recent pings (last {min(len(ping_log), 5)}):")
        for entry in ping_log[-5:]:
            print(f"    T{entry['turn']:3d}  {entry['at'][11:16]}  {entry['note'][:55]}")
    print()

    # Agent / heartbeat / drift guard state
    hb = "ARMED" if state.get("heartbeat_active") else "idle"
    ag = state.get("agents_running", 0)
    ag_ids = state.get("active_agent_ids", [])
    print(f"  Heartbeat: {hb}")
    if ag > 0:
        print(f"  Agents running: {ag}  ({', '.join(ag_ids) if ag_ids else 'unnamed'})")
    else:
        print(f"  Agents running: 0")
    # Drift guard
    if state.get("drift_guard_active"):
        print(f"  Drift Guard: ARMED")
    else:
        dw = state.get("drift_warning")
        if dw:
            print(f"  Drift Guard: idle  ⚠ WARNING PENDING")
        else:
            print(f"  Drift Guard: idle")

    # ETA
    next_hb = state.get("next_heartbeat_at")
    if next_hb and state.get("heartbeat_active"):
        try:
            eta_dt = datetime.strptime(next_hb, "%Y-%m-%d %H:%M:%S")
            secs = (eta_dt - datetime.now()).total_seconds()
            if secs > 0:
                print(f"  Next heartbeat: ~{int(secs)}s ({state.get('last_activity_source', '?')})")
            else:
                print(f"  Next heartbeat: overdue by {int(-secs)}s")
        except Exception:
            print(f"  Next heartbeat: {next_hb}")
    print()

    # Fire history
    fires = state.get("heartbeat_fires", [])
    if fires:
        print(f"  Heartbeat fires ({len(fires)}):")
        for ev in fires:
            print(f"    {ev['fired_at']}  gap={ev['gap_seconds']}s  "
                  f"signal={ev['signal']}  polls={ev.get('idle_polls', '?')}  turn={ev['turns']}")
    else:
        print(f"  Heartbeat fires: none")
    print()

    # Scope snapshot (this session)
    session_ref = state.get("session_start_ref")
    if session_ref:
        try:
            result = subprocess.run(
                ["git", "diff", "--stat", session_ref, "HEAD"],
                cwd=REPO_DIR, capture_output=True, text=True, timeout=10
            )
            lines = [l for l in result.stdout.splitlines() if "|" in l]
            if lines:
                totals = {}
                for line in lines:
                    parts = line.split("|")
                    fname = parts[0].strip()
                    try:
                        totals[fname] = int(parts[1].strip().split()[0])
                    except (IndexError, ValueError):
                        pass
                grand = sum(totals.values()) or 1
                print(f"  Scope (this session — {len(totals)} files changed):")
                for fname, cnt in sorted(totals.items(), key=lambda x: -x[1]):
                    pct = cnt / grand * 100
                    bar = "█" * min(int(pct / 5), 20)
                    print(f"    {pct:4.0f}% {bar:<20} {cnt:4d}  {fname}")
            else:
                print(f"  Scope: no changes since session start")
        except Exception as e:
            print(f"  Scope: error — {e}")

    declared = state.get("scope_files", [])
    if declared:
        print(f"\n  Declared scope: {', '.join(declared)}")

    # Coverage summary
    cov_targets = state.get("coverage_targets") or []
    cov_display = cov_targets or declared
    if cov_display:
        source = "coverage_targets" if cov_targets else "scope_files"
        cov_line = _quick_coverage(state)
        print(f"\n  Coverage ({source}): {cov_line or '?'}")
        for t in cov_display:
            print(f"    {t}")

    # Pending drift warning (full text)
    dw = state.get("drift_warning")
    if dw:
        print(f"\n  ⚠ DRIFT WARNING (run 'drift-done' to review):")
        for line in dw.strip().splitlines():
            print(f"    {line}")

    # Watchdog events
    wdevents = state.get("watchdog_events", [])
    if wdevents:
        print(f"\n  Watchdog stalls ({len(wdevents)}):")
        for ev in wdevents:
            print(f"    {ev['at']}  cycle={ev['cycle_secs']}s (limit {ev['limit_secs']}s)  turn={ev['turns']}")

    # Scan config
    exts = state.get("tracked_extensions")
    if exts:
        print(f"\n  Tracked exts: {' '.join(sorted(exts))}")
    depth = state.get("scan_depth", 5)
    if depth != 5:
        print(f"  Scan depth: {depth}")
    print(sep)


def cmd_env(args):
    """Print resolved environment paths and tool availability — useful for verifying portability."""
    import shutil
    ok   = lambda msg: print(f"  [OK]   {msg}")
    warn = lambda msg: print(f"  [WARN] {msg}")

    print("=== PHANTOM Environment ===")

    # Paths
    logs_dir = os.path.join(_PROJECT_DIR, "logs")
    print("Paths:")
    print(f"  agents_dir:  {_AGENTS_DIR}")
    print(f"  project_dir: {_PROJECT_DIR}")
    print(f"  repo_dir:    {REPO_DIR}")
    print(f"  state_file:  {STATE_FILE}")
    print(f"  profiles:    {PROFILES_FILE}")
    print(f"  logs_dir:    {logs_dir}")

    # Tools
    print("Tools:")
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    ok(f"python3 {py_ver}")
    if shutil.which("git"):
        try:
            gv = subprocess.check_output(["git", "--version"], text=True).strip()
            ok(gv)
        except Exception:
            ok("git (version unknown)")
    else:
        warn("git not found")

    # Directories
    print("Directories:")
    for label, path in [("logs_dir", logs_dir), ("agents_dir", _AGENTS_DIR)]:
        if os.path.isdir(path):
            ok(f"{label} exists")
        else:
            warn(f"{label} missing: {path}")

    # Session state
    print("Session:")
    state = read_state()
    if state:
        ok(f"active — task: {state.get('task', '?')[:60]}")
        ok(f"turns {state.get('turns_taken',0)}/{state.get('turns_target',0)} | rounds {state.get('rounds_remaining',0)} remaining")
    else:
        warn("no active session (run 'phantom.py start' to begin)")

    print("===========================")


def cmd_reset(args):
    for f in [STATE_FILE, TEMP_FILE, LOCK_FILE]:
        try:
            os.unlink(f)
            print(f"Removed: {f}")
        except FileNotFoundError:
            pass
    print("Reset complete.")


def cmd_drift_arm(args):
    state = require_state()
    if state.get("drift_guard_active"):
        print("WARNING: Drift guard already active.")
        sys.exit(2)
    state["drift_guard_active"] = True
    state["drift_warning"]      = None
    atomic_write(state)
    threshold  = state.get("scope_threshold", 50.0)
    scope      = state.get("scope_files", [])
    since      = state.get("session_start_ref", "auto")
    print(f"Drift guard armed.")
    print(f"  Threshold: {threshold}% | Since: {since[:12] if since != 'auto' else 'auto'}")
    if scope:
        print(f"  Scope:     {' '.join(scope)}")


def cmd_drift_done(args):
    """Call after drift guard sub-agent returns to read its findings."""
    state = require_state()
    state["drift_guard_active"] = False
    warning = state.get("drift_warning")
    atomic_write(state)
    if warning:
        print("=" * 54)
        print(warning)
        print("=" * 54)
        print("Re-arm after spreading changes: phantom.py drift-arm")
        sys.exit(1)
    else:
        print("Drift guard returned — no drift detected.")


def cmd_drift_status(args):
    state = read_state()
    if not state:
        print("No active session.")
        return
    active  = state.get("drift_guard_active", False)
    warning = state.get("drift_warning")
    warned_at = state.get("drift_warned_at", "")
    print(f"Drift guard: {'ARMED' if active else 'idle'}")
    if warning:
        print(f"Last warning ({warned_at}):")
        print(warning)
    else:
        print("No drift warnings.")


# --- Anchor system ---

def _eval_criteria(state: dict) -> list[tuple[str, bool]]:
    """
    Evaluate each done criterion against observable session state.
    Returns list of (criterion_text, is_done) pairs.

    Heuristics (simple keyword matching against measurable signals):
      - "coverage" + fraction → check _quick_coverage() for full coverage
      - "tests pass" / "passing" → not checkable live; always False (needs manual verify)
      - "all" + "pass" / "complete" → not checkable; False
      - anything else → False (unknown, needs manual verify)
    """
    criteria = (state.get("anchor_b") or {}).get("done_criteria") or []
    results = []
    cov_str = _quick_coverage(state)
    full_cov = cov_str is not None and "FULL COVERAGE" in cov_str

    anchor_checks = state.get("anchor_checks_count", 0)
    hb_fires      = len(state.get("heartbeat_fires", []))
    import re as _re

    for c in criteria:
        c_lower = c.lower()
        done = False
        # Coverage criterion: "coverage 4/4", "full coverage", "coverage complete"
        if "coverage" in c_lower:
            done = full_cov
        # Drift criterion: "drift clean", "no drift"
        elif "drift" in c_lower and ("clean" in c_lower or "no" in c_lower):
            done = not bool(state.get("drift_warning"))
        # Anchor check criterion: "anchor check used"
        elif "anchor check" in c_lower:
            done = anchor_checks > 0
        # Checkpoint criterion: "checkpoint used", "checkpoint before completion"
        elif "checkpoint" in c_lower and ("used" in c_lower or "before" in c_lower or "run" in c_lower):
            done = state.get("checkpoint_calls_count", 0) > 0
        # Heartbeat observed: "observed ... heartbeat fire", "heartbeat fire"
        elif "heartbeat fire" in c_lower or ("heartbeat" in c_lower and "fire" in c_lower):
            m = _re.search(r'(\d+)', c)
            needed = int(m.group(1)) if m else 1
            done = hb_fires >= needed
        # Tests passing: "N+ tests passing", "N tests pass"
        elif "test" in c_lower and ("pass" in c_lower or "passing" in c_lower):
            last_count = state.get("tests_last_count", 0)
            m = _re.search(r'(\d+)', c)
            if m and last_count > 0:
                done = last_count >= int(m.group(1))
        results.append((c, done))
    return results


def cmd_anchor(args):
    """Anchor-based navigation: Point A (origin) never changes, Point B (goal) is the target."""
    sub   = args.anchor_cmd
    state = require_state()
    sep   = "=" * 56

    if sub == "show":
        a = state.get("anchor_a", {})
        b = state.get("anchor_b", {})
        print(sep)
        print("  ANCHORS")
        print(sep)
        print(f"  Point A (origin):")
        ref = a.get("ref", "")
        print(f"    Ref:       {ref[:16] if ref else '?'}")
        print(f"    Timestamp: {a.get('timestamp', '?')}")
        print(f"  Point B (destination):")
        print(f"    Goal:      {b.get('goal', '?')}")
        criteria = b.get("done_criteria") or []
        if criteria:
            print(f"    Done when:")
            evaluated = _eval_criteria(state)
            for c, done in evaluated:
                mark = "x" if done else " "
                print(f"      [{mark}] {c}")
        else:
            print(f"    Done when: (not set — use 'anchor set-goal --criteria ...' to define)")
        print(f"    Set at:    {b.get('set_at', '?')}")
        print(f"  Current position:")
        print(f"    Turns:    {state.get('turns_taken', 0)}/{state.get('turns_target', '?')}")
        cov = _quick_coverage(state)
        print(f"    Coverage: {cov or '(none)'}")
        print(f"    Note:     {state.get('progress_note', '—')}")
        print(sep)

    elif sub == "check":
        # Increment usage counter so _eval_criteria can auto-mark "anchor check used"
        state["anchor_checks_count"] = state.get("anchor_checks_count", 0) + 1
        atomic_write(state)

        a = state.get("anchor_a", {})
        b = state.get("anchor_b", {})
        print(sep)
        print("  ANCHOR REORIENTATION CHECK")
        print(sep)
        ref = a.get("ref", "")
        print(f"  ORIGIN  (A): {a.get('timestamp', '?')}")
        print(f"               ref {ref[:16] if ref else '?'}")
        print()
        print(f"  GOAL    (B): {b.get('goal', '?')}")
        criteria = b.get("done_criteria") or []
        if criteria:
            print(f"  Done criteria:")
            evaluated = _eval_criteria(state)
            done_count = sum(1 for _, d in evaluated if d)
            for c, done in evaluated:
                mark = "x" if done else " "
                print(f"    [{mark}] {c}")
            print(f"  Progress: {done_count}/{len(criteria)} criteria verifiably met")
        print()
        print(f"  CURRENT:")
        print(f"    Turn:     {state.get('turns_taken', 0)}/{state.get('turns_target', '?')}")
        print(f"    Elapsed:  {elapsed(state.get('started', now_str()))}")
        cov = _quick_coverage(state)
        if cov:
            print(f"    Coverage: {cov}")
        dw = state.get("drift_warning")
        print(f"    Drift:    {'⚠ WARNING PENDING' if dw else 'clean'}")
        print(f"    Note:     {state.get('progress_note', '—')}")
        print()
        print(f"  Verify: does current note/coverage still point toward Point B?")
        print(sep)

    elif sub == "set-goal":
        b = state.get("anchor_b", {})
        new_goal     = getattr(args, "goal", None)
        new_criteria = getattr(args, "criteria", None) or []
        if new_goal:
            b["goal"] = new_goal
        if new_criteria:
            b["done_criteria"] = new_criteria
        b["set_at"] = now_str()
        state["anchor_b"] = b
        atomic_write(state)
        print(f"Anchor B updated.")
        print(f"  Goal:     {b.get('goal', '?')}")
        if b.get("done_criteria"):
            print(f"  Criteria: {'; '.join(b['done_criteria'])}")


# --- Checkpoint system ---

def cmd_checkpoint(args):
    """Run non-negotiable gate checks. Exits 1 if any gate fails."""
    state         = require_state()
    # Track usage so _eval_criteria can auto-mark "checkpoint used" criteria
    state["checkpoint_calls_count"] = state.get("checkpoint_calls_count", 0) + 1
    atomic_write(state)

    gate_mode     = getattr(args, "gate", False)
    require_full  = getattr(args, "require_full_coverage", False)
    failures: list[str] = []
    warnings: list[str] = []

    # Gate 1 — ping freshness (last ping within 75% of idle threshold)
    last_active = state.get("last_active", "")
    threshold   = state.get("idle_threshold_seconds", 180)
    if last_active:
        try:
            age = (datetime.now() - datetime.strptime(last_active, "%Y-%m-%d %H:%M:%S")).total_seconds()
            limit = threshold * 0.75
            if age > limit:
                failures.append(
                    f"Stale ping: {age:.0f}s since last ping (limit {limit:.0f}s) — ping before proceeding"
                )
        except Exception:
            pass

    # Gate 2 — no unresolved drift warning
    dw = state.get("drift_warning")
    if dw:
        failures.append("Unresolved drift warning — run 'drift-done', spread changes, then re-arm")

    # Gate 3 — scope concentration (hard failure in --gate mode, warning otherwise)
    scope_threshold = state.get("scope_threshold", 50.0)
    session_ref     = state.get("session_start_ref")
    if session_ref:
        try:
            r = subprocess.run(
                ["git", "diff", "--stat", session_ref, "HEAD"],
                cwd=REPO_DIR, capture_output=True, text=True, timeout=10
            )
            lines = [l for l in r.stdout.splitlines() if "|" in l]
            if lines:
                _saved_rel = os.path.relpath(SAVED_STATE_FILE, REPO_DIR) if SAVED_STATE_FILE else ""
                totals: dict[str, int] = {}
                for line in lines:
                    parts = line.split("|")
                    fname = parts[0].strip()
                    if _saved_rel and fname == _saved_rel:
                        continue
                    try:
                        totals[fname] = int(parts[1].strip().split()[0])
                    except (IndexError, ValueError):
                        pass
                grand   = sum(totals.values()) or 1
                max_pct = max(totals.values()) / grand * 100
                top_f   = max(totals, key=totals.get)
                if max_pct > scope_threshold:
                    msg = (f"Scope drift: '{top_f}' has {max_pct:.0f}% of changes "
                           f"(threshold {scope_threshold:.0f}%)")
                    (failures if gate_mode else warnings).append(msg)
        except Exception as exc:
            warnings.append(f"Scope check error: {exc}")

    # Gate 4 — coverage (blocks only when --require-full-coverage or zero coverage with targets)
    targets = state.get("coverage_targets") or []
    if targets:
        cov = _quick_coverage(state)
        if cov:
            done_count = int(cov.split("/")[0])
            if done_count == 0:
                failures.append(f"Coverage zero: none of {len(targets)} target(s) touched yet")
            elif require_full and done_count < len(targets):
                failures.append(
                    f"Coverage incomplete: {cov} — touch all targets before completing"
                )

    # Print results
    sep = "=" * 54
    print(sep)
    print("  CHECKPOINT")
    print(sep)
    print(f"  Task:  {state.get('task', '?')[:60]}")
    print(f"  Turns: {state.get('turns_taken', 0)}/{state.get('turns_target', '?')}")
    print()

    all_ok = not failures
    if failures:
        print(f"  BLOCKED ({len(failures)} gate(s) failed):")
        for f in failures:
            print(f"    ✗ {f}")
    if warnings:
        print(f"  Warnings ({len(warnings)}):")
        for w in warnings:
            print(f"    ⚠ {w}")
    if all_ok and not warnings:
        print(f"  ✓ All gates passed — good to continue.")
    elif all_ok:
        print(f"  ✓ Gates passed (warnings noted above).")
    else:
        print()
        print(f"  Fix the failures above before proceeding.")
    print(sep)

    if not all_ok:
        sys.exit(1)


# --- Profile system ---

PROFILE_KEYS = {
    "turns":             (int,   10,  "Target number of turns"),
    "rounds":            (int,   5,   "Heartbeat rounds available"),
    "threshold":         (int,   180, "Idle threshold in seconds"),
    "interval":          (int,   30,  "Heartbeat poll interval in seconds"),
    "cooldown_factor":   (float, 1.0, "Cooldown multiplier"),
    "min_idle_polls":    (int,   1,   "Consecutive idle polls before heartbeat fires"),
    "scope_threshold":   (float, 50.0,"Drift guard threshold % (last-resort gate)"),
    "scope_files":       (list,  [],  "Declared focus files for drift guard"),
    "coverage_targets":  (list,  [],  "Files to track for coverage"),
    "tracked_extensions":(list,  [],  "File extensions to watch for activity (empty = all defaults)"),
    "scan_depth":        (int,   5,   "Max workspace scan depth"),
    "auto_save_every":   (int,   5,   "Ping interval between git auto-saves"),
    "description":       (str,   "",  "Human-readable profile description"),
}


# Built-in profile presets — available without creating a profiles file.
# User-created profiles with the same name take precedence.
BUILTIN_PROFILES = {
    "sprint": {
        "description": "Fast iteration — short sessions with quick heartbeat cycles",
        "turns": 10,
        "rounds": 5,
        "threshold": 120,
        "interval": 20,
        "cooldown_factor": 0.5,
        "min_idle_polls": 1,
    },
    "marathon": {
        "description": "Long autonomous run — conservative heartbeat, many rounds",
        "turns": 30,
        "rounds": 12,
        "threshold": 180,
        "interval": 30,
        "cooldown_factor": 1.0,
        "min_idle_polls": 2,
    },
    "debug": {
        "description": "Short cycles for testing and debugging the phantom system",
        "turns": 5,
        "rounds": 3,
        "threshold": 60,
        "interval": 10,
        "cooldown_factor": 0.5,
        "min_idle_polls": 1,
    },
    "focus": {
        "description": "Deep single-task focus — strict drift guard, long threshold",
        "turns": 20,
        "rounds": 8,
        "threshold": 240,
        "interval": 30,
        "cooldown_factor": 1.5,
        "min_idle_polls": 2,
        "scope_threshold": 30.0,
    },
}


def read_profiles() -> dict:
    try:
        with open(PROFILES_FILE) as f:
            data = json.load(f)
            return data.get("profiles", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_profiles(profiles: dict):
    os.makedirs(os.path.dirname(os.path.abspath(PROFILES_FILE)), exist_ok=True)
    with open(PROFILES_FILE, "w") as f:
        json.dump({"profiles": profiles}, f, indent=2)


def load_profile(name: str) -> dict | None:
    """User profile takes precedence over built-in; returns None if not found anywhere."""
    profiles = read_profiles()
    if name in profiles:
        return profiles[name]
    return BUILTIN_PROFILES.get(name)


def cmd_config(args):
    sub = args.config_cmd

    if sub == "list":
        profiles = read_profiles()
        print(f"Built-in profiles (always available):")
        for name, p in BUILTIN_PROFILES.items():
            marker = " (overridden by user)" if name in profiles else ""
            desc = p.get("description", "")
            turns = p.get("turns", "—")
            threshold = p.get("threshold", "—")
            print(f"  {name:<20} turns={turns} threshold={threshold}s  {desc}{marker}")
        if profiles:
            print(f"\nUser profiles ({PROFILES_FILE}):")
            for name, p in profiles.items():
                desc = p.get("description", "")
                turns = p.get("turns", "—")
                threshold = p.get("threshold", "—")
                print(f"  {name:<20} turns={turns} threshold={threshold}s  {desc}")
        else:
            print(f"\nNo user profiles. Create one: phantom.py config create <name>")

    elif sub == "show":
        profiles = read_profiles()
        name = args.name
        p = profiles.get(name) or BUILTIN_PROFILES.get(name)
        if p is None:
            print(f"Profile '{name}' not found.")
            sys.exit(1)
        is_builtin = name not in profiles
        print(f"Profile: {name}{'  [built-in]' if is_builtin else f'  [{PROFILES_FILE}]'}")
        for key, (typ, default, desc) in PROFILE_KEYS.items():
            val = p.get(key, default)
            print(f"  {key:<20} = {val!r:<20}  # {desc}")

    elif sub == "create":
        profiles = read_profiles()
        name = args.name
        if name in profiles and not getattr(args, "force", False):
            print(f"Profile '{name}' already exists. Use --force to overwrite.")
            sys.exit(1)
        p = {}
        for key, (typ, default, _) in PROFILE_KEYS.items():
            val = getattr(args, key.replace("-", "_"), None)
            if val is not None:
                p[key] = val
            elif key in profiles.get(name, {}):
                p[key] = profiles[name][key]
        profiles[name] = p
        write_profiles(profiles)
        print(f"Profile '{name}' created.")
        for k, v in p.items():
            print(f"  {k} = {v!r}")
        print(f"  Saved: {PROFILES_FILE}")

    elif sub == "set":
        profiles = read_profiles()
        name = args.name
        if name not in profiles:
            print(f"Profile '{name}' not found. Create it first: phantom.py config create {name}")
            sys.exit(1)
        key = args.key
        if key not in PROFILE_KEYS:
            print(f"Unknown key '{key}'. Valid keys: {', '.join(PROFILE_KEYS)}")
            sys.exit(1)
        typ, _, _ = PROFILE_KEYS[key]
        try:
            if typ == list:
                import ast
                val = ast.literal_eval(args.value)
            else:
                val = typ(args.value)
        except (ValueError, SyntaxError):
            print(f"Invalid value for '{key}' (expected {typ.__name__}): {args.value!r}")
            sys.exit(1)
        profiles[name][key] = val
        write_profiles(profiles)
        print(f"Profile '{name}': {key} = {val!r}")

    elif sub == "delete":
        profiles = read_profiles()
        name = args.name
        if name not in profiles:
            print(f"Profile '{name}' not found.")
            sys.exit(1)
        del profiles[name]
        write_profiles(profiles)
        print(f"Profile '{name}' deleted.")


# --- CLI ---

parser = argparse.ArgumentParser(description="Phantom session manager v2")
sub = parser.add_subparsers(dest="cmd", required=True)

p = sub.add_parser("start", help="Initialize a new session")
p.add_argument("task", help="Description of what Claude is working on")
p.add_argument("--turns",     type=int, default=10,  help="Target number of turns")
p.add_argument("--rounds",    type=int, default=5,   help="Heartbeat rounds available")
p.add_argument("--threshold", type=int, default=180, help="Idle threshold in seconds")
p.add_argument("--interval",        type=int,   default=30,  help="Heartbeat poll interval in seconds")
p.add_argument("--cooldown-factor",  type=float, default=1.0, help="Cooldown = threshold * factor (default 1.0)")
p.add_argument("--min-idle-polls",   type=int,   default=1,   dest="min_idle_polls",
               help="Consecutive polls above threshold required before heartbeat fires (default 1)")
p.add_argument("--profile",          default=None,            help="Load defaults from named profile (overridable by flags)")
p.add_argument("--scope",   nargs="+", default=None,          help="Declared focus files for drift guard (e.g. --scope auth.py crypto.py)")
p.add_argument("--coverage-targets", nargs="+", default=None, dest="coverage_targets",
               help="Files/dirs to track for coverage in 'check' command")
p.add_argument("--scope-threshold", type=float, default=None, dest="scope_threshold",
               help="Drift guard scope threshold %% (default 50)")
p.add_argument("--tracked-exts", nargs="+", default=None, dest="tracked_exts",
               help="File extensions to watch for activity signals (e.g. --tracked-exts .py .ts)")
p.add_argument("--scan-depth",      type=int, default=None, dest="scan_depth",
               help="Max directory depth for workspace file scan (default 5)")
p.add_argument("--auto-save-every", type=int, default=None, dest="auto_save_every",
               help="Ping interval between git auto-saves (default 5)")
p.add_argument("--done-criteria", nargs="+", default=None, dest="done_criteria",
               help="Completion criteria for anchor Point B (e.g. 'all tests pass' 'coverage 4/4')")
p.add_argument("--force",            action="store_true",     help="Overwrite existing session")

p = sub.add_parser("config", help="Manage session profiles")
p.add_argument("config_cmd", choices=["list", "show", "create", "set", "delete"])
p.add_argument("name",  nargs="?", default=None, help="Profile name")
p.add_argument("key",   nargs="?", default=None, help="Key to set (for 'set' subcommand)")
p.add_argument("value", nargs="?", default=None, help="Value (for 'set' subcommand)")
p.add_argument("--description",     default=None, help="Profile description")
p.add_argument("--turns",           type=int,   default=None)
p.add_argument("--rounds",          type=int,   default=None)
p.add_argument("--threshold",       type=int,   default=None)
p.add_argument("--interval",        type=int,   default=None)
p.add_argument("--cooldown-factor", type=float, default=None, dest="cooldown_factor")
p.add_argument("--min-idle-polls",  type=int,   default=None, dest="min_idle_polls")
p.add_argument("--scope-threshold", type=float, default=None, dest="scope_threshold")
p.add_argument("--scope-files",     nargs="+",  default=None, dest="scope_files")
p.add_argument("--coverage-targets",nargs="+",  default=None, dest="coverage_targets")
p.add_argument("--tracked-exts",    nargs="+",  default=None, dest="tracked_extensions")
p.add_argument("--scan-depth",      type=int,   default=None, dest="scan_depth")
p.add_argument("--auto-save-every", type=int,   default=None, dest="auto_save_every")
p.add_argument("--force", action="store_true", help="Overwrite existing profile")

p = sub.add_parser("ping", help="Signal active turn (run at start of every turn)")
p.add_argument("note", nargs="?", default="", help="Optional progress note")
p.add_argument("--tests", type=int, default=None, metavar="N",
               help="Record test pass count (used by criteria eval)")

p = sub.add_parser("agent-start", help="Register a spawned sub-agent")
p.add_argument("--id", default="", help="Optional agent identifier")

p = sub.add_parser("agent-done", help="Mark a sub-agent as returned")
p.add_argument("--id", default="", help="Optional agent identifier")

sub.add_parser("heartbeat-arm", help="Arm the heartbeat before spawning")
p = sub.add_parser("status",    help="Print rich session status")
p.add_argument("--brief", action="store_true", help="One-line compact summary")
sub.add_parser("complete",      help="Mark session complete and print summary")
sub.add_parser("history",       help="Print session history and progress")

p = sub.add_parser("scope",   help="Check git diff for horizontal balance (anti-drift)")
p.add_argument("--depth",     type=int,   default=5,    help="Number of commits to check (default 5)")
p.add_argument("--threshold", type=float, default=50.0, help="%% concentration that triggers warning (default 50)")
p.add_argument("--session",   action="store_true",      help="Use session_start_ref as base (only this session)")

p = sub.add_parser("save",    help="Persist session state to git (survives container restart)")
p = sub.add_parser("restore", help="Restore session state from git save")
p.add_argument("--force", action="store_true", help="Restore even if active session exists")

sub.add_parser("reset",         help="Emergency cleanup of all state/lock files")
sub.add_parser("recover",       help="Clear stuck flags (heartbeat_active, agents_running) without full reset")
sub.add_parser("report",        help="Full session report: overview, fires, scope snapshot")

p = sub.add_parser("check", help="Unified scope + coverage check anchored to session_start_ref")
p.add_argument("--threshold", type=int, default=50,
               help="Warn when one file exceeds this %% of changes (default: 50)")
p.add_argument("--targets", nargs="+", default=None,
               help="Coverage targets (files/dirs); defaults to scope_files in state")
p.add_argument("--json", action="store_true",
               help="Output results as JSON")
sub.add_parser("drift-arm",     help="Arm the drift guard before spawning drift_guard.py")
sub.add_parser("drift-done",    help="Read drift guard findings after sub-agent returns")
sub.add_parser("drift-status",  help="Show drift guard state and last warning")
sub.add_parser("env",           help="Show resolved paths and environment check")

p = sub.add_parser("anchor", help="Anchor-based navigation: show origin/goal, re-orient, set criteria")
p.add_argument("anchor_cmd", choices=["show", "check", "set-goal"])
p.add_argument("goal", nargs="?", default=None, help="New goal text (for set-goal)")
p.add_argument("--criteria", nargs="+", default=None, help="Done criteria list (for set-goal)")

p = sub.add_parser("checkpoint", help="Run non-negotiable gate checks before continuing")
p.add_argument("--gate", action="store_true",
               help="Make scope drift a hard failure (not just a warning)")
p.add_argument("--require-full-coverage", action="store_true", dest="require_full_coverage",
               help="Require 100%% coverage to pass")

args = parser.parse_args()
{
    "start":         cmd_start,
    "ping":          cmd_ping,
    "agent-start":   cmd_agent_start,
    "agent-done":    cmd_agent_done,
    "heartbeat-arm": cmd_heartbeat_arm,
    "status":        cmd_status,
    "complete":      cmd_complete,
    "history":       cmd_history,
    "scope":         cmd_scope,
    "save":          cmd_save,
    "restore":       cmd_restore,
    "reset":         cmd_reset,
    "recover":       cmd_recover,
    "report":        cmd_report,
    "check":         cmd_check,
    "config":        cmd_config,
    "drift-arm":     cmd_drift_arm,
    "drift-done":    cmd_drift_done,
    "drift-status":  cmd_drift_status,
    "env":           cmd_env,
    "anchor":        cmd_anchor,
    "checkpoint":    cmd_checkpoint,
}[args.cmd](args)
