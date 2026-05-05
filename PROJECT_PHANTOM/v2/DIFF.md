# PHANTOM v1 vs v2 — Full Comparison

Generated after 10-turn autonomous improvement session.

---

## phantom.py

| Feature | v1 | v2 |
|---|---|---|
| State file path | Hardcoded `/tmp/phantom_session.json` | `PHANTOM_STATE` env var (testable) |
| Concurrent write protection | None | Lock file (`phantom_session.lock`) with 5s timeout |
| Session overwrite guard | Silent overwrite | Warns + shows existing session, requires `--force` |
| Poll interval | Not configurable | `--interval N` stored in state, read by runner |
| Cooldown control | 1.0x threshold hardcoded | `--cooldown-factor` (e.g. 0.5 = faster recovery) |
| Agent tracking | Count only | Count + named IDs (`--id worker-1`) |
| agent-done underflow | Silent (clamps to 0) | Warns if already 0 |
| agent-done unknown ID | No ID concept | Warns if ID not in active list |
| Turn elapsed time | Not shown | Shown on every ping (`Elapsed: 0h 5m 12s`) |
| Session summary | None | Auto-prints when `turns_taken == turns_target` |
| `complete` command | Not present | Explicit completion with full summary |
| `reset` command | Not present | Clears state + lock + temp files |
| `status` command | Raw JSON dump | Rich formatted status panel |
| Rounds used tracking | None | `rounds_used` counter incremented on each fire |
| Test coverage | 0 tests | 46 passing integration tests |

---

## heartbeat_runner.py

| Feature | v1 | v2 |
|---|---|---|
| Poll interval | Hardcoded 30s | Reads `check_interval_seconds` from state |
| Cooldown | Fixed 1x threshold | `cooldown_factor` from state (configurable) |
| SIGTERM/SIGINT | Unhandled (leaves heartbeat_active=true) | Graceful handler clears flag before exit |
| Drift reporting | Not shown | Reports `+Ns` over threshold in fire output |
| Watchdog | None | Detects if poll cycle takes >3x interval |
| Per-poll logging | Terse | Shows gap, cooldown progress, agent count |
| rounds_used | Not tracked | Increments on each fire |
| State file path | Hardcoded | `PHANTOM_STATE` env var |

---

## HEARTBEAT.md

| Feature | v1 | v2 |
|---|---|---|
| Pre-flight checks | Basic armed check | Explicit rounds=0 check + armed check |
| Crash recovery | Not described | Full recovery path: run status, report error |
| Env var documentation | None | Documents `PHANTOM_STATE` for test isolation |
| Output format | Basic | Specifies raw output only, no commentary |

---

## container_logger.py

| Feature | v1 | v2 |
|---|---|---|
| Duplicate prevention | None | PID file — exits if already running |
| Vitals content | uptime + load | uptime + load + memory (MB/total, %) + disk (GB/total, %) |
| Git push failures | Silent | 3 retries with exponential backoff, logs result |
| Log rotation | Grows forever | Capped at 500 lines on each push cycle |
| SIGTERM handling | None | Cleans up PID file on exit |
| CLI args | None | `--interval` and `--push-every` |

---

## New in v2

| Addition | Description |
|---|---|
| `test_v2.py` | 51 integration tests covering all phantom.py commands and heartbeat_runner edge cases |
| `PLAN.md` | Horizontal improvement tracker — ensures all files improve together |
| `DIFF.md` | This file — v1 vs v2 comparison |
| `PHANTOM_STATE` env var | Enables test isolation without touching production state |
| `phantom.py complete` | Explicit session completion with full summary |
| `phantom.py history` | Print session progress and last note |
| `phantom.py save` | Persist session state to git (survives container restart) |
| `phantom.py restore` | Restore saved state in a new container session |
| `phantom.py reset` | Emergency cleanup of all state/lock files |
| `last_session_state.json` | Git-persisted session state for cross-restart continuity |
| `phantom.py scope` | Checks git diff stats, warns if one file >50% of changes (anti-drift) |
| `auto_save` on ping | Every 5 pings, state auto-committed to git (configurable) |

