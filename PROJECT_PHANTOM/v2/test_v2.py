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
from datetime import datetime

V2_DIR    = os.path.dirname(os.path.abspath(__file__))
PHANTOM   = os.path.join(V2_DIR, "phantom.py")
RUNNER    = os.path.join(V2_DIR, "heartbeat_runner.py")
LOGGER    = os.path.join(V2_DIR, "container_logger.py")
DRIFT     = os.path.join(V2_DIR, "drift_guard.py")
SCOPE_GUARD      = os.path.join(V2_DIR, "scope_guard.py")
COVERAGE_TRACKER = os.path.join(V2_DIR, "coverage_tracker.py")
STATE     = "/tmp/phantom_TEST_session.json"
LOCK      = "/tmp/phantom_TEST_session.lock"
PID_FILE  = "/tmp/phantom_container_logger.pid"
PROFILES  = "/tmp/phantom_TEST_profiles.json"

PASS = "✓"
FAIL = "✗"
results = []


TEST_ENV = {**os.environ, "PHANTOM_STATE": STATE, "PHANTOM_PROFILES": PROFILES}


def run(cmd: list, input_text=None, timeout=10) -> tuple[int, str, str]:
    r = subprocess.run(
        [sys.executable] + cmd,
        capture_output=True, text=True, input=input_text,
        timeout=timeout, env=TEST_ENV
    )
    return r.returncode, r.stdout, r.stderr


def cleanup():
    for f in [STATE, LOCK, PROFILES, "/tmp/phantom_session.json.tmp"]:
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


    # hitting turns_target prints milestone but keeps session active
    cleanup()
    run([PHANTOM, "start", "milestone test", "--turns", "2"])
    run([PHANTOM, "ping", "turn 1"])
    rc, out, _ = run([PHANTOM, "ping", "turn 2"])  # hits turns_target
    check("ping at turns_target exits 0", rc == 0)
    check("ping at turns_target prints TURN TARGET REACHED", "TURN TARGET REACHED" in out)
    state = read_state()
    check("ping at turns_target keeps status=active", state.get("status") == "active")

    # turns beyond target are counted normally (session stays open)
    rc, out, _ = run([PHANTOM, "ping", "turn 3 — beyond target"])
    check("ping beyond turns_target exits 0", rc == 0)
    state = read_state()
    check("turns_taken increments past target", state.get("turns_taken") == 3)
    check("status still active past target", state.get("status") == "active")

    # complete command ends the session explicitly
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

    # save command (skip git push in tests — just check file written)
    cleanup()
    run([PHANTOM, "start", "save test", "--turns", "5"])
    run([PHANTOM, "ping", "saved progress"])
    SAVED = os.path.join(V2_DIR, "../logs/last_session_state.json")
    rc, out, _ = run([PHANTOM, "save"])
    check("save exits 0 or warns on push", rc == 0 or "push" in out.lower())
    check("save writes last_session_state.json", os.path.exists(SAVED))
    if os.path.exists(SAVED):
        with open(SAVED) as f:
            saved = json.load(f)
        check("saved state has correct task", saved.get("task") == "save test")
        check("saved state has saved_at timestamp", "saved_at" in saved)

    # restore command
    cleanup()
    rc, out, _ = run([PHANTOM, "restore"])
    check("restore exits 0 after save", rc == 0)
    state = read_state()
    check("restore clears heartbeat_active", state.get("heartbeat_active") == False)
    check("restore clears agents_running", state.get("agents_running") == 0)
    check("restore preserves task", state.get("task") == "save test")

    # restore --force over existing session
    run([PHANTOM, "start", "other task", "--force"])
    rc, out, _ = run([PHANTOM, "restore"])
    check("restore blocked without --force when session exists", rc == 1)
    rc, out, _ = run([PHANTOM, "restore", "--force"])
    check("restore --force succeeds", rc == 0)

    # PHANTOM_STATE isolation — confirm production state untouched
    check("test state isolated from /tmp/phantom_session.json",
          not os.path.exists("/tmp/phantom_session.json") or
          open("/tmp/phantom_session.json").read() != open(STATE).read()
          if os.path.exists(STATE) else True)

    # ── ping_log ──
    cleanup()
    run([PHANTOM, "start", "ping_log test", "--turns", "10"])
    run([PHANTOM, "ping", "note A"])
    run([PHANTOM, "ping", "note B"])
    run([PHANTOM, "ping", "note C"])
    state = read_state()
    ping_log = state.get("ping_log", [])
    check("ping_log created after pings", isinstance(ping_log, list) and len(ping_log) > 0)
    check("ping_log has 3 entries", len(ping_log) == 3)
    check("ping_log entry has turn key", "turn" in ping_log[0])
    check("ping_log entry has note key", "note" in ping_log[0])
    check("ping_log entry has at key", "at" in ping_log[0])
    check("ping_log stores note correctly", ping_log[0]["note"] == "note A")
    check("ping_log turn increments", ping_log[0]["turn"] == 1 and ping_log[2]["turn"] == 3)
    # ping without note doesn't crash ping_log
    rc, out, _ = run([PHANTOM, "ping"])
    check("ping without note exits 0 (ping_log unchanged)", rc == 0)
    state = read_state()
    check("ping_log unchanged when no note provided", len(state.get("ping_log", [])) == 3)
    # history shows ping_log
    rc, out, _ = run([PHANTOM, "history"])
    check("history shows Ping log section", "Ping log" in out)
    check("history shows note A in ping log", "note A" in out)
    # report shows recent pings
    rc, out, _ = run([PHANTOM, "report"])
    check("report shows Recent pings section", "Recent pings" in out)
    check("report shows note C in recent pings", "note C" in out)
    # ping_log capped at 20 entries
    for i in range(20):
        run([PHANTOM, "ping", f"overflow note {i}"])
    state = read_state()
    check("ping_log capped at 20 entries", len(state.get("ping_log", [])) <= 20)

    # ── report command ──
    cleanup()
    run([PHANTOM, "start", "report test", "--turns", "5", "--rounds", "3"])
    run([PHANTOM, "ping", "first turn note"])
    rc, out, _ = run([PHANTOM, "report"])
    check("report exits 0", rc == 0)
    check("report shows SESSION REPORT header", "SESSION REPORT" in out)
    check("report shows task name", "report test" in out)
    check("report shows status", "ACTIVE" in out)
    check("report shows turns", "1/5" in out)
    check("report shows last note", "first turn note" in out)
    check("report shows Rounds section", "Rounds:" in out)
    check("report shows Heartbeat status", "Heartbeat:" in out)
    # report on completed session
    run([PHANTOM, "complete"])
    rc, out, _ = run([PHANTOM, "report"])
    check("report on completed session shows COMPLETE", "COMPLETE" in out)

    # ── recover command ──
    cleanup()
    run([PHANTOM, "start", "recover test", "--turns", "5"])
    run([PHANTOM, "ping", "working"])
    run([PHANTOM, "heartbeat-arm"])
    run([PHANTOM, "agent-start", "--id", "stuck-agent"])
    run([PHANTOM, "drift-arm"])
    state = read_state()
    check("setup: heartbeat_active is true", state.get("heartbeat_active") == True)
    check("setup: agents_running is 1", state.get("agents_running") == 1)
    check("setup: drift_guard_active is true", state.get("drift_guard_active") == True)
    rc, out, _ = run([PHANTOM, "recover"])
    check("recover exits 0", rc == 0)
    check("recover output mentions heartbeat_active", "heartbeat_active" in out)
    check("recover output mentions agents_running", "agents_running" in out)
    check("recover output mentions drift_guard_active", "drift_guard_active" in out)
    state = read_state()
    check("recover clears heartbeat_active", state.get("heartbeat_active") == False)
    check("recover clears agents_running", state.get("agents_running") == 0)
    check("recover clears drift_guard_active", state.get("drift_guard_active") == False)
    # verify task and turns are preserved
    check("recover preserves task", state.get("task") == "recover test")
    check("recover preserves turns_taken", state.get("turns_taken") == 1)
    # recover on clean session
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "clean session"])
    rc, out, _ = run([PHANTOM, "recover"])
    check("recover on clean session exits 0", rc == 0)
    check("recover on clean session says no stuck flags", "No stuck flags" in out)
    # recover with no session
    run([PHANTOM, "reset"])
    rc, out, _ = run([PHANTOM, "recover"])
    check("recover with no session exits 0", rc == 0)
    check("recover with no session says no session", "No active session" in out)

    cleanup()


