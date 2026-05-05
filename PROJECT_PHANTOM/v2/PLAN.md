# PHANTOM v2 Improvement Plan

**Rule: Every turn must improve MULTIPLE files. No vertical drilling.**

---

## Horizontal Targets Per Turn

| Turn | phantom.py | heartbeat_runner.py | HEARTBEAT.md | container_logger.py | New |
|------|------------|--------------------|--------------|--------------------|-----|
| 1 | Setup | Setup | Setup | Setup | PLAN.md |
| 2 | Session resumption + lock file | Configurable interval | Error recovery steps | PID file (no duplicates) | — |
| 3 | State transition validation + reset cmd | SIGTERM handler + drift reporting | Crash recovery path | Memory/disk in vitals | — |
| 4 | Agent ID tracking in state | Watchdog self-check | Output format tightening | Git push retry logic | — |
| 5 | `status` command (full snapshot) | Better idle gap logging | Status check step | Log rotation | `phantom status` |
| 6 | Session summary on completion | Cooldown tuning | Rounds=0 handling | Startup dedup check | Session resumption |
| 7 | Integration test all components | — | — | — | test_v2.py |
| 8 | Fix issues from test | Fix issues from test | Fix issues from test | Fix issues from test | — |
| 9 | Final polish + compare v1 vs v2 | Final polish | Final polish | Final polish | DIFF.md |
| 10 | Promote v2 → agents/ if better | — | — | — | Update CLAUDE.md |

---

## Improvement Targets by File

### phantom.py
- [ ] Session resumption (detect existing state, offer continue vs fresh)
- [ ] Lock file (prevent concurrent phantom.py writes)
- [ ] State transition validation (agent-done when agents_running=0 should warn)
- [ ] `reset` command (emergency cleanup)
- [ ] `status` command (full snapshot: session, heartbeat, logger, agents)
- [ ] Agent ID tracking (log which agent IDs are running)
- [ ] Session summary printed on completion

### heartbeat_runner.py
- [ ] Configurable CHECK_INTERVAL via state file (not hardcoded 30s)
- [ ] SIGTERM handler (graceful shutdown, clears heartbeat_active flag)
- [ ] Drift reporting (how many seconds past threshold did it actually fire)
- [ ] Self-watchdog (detect if stuck in a poll loop)
- [ ] Better idle gap logging each poll cycle
- [ ] Cooldown formula review (currently rigid, should scale with threshold)

### HEARTBEAT.md
- [ ] Error recovery steps (what to do if runner crashes mid-poll)
- [ ] Explicit crash recovery path
- [ ] Output format tightening (less verbose on holds, clear on fire)
- [ ] Rounds=0 handling instructions
- [ ] Status check before running (confirm armed, confirm rounds > 0)

### container_logger.py
- [ ] PID file (/tmp/container_logger.pid) — prevents duplicate loggers
- [ ] Memory + disk usage in each vitals line
- [ ] Git push retry logic (currently silent on failure)
- [ ] Log rotation (cap file at N lines to avoid bloat)
- [ ] Startup dedup check (read PID file, check if process alive)
- [ ] Configurable intervals via CLI args

---

## New Features
- [ ] `phantom status` — one command showing everything alive/dead
- [ ] Session resumption — detect prior state, continue or fresh start
- [ ] `test_v2.py` — integration test suite
- [ ] `DIFF.md` — comparison of v1 vs v2

---

## Drift Guard (self-check each turn)
Before ending each turn ask: "Did I improve ALL files this turn, or just one?"
If only one — go back and touch at least one more before pinging done.
