# PHANTOM v2 Improvement Plan

**Rule: Every turn must improve MULTIPLE files. No vertical drilling.**

---

## Progress Tracker

| Turn | phantom.py | heartbeat_runner.py | HEARTBEAT.md | container_logger.py | New |
|------|------------|--------------------|--------------|--------------------|-----|
| 1 | ✅ Setup | ✅ Setup | ✅ Setup | ✅ Setup | ✅ PLAN.md |
| 2 | ✅ lock+resumption+validation+elapsed+reset+rich-status+agent-IDs | ✅ configurable interval+SIGTERM+drift | ✅ preflight+crash recovery | ✅ PID file+mem+disk+git retry | — |
| 3 | ✅ PLAN update | ✅ watchdog self-check | — | ✅ log rotation | ✅ test_v2.py (foundation) |
| 4 | session summary on done | cooldown tuning | rounds=0 explicit | startup dedup verify | — |
| 5 | — | — | — | — | test_v2.py (full suite) |
| 6 | — | — | — | — | DIFF.md |
| 7 | Promote v2 → agents/ | — | — | — | Update CLAUDE.md |

---

## Remaining Targets

### phantom.py
- [ ] Session summary printed on clean completion (turns_taken == turns_target)

### heartbeat_runner.py
- [x] Configurable CHECK_INTERVAL from state
- [x] SIGTERM/SIGINT handler
- [x] Drift reporting
- [x] Per-poll verbose hold messages
- [ ] Watchdog: detect if poll loop stalls (in progress Turn 3)
- [ ] Cooldown tuning (currently rigid 1x threshold, consider 0.5x)

### HEARTBEAT.md
- [x] Pre-flight checks
- [x] Crash recovery path
- [ ] Explicit rounds=0 early exit message

### container_logger.py
- [x] PID file dedup
- [x] Memory + disk vitals
- [x] Git push retry (3 attempts with backoff)
- [ ] Log rotation (cap at N lines)

### New
- [ ] test_v2.py — full integration test suite
- [ ] DIFF.md — v1 vs v2 comparison
- [ ] Promote v2 to agents/ (Turn 7)

---

## Drift Guard (self-check each turn)
Before pinging done: "Did I touch at least 2 files this turn?" If not — touch another.
