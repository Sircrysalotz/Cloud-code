#!/usr/bin/env python3
"""
Integration test suite for PHANTOM v2.
Tests all components: phantom.py, heartbeat_runner.py, container_logger.py

Run: python3 test_v2.py
"""

import json
import os
import subprocess
import sys
import time

V2_DIR    = os.path.dirname(os.path.abspath(__file__))
PHANTOM   = os.path.join(V2_DIR, "phantom.py")
RUNNER    = os.path.join(V2_DIR, "heartbeat_runner.py")
LOGGER    = os.path.join(V2_DIR, "container_logger.py")
STATE     = "/tmp/phantom_TEST_session.json"
LOCK      = "/tmp/phantom_TEST_session.lock"
PID_FILE  = "/tmp/phantom_container_logger.pid"

PASS = "✓"
FAIL = "✗"
results = []


TEST_ENV = {**os.environ, "PHANTOM_STATE": STATE}


def run(cmd: list, input_text=None, timeout=10) -> tuple[int, str, str]:
    r = subprocess.run(
        [sys.executable] + cmd,
        capture_output=True, text=True, input=input_text,
        timeout=timeout, env=TEST_ENV
    )
    return r.returncode, r.stdout, r.stderr


def cleanup():
    for f in [STATE, LOCK, "/tmp/phantom_session.json.tmp"]:
        try: os.unlink(f)
        except FileNotFoundError: pass


def read_state() -> dict:
    with open(STATE) as f:
        return json.load(f)


def check(name: str, passed: bool, detail: str = ""):
    status = PASS if passed else FAIL
    msg = f"  [{status}] {name}"
    if detail and not passed:
        msg += f"\n      {detail}"
    print(msg)
    results.append((name, passed))


# ─── phantom.py tests ────────────────────────────────────────────────────────

def test_phantom():
    print("\n── phantom.py ──")
    cleanup()

    # start
    rc, out, _ = run([PHANTOM, "start", "test task", "--turns", "5", "--rounds", "3", "--threshold", "60", "--interval", "10"])
    check("start creates state file", os.path.exists(STATE))
    state = read_state()
    check("start sets correct task",      state.get("task") == "test task")
    check("start sets turns_target=5",   state.get("turns_target") == 5)
    check("start sets rounds=3",         state.get("rounds_remaining") == 3)
    check("start sets threshold=60",     state.get("idle_threshold_seconds") == 60)
    check("start sets interval=10",      state.get("check_interval_seconds") == 10)
    check("start sets agents_running=0", state.get("agents_running") == 0)
    check("start sets heartbeat_active=false", state.get("heartbeat_active") == False)

    # resume guard
    rc, out, _ = run([PHANTOM, "start", "other task"])
    check("start without --force blocked when session exists", rc == 1, out)

    # force overwrite
    rc, out, _ = run([PHANTOM, "start", "new task", "--force"])
    check("start --force overwrites session", rc == 0)
    state = read_state()
    check("force overwrote task", state.get("task") == "new task")

    # ping
    rc, out, _ = run([PHANTOM, "ping", "first ping"])
    check("ping succeeds", rc == 0)
    state = read_state()
    check("ping increments turns_taken", state.get("turns_taken") == 1)
    check("ping stores progress_note",  state.get("progress_note") == "first ping")
    check("ping output contains PING",  "PING" in out)
    check("ping output contains Elapsed", "Elapsed" in out)

    # agent-start
    rc, out, _ = run([PHANTOM, "agent-start", "--id", "worker-1"])
    check("agent-start increments counter", rc == 0)
    state = read_state()
    check("agents_running=1 after agent-start", state.get("agents_running") == 1)
    check("agent ID tracked", "worker-1" in state.get("active_agent_ids", []))

    # agent-done with wrong ID warning
    rc, out, _ = run([PHANTOM, "agent-done", "--id", "unknown-id"])
    check("agent-done warns on unknown ID", "WARNING" in out)

    # agent-done correct
    run([PHANTOM, "agent-start"])  # add a second agent
    rc, out, _ = run([PHANTOM, "agent-done", "--id", "worker-1"])
    check("agent-done decrements counter", rc == 0)
    state = read_state()
    check("agent ID removed from list", "worker-1" not in state.get("active_agent_ids", []))

    # agent-done underflow warning
    run([PHANTOM, "agent-done"])  # drain to 0
    rc, out, _ = run([PHANTOM, "agent-done"])  # one more — should warn
    check("agent-done warns at 0 (underflow guard)", "WARNING" in out)
    state = read_state()
    check("agents_running stays ≥ 0 after underflow", state.get("agents_running") == 0)

    # heartbeat-arm
    rc, out, _ = run([PHANTOM, "heartbeat-arm"])
    check("heartbeat-arm succeeds", rc == 0)
    state = read_state()
    check("heartbeat_active=true after arm", state.get("heartbeat_active") == True)

    # double-arm guard
    rc, out, _ = run([PHANTOM, "heartbeat-arm"])
    check("double heartbeat-arm exits code 2", rc == 2)
    check("double-arm prints WARNING", "WARNING" in out)

    # no rounds guard
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "t", "--rounds", "0", "--force"])
    rc, out, _ = run([PHANTOM, "heartbeat-arm"])
    check("heartbeat-arm exits 2 when rounds=0", rc == 2)

    # status
    cleanup()
    run([PHANTOM, "start", "status test"])
    rc, out, _ = run([PHANTOM, "status"])
    check("status exits 0", rc == 0)
    check("status shows task", "status test" in out)
    check("status shows PHANTOM SESSION STATUS", "PHANTOM SESSION STATUS" in out)

    # reset
    rc, out, _ = run([PHANTOM, "reset"])
    check("reset exits 0", rc == 0)
    check("state file gone after reset", not os.path.exists(STATE))


    # complete command
    cleanup()
    run([PHANTOM, "start", "complete test", "--turns", "2"])
    run([PHANTOM, "ping", "turn 1"])
    run([PHANTOM, "ping", "turn 2"])  # hits turns_target
    rc, out, _ = run([PHANTOM, "complete"])
    check("complete exits 0", rc == 0)
    check("complete prints SESSION COMPLETE", "SESSION COMPLETE" in out)
    state = read_state()
    check("complete sets status=complete", state.get("status") == "complete")
    check("complete sets completed timestamp", "completed" in state)

    # cooldown_factor stored in state
    cleanup()
    run([PHANTOM, "start", "cf test", "--threshold", "60", "--cooldown-factor", "0.5"])
    state = read_state()
    check("cooldown_factor stored in state", state.get("cooldown_factor") == 0.5)

    # history command
    cleanup()
    run([PHANTOM, "start", "history test", "--turns", "3"])
    run([PHANTOM, "ping", "did some work"])
    rc, out, _ = run([PHANTOM, "history"])
    check("history exits 0", rc == 0)
    check("history shows SESSION HISTORY", "SESSION HISTORY" in out)
    check("history shows task", "history test" in out)
    check("history shows turns", "1/3" in out)
    check("history shows last note", "did some work" in out)

    # PHANTOM_STATE isolation — confirm production state untouched
    check("test state isolated from /tmp/phantom_session.json",
          not os.path.exists("/tmp/phantom_session.json") or
          open("/tmp/phantom_session.json").read() != open(STATE).read()
          if os.path.exists(STATE) else True)

    cleanup()