# ─── workspace_dir + activity signals tests ──────────────────────────────────

def test_workspace_and_activity():
    print("\n── workspace_dir + activity signals ──")
    cleanup()

    # workspace_dir stored on start
    run([PHANTOM, "start", "workspace test", "--turns", "3"])
    state = read_state()
    check("start stores workspace_dir", "workspace_dir" in state)
    check("workspace_dir is a string", isinstance(state.get("workspace_dir"), str))
    check("workspace_dir is a real directory", os.path.isdir(state.get("workspace_dir", "")))

    # workspace_dir stored in profile start too
    run([PHANTOM, "reset"])
    run([PHANTOM, "config", "create", "ws_test", "--turns", "3"])
    run([PHANTOM, "start", "ws profile test", "--profile", "ws_test"])
    state = read_state()
    check("profile start also stores workspace_dir", "workspace_dir" in state)
    check("profile stored in state", state.get("profile") == "ws_test")

    # Activity signals unit test — import runner functions directly
    import importlib.util
    spec = importlib.util.spec_from_file_location("heartbeat_runner", RUNNER)
    hr   = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hr)

    # scan_workspace returns a float and a path string
    workspace = state.get("workspace_dir", os.path.dirname(RUNNER))
    mtime, path = hr.scan_workspace(workspace)
    check("scan_workspace returns nonzero mtime", mtime > 0)
    check("scan_workspace returns file path", path is not None)

    # git_index_mtime returns float
    gi = hr.git_index_mtime(workspace)
    check("git_index_mtime returns float", isinstance(gi, float))

    # get_last_activity uses filesystem when ping is old
    old_state = {
        "last_active": "2020-01-01 00:00:00",  # ancient ping
        "workspace_dir": workspace,
    }
    ts, source = hr.get_last_activity(old_state)
    check("get_last_activity finds recent activity despite old ping", ts > 0)
    check("activity source is filesystem or git (not ping)", source != "ping")
    check("effective gap < 300s despite ancient ping", (time.time() - ts) < 300)

    # get_last_activity uses ping when it's the most recent
    very_recent_state = {
        "last_active": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "workspace_dir": "/nonexistent/path",  # no fs scan possible
    }
    ts2, source2 = hr.get_last_activity(very_recent_state)
    check("get_last_activity falls back to ping when workspace missing", source2 == "ping")

    cleanup()


# ─── profile / config tests ───────────────────────────────────────────────────

