# PROJECT: PHANTOM

> Status: Active
> Purpose: Discover and maximize the capabilities of this cloud environment. Build the infrastructure that puts it on steroids.

---

## What is this project?

PHANTOM is a meta-project. It's not an app or a product — it's the system that makes everything else possible. It explores environment limits, builds reusable tooling, and creates the autonomous session infrastructure that lets Claude work for extended periods without constant user input.

## Key Discoveries So Far

- Container stays alive as long as background processes are running
- Bare `sleep` is blocked by the harness — use `python3 -c "import time; time.sleep(N)"`
- Sub-agents run in background, report back, and each return wakes the main session for a new turn
- Internet is allowlist-restricted (GitHub + Anthropic API confirmed reachable)
- PostgreSQL 16 and Redis 7 are available locally (need to be started manually)
- Docker binary exists but daemon is not running

## The Heartbeat System

The core PHANTOM infrastructure. Enables Claude to work autonomously for extended sessions.

### How It Works

1. **Start a session** — sets up state file with task, turn target, heartbeat rounds
2. **Ping each turn** — Claude signals it's active at the start of every turn
3. **Heartbeat agent** — runs in background, polls every 30s, fires when Claude goes idle
4. **Resume loop** — each heartbeat wakes Claude for a new turn, repeats until rounds hit zero

### Files

| File | Purpose |
|---|---|
| `agents/start_session.py` | Initialize a work session |
| `agents/session_ping.py` | Run at start of each turn to signal active |
| `agents/heartbeat_runner.py` | The polling monitor — fires on idle detection |
| `agents/HEARTBEAT.md` | Instructions the heartbeat sub-agent reads |

### Session State File

Lives at `/tmp/phantom_session.json` (ephemeral — resets with container):

```json
{
  "task": "what Claude is working on",
  "last_active": "2026-05-05 20:00:00",
  "turns_taken": 3,
  "turns_target": 10,
  "rounds_remaining": 7,
  "idle_threshold_seconds": 180,
  "started": "2026-05-05 19:45:00",
  "status": "active"
}
```

### Starting a Session

```bash
# Initialize state (task, turns, heartbeat rounds, idle threshold in seconds)
python3 PROJECT_PHANTOM/agents/start_session.py "my task description" 10 10 180

# Ping at the start of each Claude turn
python3 PROJECT_PHANTOM/agents/session_ping.py
```

### Spawning the Heartbeat Sub-Agent

Keep the prompt minimal:
> "Read /home/user/Cloud-code/PROJECT_PHANTOM/agents/HEARTBEAT.md and execute."

Use `run_in_background: true`. When it fires, it returns a report. Immediately ping, then spawn the next one.

## Rules

- Always ping at the start of every turn during an active session
- Always spawn the next heartbeat round immediately after one fires
- Never let rounds_remaining hit zero without wrapping up the task cleanly
- Keep this CLAUDE.md updated as new discoveries are made
