#!/usr/bin/env python3
"""
Phantom Heartbeat Runner v2.

Fires ONLY when ALL of these are true:
  1. gap since last_active >= idle_threshold
  2. agents_running == 0  (not waiting on sub-agents)
  3. cooldown since last_heartbeat_fired >= idle_threshold
  4. rounds_remaining > 0

v2 additions:
  - Poll interval read from state file (check_interval_seconds), not hardcoded
  - SIGTERM/SIGINT handler — clears heartbeat_active before exit
  - Drift reporting — shows how far past threshold the fire actually happened
  - Per-poll status line includes gap, cooldown, and agent count
"""

import json
import os
import signal
import sys
import time
from datetime import datetime

STATE_FILE = os.environ.get("PHANTOM_STATE", "/tmp/phantom_session.json")
TEMP_FILE  = STATE_FILE + ".tmp"


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
    # Watchdog: if a single poll cycle takes > 3x the interval, something is wrong
    watchdog_limit  = check_interval * 3

    print(f"Heartbeat v2 active")
    print(f"  Threshold: {idle_threshold}s | Cooldown: {cooldown_window:.0f}s ({cooldown_factor}x) | Poll: {check_interval}s | Rounds: {state.get('rounds_remaining')}")
    print(f"  Watchdog:  {watchdog_limit}s max per cycle")

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

        # Guard 2: idle gap
        last_active_str = state.get("last_active", "")
        if not last_active_str:
            continue
        gap = (now - parse_dt(last_active_str)).total_seconds()

        # Guard 3: cooldown (configurable via cooldown_factor)
        last_fired_str = state.get("last_heartbeat_fired")
        if last_fired_str:
            cooldown_elapsed = (now - parse_dt(last_fired_str)).total_seconds()
            if cooldown_elapsed < cooldown_window:
                print(f"[{ts}] HOLD — cooldown {cooldown_elapsed:.0f}s/{cooldown_window:.0f}s | gap {gap:.0f}s")
                continue

        if gap < idle_threshold:
            print(f"[{ts}] HOLD — active {gap:.0f}s ago (need {idle_threshold}s)")
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
        print(f"  Task:      {state.get('task', '—')}")
        print(f"  Progress:  {state.get('progress_note', 'none')}")
        print(f"  Turns:     {state.get('turns_taken')}/{state.get('turns_target')}")
        print(f"  Rounds left: {state['rounds_remaining']}")
        print("=" * 54)
        print("RESUME: phantom.py ping [note] → phantom.py heartbeat-arm → spawn next round.")
        return


if __name__ == "__main__":
    main()
