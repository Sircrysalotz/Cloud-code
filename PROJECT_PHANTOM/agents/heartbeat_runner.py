#!/usr/bin/env python3
"""
Phantom Heartbeat Runner.
Polls the session state file. When the main Claude session goes idle
(last_active gap exceeds idle_threshold), reports back to trigger a new turn.
"""

import json
import time
from datetime import datetime

STATE_FILE = "/tmp/phantom_session.json"
CHECK_INTERVAL = 30  # seconds between each poll

def read_state():
    with open(STATE_FILE) as f:
        return json.load(f)

def decrement_round(state):
    state["rounds_remaining"] = max(0, state.get("rounds_remaining", 0) - 1)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
    return state

def main():
    state = read_state()
    idle_threshold = state.get("idle_threshold_seconds", 180)
    rounds_remaining = state.get("rounds_remaining", 0)

    print(f"Heartbeat active. Idle threshold: {idle_threshold}s | Rounds remaining: {rounds_remaining}")

    while True:
        time.sleep(CHECK_INTERVAL)

        state = read_state()
        rounds_remaining = state.get("rounds_remaining", 0)

        if rounds_remaining <= 0:
            print("All heartbeat rounds exhausted. Session complete.")
            return

        last_active_str = state.get("last_active", "")
        if not last_active_str:
            continue

        last_active = datetime.strptime(last_active_str, "%Y-%m-%d %H:%M:%S")
        now = datetime.now()
        gap = (now - last_active).total_seconds()

        if gap >= idle_threshold:
            state = decrement_round(state)
            rounds_left = state["rounds_remaining"]
            print("=" * 50)
            print("HEARTBEAT FIRED — Main session idle detected")
            print(f"  Idle for: {gap:.0f}s (threshold: {idle_threshold}s)")
            print(f"  Task: {state.get('task', 'unknown')}")
            print(f"  Turns taken: {state.get('turns_taken', 0)}/{state.get('turns_target', '?')}")
            print(f"  Rounds remaining after this: {rounds_left}")
            print("=" * 50)
            print("ACTION REQUIRED: Resume your session. Run session_ping.py, then continue your task.")
            return

if __name__ == "__main__":
    main()