---

## Critical Bug Found During This Session

**Test suite collided with live session state.**

The test suite used `/tmp/phantom_session.json` — the same path as the running session.
When tests ran `cleanup()`, they deleted the active heartbeat session state.
The heartbeat runner reported `ERROR: State file lost mid-session.`

**Fix:** `PHANTOM_STATE` env var lets tests use a separate path (`/tmp/phantom_TEST_session.json`).
This separation is now enforced in `test_v2.py` via `TEST_ENV`.

---

## Summary

v2 is a significant improvement across all dimensions:
- More robust (locks, guards, retries, SIGTERM handlers)
- More observable (rich status, drift reporting, per-poll logs, session summary)
- More testable (env var isolation, 46 tests)
- More configurable (interval, cooldown_factor, CLI args on logger)
- Catches more bugs (agent-done underflow, double-arm, crash recovery)

---

## v2.1 Additions (activity signals + profile system + drift_guard v2)

### Problem: heartbeat_runner fired false positives during active coding

v2.0 heartbeat_runner used only `last_active` (ping timestamp) to measure idle time.
When Claude coded for 8+ minutes without pinging, heartbeat fired as a false positive.

**Fix in v2.1** — multi-source activity signals:

| Signal | Source |
|---|---|
| `ping` | `last_active` field in session state (explicit) |
| `file:path` | `os.walk(workspace)` — most recently modified tracked file |
| `git:index` | `mtime(.git/index)` — any staged/modified file |

`get_last_activity(state)` returns `(timestamp, source_label)` using `max()` of all three.
Heartbeat now shows `[signal_source]` on every HOLD/FIRE line.

### Problem: all config flags had to be retyped each session

**Fix in v2.1** — profile system:
- Named configs stored in `~/.phantom_profiles.json` (default) or `PHANTOM_PROFILES` env var
- `phantom.py config create|list|show|set|delete` commands
- `phantom.py start --profile sprint` loads saved defaults
- Flags passed explicitly still override the profile

### New: portable anti-drift tools

| Tool | Purpose |
|---|---|
| `tools/scope_guard.py` | Standalone drift checker for any git repo (`--repo`, `--threshold`, `--since`) |
| `tools/coverage_tracker.py` | Target coverage checker — which files have been touched vs skipped |
| `tools/test_tools.py` | 36 integration tests for both tools |

### drift_guard.py — v1 (percentage-only) vs v2.1 (four-gate)

| Scenario | v1 | v2.1 |
|---|---|---|
| Legitimate single-file task (e.g. rewriting drift_guard.py) | `DRIFT` (false positive) | `CLEAN` — task alignment gate |
| Declared focus: `--scope drift_guard.py` | No concept | `CLEAN` — within scope |
| Many hunks spread across one large file | `DRIFT` (false positive) | `CLEAN` — hunk spread gate |
| Slow upward trend, not yet over threshold | Missed | `TRENDING` — trend detection |
| Actually vertical (1 hunk, 80% one file) | `DRIFT` ✓ | `VERTICAL` ✓ |
| Scope creep (outside declared scope) | No concept | `SCOPE_CREEP` |

New CLI args on drift_guard.py:

| Arg | Default | Purpose |
|---|---|---|
| `--scope f1 f2` | (from state) | Override declared scope files |
| `--scope-threshold` | 30% | % outside scope that triggers SCOPE_CREEP |
| `--hunk-count-min` | 4 | Minimum hunks before spread analysis applies |
| `--hunk-spread` | 0.3 | Minimum spread ratio for CLEAN verdict |
| `--trend-checks` | 3 | History window for trend detection |

phantom.py additions in v2.1:
- `--scope` on `start` → `scope_files` stored in session state
- `scope_files` included in profile keys (saveable per-profile)
- `scope_threshold` default changed from 40% to 50% (last-resort gate)

Test coverage: 46 → 152 tests (152/152 passing)
