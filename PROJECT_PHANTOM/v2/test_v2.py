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

    # config list — empty
    rc, out, _ = run([PHANTOM, "config", "list"])
    check("config list exits 0 when empty", rc == 0)
    check("config list shows no profiles message", "No profiles" in out)

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

    # min_idle_polls in profile keys
    run([PHANTOM, "config", "create", "testpoll",
         "--turns", "5", "--min-idle-polls", "2"])  # note: config create won't have --min-idle-polls
    # Verify via config set instead
    run([PHANTOM, "config", "create", "testpoll2", "--turns", "5"])
    run([PHANTOM, "config", "set", "testpoll2", "min_idle_polls", "2"])
    rc, out, err = run([PHANTOM, "config", "show", "testpoll2"])
    check("min_idle_polls settable in profile", "min_idle_polls" in out and "2" in out)

    cleanup()


# ─── container_logger.py tests ───────────────────────────────────────────────

def test_container_logger():
    print("\n── container_logger.py ──")

    # just verify it imports and shows help without error
    rc, out, err = run([LOGGER, "--help"])
    check("container_logger --help exits 0", rc == 0)
    check("--interval option present", "--interval" in out)
    check("--push-every option present", "--push-every" in out)


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
