# PHANTOM Improvement Plan

**Rule: Every turn must improve MULTIPLE files. No vertical drilling.**

---

## Progress Tracker

| Turn | phantom.py | heartbeat_runner.py | HEARTBEAT.md | container_logger.py | New |
|------|------------|--------------------|--------------|--------------------|-----|
| 1 | ✅ Setup | ✅ Setup | ✅ Setup | ✅ Setup | ✅ PLAN.md |
| 2 | ✅ lock+resumption+validation+elapsed+reset+rich-status+agent-IDs | ✅ configurable interval+SIGTERM+drift | ✅ preflight+crash recovery | ✅ PID file+mem+disk+git retry | — |
| 3 | ✅ PLAN update | ✅ watchdog self-check | — | ✅ log rotation | ✅ test_phantom.py (foundation) |
| 4 | ✅ session summary on done | ✅ cooldown tuning | ✅ rounds=0 explicit | — | — |
| 5 | — | — | — | — | ✅ test_phantom.py (full suite) |
| 6 | — | — | — | — | ✅ DIFF.md |
| 7 | ✅ v2 merged → agents/ | — | — | — | ✅ CLAUDE.md updated |

---

## Completed

All original targets done. Current focus: horizontal improvement sessions
that improve multiple files per turn and keep test_phantom.py passing.

### Core (all complete)
- [x] lock+resumption+validation+elapsed+reset+rich-status+agent-IDs (phantom.py)
- [x] Configurable CHECK_INTERVAL from state (heartbeat_runner.py)
- [x] SIGTERM/SIGINT handler (heartbeat_runner.py)
- [x] Drift reporting (heartbeat_runner.py)
- [x] Watchdog: detect if poll loop stalls (heartbeat_runner.py)
- [x] Cooldown tuning (heartbeat_runner.py)
- [x] Pre-flight checks + crash recovery path (HEARTBEAT.md)
- [x] Explicit rounds=0 early exit (heartbeat_runner.py)
- [x] Log rotation, cap at 500 lines (container_logger.py)
- [x] test_phantom.py — 352-test integration suite
- [x] DIFF.md — changelog v2.0 → v2.5
- [x] v2/ collapsed — single canonical codebase in agents/ and tools/

---

## Drift Guard (self-check each turn)
Before pinging done: "Did I touch at least 2 files this turn?" If not — touch another.
