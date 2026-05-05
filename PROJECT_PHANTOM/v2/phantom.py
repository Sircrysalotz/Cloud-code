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
import sys
import time
from datetime import datetime

STATE_FILE = "/tmp/phantom_session.json"
TEMP_FILE  = "/tmp/phantom_session.json.tmp"
LOCK_FILE  = "/tmp/phantom_session.lock"
LOCK_TIMEOUT = 5  # seconds


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

    state = {
        "task":                   args.task,
        "last_active":            now_str(),
        "turns_taken":            0,
        "turns_target":           args.turns,
        "rounds_remaining":       args.rounds,
        "idle_threshold_seconds": args.threshold,
        "check_interval_seconds": args.interval,
        "agents_running":         0,
        "active_agent_ids":       [],
        "heartbeat_active":       False,
        "last_heartbeat_fired":   None,
        "progress_note":          "",
        "started":                now_str(),
        "status":                 "active",
    }
    atomic_write(state)
    print(f"Session started.")
    print(f"  Task:      {args.task}")
    print(f"  Turns:     {args.turns}")
    print(f"  Rounds:    {args.rounds}")
    print(f"  Threshold: {args.threshold}s ({args.threshold // 60}m {args.threshold % 60}s)")
    print(f"  Poll:      every {args.interval}s")


def cmd_ping(args):
    state = require_state()
    state["last_active"]  = now_str()
    state["turns_taken"]  = state.get("turns_taken", 0) + 1
    if args.note:
        state["progress_note"] = args.note
    atomic_write(state)
    agents  = state.get("agents_running", 0)
    rounds  = state.get("rounds_remaining", 0)
    elapsed_str = elapsed(state.get("started", now_str()))
    print(f"PING — Turn {state['turns_taken']}/{state['turns_target']} | Rounds left: {rounds} | Agents: {agents} | Elapsed: {elapsed_str}")
    if args.note:
        print(f"  Note: {args.note}")


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
    print(f"Heartbeat armed. Rounds remaining: {state['rounds_remaining']}")


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
    print(f"  Heartbeat:  {'ARMED' if state.get('heartbeat_active') else 'idle'}")
    print(f"  Last ping:  {state.get('last_active', '?')}")
    print(f"  Last fired: {state.get('last_heartbeat_fired', 'never')}")
    print(f"  Progress:   {state.get('progress_note', '—')}")
    print("=" * 50)


def cmd_reset(args):
    for f in [STATE_FILE, TEMP_FILE, LOCK_FILE]:
        try:
            os.unlink(f)
            print(f"Removed: {f}")
        except FileNotFoundError:
            pass
    print("Reset complete.")


# --- CLI ---

parser = argparse.ArgumentParser(description="Phantom session manager v2")
sub = parser.add_subparsers(dest="cmd", required=True)

p = sub.add_parser("start", help="Initialize a new session")
p.add_argument("task", help="Description of what Claude is working on")
p.add_argument("--turns",     type=int, default=10,  help="Target number of turns")
p.add_argument("--rounds",    type=int, default=5,   help="Heartbeat rounds available")
p.add_argument("--threshold", type=int, default=180, help="Idle threshold in seconds")
p.add_argument("--interval",  type=int, default=30,  help="Heartbeat poll interval in seconds")
p.add_argument("--force",     action="store_true",   help="Overwrite existing session")

p = sub.add_parser("ping", help="Signal active turn (run at start of every turn)")
p.add_argument("note", nargs="?", default="", help="Optional progress note")

p = sub.add_parser("agent-start", help="Register a spawned sub-agent")
p.add_argument("--id", default="", help="Optional agent identifier")

p = sub.add_parser("agent-done", help="Mark a sub-agent as returned")
p.add_argument("--id", default="", help="Optional agent identifier")

sub.add_parser("heartbeat-arm", help="Arm the heartbeat before spawning")
sub.add_parser("status",        help="Print rich session status")
sub.add_parser("reset",         help="Emergency cleanup of all state/lock files")

args = parser.parse_args()
{
    "start":         cmd_start,
    "ping":          cmd_ping,
    "agent-start":   cmd_agent_start,
    "agent-done":    cmd_agent_done,
    "heartbeat-arm": cmd_heartbeat_arm,
    "status":        cmd_status,
    "reset":         cmd_reset,
}[args.cmd](args)
