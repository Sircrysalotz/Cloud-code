#!/usr/bin/env python3
"""
Phantom Heartbeat Runner.

Fires ONLY when ALL of these are true:
  1. gap since last_active >= idle_threshold
  2. agents_running == 0  (not waiting on sub-agents)
  3. cooldown since last_heartbeat_fired >= idle_threshold  (no rapid re-fire)
  4. rounds_remaining > 0
"""

import json
import os
import time
from datetime import datetime

STATE_FILE = "/tmp/phantom_session.json"
TEMP_FILE  = "/tmp/phantom_session.json.tmp"
CHECK_INTERVAL = 30  # seconds between polls


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


def main():
    state = read_state()
    if not state:
        print("ERROR: No session state. Run phantom.py start first.")
        return

    if not state.get("heartbeat_active"):
        print("ERROR: Not armed. Run phantom.py heartbeat-arm before spawning.")
        return

    idle_threshold = state.get("idle_threshold_seconds", 180)
    print(f"Heartbeat active | Threshold: {idle_threshold}s | Rounds: {state.get('rounds_remaining')}")
    print(f"Polling every {CHECK_INTERVAL}s...")

    while True:
        time.sleep(CHECK_INTERVAL)

        state = read_state()
        if not state:
            print("ERROR: State file lost mid-session.")
            return

        rounds_remaining = state.get("rounds_remaining", 0)
        if rounds_remaining <= 0:
            print("Rounds exhausted. Heartbeat shutting down.")
            state["heartbeat_active"] = False
            atomic_write(state)
            return

        now = datetime.now()

        # Guard 1: other agents still running
        agents_running = state.get("agents_running", 0)
        if agents_running > 0:
            print(f"[{now.strftime('%H:%M:%S')}] Holding — {agents_running} agent(s) still running.")
            continue

        # Guard 2: idle gap check
        last_active_str = state.get("last_active", "")
        if not last_active_str:
            continue
        gap = (now - parse_dt(last_active_str)).total_seconds()

        # Guard 3: cooldown since last fire
        last_fired_str = state.get("last_heartbeat_fired")
        if last_fired_str:
            cooldown = (now - parse_dt(last_fired_str)).total_seconds()
            if cooldown < idle_threshold:
                print(f"[{now.strftime('%H:%M:%S')}] Cooldown ({cooldown:.0f}s/{idle_threshold}s). Holding.")
                continue

        if gap < idle_threshold:
            print(f"[{now.strftime('%H:%M:%S')}] Active ({gap:.0f}s ago). Holding.")
            continue

        # All guards passed — fire
        state["rounds_remaining"]     = max(0, rounds_remaining - 1)
        state["last_heartbeat_fired"] = now.strftime("%Y-%m-%d %H:%M:%S")
        state["heartbeat_active"]     = False  # must re-arm before next spawn
        atomic_write(state)

        print("=" * 52)
        print("  HEARTBEAT FIRED")
        print(f"  Idle:     {gap:.0f}s (threshold: {idle_threshold}s)")
        print(f"  Task:     {state.get('task', '—')}")
        print(f"  Progress: {state.get('progress_note', 'none')}")
        print(f"  Turns:    {state.get('turns_taken')}/{state.get('turns_target')}")
        print(f"  Rounds left: {state['rounds_remaining']}")
        print("=" * 52)
        print("RESUME: phantom.py ping [note], then phantom.py heartbeat-arm, then spawn next round.")
        return


if __name__ == "__main__":
    main()