# ─── heartbeat_runner.py tests ───────────────────────────────────────────────

def test_heartbeat_runner():
    print("\n── heartbeat_runner.py ──")
    cleanup()

    # no state file
    rc, out, err = run([RUNNER])
    check("runner exits on missing state", "ERROR" in out or "ERROR" in err)

    # not armed
    run([PHANTOM, "start", "hb test", "--threshold", "5", "--interval", "2"])
    rc, out, err = run([RUNNER])
    check("runner exits when not armed", "ERROR" in out or "Not armed" in out)

    # rounds=0 guard — force state with 1s interval so runner exits quickly
    run([PHANTOM, "start", "hb test", "--rounds", "0", "--interval", "1", "--force"])
    state = read_state()
    state["heartbeat_active"] = True  # bypass arm guard for test
    with open(STATE, "w") as f:
        json.dump(state, f)
    rc, out, err = run([RUNNER])
    check("runner exits cleanly when rounds=0", "exhausted" in out.lower() or "complete" in out.lower() or "shutting" in out.lower())

    cleanup()


# ─── container_logger.py tests ───────────────────────────────────────────────

def test_container_logger():
    print("\n── container_logger.py ──")

    # just verify it imports and shows help without error
    rc, out, err = run([LOGGER, "--help"])
    check("container_logger --help exits 0", rc == 0)
    check("--interval option present", "--interval" in out)
    check("--push-every option present", "--push-every" in out)


# ─── Run all ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("PHANTOM v2 Integration Tests")
    print("=" * 50)

    cleanup()
    try:
        test_phantom()
        test_heartbeat_runner()
        test_container_logger()
    finally:
        cleanup()

    print("\n" + "=" * 50)
    passed = sum(1 for _, p in results if p)
    total  = len(results)
    print(f"  Results: {passed}/{total} passed")
    if passed < total:
        print("  FAILED:")
        for name, p in results:
            if not p:
                print(f"    - {name}")
    print("=" * 50)
    sys.exit(0 if passed == total else 1)
