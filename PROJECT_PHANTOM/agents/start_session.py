#!/usr/bin/env python3
"""Initialize a Phantom work session. Run this before spawning the heartbeat agent."""

import json
import sys
from datetime import datetime

STATE_FILE = "/tmp/phantom_session.json"

def start(task: str, turns: int = 10, rounds: int = 10, idle_threshold: int = 180):
    state = {
        "task": task,
        "last_active": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "turns_taken": 0,
        "turns_target": turns,
        "rounds_remaining": rounds,
        "idle_threshold_seconds": idle_threshold,
        "started": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "status": "active"
    }
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
    print(f"Session started.")
    print(f"  Task: {task}")
    print(f"  Turns target: {turns}")
    print(f"  Heartbeat rounds: {rounds}")
    print(f"  Idle threshold: {idle_threshold}s ({idle_threshold // 60}m {idle_threshold % 60}s)")
    print(f"  State file: {STATE_FILE}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 start_session.py \"task description\" [turns] [rounds] [idle_threshold_seconds]")
        sys.exit(1)
    task = sys.argv[1]
    turns = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    rounds = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    idle_threshold = int(sys.argv[4]) if len(sys.argv) > 4 else 180
    start(task, turns, rounds, idle_threshold)
