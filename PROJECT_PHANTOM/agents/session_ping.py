#!/usr/bin/env python3
"""Run this at the start of every Claude turn to signal the session is still active."""

import json
from datetime import datetime

STATE_FILE = "/tmp/phantom_session.json"

def ping():
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
        state["last_active"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        state["turns_taken"] = state.get("turns_taken", 0) + 1
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
        turns_taken = state["turns_taken"]
        turns_target = state.get("turns_target", "?")
        rounds_remaining = state.get("rounds_remaining", "?")
        print(f"PING — Turn {turns_taken}/{turns_target} | Heartbeat rounds left: {rounds_remaining}")
    except FileNotFoundError:
        print("No active session. Run start_session.py first.")

if __name__ == "__main__":
    ping()
