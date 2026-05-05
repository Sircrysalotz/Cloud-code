#!/usr/bin/env python3
"""
Phantom session manager. Single interface for all session state operations.
All writes are atomic (write-to-temp + rename) to prevent race conditions.

Usage:
  phantom.py start "task" [--turns N] [--rounds N] [--threshold N]
  phantom.py ping ["progress note"]
  phantom.py agent-start
  phantom.py agent-done
  phantom.py heartbeat-arm
  phantom.py status
"""

import argparse
import json
import os
import sys
from datetime import datetime

STATE_FILE = "/tmp/phantom_session.json"
TEMP_FILE  = "/tmp/phantom_session.json.tmp"


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
            import time; time.sleep(0.1)
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


# --- Commands ---

def cmd_start(args):
    state = {
        "task":                   args.task,
        "last_active":            now_str(),
        "turns_taken":            0,
        "turns_target":           args.turns,
        "rounds_remaining":       args.rounds,
        "idle_threshold_seconds": args.threshold,
        "agents_running":         0,
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


def cmd_ping(args):
    state = require_state()
    state["last_active"]  = now_str()
    state["turns_taken"]  = state.get("turns_taken", 0) + 1
    if args.note:
        state["progress_note"] = args.note
    atomic_write(state)
    agents = state.get("agents_running", 0)
    rounds = state.get("rounds_remaining", 0)
    print(f"PING — Turn {state['turns_taken']}/{state['turns_target']} | Rounds left: {rounds} | Agents running: {agents}")
    if args.note:
        print(f"  Note: {args.note}")


def cmd_agent_start(args):
    state = require_state()
    state["agents_running"] = state.get("agents_running", 0) + 1
    atomic_write(state)
    print(f"Agent registered. agents_running: {state['agents_running']}")


def cmd_agent_done(args):
    state = require_state()
    state["agents_running"] = max(0, state.get("agents_running", 0) - 1)
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
    print(json.dumps(state, indent=2))


# --- CLI ---

parser = argparse.ArgumentParser(description="Phantom session manager")
sub = parser.add_subparsers(dest="cmd", required=True)

p = sub.add_parser("start", help="Initialize a new session")
p.add_argument("task", help="Description of what Claude is working on")
p.add_argument("--turns",     type=int, default=10,  help="Target number of turns")
p.add_argument("--rounds",    type=int, default=5,   help="Heartbeat rounds available")
p.add_argument("--threshold", type=int, default=180, help="Idle threshold in seconds")

p = sub.add_parser("ping", help="Signal active turn (run at start of every turn)")
p.add_argument("note", nargs="?", default="", help="Optional progress note")

sub.add_parser("agent-start", help="Register a spawned sub-agent (prevents false-positive heartbeat)")
sub.add_parser("agent-done",  help="Mark a sub-agent as returned")
sub.add_parser("heartbeat-arm", help="Arm the heartbeat before spawning (prevents double-spawn)")
sub.add_parser("status", help="Print current session state")

args = parser.parse_args()
{
    "start":         cmd_start,
    "ping":          cmd_ping,
    "agent-start":   cmd_agent_start,
    "agent-done":    cmd_agent_done,
    "heartbeat-arm": cmd_heartbeat_arm,
    "status":        cmd_status,
}[args.cmd](args)
