#!/usr/bin/env python3
"""
Phantom session manager v2. Single interface for all session state operations.
All writes are atomic (write-to-temp + rename) to prevent race conditions.

Usage:
  phantom.py start "task" [--turns N] [--rounds N] [--threshold N] [--interval N] [--force]
  phantom.py ping ["progress note"]
  phantom.py agent-start [--id AGENT_ID]
  phantom.py agent-done [--id AGENT_ID]
  phantom.py heartbeat-arm
  phantom.py status
  phantom.py reset
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime

REPO_DIR         = "/home/user/Cloud-code"
SAVED_STATE_FILE = os.path.join(REPO_DIR, "PROJECT_PHANTOM/logs/last_session_state.json")

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

    turns          = resolve(args.turns,          10,  "turns",          10)
    rounds         = resolve(args.rounds,          5,   "rounds",         5)
    threshold      = resolve(args.threshold,       180, "threshold",      180)
    interval       = resolve(args.interval,        30,  "interval",       30)
    cf             = resolve(args.cooldown_factor, 1.0, "cooldown_factor",1.0)
    min_idle_polls = resolve(getattr(args, "min_idle_polls", 1), 1, "min_idle_polls", 1)

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
        "scope_files":            getattr(args, "scope", None) or [],
        "session_start_ref":      session_start_ref,
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
            subprocess.run(["git", "add", "PROJECT_PHANTOM/logs/last_session_state.json"],
                           cwd=REPO_DIR, capture_output=True, timeout=30)
            subprocess.run(["git", "commit", "-m",
                            f"[phantom] auto-save turn {state.get('turns_taken')}\n\nhttps://claude.ai/code/session_01URz48AEdtJbKdvuHxoBEJ6"],
                           cwd=REPO_DIR, capture_output=True, timeout=30)
            subprocess.run(["git", "push"], cwd=REPO_DIR, capture_output=True, timeout=30)
            print(f"  [auto-saved to git]")
        except Exception:
            print(f"  [auto-save failed — state written locally]")


def cmd_ping(args):
    state = require_state()
    state["last_active"]  = now_str()
    state["turns_taken"]  = state.get("turns_taken", 0) + 1
    if args.note:
        state["progress_note"] = args.note
    atomic_write(state)
    agents      = state.get("agents_running", 0)
    rounds      = state.get("rounds_remaining", 0)
    elapsed_str = elapsed(state.get("started", now_str()))
    turns_taken = state["turns_taken"]
    turns_target = state.get("turns_target", "?")
    print(f"PING — Turn {turns_taken}/{turns_target} | Rounds left: {rounds} | Agents: {agents} | Elapsed: {elapsed_str}")
    if args.note:
        print(f"  Note: {args.note}")
    auto_save(state)
    if isinstance(turns_target, int) and turns_taken >= turns_target:
        state["status"] = "complete"
        atomic_write(state)
        print_session_summary(state)


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
    # Show estimated fire time based on last activity
    last_active = state.get("last_active", "")
    if last_active:
        try:
            from datetime import timedelta
            fire_dt = datetime.strptime(last_active, "%Y-%m-%d %H:%M:%S") + timedelta(seconds=threshold)
            remaining = (fire_dt - datetime.now()).total_seconds()
            if remaining > 0:
                print(f"  Est. fire:  ~{remaining:.0f}s from now ({fire_dt.strftime('%H:%M:%S')})")
            else:
                print(f"  Est. fire:  overdue by {-remaining:.0f}s (ping was {-remaining + threshold:.0f}s ago)")
        except Exception:
            pass


def cmd_status(args):
    state = read_state()
    if not state:
        print("No active session.")
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

    print(f"  Last ping:  {state.get('last_active', '?')}")
    print(f"  Last fired: {state.get('last_heartbeat_fired', 'never')}")
    if state.get("min_idle_polls", 1) > 1:
        print(f"  Min polls:  {state.get('min_idle_polls')} consecutive idle polls required")
    print(f"  Progress:   {state.get('progress_note', '—')}")
    fires = state.get("heartbeat_fires", [])
    if fires:
        print(f"  Fire log:   (last {len(fires)})")
        for ev in fires[-3:]:
            print(f"    {ev['fired_at']}  gap={ev['gap_seconds']}s  signal={ev['signal']}  turn={ev['turns']}")
    print("=" * 50)


def cmd_complete(args):
    state = require_state()
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
        subprocess.run(["git", "add", "PROJECT_PHANTOM/logs/last_session_state.json"],
                       cwd=REPO_DIR, capture_output=True, timeout=30)
        subprocess.run(["git", "commit", "-m",
                        f"[phantom] session state saved — turn {state.get('turns_taken')}\n\nhttps://claude.ai/code/session_01URz48AEdtJbKdvuHxoBEJ6"],
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
    state["heartbeat_active"] = False  # always clear on restore
    state["agents_running"]   = 0      # always clear on restore
    state["active_agent_ids"] = []
    atomic_write(state)
    print(f"Session restored from git save ({saved_at}).")
    print(f"  Task:  {state.get('task', '?')}")
    print(f"  Turns: {state.get('turns_taken', 0)}/{state.get('turns_target', '?')}")
    print(f"  Rounds remaining: {state.get('rounds_remaining', 0)}")
    print("NOTE: heartbeat_active and agents_running cleared. Re-arm before spawning.")


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
        totals = {}
        for line in lines:
            parts = line.split("|")
            fname = parts[0].strip()
            try:
                changes = int(parts[1].strip().split()[0])
                totals[fname] = changes
            except (IndexError, ValueError):
                pass
        grand_total = sum(totals.values()) or 1
        threshold = getattr(args, "threshold", 50)
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
    print("=" * 50)


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
    print("Drift guard armed.")


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


# --- Profile system ---

PROFILE_KEYS = {
    "turns":          (int,   10,  "Target number of turns"),
    "rounds":         (int,   5,   "Heartbeat rounds available"),
    "threshold":      (int,   180, "Idle threshold in seconds"),
    "interval":       (int,   30,  "Heartbeat poll interval in seconds"),
    "cooldown_factor":(float, 1.0, "Cooldown multiplier"),
    "min_idle_polls": (int,   1,   "Consecutive idle polls before heartbeat fires"),
    "scope_threshold":(float, 50.0,"Drift guard threshold % (last-resort gate)"),
    "scope_files":    (list, [],   "Declared focus files for drift guard"),
    "coverage_targets":(list, [],  "Files to track for coverage"),
    "description":    (str,   "",  "Human-readable profile description"),
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
    profiles = read_profiles()
    return profiles.get(name)


def cmd_config(args):
    sub = args.config_cmd

    if sub == "list":
        profiles = read_profiles()
        if not profiles:
            print(f"No profiles found. ({PROFILES_FILE})")
            print("Create one: phantom.py config create <name>")
            return
        print(f"Profiles ({PROFILES_FILE}):")
        for name, p in profiles.items():
            desc = p.get("description", "")
            turns = p.get("turns", "—")
            threshold = p.get("threshold", "—")
            print(f"  {name:<20} turns={turns} threshold={threshold}s  {desc}")

    elif sub == "show":
        profiles = read_profiles()
        name = args.name
        if name not in profiles:
            print(f"Profile '{name}' not found.")
            sys.exit(1)
        p = profiles[name]
        print(f"Profile: {name}")
        print(f"  File: {PROFILES_FILE}")
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
p.add_argument("--force",            action="store_true",     help="Overwrite existing session")

p = sub.add_parser("config", help="Manage session profiles")
p.add_argument("config_cmd", choices=["list", "show", "create", "set", "delete"])
p.add_argument("name",  nargs="?", default=None, help="Profile name")
p.add_argument("key",   nargs="?", default=None, help="Key to set (for 'set' subcommand)")
p.add_argument("value", nargs="?", default=None, help="Value (for 'set' subcommand)")
p.add_argument("--description",    default=None, help="Profile description")
p.add_argument("--turns",          type=int,   default=None)
p.add_argument("--rounds",         type=int,   default=None)
p.add_argument("--threshold",      type=int,   default=None)
p.add_argument("--interval",       type=int,   default=None)
p.add_argument("--cooldown-factor",type=float, default=None, dest="cooldown_factor")
p.add_argument("--scope-threshold",type=float, default=None, dest="scope_threshold")
p.add_argument("--coverage-targets",nargs="+", default=None, dest="coverage_targets")
p.add_argument("--force", action="store_true", help="Overwrite existing profile")

p = sub.add_parser("ping", help="Signal active turn (run at start of every turn)")
p.add_argument("note", nargs="?", default="", help="Optional progress note")

p = sub.add_parser("agent-start", help="Register a spawned sub-agent")
p.add_argument("--id", default="", help="Optional agent identifier")

p = sub.add_parser("agent-done", help="Mark a sub-agent as returned")
p.add_argument("--id", default="", help="Optional agent identifier")

sub.add_parser("heartbeat-arm", help="Arm the heartbeat before spawning")
sub.add_parser("status",        help="Print rich session status")
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
sub.add_parser("drift-arm",     help="Arm the drift guard before spawning drift_guard.py")
sub.add_parser("drift-done",    help="Read drift guard findings after sub-agent returns")
sub.add_parser("drift-status",  help="Show drift guard state and last warning")

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
    "config":        cmd_config,
    "drift-arm":     cmd_drift_arm,
    "drift-done":    cmd_drift_done,
    "drift-status":  cmd_drift_status,
}[args.cmd](args)
