# PHANTOM

**Autonomous session tooling for Claude in cloud environments.**

PHANTOM lets Claude work for hours on its own — without you having to sit there and keep it going. It handles the heartbeat, watches for drift, and keeps the session state so nothing gets lost.

---

## The Problem It Solves

Cloud Claude sessions go idle after a few minutes of no activity. Without PHANTOM:
- You start a task, walk away, come back to a dead session
- No way to know what Claude did or didn't do
- No way to enforce "stay on scope, don't rabbit-hole"

With PHANTOM:
- Claude pings itself every ~3 minutes to prove it's alive
- A background watcher fires when Claude goes genuinely idle → wakes it back up
- A drift guard watches git changes and alerts if one file starts dominating
- Everything is written to a state file so you can see exactly what happened

---

## Quick Start

```bash
# 1. Start a session
python3 agents/phantom.py start "your task description" \
  --turns 20 --rounds 8 --threshold 180

# 2. Arm the heartbeat (then spawn the agent — see CLAUDE.md step 5)
python3 agents/phantom.py heartbeat-arm

# 3. Arm the drift guard (then spawn the agent — see CLAUDE.md step 4)
python3 agents/phantom.py drift-arm

# 4. Ping at the start of every turn
python3 agents/phantom.py ping "what I just did / what's next"

# 5. Check status anytime
python3 agents/phantom.py status

# 6. End when done
python3 agents/phantom.py checkpoint
python3 agents/phantom.py complete
```

---

## Key Commands

| Command | What it does |
|---|---|
| `phantom.py start "task"` | Start a new session |
| `phantom.py ping "note"` | Record activity (resets idle timer) |
| `phantom.py status` | See everything at a glance |
| `phantom.py status --brief` | One-line summary |
| `phantom.py check` | Scope + coverage check |
| `phantom.py anchor check` | Re-orient: where am I vs. where am I going |
| `phantom.py checkpoint` | Gate check before finishing |
| `phantom.py complete` | End the session |
| `phantom.py recover` | Clear stuck flags without losing session data |
| `phantom.py save / restore` | Survive container restarts |

---

## How the Heartbeat Works

1. `heartbeat-arm` arms the system and sets an ETA for the next fire
2. You spawn a background agent that runs `heartbeat_runner.py` (blocking, not background)
3. The runner polls every 30s — holds if Claude is active, fires when idle > threshold
4. Fire wakes the main session → Claude resumes work → re-arms for the next round
5. Repeat until `complete` is called or rounds run out

The fire is **real** — state is updated, rounds decrease, timestamps are recorded. It's not a timer or a fake signal.

---

## How the Drift Guard Works

Runs alongside the heartbeat as a second background agent. Every 60 seconds it checks git to see if changes are concentrated in one file. Four gates before it fires an alert:

1. **Scope check** — if the dominant file is inside declared scope, it's fine
2. **Task alignment** — if the file name matches the task keywords, it's fine
3. **Hunk spread** — if changes are distributed across the file (many hunks), it's fine
4. **Trend** — slow upward creep over multiple checks → alert

If drift fires, the main session sees it via `drift-done` and can spread changes or update scope.

---

## Profiles (built-in presets)

```bash
python3 agents/phantom.py start "task" --profile marathon
```

| Name | Turns | Threshold | Use for |
|---|---|---|---|
| `sprint` | 10 | 120s | Quick iteration |
| `marathon` | 30 | 180s | Long autonomous runs |
| `debug` | 5 | 60s | Testing the system itself |
| `focus` | 20 | 240s | Deep single-task work |

---

## Files

| File | What it is |
|---|---|
| `agents/phantom.py` | Everything — session CLI, state management, all commands |
| `agents/heartbeat_runner.py` | Background poller — fires when idle |
| `agents/drift_guard.py` | Background watcher — fires when one file dominates |
| `agents/criteria.py` | Shared module — evaluates done-criteria against session state |
| `agents/container_logger.py` | Logs container vitals every 60s |
| `agents/HEARTBEAT.md` | Instructions for the heartbeat sub-agent |
| `agents/DRIFT_GUARD.md` | Instructions for the drift guard sub-agent |
| `test_phantom.py` | 583 integration tests |
| `CLAUDE.md` | Full protocol, session state reference, troubleshooting |
| `DIFF.md` | Version changelog (every improvement since v1) |
| `PLAN.md` | Friction backlog + dogfood session log |
| `ANTI_DRIFT.md` | Real failure patterns observed in live sessions + fixes |

---

## Troubleshooting

**Heartbeat fired but nothing in state?**
Agent fabricated the output. Run `phantom.py recover` then re-arm.

**`heartbeat-arm` says "already active" but agents=0?**
Context compaction left flags stuck. Run `phantom.py recover` then re-arm.

**Drift guard fires SCOPE_CREEP immediately?**
Either scope wasn't declared on start, or `session_start_ref` is missing.
Fix: `phantom.py scope-update --scope <your files>` then `drift-arm`.

**Container died mid-session?**
`phantom.py restore` — recovers last saved state. Then re-arm and continue.

---

## Running Tests

```bash
python3 test_phantom.py
# 583 tests — covers all commands, heartbeat runner, drift guard, criteria module
```

---

*For the full protocol, session state schema, and anti-drift patterns — read `CLAUDE.md`.*
