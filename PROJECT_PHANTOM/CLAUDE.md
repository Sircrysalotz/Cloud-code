# PROJECT: PHANTOM

> Status: Active
> Purpose: Discover and maximize the capabilities of this cloud environment. Build the infrastructure that makes it actually useful.

---

## What is this project?

PHANTOM is a meta-project. It explores environment limits and builds the autonomous session tooling that lets Claude work for extended periods without constant user input.

## Key Environment Facts

- Container stays alive as long as background processes are running
- Bare `sleep` is blocked by the harness — always use `python3 -c "import time; time.sleep(N)"`
- Sub-agents run in background, report back, each return wakes the main session
- Internet is allowlist-restricted (GitHub + Anthropic API confirmed reachable)
- PostgreSQL 16 and Redis 7 available locally (start manually — not auto-started)
- Docker binary exists, daemon is not running
- Container idle timeout: confirmed alive past 10+ min of chat idle; container_logger.py maps this precisely
- A running background process keeps the container warm (heartbeat runner doubles as keepalive)
- Keep heartbeat idle threshold ≤ 180s (3 min) until container_logger gives accurate data

---

## The Heartbeat System (v2)

Enables autonomous extended sessions. Heartbeat fires ONLY when Claude is genuinely idle — not when waiting on sub-agents, not within cooldown, not when rounds are exhausted.

### v2 Improvements Over v1
| Problem | Fix |
|---|---|
| False positive while waiting on sub-agents | `agents_running` counter — heartbeat holds while > 0 |
| Rapid re-fire if ping missed | Configurable cooldown via `cooldown_factor` |
| Double heartbeat spawn | `heartbeat_active` flag — arm check prevents duplicate |
| JSON corruption on concurrent read/write | Atomic writes + lock file |
| Tests colliding with live session state | `PHANTOM_STATE` env var for full isolation |
| Hardcoded poll interval | `check_interval_seconds` in state, set via `--interval` |
| No SIGTERM handling | Graceful shutdown clears `heartbeat_active` flag |
| No drift reporting | Reports `+Ns` past threshold on fire |
| No watchdog | Detects poll cycles taking >3x interval |
| No session summary | Printed when `turns_taken == turns_target` |
| No test coverage | 103 integration tests in `v2/test_v2.py` |
| False fire during active coding (no ping) | Filesystem + git index activity signals in heartbeat_runner |
| All config flags must be typed each session | Profile system — named configs in `~/.phantom_profiles.json` |

### Files

| File | Purpose |
|---|---|
| `agents/phantom.py` | Unified session CLI (v2) |
| `agents/heartbeat_runner.py` | Polling monitor with all guards (v2) |
| `agents/HEARTBEAT.md` | Sub-agent instructions (v2) |
| `agents/container_logger.py` | Background vitals daemon (v2) |
| `logs/container_vitals.log` | Live container vitals log |
| `v2/` | Development copies + test suite + DIFF.md |

### Session State (`/tmp/phantom_session.json`)

```json
{
  "task": "what Claude is working on",
  "last_active": "2026-05-05 20:00:00",
  "turns_taken": 0,
  "turns_target": 10,
  "rounds_remaining": 5,
  "idle_threshold_seconds": 180,
  "check_interval_seconds": 30,
  "cooldown_factor": 1.0,
  "rounds_used": 0,
  "agents_running": 0,
  "active_agent_ids": [],
  "heartbeat_active": false,
  "last_heartbeat_fired": null,
  "progress_note": "",
  "started": "2026-05-05 20:00:00",
  "status": "active",
  "workspace_dir": "/path/to/cwd",
  "profile": null
}
```

---

## Protocol — Every Session

### Start container logger (once per container boot)
```bash
# Check if already running first
ps aux | grep container_logger | grep -v grep
# Start if not running
nohup python3 /home/user/Cloud-code/PROJECT_PHANTOM/agents/container_logger.py --interval 60 --push-every 5 > /tmp/container_logger.out 2>&1 &
```

### Initialize session
```bash
# With a profile (recommended — loads saved defaults)
python3 PROJECT_PHANTOM/agents/phantom.py start "task" --profile sprint

# Or with explicit flags
python3 PROJECT_PHANTOM/agents/phantom.py start "task" --turns 10 --rounds 5 --threshold 180 --interval 30 --cooldown-factor 1.0

# Profile flags can still be overridden
python3 PROJECT_PHANTOM/agents/phantom.py start "task" --profile sprint --turns 3
```

