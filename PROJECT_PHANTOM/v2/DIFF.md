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
| `test_v2.py` | 46 integration tests covering all phantom.py commands and heartbeat_runner edge cases |
| `PLAN.md` | Horizontal improvement tracker — ensures all files improve together |
| `DIFF.md` | This file — v1 vs v2 comparison |
| `PHANTOM_STATE` env var | Enables test isolation without touching production state |

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