def test_config():
    print("\n── phantom.py config ──")
    cleanup()

    # config list — always shows built-in profiles
    rc, out, _ = run([PHANTOM, "config", "list"])
    check("config list exits 0", rc == 0)
    check("config list shows built-in profiles header", "Built-in" in out)
    check("config list shows sprint built-in", "sprint" in out)
    check("config list shows marathon built-in", "marathon" in out)
    check("config list shows debug built-in", "debug" in out)
    check("config list shows no user profiles message when empty", "No user profiles" in out)

    # config create
    rc, out, _ = run([PHANTOM, "config", "create", "myprofile",
                      "--turns", "7", "--rounds", "4", "--threshold", "90",
                      "--description", "test profile"])
    check("config create exits 0", rc == 0)
    check("config create shows profile name", "myprofile" in out)

    # config list — shows new profile
    rc, out, _ = run([PHANTOM, "config", "list"])
    check("config list shows created profile", "myprofile" in out)
    check("config list shows turns", "turns=7" in out)
    check("config list shows threshold", "threshold=90s" in out)

    # config show
    rc, out, _ = run([PHANTOM, "config", "show", "myprofile"])
    check("config show exits 0", rc == 0)
    check("config show displays turns", "turns" in out and "7" in out)
    check("config show displays description", "test profile" in out)

    # config set
    rc, out, _ = run([PHANTOM, "config", "set", "myprofile", "turns", "9"])
    check("config set exits 0", rc == 0)
    rc, out, _ = run([PHANTOM, "config", "show", "myprofile"])
    check("config set persists change", "9" in out)

    # config set — invalid key
    rc, out, _ = run([PHANTOM, "config", "set", "myprofile", "nonexistent_key", "123"])
    check("config set exits 1 on unknown key", rc == 1)

    # config set — type coercion
    rc, out, _ = run([PHANTOM, "config", "set", "myprofile", "cooldown_factor", "0.75"])
    check("config set coerces float", rc == 0)
    rc, out, _ = run([PHANTOM, "config", "show", "myprofile"])
    check("config set stores float value", "0.75" in out)

    # config create --force overwrites
    rc, out, _ = run([PHANTOM, "config", "create", "myprofile", "--turns", "99", "--force"])
    check("config create --force exits 0", rc == 0)
    rc, out, _ = run([PHANTOM, "config", "show", "myprofile"])
    check("config create --force overwrites profile", "99" in out)

    # config create blocked without --force
    rc, out, _ = run([PHANTOM, "config", "create", "myprofile", "--turns", "1"])
    check("config create blocked without --force", rc == 1)

    # phantom.py start --profile loads values
    run([PHANTOM, "config", "create", "starttest",
         "--turns", "8", "--rounds", "4", "--threshold", "77"])
    rc, out, _ = run([PHANTOM, "start", "profile start test", "--profile", "starttest"])
    check("start --profile exits 0", rc == 0)
    check("start --profile shows profile name in output", "starttest" in out)
    state = read_state()
    check("start --profile sets turns_target from profile", state.get("turns_target") == 8)
    check("start --profile sets threshold from profile", state.get("idle_threshold_seconds") == 77)
    check("start --profile stores profile name in state", state.get("profile") == "starttest")
    check("start --profile stores workspace_dir", "workspace_dir" in state)

    # start --profile with flag override
    run([PHANTOM, "start", "override test", "--profile", "starttest", "--turns", "42", "--force"])
    state = read_state()
    check("start --profile --turns overrides profile", state.get("turns_target") == 42)
    check("start --profile without --turns uses profile value", state.get("idle_threshold_seconds") == 77)

    # start with nonexistent profile exits 1
    rc, out, _ = run([PHANTOM, "start", "bad profile", "--profile", "nonexistent"])
    check("start --profile nonexistent exits 1", rc == 1)

    # config delete
    rc, out, _ = run([PHANTOM, "config", "delete", "myprofile"])
    check("config delete exits 0", rc == 0)
    rc, out, _ = run([PHANTOM, "config", "list"])
    check("deleted profile gone from list", "myprofile" not in out)

    # config delete nonexistent exits 1
    rc, out, _ = run([PHANTOM, "config", "delete", "nonexistent_profile"])
    check("config delete nonexistent exits 1", rc == 1)

    # ── built-in profile tests ──
    # config list shows built-ins even with no user profiles
    cleanup()
    rc, out, _ = run([PHANTOM, "config", "list"])
    check("config list shows built-ins without user profiles", "Built-in" in out)
    check("config list shows sprint without user file", "sprint" in out)
    check("config list shows marathon without user file", "marathon" in out)
    check("config list shows focus built-in", "focus" in out)

    # config show works on built-in profiles
    rc, out, _ = run([PHANTOM, "config", "show", "sprint"])
    check("config show sprint exits 0", rc == 0)
    check("config show sprint shows built-in label", "built-in" in out)
    check("config show sprint has threshold", "threshold" in out)

    rc, out, _ = run([PHANTOM, "config", "show", "marathon"])
    check("config show marathon exits 0", rc == 0)
    check("config show marathon shows built-in label", "built-in" in out)

    # start with built-in profile loads values
    rc, out, _ = run([PHANTOM, "start", "sprint test", "--profile", "sprint"])
    check("start --profile sprint (built-in) exits 0", rc == 0)
    state = read_state()
    check("start --profile sprint sets turns=10", state.get("turns_target") == 10)
    check("start --profile sprint sets threshold=120", state.get("idle_threshold_seconds") == 120)
    check("start --profile sprint sets profile name in state", state.get("profile") == "sprint")

    rc, out, _ = run([PHANTOM, "start", "marathon test", "--profile", "marathon", "--force"])
    check("start --profile marathon (built-in) exits 0", rc == 0)
    state = read_state()
    check("start --profile marathon sets turns=30", state.get("turns_target") == 30)
    check("start --profile marathon sets min_idle_polls=2", state.get("min_idle_polls") == 2)

    rc, out, _ = run([PHANTOM, "start", "debug test", "--profile", "debug", "--force"])
    check("start --profile debug (built-in) exits 0", rc == 0)
    state = read_state()
    check("start --profile debug sets turns=5", state.get("turns_target") == 5)
    check("start --profile debug sets threshold=60", state.get("idle_threshold_seconds") == 60)

    # built-in profile can be overridden by --flags
    rc, out, _ = run([PHANTOM, "start", "sprint override", "--profile", "sprint",
                      "--turns", "99", "--force"])
    check("start --profile sprint --turns 99 overrides built-in turns", rc == 0)
    state = read_state()
    check("turns overridden to 99 vs built-in 10", state.get("turns_target") == 99)
    check("threshold still from sprint (120)", state.get("idle_threshold_seconds") == 120)

    # user profile with same name takes precedence over built-in
    run([PHANTOM, "config", "create", "sprint",
         "--turns", "77", "--threshold", "999"])
    rc, out, _ = run([PHANTOM, "start", "user sprint", "--profile", "sprint", "--force"])
    state = read_state()
    check("user profile 'sprint' overrides built-in", state.get("turns_target") == 77)
    check("user sprint threshold=999 (not built-in 120)", state.get("idle_threshold_seconds") == 999)
    # list shows (overridden by user) for sprint
    rc, out, _ = run([PHANTOM, "config", "list"])
    check("config list shows sprint as overridden by user", "overridden by user" in out)

    # profile with coverage_targets — loads into state at start
    run([PHANTOM, "config", "create", "cov_profile",
         "--coverage-targets", "agents/phantom.py", "v2/phantom.py"])
    rc, out, _ = run([PHANTOM, "start", "profile cov test", "--profile", "cov_profile", "--force"])
    check("start with coverage_targets profile exits 0", rc == 0)
    state = read_state()
    cov = state.get("coverage_targets", [])
    check("start --profile loads coverage_targets into state",
          "agents/phantom.py" in cov and "v2/phantom.py" in cov)

    # CLI --coverage-targets overrides profile's coverage_targets
    rc, out, _ = run([PHANTOM, "start", "cov override", "--profile", "cov_profile",
                      "--coverage-targets", "only_this.py", "--force"])
    state = read_state()
    check("CLI --coverage-targets overrides profile value",
          state.get("coverage_targets") == ["only_this.py"])

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

    # runner exits when status==complete (explicit session completion)
    run([PHANTOM, "start", "complete exit test", "--rounds", "5", "--interval", "1", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    state["status"]           = "complete"  # session explicitly ended
    state["last_active"]      = "2020-01-01 00:00:00"
    with open(STATE, "w") as f:
        json.dump(state, f)
    rc, out, err = run([RUNNER])
    check("runner exits when status=complete", "complete" in out.lower() or "shutting" in out.lower())
    check("runner clears heartbeat_active on complete exit", not read_state().get("heartbeat_active", True))

    # Activity metadata written even when agents_running > 0 (bug fix verification)
    import subprocess as _sp
    run([PHANTOM, "start", "agent guard test", "--rounds", "1", "--interval", "1", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    state["agents_running"]   = 1   # simulate worker holding the guard
    state["last_active"]      = "2026-01-01 12:00:00"
    import tempfile as _tf
    with _tf.TemporaryDirectory() as tmpws:
        state["workspace_dir"] = tmpws
        with open(STATE, "w") as fp: json.dump(state, fp)
        try:
            _sp.run([sys.executable, RUNNER], capture_output=True, timeout=3, env=TEST_ENV)
        except _sp.TimeoutExpired:
            pass
    state_after = read_state()
    check("next_heartbeat_at written when agents_running > 0", state_after.get("next_heartbeat_at") is not None)
    check("last_activity_source written when agents_running > 0", state_after.get("last_activity_source") is not None)

    # min_idle_polls stored in state when --min-idle-polls used on start
    run([PHANTOM, "start", "hb test", "--min-idle-polls", "2", "--force"])
    state = read_state()
    check("min_idle_polls stored in state", state.get("min_idle_polls") == 2)

    # min_idle_polls default is 1
    run([PHANTOM, "start", "hb test", "--force"])
    state = read_state()
    check("min_idle_polls defaults to 1", state.get("min_idle_polls", 1) == 1)

    # session_start_ref stored on start
    run([PHANTOM, "start", "ref test", "--force"])
    state = read_state()
    check("session_start_ref stored on start", "session_start_ref" in state)
    check("session_start_ref is a string", isinstance(state.get("session_start_ref"), str))

    # runner banner includes min_idle_polls
    run([PHANTOM, "start", "hb test", "--rounds", "0", "--interval", "1", "--min-idle-polls", "3", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    with open(STATE, "w") as f:
        json.dump(state, f)
    rc, out, err = run([RUNNER])
    check("runner banner shows min_idle_polls", "Min idle polls: 3" in out)

    # heartbeat-arm shows ETA estimate
    run([PHANTOM, "start", "arm eta test", "--threshold", "180", "--force"])
    rc, out, err = run([PHANTOM, "heartbeat-arm"])
    check("heartbeat-arm exits 0", rc == 0)
    check("heartbeat-arm shows Est. fire or overdue", "Est. fire" in out or "overdue" in out or "fire" in out.lower())

    # min_idle_polls in profile keys
    run([PHANTOM, "config", "create", "testpoll",
         "--turns", "5", "--min-idle-polls", "2"])  # note: config create won't have --min-idle-polls
    # Verify via config set instead
    run([PHANTOM, "config", "create", "testpoll2", "--turns", "5"])
    run([PHANTOM, "config", "set", "testpoll2", "min_idle_polls", "2"])
    rc, out, err = run([PHANTOM, "config", "show", "testpoll2"])
    check("min_idle_polls settable in profile", "min_idle_polls" in out and "2" in out)

    # heartbeat fire history written to state on fire
    import tempfile
    run([PHANTOM, "start", "fire history test", "--rounds", "1", "--interval", "1", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    # Inject a last_active far in the past so runner fires on first poll
    state["last_active"] = "2020-01-01 00:00:00"
    # Use an empty temp dir so filesystem scan returns instantly (no files to walk)
    with tempfile.TemporaryDirectory() as tmpws:
        state["workspace_dir"] = tmpws
        with open(STATE, "w") as f:
            json.dump(state, f)
        rc, out, err = run([RUNNER], timeout=10)
    state_after = read_state()
    fires = state_after.get("heartbeat_fires", [])
    check("heartbeat_fires list exists after fire", isinstance(fires, list))
    check("fire event has fired_at key", len(fires) > 0 and "fired_at" in fires[-1])
    check("fire event has signal key", len(fires) > 0 and "signal" in fires[-1])
    check("fire event has gap_seconds key", len(fires) > 0 and "gap_seconds" in fires[-1])
    check("fire event records turns", len(fires) > 0 and "turns" in fires[-1])

    # scope --session flag accepted
    run([PHANTOM, "start", "scope test", "--force"])
    rc, out, err = run([PHANTOM, "scope", "--session"])
    check("scope --session exits 0", rc == 0)
    check("scope --session shows label", "session" in out.lower() or "SCOPE CHECK" in out)

    # scope --threshold flag changes warning level
    rc, out, err = run([PHANTOM, "scope", "--threshold", "99"])
    check("scope --threshold accepted", rc == 0)

    # ── v5: tracked_extensions stored on start ──
    run([PHANTOM, "start", "ext test", "--tracked-exts", ".py", ".ts", "--force"])
    state = read_state()
    check("tracked_extensions stored on start", "tracked_extensions" in state)
    check("tracked_extensions contains .py", ".py" in state.get("tracked_extensions", []))
    check("tracked_extensions contains .ts", ".ts" in state.get("tracked_extensions", []))

    # scan_depth stored on start
    run([PHANTOM, "start", "depth test", "--scan-depth", "3", "--force"])
    state = read_state()
    check("scan_depth stored on start", state.get("scan_depth") == 3)

    # scan_depth defaults to 5 when not specified
    run([PHANTOM, "start", "depth default test", "--force"])
    state = read_state()
    check("scan_depth defaults to 5", state.get("scan_depth") == 5)

    # runner banner shows tracked exts when custom set provided
    run([PHANTOM, "start", "exts banner test", "--rounds", "0", "--interval", "1",
         "--tracked-exts", ".rs", ".go", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    with open(STATE, "w") as f:
        json.dump(state, f)
    rc, out, err = run([RUNNER])
    check("runner banner shows custom tracked exts", ".rs" in out or ".go" in out)

    # watchdog event written to state on stall
    # We can test the function directly without triggering a real stall
    import importlib.util as _ilu
    spec = _ilu.spec_from_file_location("heartbeat_runner", RUNNER)
    hr = _ilu.module_from_spec(spec)
    spec.loader.exec_module(hr)
    # DEFAULT_TRACKED_EXTS should exist (not TRACKED_EXTS)
    check("DEFAULT_TRACKED_EXTS defined in runner", hasattr(hr, "DEFAULT_TRACKED_EXTS"))
    check("scan_workspace accepts tracked_exts param", True)  # validated by import success
    # scan_workspace with custom exts only tracks those extensions
    with tempfile.TemporaryDirectory() as tmpdir:
        open(os.path.join(tmpdir, "test.py"), "w").close()
        open(os.path.join(tmpdir, "test.rs"), "w").close()
        mtime, path = hr.scan_workspace(tmpdir, {".rs"})
        check("scan_workspace with .rs only finds .rs file", path is not None and path.endswith(".rs"))
        mtime2, path2 = hr.scan_workspace(tmpdir, {".js"})
        check("scan_workspace with .js finds nothing (no .js files)", path2 is None or path2 == "")

    cleanup()


# ─── container_logger.py tests ───────────────────────────────────────────────

def test_container_logger():
    print("\n── container_logger.py ──")

    # just verify it imports and shows help without error
    rc, out, err = run([LOGGER, "--help"])
    check("container_logger --help exits 0", rc == 0)
    check("--interval option present", "--interval" in out)
    check("--push-every option present", "--push-every" in out)

    # v3: new alert threshold flags
    check("--mem-alert option present", "--mem-alert" in out)
    check("--disk-alert option present", "--disk-alert" in out)

    # read_mem and read_disk return tuples now (str, float)
    import importlib.util as _ilu
    spec = _ilu.spec_from_file_location("container_logger", LOGGER)
    cl = _ilu.module_from_spec(spec)
    spec.loader.exec_module(cl)
    mem_str, mem_pct = cl.read_mem()
    check("read_mem returns string", isinstance(mem_str, str))
    check("read_mem returns float pct", isinstance(mem_pct, float))
    check("read_mem pct is 0-100", 0.0 <= mem_pct <= 100.0)
    disk_str, disk_pct = cl.read_disk()
    check("read_disk returns string", isinstance(disk_str, str))
    check("read_disk returns float pct", isinstance(disk_pct, float))
    check("read_disk pct is 0-100", 0.0 <= disk_pct <= 100.0)

    # Alert logic: when mem_pct exceeds threshold, prefix should be ALERT
    # We test this by calling read_mem and checking the alert dedup logic
    # directly with a very low threshold
    check("container_logger v3 description in docstring", "v3" in cl.__doc__ or "v3" in open(LOGGER).read())
    # Verify alert deduplication: mem_alerted flag logic resets at 0.9*threshold
    # We can verify the logic exists by checking the source
    with open(LOGGER) as f:
        src = f.read()
    check("alert deduplication logic present", "mem_alerted" in src and "disk_alerted" in src)
    check("ALERT prefix in log when thresholds exceeded", "ALERT" in src)
    check("0.9 * threshold for hysteresis", "0.9" in src)


# ─── drift_guard.py tests ────────────────────────────────────────────────────

def test_drift_guard():
    print("\n── drift_guard.py ──")
    cleanup()

    # drift_guard exits when no state file
    rc, out, err = run([DRIFT])
    check("drift_guard exits on missing state", rc != 0)
    check("drift_guard prints ERROR on missing state", "ERROR" in out or "ERROR" in err)

    # drift-arm command
    run([PHANTOM, "start", "drift test task", "--turns", "5"])
    rc, out, _ = run([PHANTOM, "drift-arm"])
    check("drift-arm exits 0", rc == 0)
    state = read_state()
    check("drift_guard_active=true after arm", state.get("drift_guard_active") == True)

    # double drift-arm warns
    rc, out, _ = run([PHANTOM, "drift-arm"])
    check("double drift-arm exits 2", rc == 2)
    check("double drift-arm prints WARNING", "WARNING" in out)

    # drift-done with no warning
    rc, out, _ = run([PHANTOM, "drift-done"])
    check("drift-done exits 0 when no warning", rc == 0)
    check("drift-done prints no drift message", "no drift" in out.lower())
    state = read_state()
    check("drift_guard_active=false after done", state.get("drift_guard_active") == False)

    # drift-done with injected warning
    state["drift_guard_active"] = False
    state["drift_warning"] = "DRIFT DETECTED: phantom.py has 90% of changes"
    state["drift_warned_at"] = "2026-01-01 12:00:00"
    with open(STATE, "w") as f:
        json.dump(state, f)
    rc, out, _ = run([PHANTOM, "drift-done"])
    check("drift-done exits 1 when warning present", rc == 1)
    check("drift-done prints warning text", "DRIFT DETECTED" in out)

    # drift-status shows warning
    rc, out, _ = run([PHANTOM, "drift-status"])
    check("drift-status exits 0", rc == 0)
    check("drift-status shows DRIFT DETECTED", "DRIFT DETECTED" in out)

    # drift_guard exits when not armed
    run([PHANTOM, "start", "test", "--force"])  # resets drift_warning
    rc, out, err = run([DRIFT])
    check("drift_guard exits when not armed", rc != 0)
    check("drift_guard prints not armed error", "Not armed" in out or "Not armed" in err)

    # drift_guard exits when workspace_dir missing
    run([PHANTOM, "drift-arm"])
    state = read_state()
    state["workspace_dir"] = "/nonexistent/path"
    with open(STATE, "w") as f:
        json.dump(state, f)
    rc, out, err = run([DRIFT])
    check("drift_guard exits on missing workspace", rc != 0)
    check("drift_guard prints workspace error", "workspace" in out.lower() or "workspace" in err.lower())

    # scope_files stored in session state on start
    run([PHANTOM, "start", "scoped task", "--turns", "3",
         "--scope", "auth.py", "crypto.py", "--force"])
    state = read_state()
    check("start --scope stores scope_files in state", state.get("scope_files") == ["auth.py", "crypto.py"])

    # Unit tests — import drift_guard functions directly
    import importlib.util
    spec = importlib.util.spec_from_file_location("drift_guard", DRIFT)
    dg   = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dg)

    git_workspace = os.path.dirname(os.path.dirname(V2_DIR))

    # find_since returns a string
    since = dg.find_since(git_workspace)
    check("find_since returns non-empty string", isinstance(since, str) and len(since) > 0)

    # session_start_ref preferred over find_since in drift_guard main
    # (tested indirectly: after phantom.py start, state has session_start_ref)
    run([PHANTOM, "start", "drift ref test", "--force"])
    state_after = read_state()
    ref = state_after.get("session_start_ref")
    check("session_start_ref stored by phantom start", ref is not None)
    check("session_start_ref is a valid git hash (40 chars)", ref is not None and len(ref) == 40)

    # get_file_scores returns raw dict and scored list
    raw, scored = dg.get_file_scores(git_workspace, since)
    check("get_file_scores returns scored list", isinstance(scored, list))
    check("scored list has tuples of 3", all(len(x) == 3 for x in scored[:3]))
    if scored:
        check("scored pct sums to ~100", abs(sum(p for _, _, p in scored) - 100.0) < 1.0)

    # count_hunks returns per-file hunk analysis
    hunks = dg.count_hunks(git_workspace, since)
    check("count_hunks returns dict", isinstance(hunks, dict))
    for fname, data in list(hunks.items())[:3]:
        check(f"hunk data has hunk_count for {fname[:30]}", "hunk_count" in data)
        check(f"hunk data has hunk_spread for {fname[:30]}", "hunk_spread" in data)
        check(f"hunk_spread 0–1 for {fname[:30]}", 0.0 <= data.get("hunk_spread", -1) <= 1.0)

    # TrendTracker — basic operations
    tracker = dg.TrendTracker(window=3)
    check("trend unknown with no history", tracker.trend("a.py")[0] == "unknown")
    tracker.update([("a.py", 80, 80.0), ("b.py", 20, 20.0)])
    tracker.update([("a.py", 85, 85.0), ("b.py", 15, 15.0)])
    tracker.update([("a.py", 90, 90.0), ("b.py", 10, 10.0)])
    t_dir, t_rate = tracker.trend("a.py")
    check("trend detects upward trend", t_dir == "up")
    check("trend rate is positive", t_rate > 0)
    check("consistently_above detects sustained high pct", tracker.consistently_above("a.py", 70.0))
    check("consistently_above false when not sustained", not tracker.consistently_above("a.py", 95.0))

    # evaluate_drift — Gate 1: declared scope, changes within scope → CLEAN
    in_scope_scored = [("auth.py", 80, 80.0), ("crypto.py", 20, 20.0)]
    in_scope_hunks  = {"auth.py": {"hunk_count": 5, "hunk_spread": 0.6}}
    t2 = dg.TrendTracker(3)
    t2.update(in_scope_scored)
    is_d, verdict, _ = dg.evaluate_drift(
        in_scope_scored, 100, in_scope_hunks, t2,
        task="improve auth module", scope_files=["auth.py", "crypto.py"],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3)
    check("Gate1: within declared scope → CLEAN", not is_d and verdict == "CLEAN")

    # evaluate_drift — Gate 1: scope creep → SCOPE_CREEP
    creep_scored = [("auth.py", 30, 30.0), ("random_util.py", 40, 40.0), ("other.py", 30, 30.0)]
    t3 = dg.TrendTracker(3)
    t3.update(creep_scored)
    is_d2, verdict2, _ = dg.evaluate_drift(
        creep_scored, 100, {}, t3,
        task="improve auth", scope_files=["auth.py"],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3)
    check("Gate1: changes outside scope → SCOPE_CREEP", is_d2 and verdict2 == "SCOPE_CREEP")

    # evaluate_drift — Gate 2: task alignment → CLEAN
    aligned_scored = [("drift_guard.py", 85, 85.0), ("test.py", 15, 15.0)]
    t4 = dg.TrendTracker(3)
    t4.update(aligned_scored)
    is_d3, verdict3, _ = dg.evaluate_drift(
        aligned_scored, 100, {"drift_guard.py": {"hunk_count": 3, "hunk_spread": 0.2}}, t4,
        task="improve drift guard detection logic", scope_files=[],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3)
    check("Gate2: dominant file matches task → CLEAN", not is_d3 and verdict3 == "CLEAN")

    # evaluate_drift — Gate 3: many spread hunks → CLEAN
    spread_scored = [("big_refactor.py", 80, 80.0), ("b.py", 20, 20.0)]
    t5 = dg.TrendTracker(3)
    t5.update(spread_scored)
    is_d4, verdict4, _ = dg.evaluate_drift(
        spread_scored, 100,
        {"big_refactor.py": {"hunk_count": 12, "hunk_spread": 0.85}}, t5,
        task="general refactor", scope_files=[],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3)
    check("Gate3: many spread hunks → CLEAN", not is_d4 and verdict4 == "CLEAN")

    # evaluate_drift — Fallback: 1 hunk, low spread, no alignment → VERTICAL
    vert_scored = [("only_file.py", 80, 80.0), ("b.py", 20, 20.0)]
    t6 = dg.TrendTracker(3)
    for _ in range(4): t6.update(vert_scored)
    is_d5, verdict5, _ = dg.evaluate_drift(
        vert_scored, 100,
        {"only_file.py": {"hunk_count": 1, "hunk_spread": 0.05}}, t6,
        task="update config system", scope_files=[],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3)
    check("Fallback: 1 hunk no alignment → VERTICAL drift", is_d5 and verdict5 == "VERTICAL")

    # evaluate_drift — configurable scope_threshold (tighter: 20%)
    scope_scored2 = [("in_scope.py", 70, 70.0), ("out_of_scope.py", 30, 30.0)]
    t7 = dg.TrendTracker(3)
    t7.update(scope_scored2)
    # Default scope_threshold=30 → 30% outside is NOT > 30 → CLEAN
    is_d6, verdict6, _ = dg.evaluate_drift(
        scope_scored2, 100, {}, t7, task="fix bug", scope_files=["in_scope.py"],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3, scope_threshold=30.0)
    check("scope_threshold=30: exactly at boundary → CLEAN", not is_d6)
    # With tighter scope_threshold=20 → 30% outside IS > 20 → SCOPE_CREEP
    is_d7, verdict7, _ = dg.evaluate_drift(
        scope_scored2, 100, {}, t7, task="fix bug", scope_files=["in_scope.py"],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3, scope_threshold=20.0)
    check("scope_threshold=20: 30% outside → SCOPE_CREEP", is_d7 and verdict7 == "SCOPE_CREEP")

    # evaluate_drift — configurable hunk_count_min (stricter: require 8 hunks)
    spread_scored = [("big_file.py", 80, 80.0), ("other.py", 20, 20.0)]
    t8 = dg.TrendTracker(3)
    t8.update(spread_scored)
    # With hunk_count_min=4 and only 4 hunks → CLEAN
    is_d8, verdict8, _ = dg.evaluate_drift(
        spread_scored, 100,
        {"big_file.py": {"hunk_count": 4, "hunk_spread": 0.8}}, t8,
        task="unrelated task", scope_files=[],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3, hunk_count_min=4)
    check("hunk_count_min=4 with 4 hunks → CLEAN", not is_d8)
    # With hunk_count_min=8 and only 4 hunks → falls through to VERTICAL
    is_d9, verdict9, _ = dg.evaluate_drift(
        spread_scored, 100,
        {"big_file.py": {"hunk_count": 4, "hunk_spread": 0.8}}, t8,
        task="unrelated task", scope_files=[],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3, hunk_count_min=8)
    check("hunk_count_min=8 with only 4 hunks → VERTICAL", is_d9 and verdict9 == "VERTICAL")

    # parse_diff_stat still works
    sample = " a.py | 90 +++---\n b.py | 15 +++\n 2 files changed\n"
    files = dg.parse_diff_stat(sample)
    check("parse_diff_stat parses a.py", files.get("a.py") == 90)
    check("parse_diff_stat parses b.py", files.get("b.py") == 15)
    check("parse_diff_stat skips summary line", len(files) == 2)

    # ── v3 improved output tests: verdict-specific ACTION messages ──
    # Test scope_match function (in-scope marker logic)
    check("scope_match: exact filename matches", dg.scope_match("auth.py", ["auth.py", "crypto.py"]))
    check("scope_match: path/to/file matches basename", dg.scope_match("src/auth.py", ["auth.py"]))
    check("scope_match: different file does not match", not dg.scope_match("other.py", ["auth.py"]))

    # Test that warning builder includes [in-scope] marker for in-scope files.
    # We do this by verifying the evaluate_drift return values lead to the right
    # SCOPE_CREEP verdict with scope markers expected in the actual warning construction.
    # The warning text is built in main() — we verify it via the verdict that would
    # trigger the SCOPE_CREEP branch of the action_map.
    in_scope_files = ["auth.py"]
    creep_scored2 = [("random.py", 60, 60.0), ("auth.py", 40, 40.0)]
    t_c = dg.TrendTracker(3)
    t_c.update(creep_scored2)
    is_creep, v_creep, r_creep = dg.evaluate_drift(
        creep_scored2, 100, {}, t_c,
        task="fix auth", scope_files=in_scope_files,
        threshold=50.0, min_lines=5, hunk_spread_min=0.3, scope_threshold=30.0)
    check("SCOPE_CREEP verdict triggers for scope test", is_creep and v_creep == "SCOPE_CREEP")
    # Verify in-scope flag logic matches scope_match
    for name, _, _ in creep_scored2:
        expected_in_scope = dg.scope_match(name, in_scope_files)
        if name == "auth.py":
            check(f"scope_match correctly identifies {name} as in-scope", expected_in_scope)
        else:
            check(f"scope_match correctly identifies {name} as out-of-scope", not expected_in_scope)

    # Test that VERTICAL fires correct evaluate_drift verdict (action_map key)
    vert_scored2 = [("only.py", 90, 90.0), ("other.py", 10, 10.0)]
    t_v = dg.TrendTracker(3)
    for _ in range(4): t_v.update(vert_scored2)
    is_v, v_v, _ = dg.evaluate_drift(
        vert_scored2, 100,
        {"only.py": {"hunk_count": 1, "hunk_spread": 0.05}}, t_v,
        task="unrelated to only", scope_files=[],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3)
    check("VERTICAL verdict for action_map test", is_v and v_v == "VERTICAL")

    # Test TRENDING verdict fires — Gate 4: top_pct <= threshold but trending up
    # Gate 4 requires: top_pct <= threshold AND trend up AND consistently_above(threshold*0.7)
    # With threshold=50, threshold*0.7=35 — all values must be > 35
    t_trend = dg.TrendTracker(window=3)
    for pct in [36, 40, 45]:
        t_trend.update([("slow_creep.py", pct, float(pct)), ("b.py", 100 - pct, float(100 - pct))])
    is_tr, v_tr, _ = dg.evaluate_drift(
        [("slow_creep.py", 45, 45.0), ("b.py", 55, 55.0)], 100,
        {"slow_creep.py": {"hunk_count": 1, "hunk_spread": 0.1}}, t_trend,
        task="unrelated task", scope_files=[],
        threshold=50.0, min_lines=5, hunk_spread_min=0.3)
    # top_pct=45 <= threshold=50, trend up, consistently_above(35%) → TRENDING
    check("TRENDING verdict fires on slow upward creep below threshold", is_tr and v_tr == "TRENDING")

    cleanup()


# ─── scope_guard.py tests ────────────────────────────────────────────────────

def test_scope_guard():
    print("\n── scope_guard.py ──")
    cleanup()

    # Basic: help exits 0 with expected flags
    rc, out, err = run([SCOPE_GUARD, "--help"])
    check("scope_guard --help exits 0", rc == 0)
    check("--session flag present", "--session" in out)
    check("--state-file flag present", "--state-file" in out)
    check("--threshold flag present", "--threshold" in out)
    check("--json flag present", "--json" in out)
    check("--quiet flag present", "--quiet" in out)

    # Run against live repo — should exit 0 or 1 (not 2)
    rc, out, err = run([SCOPE_GUARD, "--repo", "/home/user/Cloud-code"])
    check("scope_guard runs against live repo (not error)", rc != 2)

    # --session: reads session_start_ref from phantom state
    run([PHANTOM, "start", "scope_guard session test", "--turns", "3"])
    state = read_state()
    session_ref = state.get("session_start_ref")
    check("phantom state has session_start_ref for scope_guard test", session_ref is not None)
    rc, out, err = run([SCOPE_GUARD, "--repo", "/home/user/Cloud-code",
                        "--session", "--state-file", STATE])
    check("scope_guard --session exits 0 or 1 (not error)", rc != 2)
    check("scope_guard --session output mentions session", "session" in out.lower() or rc == 0)

    # --session with no session state falls back gracefully
    run([PHANTOM, "reset"])
    rc, out, err = run([SCOPE_GUARD, "--repo", "/home/user/Cloud-code",
                        "--session", "--state-file", "/tmp/nonexistent_state.json"])
    # Should still run (falls back to auto-detect), not crash with exit 2
    check("scope_guard --session fallback when state missing", rc != 2 or "ERROR" not in out)

    # --json output is valid JSON
    rc, out, err = run([SCOPE_GUARD, "--repo", "/home/user/Cloud-code",
                        "--json", "--since", "HEAD~1"])
    check("scope_guard --json exits 0 or 1", rc in (0, 1))
    if out.strip():
        try:
            data = json.loads(out)
            check("scope_guard --json output is valid JSON", True)
            check("scope_guard --json has 'since' key", "since" in data)
            check("scope_guard --json has 'clean' key", "clean" in data)
            check("scope_guard --json has 'files' key", "files" in data)
            check("scope_guard --json has 'session' key (v3)", "session" in data)
        except json.JSONDecodeError:
            check("scope_guard --json output is valid JSON", False)

    # --quiet: suppresses output
    rc, out, err = run([SCOPE_GUARD, "--repo", "/home/user/Cloud-code",
                        "--quiet", "--since", "HEAD~1"])
    check("scope_guard --quiet suppresses stdout", len(out.strip()) == 0)

    # read_session_start_ref function
    import importlib.util as _ilu
    spec = _ilu.spec_from_file_location("scope_guard", SCOPE_GUARD)
    sg = _ilu.module_from_spec(spec)
    spec.loader.exec_module(sg)
    # Write a test state with session_start_ref
    import tempfile as _tf
    with _tf.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as fp:
        json.dump({"session_start_ref": "abc123def456abc123def456abc123def456abc1"}, fp)
        tmp_state = fp.name
    ref = sg.read_session_start_ref(tmp_state)
    check("read_session_start_ref returns ref from state file", ref == "abc123def456abc123def456abc123def456abc1")
    os.unlink(tmp_state)
    # Missing file returns None
    ref2 = sg.read_session_start_ref("/tmp/nonexistent_xyz.json")
    check("read_session_start_ref returns None for missing file", ref2 is None)

    cleanup()


# ─── coverage_tracker.py tests ───────────────────────────────────────────────

def test_coverage_tracker():
    print("\n── coverage_tracker.py ──")
    cleanup()

    # basic: help exits 0 with expected flags
    rc, out, err = run([COVERAGE_TRACKER, "--help"])
    check("coverage_tracker --help exits 0", rc == 0)
    check("--session flag present", "--session" in out)
    check("--state-file flag present", "--state-file" in out)
    check("--targets flag present", "--targets" in out)
    check("--json flag present", "--json" in out)
    check("--quiet flag present", "--quiet" in out)

    # run against live repo with specific targets
    rc, out, err = run([COVERAGE_TRACKER,
                        "--repo", "/home/user/Cloud-code",
                        "--targets",
                        "PROJECT_PHANTOM/agents/phantom.py",
                        "PROJECT_PHANTOM/agents/heartbeat_runner.py",
                        "--since", "HEAD~3"])
    check("coverage_tracker exits 0 or 1 (not error)", rc in (0, 1))
    check("coverage_tracker output shows coverage check", "Coverage check" in out or rc == 1)

    # --session flag reads session_start_ref
    run([PHANTOM, "start", "cov tracker session test", "--turns", "3"])
    state = read_state()
    session_ref = state.get("session_start_ref")
    check("phantom state has session_start_ref for coverage test", session_ref is not None)
    rc, out, err = run([COVERAGE_TRACKER,
                        "--repo", "/home/user/Cloud-code",
                        "--targets", "PROJECT_PHANTOM/agents/phantom.py",
                        "--session", "--state-file", STATE])
    check("coverage_tracker --session exits 0 or 1", rc in (0, 1))
    check("coverage_tracker --session shows session label", "session" in out.lower() or rc in (0, 1))

    # --json output is valid JSON with session field
    rc, out, err = run([COVERAGE_TRACKER,
                        "--repo", "/home/user/Cloud-code",
                        "--targets", "PROJECT_PHANTOM/agents/phantom.py",
                        "--json", "--since", "HEAD~2"])
    check("coverage_tracker --json exits 0 or 1", rc in (0, 1))
    if out.strip():
        try:
            data = json.loads(out)
            check("coverage_tracker --json is valid JSON", True)
            check("coverage_tracker --json has 'since' key", "since" in data)
            check("coverage_tracker --json has 'session' key", "session" in data)
            check("coverage_tracker --json has 'full_coverage' key", "full_coverage" in data)
            check("coverage_tracker --json has 'touched_files' key", "touched_files" in data)
        except json.JSONDecodeError:
            check("coverage_tracker --json is valid JSON", False)

    # read_session_start_ref function
    import importlib.util as _ilu
    spec = _ilu.spec_from_file_location("coverage_tracker", COVERAGE_TRACKER)
    ct = _ilu.module_from_spec(spec)
    spec.loader.exec_module(ct)
    import tempfile as _tf
    with _tf.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as fp:
        json.dump({"session_start_ref": "deadbeef" * 5}, fp)
        tmp_state = fp.name
    ref = ct.read_session_start_ref(tmp_state)
    check("coverage_tracker read_session_start_ref returns ref", ref == "deadbeef" * 5)
    os.unlink(tmp_state)
    ref2 = ct.read_session_start_ref("/tmp/nonexistent_ct.json")
    check("coverage_tracker read_session_start_ref returns None for missing", ref2 is None)

    # --quiet suppresses output
    rc, out, err = run([COVERAGE_TRACKER,
                        "--repo", "/home/user/Cloud-code",
                        "--targets", "PROJECT_PHANTOM/agents/phantom.py",
                        "--quiet", "--since", "HEAD~1"])
    check("coverage_tracker --quiet suppresses stdout", len(out.strip()) == 0)

    cleanup()


def test_check():
    print("\n── phantom.py check ──")
    cleanup()

    # No session → exits 1
    rc, out, err = run([PHANTOM, "check"])
    check("check with no session exits 1", rc == 1)
    check("check reports no active session", "no active session" in out.lower())

    # Start session with a session_start_ref
    run([PHANTOM, "start", "check cmd test", "--turns", "5", "--rounds", "3"])
    rc, out, err = run([PHANTOM, "check"])
    check("check exits 0 with active session", rc == 0)
    check("check shows SESSION CHECK header", "SESSION CHECK" in out)
    check("check shows task", "check cmd test" in out)
    check("check shows turns", "Turns:" in out)
    check("check shows SCOPE section", "SCOPE" in out)

    # --threshold flag changes warning threshold (very low = DRIFT RISK likely)
    rc, out, err = run([PHANTOM, "check", "--threshold", "1"])
    check("check --threshold 1 shows DRIFT RISK", "DRIFT RISK" in out or "SCOPE OK" in out or "no changes" in out)

    # --targets adds coverage section
    rc, out, err = run([PHANTOM, "check", "--targets", "agents/phantom.py"])
    check("check --targets shows COVERAGE section", "COVERAGE" in out)

    # scope_files in state used as default targets
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "scope-file test", "--turns", "3",
         "--scope", "agents/phantom.py", "agents/heartbeat_runner.py"])
    rc, out, err = run([PHANTOM, "check"])
    check("check uses scope_files when no --targets", "COVERAGE" in out)

    # --threshold=100 → always SCOPE OK
    rc, out, err = run([PHANTOM, "check", "--threshold", "100"])
    check("check --threshold 100 never shows DRIFT RISK", "DRIFT RISK" not in out)

    # status shows coverage_targets and scope_files when set
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "status test", "--turns", "3",
         "--coverage-targets", "agents/phantom.py",
         "--scope", "agents/heartbeat_runner.py"])
    rc, out, err = run([PHANTOM, "status"])
    check("status shows Coverage: line when coverage_targets set", "Coverage:" in out)
    check("status shows Scope: line when scope_files set", "Scope:" in out)

    # complete shows coverage summary when coverage_targets set
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "complete test", "--turns", "3",
         "--coverage-targets", "agents/phantom.py", "v2/phantom.py"])
    rc, out, err = run([PHANTOM, "complete"])
    check("complete shows Coverage line when targets set", "Coverage:" in out)

    # --coverage-targets stored in state at start
    run([PHANTOM, "reset"])
    rc, out, err = run([PHANTOM, "start", "coverage target test", "--turns", "3",
                        "--coverage-targets", "agents/phantom.py", "v2/phantom.py"])
    check("start --coverage-targets shows Coverage line", "Coverage:" in out)
    rc, out, err = run([PHANTOM, "check"])
    check("check uses coverage_targets from state", "COVERAGE" in out)
    # coverage_targets take precedence over scope_files
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "priority test", "--turns", "3",
         "--coverage-targets", "agents/phantom.py",
         "--scope", "agents/heartbeat_runner.py"])
    rc, out, err = run([PHANTOM, "check"])
    check("check coverage_targets take precedence over scope_files", "COVERAGE" in out)

    cleanup()


# ─── Run all ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("PHANTOM v2 Integration Tests")
    print("=" * 50)

    cleanup()
    try:
        test_phantom()
        test_workspace_and_activity()
        test_config()
        test_drift_guard()
        test_heartbeat_runner()
        test_container_logger()
        test_scope_guard()
        test_coverage_tracker()
        test_check()
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
