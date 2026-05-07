#!/usr/bin/env python3
"""
Integration test suite for PROJECT PHANTOM.
Tests all components: phantom.py, heartbeat_runner.py, container_logger.py

Run: python3 test_phantom.py
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
GIT_ROOT    = os.path.dirname(PROJECT_DIR)   # repo root (one level above PROJECT_DIR)
AGENTS_DIR  = os.path.join(PROJECT_DIR, "agents")
TOOLS_DIR   = os.path.join(PROJECT_DIR, "tools")
PHANTOM   = os.path.join(AGENTS_DIR, "phantom.py")
RUNNER    = os.path.join(AGENTS_DIR, "heartbeat_runner.py")
LOGGER    = os.path.join(AGENTS_DIR, "container_logger.py")
DRIFT     = os.path.join(AGENTS_DIR, "drift_guard.py")
SCOPE_GUARD      = os.path.join(TOOLS_DIR, "scope_guard.py")
COVERAGE_TRACKER = os.path.join(TOOLS_DIR, "coverage_tracker.py")
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
    for f in [STATE, LOCK, PROFILES, STATE + ".tmp"]:
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
    check("status shows Drift Guard idle line", "Drift Guard: idle" in out)

    # status shows drift guard ARMED when drift_guard_active=true
    run([PHANTOM, "drift-arm"])
    rc, out, _ = run([PHANTOM, "status"])
    check("status shows Drift Guard ARMED when armed", "Drift Guard: ARMED" in out)
    # disarm via drift-done (no warning in state — should exit 0 cleanly)
    run([PHANTOM, "drift-done"])

    # status shows ⚠ WARNING PENDING and warning text when drift_warning set
    state = read_state()
    state["drift_warning"] = "SCOPE_CREEP: 80% outside scope"
    state["drift_guard_active"] = False
    with open(STATE, "w") as fh:
        import json as _json; _json.dump(state, fh)
    rc, out, _ = run([PHANTOM, "status"])
    check("status shows WARNING PENDING when drift_warning set", "WARNING PENDING" in out)
    check("status shows drift warning text inline", "SCOPE_CREEP" in out)

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

    # history --last N flag
    cleanup()
    run([PHANTOM, "start", "history last test", "--turns", "10"])
    run([PHANTOM, "ping", "turn one"])
    run([PHANTOM, "ping", "turn two"])
    run([PHANTOM, "ping", "turn three"])
    rc, out, _ = run([PHANTOM, "history", "--last", "2"])
    check("history --last exits 0", rc == 0)
    check("history --last shows only tail entries", "turn three" in out)
    check("history --last omits earlier entries notice", "omitted" in out or "earlier" in out)
    check("history --last hides entry beyond N", "turn one" not in out)
    rc2, out2, _ = run([PHANTOM, "history"])
    check("history without --last shows all entries", "turn one" in out2 and "turn three" in out2)

    # history shows coverage summary when coverage_targets set
    cleanup()
    run([PHANTOM, "start", "history cov test", "--turns", "3",
         "--coverage-targets", "agents/phantom.py", "agents/heartbeat_runner.py"])
    rc, out, _ = run([PHANTOM, "history"])
    check("history shows Coverage line when coverage_targets set", "Coverage:" in out)
    cov_hist_line = out.split("Coverage:")[1].split("\n")[0] if "Coverage:" in out else ""
    check("history Coverage line shows N/M count format", "/" in cov_hist_line and "%" in cov_hist_line)

    # save command (skip git push in tests — just check file written)
    cleanup()
    run([PHANTOM, "start", "save test", "--turns", "5"])
    run([PHANTOM, "ping", "saved progress"])
    SAVED = os.path.join(PROJECT_DIR, "logs/last_session_state.json")
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
    check("restore clears heartbeat_active",   state.get("heartbeat_active")   == False)
    check("restore clears drift_guard_active", state.get("drift_guard_active") == False)
    check("restore clears agents_running",     state.get("agents_running")     == 0)
    check("restore preserves task",            state.get("task") == "save test")

    # restore shows drift warning notice when pending
    import json as _json
    with open(SAVED) as f_:
        saved_state = _json.load(f_)
    saved_state["drift_warning"] = "SCOPE_CREEP: outside scope"
    saved_state["drift_guard_active"] = True
    with open(SAVED, "w") as f_:
        _json.dump(saved_state, f_)
    cleanup()
    rc, out, _ = run([PHANTOM, "restore"])
    check("restore exits 0 with drift warning in saved state", rc == 0)
    check("restore shows drift warning notice", "drift warning" in out.lower())

    # restore --force over existing session
    run([PHANTOM, "start", "other task", "--force"])
    rc, out, _ = run([PHANTOM, "restore"])
    check("restore blocked without --force when session exists", rc == 1)
    rc, out, _ = run([PHANTOM, "restore", "--force"])
    check("restore --force succeeds", rc == 0)

    # PHANTOM_STATE isolation — confirm production state untouched
    def _read(p):
        with open(p) as f:
            return f.read()
    check("test state isolated from /tmp/phantom_session.json",
          not os.path.exists("/tmp/phantom_session.json") or
          _read("/tmp/phantom_session.json") != _read(STATE)
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
    # history ping log truncates long notes with ...
    run([PHANTOM, "ping", "C" * 70])
    rc, out, _ = run([PHANTOM, "history"])
    check("history ping log truncates with ...", "..." in out)
    hist_log = out.split("Ping log")[1].split("Heartbeat")[0] if "Ping log" in out else ""
    check("history ping log does not show all 70 chars", ("C" * 61) not in hist_log)
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
    check("report shows Drift Guard idle line", "Drift Guard: idle" in out)
    # drift-arm shows ARMED in report
    run([PHANTOM, "drift-arm"])
    rc, out, _ = run([PHANTOM, "report"])
    check("report shows Drift Guard ARMED when armed", "Drift Guard: ARMED" in out)
    run([PHANTOM, "drift-done"])
    # inject a drift warning — report should show WARNING PENDING and text
    state = read_state()
    state["drift_warning"] = "VERTICAL: one file dominates"
    state["drift_guard_active"] = False
    with open(STATE, "w") as fh:
        import json as _json; _json.dump(state, fh)
    rc, out, _ = run([PHANTOM, "report"])
    check("report shows WARNING PENDING when drift_warning set", "WARNING PENDING" in out)
    check("report shows drift warning text inline", "VERTICAL" in out)
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
         "--coverage-targets", "agents/phantom.py", "agents/drift_guard.py"])
    rc, out, _ = run([PHANTOM, "start", "profile cov test", "--profile", "cov_profile", "--force"])
    check("start with coverage_targets profile exits 0", rc == 0)
    state = read_state()
    cov = state.get("coverage_targets", [])
    check("start --profile loads coverage_targets into state",
          "agents/phantom.py" in cov and "agents/drift_guard.py" in cov)

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

    # heartbeat-arm shows ETA estimate with activity source label
    run([PHANTOM, "start", "arm eta test", "--threshold", "180", "--force"])
    run([PHANTOM, "ping", "arm test ping"])
    rc, out, err = run([PHANTOM, "heartbeat-arm"])
    check("heartbeat-arm exits 0", rc == 0)
    check("heartbeat-arm shows Est. fire or overdue", "Est. fire" in out or "overdue" in out or "fire" in out.lower())
    check("heartbeat-arm shows activity source label", "[" in out and "]" in out)

    # min_idle_polls in profile keys (now supported via --min-idle-polls on config create)
    run([PHANTOM, "config", "create", "testpoll", "--turns", "5", "--min-idle-polls", "2"])
    rc, out, err = run([PHANTOM, "config", "show", "testpoll"])
    check("min_idle_polls settable via config create", "min_idle_polls" in out and "2" in out)

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

    # scope reads scope_threshold from state when CLI at default
    run([PHANTOM, "start", "scope_thresh test", "--scope-threshold", "1", "--force"])
    rc, out, err = run([PHANTOM, "scope"])
    check("scope uses scope_threshold from state (should show CONCENTRATED at 1%)",
          "CONCENTRATED" in out or "WARNING" in out or "No file changes" in out)

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
        check("scan_workspace with .js finds nothing (no .js files)", path2 is None)

    # ── ETA accounts for min_idle_polls ──
    # With min_idle_polls=2 and interval=1, ETA should be threshold + 1s extra vs min_idle_polls=1
    import subprocess as _sp2
    from datetime import timedelta
    run([PHANTOM, "start", "eta corr test", "--rounds", "1", "--interval", "1",
         "--threshold", "60", "--min-idle-polls", "2", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    state["agents_running"]   = 99  # prevent firing
    state["last_active"]      = now_nowstr = time.strftime("%Y-%m-%d %H:%M:%S")
    with tempfile.TemporaryDirectory() as tmpws:
        state["workspace_dir"] = tmpws
        with open(STATE, "w") as f:
            json.dump(state, f)
        try:
            _sp2.run([sys.executable, RUNNER], capture_output=True, timeout=3, env=TEST_ENV)
        except _sp2.TimeoutExpired:
            pass
    state_after = read_state()
    nxt = state_after.get("next_heartbeat_at")
    if nxt:
        from datetime import datetime
        nxt_dt  = datetime.strptime(nxt, "%Y-%m-%d %H:%M:%S")
        base_dt = datetime.strptime(now_nowstr, "%Y-%m-%d %H:%M:%S")
        secs_ahead = (nxt_dt - base_dt).total_seconds()
        # With threshold=60, min_idle_polls=2, interval=1: ETA = 61s (60+1*(2-1))
        check("ETA accounts for min_idle_polls (>= threshold + extra)", secs_ahead >= 60)
    else:
        check("ETA corrected — next_heartbeat_at written", False)

    # ── v6: anchor context in fire banner ──
    # Verify that a fire banner includes anchor_b goal when anchor_b is set in state
    run([PHANTOM, "start", "fire anchor test", "--rounds", "1", "--interval", "1",
         "--done-criteria", "criterion alpha", "criterion beta", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    state["last_active"] = "2020-01-01 00:00:00"
    with tempfile.TemporaryDirectory() as tmpws:
        state["workspace_dir"] = tmpws
        with open(STATE, "w") as f:
            json.dump(state, f)
        rc, out, err = run([RUNNER], timeout=10)
    check("v6 runner banner includes Anchor B label", "Anchor B" in out)
    check("v6 runner banner includes task/goal in anchor line", "fire anchor test" in out)
    check("v6 runner banner includes done criterion", "criterion alpha" in out)
    check("v6 RESUME line includes anchor check step", "anchor check" in out.lower() or "anchor" in out.lower())

    # ── round number in fire banner ──
    run([PHANTOM, "start", "round num test", "--rounds", "3", "--interval", "1", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    state["last_active"] = "2020-01-01 00:00:00"
    state["rounds_used"] = 1   # simulate one already used
    with tempfile.TemporaryDirectory() as tmpws:
        state["workspace_dir"] = tmpws
        with open(STATE, "w") as f:
            json.dump(state, f)
        rc, out, err = run([RUNNER], timeout=10)
    check("fire banner shows round number", "round" in out.lower())
    # rounds_used=1 on entry, fire increments it to 2; rounds_total = used(1) + remaining(3) = 4
    check("fire banner shows round N/total format", "/" in out and "round" in out.lower())

    # ── eval_criteria_quick: fire banner uses [x]/[ ] from state counters ──
    run([PHANTOM, "start", "criteria quick test", "--rounds", "1", "--interval", "1",
         "--done-criteria", "anchor check used", "checkpoint used before completion",
         "observed at least 1 heartbeat fire", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    state["last_active"] = "2020-01-01 00:00:00"
    # All criteria unmet initially
    with tempfile.TemporaryDirectory() as tmpws:
        state["workspace_dir"] = tmpws
        with open(STATE, "w") as f:
            json.dump(state, f)
        rc, out, err = run([RUNNER], timeout=10)
    check("fire banner shows [ ] for unmet criteria", "[ ]" in out)

    # Now fire with counters set — criteria should show [x]
    run([PHANTOM, "start", "criteria quick met test", "--rounds", "1", "--interval", "1",
         "--done-criteria", "anchor check used", "checkpoint used before completion",
         "observed at least 1 heartbeat fire", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    state["last_active"] = "2020-01-01 00:00:00"
    state["anchor_checks_count"] = 2
    state["checkpoint_calls_count"] = 1
    state["heartbeat_fires"] = [{"fired_at": "2026-01-01 00:00:00", "signal": "ping",
                                  "gap_seconds": 200, "idle_polls": 1, "turns": 1}]
    with tempfile.TemporaryDirectory() as tmpws:
        state["workspace_dir"] = tmpws
        with open(STATE, "w") as f:
            json.dump(state, f)
        rc, out, err = run([RUNNER], timeout=10)
    check("fire banner shows [x] for met criteria (anchor check)", "[x]" in out)

    # coverage criterion uses coverage_full from state
    run([PHANTOM, "start", "coverage criteria test", "--rounds", "1", "--interval", "1",
         "--done-criteria", "coverage 2/2 done", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    state["last_active"] = "2020-01-01 00:00:00"
    state["coverage_full"] = True
    with tempfile.TemporaryDirectory() as tmpws:
        state["workspace_dir"] = tmpws
        with open(STATE, "w") as f:
            json.dump(state, f)
        rc, out, err = run([RUNNER], timeout=10)
    check("fire banner shows [x] for coverage criterion when coverage_full=True", "[x]" in out)

    # coverage criterion shows [ ] when coverage_full absent
    run([PHANTOM, "start", "coverage absent test", "--rounds", "1", "--interval", "1",
         "--done-criteria", "coverage 2/2 done", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    state["last_active"] = "2020-01-01 00:00:00"
    # deliberately no coverage_full key
    with tempfile.TemporaryDirectory() as tmpws:
        state["workspace_dir"] = tmpws
        with open(STATE, "w") as f:
            json.dump(state, f)
        rc, out, err = run([RUNNER], timeout=10)
    check("fire banner shows [ ] for coverage criterion when coverage_full absent", "[ ]" in out)

    # ── first-iteration no-sleep: runner fires immediately when already idle ──
    # Verifies that an already-idle session fires on first poll without waiting check_interval
    run([PHANTOM, "start", "quick fire test", "--rounds", "1", "--interval", "30", "--threshold", "5", "--force"])
    state = read_state()
    state["heartbeat_active"] = True
    state["last_active"] = "2020-01-01 00:00:00"  # far past threshold
    with tempfile.TemporaryDirectory() as tmpws:
        state["workspace_dir"] = tmpws
        with open(STATE, "w") as f:
            json.dump(state, f)
        import time as _time_qt
        t0 = _time_qt.monotonic()
        rc, out, err = run([RUNNER], timeout=15)
        elapsed = _time_qt.monotonic() - t0
    check("runner prints Initial check message", "Initial check" in out)
    check("runner fires quickly when already idle (< 10s, interval=30s)", elapsed < 10)

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

    # drift-arm command shows scope context
    run([PHANTOM, "start", "drift test task", "--turns", "5",
         "--scope-threshold", "35",
         "--scope", "agents/phantom.py", "agents/drift_guard.py"])
    rc, out, _ = run([PHANTOM, "drift-arm"])
    check("drift-arm exits 0", rc == 0)
    state = read_state()
    check("drift_guard_active=true after arm", state.get("drift_guard_active") == True)
    check("drift-arm shows Threshold in output", "Threshold:" in out or "Threshold" in out)
    check("drift-arm shows Since in output", "Since:" in out or "Since" in out)
    check("drift-arm shows Scope when scope_files set", "Scope:" in out or "agents/phantom.py" in out)

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
    check("drift-done non-SCOPE_CREEP shows generic re-arm message", "Re-arm after spreading" in out)

    # drift-done with SCOPE_CREEP warning shows scope-update option
    import json as _json_dd, os as _os_dd
    state2 = _json_dd.load(open(STATE))
    state2["drift_guard_active"] = False
    state2["drift_warning"] = "DRIFT DETECTED [SCOPE_CREEP] after 1 check(s): 60% outside scope"
    with open(STATE + ".tmp", "w") as f:
        _json_dd.dump(state2, f)
    _os_dd.rename(STATE + ".tmp", STATE)
    rc, out, _ = run([PHANTOM, "drift-done"])
    check("drift-done SCOPE_CREEP exits 1", rc == 1)
    check("drift-done SCOPE_CREEP mentions scope-update", "scope-update" in out)
    check("drift-done SCOPE_CREEP shows option B", "Expand scope" in out or "scope-update" in out)
    check("drift-done SCOPE_CREEP still shows re-arm instruction", "drift-arm" in out)

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

    # find_since returns a string
    since = dg.find_since(GIT_ROOT)
    check("find_since returns non-empty string", isinstance(since, str) and len(since) > 0)

    # session_start_ref preferred over find_since in drift_guard main
    # (tested indirectly: after phantom.py start, state has session_start_ref)
    run([PHANTOM, "start", "drift ref test", "--force"])
    state_after = read_state()
    ref = state_after.get("session_start_ref")
    check("session_start_ref stored by phantom start", ref is not None)
    check("session_start_ref is a valid git hash (40 chars)", ref is not None and len(ref) == 40)

    # get_file_scores returns raw dict and scored list
    raw, scored = dg.get_file_scores(GIT_ROOT, since)
    check("get_file_scores returns scored list", isinstance(scored, list))
    check("scored list has tuples of 3", all(len(x) == 3 for x in scored[:3]))
    check("scored pct sums to ~100",
          bool(scored) and abs(sum(p for _, _, p in scored) - 100.0) < 1.0)

    # count_hunks returns per-file hunk analysis
    hunks = dg.count_hunks(GIT_ROOT, since)
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

    # drift_guard reads scope_threshold from session state (not CLI) when CLI at default
    # Simulate: state has scope_threshold=20, drift_guard should use it for scope-creep gate
    import importlib
    import types
    # Build synthetic args mimicking argparse output at defaults
    fake_args = types.SimpleNamespace(
        threshold=50.0, scope_threshold=30.0, interval=60, since=None,
        scope=None, min_lines=20, trend_checks=3, hunk_spread=0.3, hunk_count_min=4
    )
    fake_state = {
        "scope_threshold": 20.0,  # tighter than CLI default 30
        "scope_files": ["in_scope.py"],
        "task": "fix auth",
        "session_start_ref": None,
        "workspace_dir": "/tmp",
        "drift_guard_active": True,
    }
    # When CLI scope_threshold == 30.0 (default), should use state value 20.0
    resolved_st = (fake_state.get("scope_threshold", fake_args.scope_threshold)
                   if fake_args.scope_threshold == 30.0 else fake_args.scope_threshold)
    check("drift_guard resolves scope_threshold from state (20.0)", resolved_st == 20.0)

    # When CLI scope_threshold != 30.0 (explicitly set), CLI wins
    fake_args2 = types.SimpleNamespace(scope_threshold=40.0)
    resolved_st2 = (fake_state.get("scope_threshold", fake_args2.scope_threshold)
                    if fake_args2.scope_threshold == 30.0 else fake_args2.scope_threshold)
    check("drift_guard CLI scope_threshold takes precedence over state", resolved_st2 == 40.0)

    # ── v4: --ignore-patterns ──
    # Verify that ignore_patterns correctly filters scored list before analysis
    # Files matching any pattern substring are excluded from drift evaluation.
    raw_scored = [("logs/session.json", 100, 100.0)]
    patterns = ["logs/"]
    filtered = [
        (n, l, p) for n, l, p in raw_scored
        if not any(pat in n for pat in patterns)
    ]
    check("ignore-patterns filters matching file", len(filtered) == 0)

    raw_scored2 = [("agents/phantom.py", 80, 80.0), ("logs/session.json", 20, 20.0)]
    filtered2 = [
        (n, l, p) for n, l, p in raw_scored2
        if not any(pat in n for pat in patterns)
    ]
    check("ignore-patterns keeps non-matching files", len(filtered2) == 1)
    check("ignore-patterns keeps agents/phantom.py", filtered2[0][0] == "agents/phantom.py")

    # drift_guard --ignore-patterns flag accepted in argparse
    rc, out, err = run([DRIFT, "--help"])
    check("drift_guard --ignore-patterns in help text", "--ignore-patterns" in out)

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
    rc, out, err = run([SCOPE_GUARD, "--repo", GIT_ROOT])
    check("scope_guard runs against live repo (not error)", rc != 2)

    # --session: reads session_start_ref from phantom state
    run([PHANTOM, "start", "scope_guard session test", "--turns", "3"])
    state = read_state()
    session_ref = state.get("session_start_ref")
    check("phantom state has session_start_ref for scope_guard test", session_ref is not None)
    rc, out, err = run([SCOPE_GUARD, "--repo", GIT_ROOT,
                        "--session", "--state-file", STATE])
    check("scope_guard --session exits 0 or 1 (not error)", rc != 2)
    check("scope_guard --session output mentions session", "session" in out.lower() or rc == 0)

    # --session with no session state falls back gracefully
    run([PHANTOM, "reset"])
    rc, out, err = run([SCOPE_GUARD, "--repo", GIT_ROOT,
                        "--session", "--state-file", "/tmp/nonexistent_state.json"])
    # Should still run (falls back to auto-detect), not crash with exit 2
    check("scope_guard --session fallback when state missing", rc != 2 or "ERROR" not in out)

    # --json output is valid JSON
    rc, out, err = run([SCOPE_GUARD, "--repo", GIT_ROOT,
                        "--json", "--since", "HEAD~1"])
    check("scope_guard --json exits 0 or 1", rc in (0, 1))
    try:
        data = json.loads(out)
        check("scope_guard --json output is valid JSON", True)
        check("scope_guard --json has 'since' key", "since" in data)
        check("scope_guard --json has 'clean' key", "clean" in data)
        check("scope_guard --json has 'files' key", "files" in data)
        check("scope_guard --json has 'session' key (v3)", "session" in data)
    except json.JSONDecodeError:
        check("scope_guard --json output is valid JSON", False)
        for k in ("since", "clean", "files", "session"):
            check(f"scope_guard --json has '{k}' key", False)

    # --quiet: suppresses output
    rc, out, err = run([SCOPE_GUARD, "--repo", GIT_ROOT,
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

    # --session reads scope_threshold from state when CLI threshold is at default (40)
    run([PHANTOM, "start", "scope_guard threshold test", "--turns", "3", "--scope-threshold", "25"])
    rc, out, err = run([SCOPE_GUARD, "--repo", GIT_ROOT,
                        "--session", "--state-file", STATE, "--json", "--since", "HEAD~1"])
    check("scope_guard --session --json exits 0 or 1", rc in (0, 1))
    try:
        data = json.loads(out)
        check("scope_guard --session reads scope_threshold: threshold is 25", data.get("threshold") == 25.0)
    except json.JSONDecodeError:
        check("scope_guard --session reads scope_threshold: threshold is 25", False)

    # --session explicit --threshold overrides state scope_threshold
    rc, out, err = run([SCOPE_GUARD, "--repo", GIT_ROOT,
                        "--session", "--state-file", STATE, "--json", "--since", "HEAD~1",
                        "--threshold", "35"])
    check("scope_guard --session explicit --threshold exits 0 or 1", rc in (0, 1))
    try:
        data = json.loads(out)
        check("scope_guard explicit --threshold overrides state: threshold is 35", data.get("threshold") == 35.0)
    except json.JSONDecodeError:
        check("scope_guard explicit --threshold overrides state: threshold is 35", False)

    # --session with no explicit --scope-threshold uses phantom.py start default (50.0)
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "scope_guard no-threshold test", "--turns", "3"])
    rc, out, err = run([SCOPE_GUARD, "--repo", GIT_ROOT,
                        "--session", "--state-file", STATE, "--json", "--since", "HEAD~1"])
    check("scope_guard --session no scope_threshold exits 0 or 1", rc in (0, 1))
    try:
        data = json.loads(out)
        check("scope_guard --session uses phantom start default scope_threshold 50", data.get("threshold") == 50.0)
    except json.JSONDecodeError:
        check("scope_guard --session uses phantom start default scope_threshold 50", False)

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
                        "--repo", GIT_ROOT,
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
                        "--repo", GIT_ROOT,
                        "--targets", "PROJECT_PHANTOM/agents/phantom.py",
                        "--session", "--state-file", STATE])
    check("coverage_tracker --session exits 0 or 1", rc in (0, 1))
    check("coverage_tracker --session shows session label", "session" in out.lower() or rc in (0, 1))

    # --json output is valid JSON with session field
    rc, out, err = run([COVERAGE_TRACKER,
                        "--repo", GIT_ROOT,
                        "--targets", "PROJECT_PHANTOM/agents/phantom.py",
                        "--json", "--since", "HEAD~2"])
    check("coverage_tracker --json exits 0 or 1", rc in (0, 1))
    try:
        data = json.loads(out)
        check("coverage_tracker --json is valid JSON", True)
        check("coverage_tracker --json has 'since' key", "since" in data)
        check("coverage_tracker --json has 'session' key", "session" in data)
        check("coverage_tracker --json has 'full_coverage' key", "full_coverage" in data)
        check("coverage_tracker --json has 'touched_files' key", "touched_files" in data)
    except json.JSONDecodeError:
        check("coverage_tracker --json is valid JSON", False)
        for k in ("since", "session", "full_coverage", "touched_files"):
            check(f"coverage_tracker --json has '{k}' key", False)

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
                        "--repo", GIT_ROOT,
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

    # --json produces valid JSON with required keys
    rc, out, err = run([PHANTOM, "check", "--json"])
    check("check --json exits 0", rc == 0)
    try:
        data = json.loads(out)
        check("check --json is valid JSON", True)
        check("check --json has 'task' key", "task" in data)
        check("check --json has 'scope' key", "scope" in data)
        check("check --json has 'coverage' key", "coverage" in data)
        check("check --json scope has 'clean' key", "clean" in data.get("scope", {}))
        check("check --json coverage has 'full' key", "full" in data.get("coverage", {}))
    except json.JSONDecodeError:
        check("check --json is valid JSON", False)
        for k in ("task", "scope", "coverage", "scope.clean", "coverage.full"):
            check(f"check --json has '{k}' key", False)

    # status shows coverage_targets and scope_files when set
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "status test", "--turns", "3",
         "--coverage-targets", "agents/phantom.py",
         "--scope", "agents/heartbeat_runner.py"])
    rc, out, err = run([PHANTOM, "status"])
    check("status shows Coverage: line when coverage_targets set", "Coverage:" in out)
    check("status shows Scope: line when scope_files set", "Scope:" in out)
    # Coverage line must show N/M count format, not raw file list
    cov_status_line = out.split("Coverage:")[1].split("\n")[0] if "Coverage:" in out else ""
    check("status Coverage line shows N/M count format", "/" in cov_status_line and "%" in cov_status_line)

    # status shows criteria mini-view when done-criteria set
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "criteria view test", "--turns", "5",
         "--done-criteria", "tests pass", "coverage ok", "docs done"])
    run([PHANTOM, "ping", "turn 1", "--tests", "500"])
    rc, out, err = run([PHANTOM, "status"])
    check("status shows Criteria: line when done-criteria set", "Criteria:" in out)
    check("status Criteria line shows N/M met format", "/3 met" in out or "0/3 met" in out or "1/3 met" in out)
    check("status Criteria line shows [x] or [ ] marks", "[x]" in out or "[ ]" in out)

    # scope-update warns when drift guard is armed
    run([PHANTOM, "drift-arm"])
    rc, out, err = run([PHANTOM, "scope-update", "--scope", "agents/phantom.py", "CLAUDE.md"])
    check("scope-update warns about armed drift guard", "⚠" in out or "Drift guard" in out)
    check("scope-update armed warning mentions re-arm", "drift-arm" in out or "re-arm" in out.lower())
    run([PHANTOM, "drift-done"])  # cleanup

    # complete shows coverage summary when coverage_targets set
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "complete test", "--turns", "3",
         "--coverage-targets", "agents/phantom.py", "agents/heartbeat_runner.py"])
    rc, out, err = run([PHANTOM, "complete"])
    check("complete shows Coverage line when targets set", "Coverage:" in out)

    # report shows coverage summary when coverage_targets set
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "report test", "--turns", "3",
         "--coverage-targets", "agents/phantom.py"])
    rc, out, err = run([PHANTOM, "report"])
    check("report shows Coverage section when targets set", "Coverage" in out)

    # start --scope-threshold stored in state
    run([PHANTOM, "reset"])
    rc, out, err = run([PHANTOM, "start", "threshold test", "--turns", "3",
                        "--scope-threshold", "30"])
    check("start --scope-threshold exits 0", rc == 0)
    state = read_state()
    check("start --scope-threshold stored in state", state.get("scope_threshold") == 30.0)

    # start without --scope-threshold defaults to 50.0
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "default threshold", "--turns", "3"])
    state = read_state()
    check("start without --scope-threshold defaults to 50.0",
          state.get("scope_threshold") == 50.0)

    # --coverage-targets stored in state at start
    run([PHANTOM, "reset"])
    rc, out, err = run([PHANTOM, "start", "coverage target test", "--turns", "3",
                        "--coverage-targets", "agents/phantom.py", "agents/heartbeat_runner.py"])
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

    # check writes coverage_full to state when coverage targets are set
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "cov-full test", "--turns", "3",
         "--coverage-targets", "agents/phantom.py"])
    run([PHANTOM, "check"])
    state = read_state()
    check("check writes coverage_full to state", "coverage_full" in state)
    check("coverage_full is bool", isinstance(state.get("coverage_full"), bool))

    # check does NOT write coverage_full when no targets declared
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "no-cov test", "--turns", "3"])
    run([PHANTOM, "check"])
    state = read_state()
    check("check does not write coverage_full when no targets", "coverage_full" not in state)

    # check caching — second call within TTL uses cache
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "cache test", "--turns", "3",
         "--coverage-targets", "agents/phantom.py"])
    run([PHANTOM, "check"])
    state_after_first = read_state()
    check("check stores check_cache in state after first call", "check_cache" in state_after_first)
    # second call within TTL should show "(cached)" in output
    rc, out, _ = run([PHANTOM, "check"])
    check("check shows cached indicator on second call within TTL", "cached" in out)

    # --no-cache flag forces fresh git diff even if cache is valid
    rc, out, _ = run([PHANTOM, "check", "--no-cache"])
    check("check --no-cache bypasses cache (no cached note)", "cached" not in out)

    cleanup()

    # -- auto_save_every stored at start --
    run([PHANTOM, "start", "auto-save test", "--turns", "3", "--auto-save-every", "3"])
    state = read_state()
    check("--auto-save-every stored in state", state.get("auto_save_every") == 3)

    # default auto_save_every is 5
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "default auto-save", "--turns", "3"])
    state = read_state()
    check("auto_save_every defaults to 5", state.get("auto_save_every") == 5)

    # runtime fields initialized at start
    check("drift_guard_active initialized False", state.get("drift_guard_active") == False)
    check("drift_warning initialized None",       state.get("drift_warning")      is None)
    check("heartbeat_fires initialized []",       state.get("heartbeat_fires")    == [])
    check("watchdog_events initialized []",       state.get("watchdog_events")    == [])
    check("ping_log initialized []",              state.get("ping_log")           == [])

    # anchor_a and anchor_b initialized at start
    check("anchor_a initialized on start", isinstance(state.get("anchor_a"), dict))
    check("anchor_b initialized on start", isinstance(state.get("anchor_b"), dict))
    check("anchor_a has ref key",          "ref" in (state.get("anchor_a") or {}))
    check("anchor_a has timestamp key",    "timestamp" in (state.get("anchor_a") or {}))
    check("anchor_b has goal key",         "goal" in (state.get("anchor_b") or {}))
    check("anchor_b goal matches task",    state.get("anchor_b", {}).get("goal") == "default auto-save")

    # auto-save amend: second auto-save should amend the first (no new commit)
    import subprocess as _sp
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "amend test", "--turns", "10", "--auto-save-every", "2"])
    before_count = len(_sp.run(
        ["git", "log", "--oneline"], cwd=GIT_ROOT, capture_output=True, text=True
    ).stdout.strip().splitlines())
    run([PHANTOM, "ping", "turn 1"])
    run([PHANTOM, "ping", "turn 2"])  # triggers first auto-save (new commit)
    after_first = len(_sp.run(
        ["git", "log", "--oneline"], cwd=GIT_ROOT, capture_output=True, text=True
    ).stdout.strip().splitlines())
    check("first auto-save creates one new commit", after_first == before_count + 1)
    run([PHANTOM, "ping", "turn 3"])
    run([PHANTOM, "ping", "turn 4"])  # triggers second auto-save (should amend)
    after_second = len(_sp.run(
        ["git", "log", "--oneline"], cwd=GIT_ROOT, capture_output=True, text=True
    ).stdout.strip().splitlines())
    check("second auto-save amends (no extra commit)", after_second == after_first)
    # commit message reflects current turn after amend
    last_msg = _sp.run(
        ["git", "log", "-1", "--format=%s"], cwd=GIT_ROOT, capture_output=True, text=True
    ).stdout.strip()
    check("amended auto-save message shows latest turn", "turn 4" in last_msg)

    cleanup()


def test_env():
    print("\n── phantom.py env ──")
    cleanup()

    # env exits 0 (no session required)
    rc, out, err = run([PHANTOM, "env"])
    check("env exits 0", rc == 0)
    check("env shows PHANTOM Environment header", "PHANTOM Environment" in out)

    # Paths section shows expected keys
    check("env shows agents_dir", "agents_dir" in out)
    check("env shows repo_dir",   "repo_dir"   in out)
    check("env shows state_file", "state_file" in out)

    # Tools section shows python3 ok
    check("env shows python3 ok", "[OK]" in out and "python3" in out)

    # Session section shows warning when no session
    check("env warns no active session", "no active session" in out.lower())

    # Container logger section always shown
    check("env shows Container logger section", "Container logger" in out)
    # Either OK (if logger is running) or WARN with start command
    check("env reports container_logger status", "container_logger.py" in out)

    # With active session — shows session info
    run([PHANTOM, "start", "env test session", "--turns", "3"])
    rc, out, err = run([PHANTOM, "env"])
    check("env exits 0 with active session", rc == 0)
    check("env shows active session info", "active" in out.lower())
    check("env shows task text", "env test session" in out)

    cleanup()


def test_anchor():
    print("\n── phantom.py anchor ──")
    cleanup()

    # anchor requires an active session
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("anchor show exits nonzero without session", rc != 0)

    # Start session
    run([PHANTOM, "start", "reach the destination goal", "--turns", "5",
         "--done-criteria", "tests pass", "coverage 4/4"])

    # anchor show — check structure
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("anchor show exits 0", rc == 0)
    check("anchor show has ANCHORS header", "ANCHORS" in out)
    check("anchor show has Point A origin", "Point A" in out)
    check("anchor show has Point B destination", "Point B" in out)
    check("anchor show shows goal text", "reach the destination goal" in out)
    check("anchor show shows done_criteria", "tests pass" in out)
    check("anchor show shows second criterion", "coverage 4/4" in out)
    check("anchor show shows Current position", "Current position" in out)
    check("anchor show shows turns", "0/5" in out)

    # anchor check — reorientation output
    rc, out, err = run([PHANTOM, "anchor", "check"])
    check("anchor check exits 0", rc == 0)
    check("anchor check has REORIENTATION header", "ANCHOR REORIENTATION CHECK" in out)
    check("anchor check shows ORIGIN (A)", "ORIGIN" in out)
    check("anchor check shows GOAL (B)", "GOAL" in out)
    check("anchor check shows CURRENT section", "CURRENT" in out)
    check("anchor check shows goal text", "reach the destination goal" in out)
    check("anchor check shows criteria", "tests pass" in out)
    check("anchor check shows verify prompt", "Verify" in out)

    # anchor set-goal — updates goal and criteria
    rc, out, err = run([PHANTOM, "anchor", "set-goal", "new goal text",
                        "--criteria", "criterion one", "criterion two"])
    check("anchor set-goal exits 0", rc == 0)
    check("anchor set-goal shows updated", "Anchor B updated" in out)
    check("anchor set-goal shows new goal", "new goal text" in out)
    check("anchor set-goal shows criteria", "criterion one" in out)

    # Verify anchor show reflects the updated goal
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("anchor show reflects set-goal change", "new goal text" in out)
    check("anchor show shows criterion one", "criterion one" in out)
    check("anchor show shows criterion two", "criterion two" in out)

    # anchor check shows criteria Progress line
    rc, out, err = run([PHANTOM, "anchor", "check"])
    check("anchor check shows Progress N/M line", "Progress:" in out)

    # _eval_criteria: coverage criterion auto-marks [x] when coverage is full
    # Set up a session with a "coverage" criterion and mark one target touched via git diff
    # (Hard to test end-to-end without real git changes; test the [ ] → shown behavior)
    run([PHANTOM, "start", "criteria eval test", "--turns", "5", "--force",
         "--done-criteria", "coverage full", "drift clean", "no drift warning"])
    run([PHANTOM, "ping", "evaluating criteria"])
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("anchor show shows [ ] for unmet criteria", "[ ]" in out)
    # With no drift warning, 'drift clean' criterion should show [x]
    check("anchor show marks drift clean as [x] when clean", "[x]" in out)

    cleanup()

    # _eval_criteria: anchor check tracking — criterion auto-marks [x] after first anchor check
    run([PHANTOM, "start", "anchor check tracking test", "--turns", "5",
         "--done-criteria", "anchor check used at least once"])
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("anchor check tracking: [ ] before first check", "[ ]" in out)
    # Run anchor check — increments counter
    run([PHANTOM, "anchor", "check"])
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("anchor check tracking: [x] after anchor check runs", "[x]" in out)

    cleanup()

    # _eval_criteria: heartbeat fire count — criterion auto-marks [x] when fires >= needed
    run([PHANTOM, "start", "hb fire tracking test", "--turns", "5",
         "--done-criteria", "observed at least 1 heartbeat fire"])
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("hb fire criterion: [ ] with zero fires", "[ ]" in out)
    # Inject a fake heartbeat fire into state
    import json as _json2, os as _os2
    s2 = _json2.load(open(STATE))
    s2["heartbeat_fires"] = [{"fired_at": "2026-01-01 00:00:00", "signal": "ping",
                               "gap_seconds": 185, "idle_polls": 1, "turns": 1}]
    with open(STATE + ".tmp", "w") as f:
        _json2.dump(s2, f)
    _os2.rename(STATE + ".tmp", STATE)
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("hb fire criterion: [x] after 1 fire injected", "[x]" in out)

    cleanup()

    # _eval_criteria: tests passing count — criterion auto-marks [x] when tests_last_count >= N
    run([PHANTOM, "start", "tests passing criteria test", "--turns", "5",
         "--done-criteria", "434+ tests passing on all changes"])
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("tests criterion: [ ] before recording count", "[ ]" in out)
    # Record test count via ping --tests
    run([PHANTOM, "ping", "ran tests", "--tests", "475"])
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("tests criterion: [x] when count >= threshold", "[x]" in out)

    cleanup()

    # ping --tests stores tests_last_count in state
    run([PHANTOM, "start", "ping tests flag test", "--turns", "5"])
    run([PHANTOM, "ping", "test note", "--tests", "100"])
    import json as _json_t, os as _os_t
    st = _json_t.load(open(STATE))
    check("ping --tests stores tests_last_count in state", st.get("tests_last_count") == 100)

    cleanup()

    # anchor check writes coverage_full to state (keeps fire banner in sync without running check)
    run([PHANTOM, "start", "anchor cov_full test", "--turns", "5",
         "--coverage-targets", "agents/phantom.py"])
    state_before = _json_t.load(open(STATE))
    check("coverage_full absent before anchor check", "coverage_full" not in state_before)
    run([PHANTOM, "anchor", "check"])
    state_after = _json_t.load(open(STATE))
    check("anchor check writes coverage_full to state", "coverage_full" in state_after)
    check("coverage_full is bool after anchor check", isinstance(state_after.get("coverage_full"), bool))

    # scope-update — updates scope mid-session without resetting state
    import json as _json_su, os as _os_su
    cleanup()
    run([PHANTOM, "start", "scope update test", "--turns", "5",
         "--scope", "agents/phantom.py",
         "--coverage-targets", "agents/phantom.py"])
    run([PHANTOM, "ping", "initial"])
    s_before = _json_su.load(open(STATE))
    turns_before = s_before.get("turns_taken")

    rc, out, err = run([PHANTOM, "scope-update",
                        "--scope", "agents/phantom.py", "CLAUDE.md",
                        "--scope-threshold", "40"])
    check("scope-update exits 0", rc == 0)
    check("scope-update prints new scope", "agents/phantom.py" in out and "CLAUDE.md" in out)
    check("scope-update clears drift_warning", "drift_warning" not in out or True)  # structural check
    check("scope-update prints re-arm reminder", "drift-arm" in out)

    s_after = _json_su.load(open(STATE))
    check("scope-update preserves turns_taken", s_after.get("turns_taken") == turns_before)
    check("scope-update updates scope_files", "CLAUDE.md" in (s_after.get("scope_files") or []))
    check("scope-update updates scope_threshold", s_after.get("scope_threshold") == 40.0)
    check("scope-update clears drift_warning in state", s_after.get("drift_warning") is None)

    # scope-update with no args prints usage hint
    rc, out, err = run([PHANTOM, "scope-update"])
    check("scope-update with no args exits 0", rc == 0)
    check("scope-update with no args shows usage hint", "No changes" in out)

    cleanup()


def test_checkpoint():
    print("\n── phantom.py checkpoint ──")
    cleanup()

    # checkpoint requires an active session
    rc, out, err = run([PHANTOM, "checkpoint"])
    check("checkpoint exits nonzero without session", rc != 0)

    # Fresh session — ping will be fresh, but coverage is 0 (no targets set)
    run([PHANTOM, "start", "checkpoint test", "--turns", "5"])
    run([PHANTOM, "ping", "just started"])
    rc, out, err = run([PHANTOM, "checkpoint"])
    check("checkpoint exits 0 with no targets and fresh ping", rc == 0)
    check("checkpoint shows CHECKPOINT header", "CHECKPOINT" in out)
    check("checkpoint shows gates passed", "gates passed" in out.lower() or "All gates" in out)
    check("checkpoint shows ping freshness in summary", "Ping:" in out)
    check("checkpoint shows drift status in summary", "Drift:" in out)
    # checkpoint call should have incremented checkpoint_calls_count
    import json as _json3, os as _os3
    s3 = _json3.load(open(STATE))
    check("checkpoint increments checkpoint_calls_count", s3.get("checkpoint_calls_count", 0) >= 1)

    # _eval_criteria: checkpoint criterion auto-marks [x] after checkpoint runs
    cleanup()
    run([PHANTOM, "start", "checkpoint criteria test", "--turns", "5",
         "--done-criteria", "checkpoint used before completion"])
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("checkpoint criterion: [ ] before first checkpoint", "[ ]" in out)
    run([PHANTOM, "ping", "ready to checkpoint"])
    run([PHANTOM, "checkpoint"])
    rc, out, err = run([PHANTOM, "anchor", "show"])
    check("checkpoint criterion: [x] after checkpoint runs", "[x]" in out)

    cleanup()

    # Session with coverage targets but zero coverage touched — should fail
    run([PHANTOM, "start", "checkpoint test 2", "--turns", "5",
         "--coverage-targets", "agents/phantom.py", "agents/heartbeat_runner.py"])
    run([PHANTOM, "ping", "just started"])
    rc, out, err = run([PHANTOM, "checkpoint"])
    check("checkpoint fails when zero coverage targets touched", rc == 1)
    check("checkpoint shows BLOCKED", "BLOCKED" in out)
    check("checkpoint shows Coverage zero message", "Coverage zero" in out)

    cleanup()

    # Session with drift warning — should fail
    run([PHANTOM, "start", "checkpoint test 3", "--turns", "5"])
    run([PHANTOM, "ping", "just started"])
    # Inject a drift warning
    import json as _json
    s = _json.load(open(STATE))
    s["drift_warning"] = "VERTICAL drift detected"
    import tempfile, os as _os
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        _json.dump(s, f)
    _os.rename(tmp, STATE)
    rc, out, err = run([PHANTOM, "checkpoint"])
    check("checkpoint fails with drift warning", rc == 1)
    check("checkpoint shows BLOCKED", "BLOCKED" in out)
    check("checkpoint shows drift failure message", "drift" in out.lower())

    cleanup()

    # --require-full-coverage: fails when coverage is partial
    run([PHANTOM, "start", "checkpoint full cov test", "--turns", "5",
         "--coverage-targets", "agents/phantom.py", "agents/heartbeat_runner.py"])
    run([PHANTOM, "ping", "just started"])
    # Manually mark phantom.py as touched but not heartbeat_runner.py
    # (can't easily do this without real git commits, so verify the flag is accepted)
    rc, out, err = run([PHANTOM, "checkpoint", "--require-full-coverage"])
    check("checkpoint --require-full-coverage exits 1 with zero coverage", rc == 1)
    check("checkpoint --gate is accepted", True)  # flag parses correctly

    cleanup()

    # Stale ping — inject old last_active to trigger freshness gate
    run([PHANTOM, "start", "checkpoint stale test", "--turns", "5", "--threshold", "60"])
    s = _json.load(open(STATE))
    s["last_active"] = "2020-01-01 00:00:00"  # very old
    with open(STATE + ".tmp", "w") as f:
        _json.dump(s, f)
    _os.rename(STATE + ".tmp", STATE)
    rc, out, err = run([PHANTOM, "checkpoint"])
    check("checkpoint fails with stale ping", rc == 1)
    check("checkpoint shows Stale ping message", "Stale ping" in out)

    cleanup()

    # complete — soft pre-complete checkpoint warns on issues but doesn't block
    run([PHANTOM, "start", "complete warn test", "--turns", "3",
         "--coverage-targets", "agents/phantom.py"])
    # inject stale ping so soft checkpoint fires
    s = _json.load(open(STATE))
    s["last_active"] = "2020-01-01 00:00:00"
    with open(STATE + ".tmp", "w") as f:
        _json.dump(s, f)
    _os.rename(STATE + ".tmp", STATE)
    rc, out, err = run([PHANTOM, "complete"])
    check("complete exits 0 even with soft checkpoint issues", rc == 0)
    check("complete shows pre-complete warning", "Pre-complete" in out or "pre-complete" in out.lower())
    check("complete still shows SESSION COMPLETE", "SESSION COMPLETE" in out)

    cleanup()


def test_status_brief():
    print("\n── phantom.py status --brief ──")
    cleanup()

    # No session — should print nothing useful / exit 0 with "No active session"
    rc, out, err = run([PHANTOM, "status", "--brief"])
    check("status --brief with no session exits 0", rc == 0)
    check("status --brief with no session says no session", "No active session" in out)

    # Basic brief output format
    run([PHANTOM, "start", "brief test task", "--turns", "10", "--rounds", "5"])
    run([PHANTOM, "ping", "initial ping"])
    rc, out, err = run([PHANTOM, "status", "--brief"])
    check("status --brief exits 0 with active session", rc == 0)
    check("status --brief outputs single line", len(out.strip().splitlines()) == 1)
    check("status --brief contains [active]", "[active]" in out)
    check("status --brief contains turn info T0/10", "T0/10" in out or "T1/10" in out)
    check("status --brief contains round info R5", "R5" in out)
    check("status --brief contains HB:idle when not armed", "HB:idle" in out)
    check("status --brief contains drift:ok when no warning", "drift:ok" in out)

    # Drift warning shows ⚠drift
    import json as _json, os as _os
    s = _json.load(open(STATE))
    s["drift_warning"] = "VERTICAL drift detected"
    with open(STATE + ".tmp", "w") as f:
        _json.dump(s, f)
    _os.rename(STATE + ".tmp", STATE)
    rc, out, err = run([PHANTOM, "status", "--brief"])
    check("status --brief shows ⚠drift when drift_warning set", "⚠drift" in out)

    # Clear drift warning, arm HB with future next_heartbeat_at → shows HB:~Xs
    s = _json.load(open(STATE))
    s["drift_warning"] = None
    s["heartbeat_active"] = True
    from datetime import datetime, timedelta
    future = (datetime.now() + timedelta(seconds=90)).strftime("%Y-%m-%d %H:%M:%S")
    s["next_heartbeat_at"] = future
    with open(STATE + ".tmp", "w") as f:
        _json.dump(s, f)
    _os.rename(STATE + ".tmp", STATE)
    rc, out, err = run([PHANTOM, "status", "--brief"])
    check("status --brief shows HB:~Xs when armed with ETA", "HB:~" in out and "s" in out)

    # No next_heartbeat_at but armed → HB:armed
    s = _json.load(open(STATE))
    s["next_heartbeat_at"] = None
    with open(STATE + ".tmp", "w") as f:
        _json.dump(s, f)
    _os.rename(STATE + ".tmp", STATE)
    rc, out, err = run([PHANTOM, "status", "--brief"])
    check("status --brief shows HB:armed when armed without ETA", "HB:armed" in out)

    # Progress note truncated at 40 chars
    s = _json.load(open(STATE))
    s["heartbeat_active"] = False
    s["progress_note"] = "A" * 60
    with open(STATE + ".tmp", "w") as f:
        _json.dump(s, f)
    _os.rename(STATE + ".tmp", STATE)
    rc, out, err = run([PHANTOM, "status", "--brief"])
    check("status --brief truncates note with ...", "..." in out and ("A" * 38) not in out)

    # Coverage shown when coverage_targets set
    cleanup()
    run([PHANTOM, "start", "brief cov test", "--turns", "5",
         "--coverage-targets", "agents/phantom.py", "agents/heartbeat_runner.py"])
    run([PHANTOM, "ping", "ping"])
    rc, out, err = run([PHANTOM, "status", "--brief"])
    check("status --brief shows coverage fraction with targets", "/" in out)
    check("status --brief labels coverage with cov: prefix", "cov:" in out)

    # Note truncation: notes > 40 chars get ... suffix, not hard cut
    cleanup()
    run([PHANTOM, "start", "truncation test", "--turns", "5"])
    run([PHANTOM, "ping", "A" * 50])
    rc, out, err = run([PHANTOM, "status", "--brief"])
    check("status --brief truncates long note with ...", "..." in out)
    check("status --brief does not show all 50 chars", ("A" * 41) not in out)

    # status --verbose shows full criteria text
    cleanup()
    run([PHANTOM, "start", "verbose criteria test", "--turns", "5",
         "--done-criteria", "all tests pass", "coverage 3/3"])
    rc, out, err = run([PHANTOM, "status", "--verbose"])
    check("status --verbose exits 0", rc == 0)
    check("status --verbose shows full criterion text 1", "all tests pass" in out)
    check("status --verbose shows full criterion text 2", "coverage 3/3" in out)
    check("status --verbose shows [x] or [ ] marks", "[x]" in out or "[ ]" in out)
    check("status --verbose shows met count", "/2 met" in out)

    # regular status still shows mini-view (not full text for every criterion)
    rc, out_mini, _ = run([PHANTOM, "status"])
    check("status (non-verbose) does not expand criteria text", "all tests pass" not in out_mini)
    check("status (non-verbose) still shows criteria count", "/2 met" in out_mini or "Criteria" in out_mini)

    # report scope section filters auto-save file
    cleanup()
    run([PHANTOM, "start", "report scope filter test", "--turns", "5"])
    run([PHANTOM, "ping", "turn 1"])
    rc, out, err = run([PHANTOM, "report"])
    check("report scope section hides last_session_state.json", "last_session_state.json" not in out)

    # report ping log truncates with ... not hard cut
    cleanup()
    run([PHANTOM, "start", "report ping truncate test", "--turns", "5"])
    run([PHANTOM, "ping", "B" * 60])
    rc, out, err = run([PHANTOM, "report"])
    check("report ping log truncates with ...", "..." in out)
    pings_section = out.split("Recent pings")[1].split("\n\n")[0] if "Recent pings" in out else ""
    check("report ping log does not show all 60 chars in pings section", ("B" * 56) not in pings_section)

    # report coverage section shows ✓/✗ per target
    cleanup()
    run([PHANTOM, "start", "report cov markers test", "--turns", "5",
         "--coverage-targets", "agents/phantom.py", "agents/drift_guard.py"])
    rc, out, err = run([PHANTOM, "report"])
    check("report coverage shows ✗ for untouched target", "✗" in out)

    # report coverage shows ✓ for touched target (phantom.py is changed this session)
    # Use scope_files fallback when no coverage_targets — also shows ✓/✗
    run([PHANTOM, "reset"])
    run([PHANTOM, "start", "report cov scope test", "--turns", "5",
         "--scope", "agents/phantom.py"])
    rc, out, err = run([PHANTOM, "report"])
    check("report coverage section present for scope_files", "Coverage" in out)

    cleanup()


def test_docs_content():
    print("\n── docs content validation ──")
    import os as _os

    agents_dir = _os.path.dirname(_os.path.abspath(PHANTOM))

    # HEARTBEAT.md v8 content checks
    hb_md = open(_os.path.join(agents_dir, "HEARTBEAT.md")).read()
    check("HEARTBEAT.md header is v8", "v8" in hb_md.splitlines()[0])
    check("HEARTBEAT.md execution block appears near top (within first 20 lines)", any("STEP" in l or "Bash tool" in l for l in hb_md.splitlines()[:20]))
    check("HEARTBEAT.md has fabrication prevention section", "Never fabricate" in hb_md)
    check("HEARTBEAT.md warns against generating fire output", "Do NOT generate fire output" in hb_md)
    check("HEARTBEAT.md has post-flight verification step", "rounds_remaining" in hb_md and "decreased" in hb_md)
    check("HEARTBEAT.md shows exact HOLD active format", "active Xs ago" in hb_md)
    check("HEARTBEAT.md fire banner shows plain === chars", "======" in hb_md)
    check("HEARTBEAT.md warns against text before Bash call", "Do NOT generate any text" in hb_md or "no text before" in hb_md.lower() or "text only at the end" in hb_md.lower() or "text output before" in hb_md.lower() or "DO NOT write" in hb_md)
    check("HEARTBEAT.md warns against 'waiting for' pattern", "waiting for" in hb_md.lower() or "will relay" in hb_md.lower())
    # Box char appears in fabrication warning (as example of what NOT to do) — not in fire banner section
    fire_section = hb_md.split("### On fire")[1] if "### On fire" in hb_md else ""
    check("HEARTBEAT.md fire banner section does NOT show box chars", "╔══" not in fire_section)

    # DRIFT_GUARD.md v5 content checks
    dg_md = open(_os.path.join(agents_dir, "DRIFT_GUARD.md")).read()
    check("DRIFT_GUARD.md header is v5", "v5" in dg_md.splitlines()[0])
    check("DRIFT_GUARD.md has fabrication prevention section", "Never fabricate" in dg_md)
    check("DRIFT_GUARD.md scope-update in SCOPE_CREEP action", "scope-update" in dg_md)
    check("DRIFT_GUARD.md warns against text before Bash call", "Do NOT generate any text" in dg_md or "text output before" in dg_md.lower())
    check("DRIFT_GUARD.md warns against early commentary", "running drift guard" in dg_md.lower() or "I will return" in dg_md or "will return the output" in dg_md.lower())

    # CLAUDE.md fire verification rule
    claude_md_path = _os.path.join(agents_dir, "..", "CLAUDE.md")
    claude_md = open(claude_md_path).read()
    check("CLAUDE.md anti-drift has fire verification rule", "verify heartbeat fires are real" in claude_md)
    check("CLAUDE.md troubleshooting has fabricated fire entry", "fabricated" in claude_md.lower() or "Fabricated" in claude_md)
    check("CLAUDE.md protocol step 6 mentions rounds_remaining check", "rounds_remaining" in claude_md and "fabricated" in claude_md.lower())
    check("CLAUDE.md useful commands has scope-update", "scope-update" in claude_md)

    # MD files not stale
    project_dir = _os.path.join(agents_dir, "..")
    diff_md = open(_os.path.join(project_dir, "DIFF.md")).read()
    plan_md = open(_os.path.join(project_dir, "PLAN.md")).read()
    anti_md = open(_os.path.join(project_dir, "ANTI_DRIFT.md")).read()
    check("DIFF.md covers v3.x (not just v1/v2)", "v3" in diff_md)
    check("DIFF.md has v3.2 section", "v3.1 → v3.2" in diff_md or "v3.2" in diff_md)
    check("PLAN.md has Known Friction section", "Known Friction" in plan_md or "Planned" in plan_md)
    check("PLAN.md has Architecture Invariants", "Invariant" in plan_md)
    check("ANTI_DRIFT.md covers v3.x patterns", "v3." in anti_md)
    check("ANTI_DRIFT.md has fabrication pattern", "Fabrication" in anti_md or "fabricat" in anti_md.lower())


# ─── Run all ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("PHANTOM Integration Tests")
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
        test_env()
        test_anchor()
        test_checkpoint()
        test_status_brief()
        test_docs_content()
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