### Every turn start
```bash
python3 PROJECT_PHANTOM/agents/phantom.py ping "what I just did / what's next"
```

### Before spawning a worker sub-agent
```bash
python3 PROJECT_PHANTOM/agents/phantom.py agent-start --id "worker-name"
# spawn the agent
```

### When worker returns
```bash
python3 PROJECT_PHANTOM/agents/phantom.py agent-done --id "worker-name"
```

### Before spawning heartbeat (check exit code — skip spawn if exit 2)
```bash
python3 PROJECT_PHANTOM/agents/phantom.py heartbeat-arm
# if exit 0: spawn heartbeat
# if exit 2: heartbeat already active OR rounds=0 — do NOT spawn
```

### Heartbeat sub-agent prompt (keep it short)
> "Read /home/user/Cloud-code/PROJECT_PHANTOM/agents/HEARTBEAT.md and execute."

Use `run_in_background: true`.

### When heartbeat fires
1. `phantom.py ping "resuming — [what's next]"`
2. `phantom.py heartbeat-arm`
3. Spawn next heartbeat round
4. Continue work immediately — do NOT wait

### Check status anytime
```bash
python3 PROJECT_PHANTOM/agents/phantom.py status
```

### Save session state to git (call periodically — survives container restart)
```bash
python3 PROJECT_PHANTOM/agents/phantom.py save
```

### Restore after container restart
```bash
python3 PROJECT_PHANTOM/agents/phantom.py restore
# Use --force to restore over an existing session
```

### Explicit session end
```bash
python3 PROJECT_PHANTOM/agents/phantom.py complete
```

### Session history
```bash
python3 PROJECT_PHANTOM/agents/phantom.py history
```

### Anti-drift scope check (warns if any file >50% of changes)
```bash
python3 PROJECT_PHANTOM/agents/phantom.py scope
```

### Manage profiles
```bash
# List all profiles
python3 PROJECT_PHANTOM/agents/phantom.py config list

# Create a profile (stored in ~/.phantom_profiles.json by default)
python3 PROJECT_PHANTOM/agents/phantom.py config create security \
  --description "Security audit" --turns 5 --rounds 3 --threshold 120 \
  --cooldown-factor 0.5 --scope-threshold 25

# Show a profile
python3 PROJECT_PHANTOM/agents/phantom.py config show security

# Update a single value
python3 PROJECT_PHANTOM/agents/phantom.py config set security turns 6

# Delete a profile
python3 PROJECT_PHANTOM/agents/phantom.py config delete security

# Override PHANTOM_PROFILES env var to use a project-local profiles file
export PHANTOM_PROFILES=/path/to/project/phantom_profiles.json
```

### Emergency cleanup
```bash
python3 PROJECT_PHANTOM/agents/phantom.py reset
```

---

## Container Logger

Runs independently of the heartbeat. Maps when the container dies.

```bash
# Check vitals
tail -20 PROJECT_PHANTOM/logs/container_vitals.log
# Check if running
ps aux | grep container_logger | grep -v grep
```

Last pushed entry on GitHub = last confirmed alive before container death.

---

## Testing

```bash
# Run full integration suite (isolated from live session)
python3 PROJECT_PHANTOM/v2/test_v2.py
# 46 tests covering all phantom.py commands + heartbeat_runner edge cases
```

---

## Anti-Drift Observations (from 10-turn session)

Key patterns that cause drift in autonomous sessions:
- Treating heartbeat as a turn timer (stop and wait) — it should fire when you genuinely stop
- Writing code without pinging — looks idle to heartbeat even when active
- Vertical creep on one file while others are neglected

Proposed future agents (`v2/ANTI_DRIFT.md`):
- **Scope Guard** — warns if one file is getting disproportionate commits
- **Goal Alignment Checker** — re-reads task, flags if progress notes drift from goal
- **Coverage Tracker** — tracks which targets have been touched vs skipped
- **Progress Note Auditor** — flags vague notes, enforces specificity

---

## Rules

- Always ping at the start of every turn — no exceptions
- Always call `agent-start` before spawning a worker, `agent-done` when it returns
- Always call `heartbeat-arm` and check exit code before spawning heartbeat
- Keep idle threshold ≤ 180s until container timeout is fully mapped
- Update this CLAUDE.md as new environment facts are discovered
- The correct flow: work continuously → stop when genuinely done → heartbeat fires → resume
