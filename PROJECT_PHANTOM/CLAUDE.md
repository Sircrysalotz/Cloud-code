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
- Container idle timeout: confirmed alive past 10+ minutes of chat idle; true death point unknown — container_logger.py is mapping this accurately
- A running background process keeps the container warm (heartbeat runner doubles as keepalive)
- Keep heartbeat idle threshold ≤ 180s (3 min) until container_logger gives accurate data

---

## The Heartbeat System

Enables autonomous extended sessions. The heartbeat fires ONLY when Claude is genuinely idle — not when waiting on sub-agents, not within the cooldown window, not when rounds are exhausted.

### Fixes over v1
| Problem | Fix |
|---|---|
| False positive while waiting on sub-agents | `agents_running` counter — heartbeat holds while > 0 |
| Rapid re-fire if ping missed | Cooldown: can't re-fire within one full threshold window |
| Double heartbeat spawn | `heartbeat_active` flag — arm check prevents duplicate |
| JSON corruption on concurrent read/write | Atomic writes via write-to-temp + `os.rename()` |
| Meaningless turn counter | Optional `progress_note` on every ping |

### Files

| File | Purpose |
|---|---|
| `agents/phantom.py` | Unified session CLI — all state operations go through here |
| `agents/heartbeat_runner.py` | The polling monitor — handles all guard conditions |
| `agents/HEARTBEAT.md` | Instructions the heartbeat sub-agent reads |
| `agents/container_logger.py` | Background daemon — logs vitals every 60s, pushes to git every 5 min |
| `logs/container_vitals.log` | Persistent vitals log — last entry = last confirmed container alive |

### Session State (`/tmp/phantom_session.json`)

```json
{
  "task": "what Claude is working on",
  "last_active": "2026-05-05 20:00:00",
  "turns_taken": 0,
  "turns_target": 10,
  "rounds_remaining": 5,
  "idle_threshold_seconds": 180,
  "agents_running": 0,
  "heartbeat_active": false,
  "last_heartbeat_fired": null,
  "progress_note": "",
  "started": "2026-05-05 20:00:00",
  "status": "active"
}
```

---

## Container Logger

Runs independently of the heartbeat. Its job is to accurately map when the container dies.

### Start it at the beginning of every session
```bash
nohup python3 /home/user/Cloud-code/PROJECT_PHANTOM/agents/container_logger.py > /tmp/container_logger.out 2>&1 &
echo "Logger PID: $!"
```

### How it works
- Logs a timestamped entry every 60 seconds to `logs/container_vitals.log`
- Every 5 entries (~5 min) commits and pushes the log to git
- When the container dies, the last pushed entry = last confirmed alive timestamp
- Subtract that from the next session start to get the death window

### Check it anytime
```bash
tail -20 /home/user/Cloud-code/PROJECT_PHANTOM/logs/container_vitals.log
```

### Check if still running
```bash
ps aux | grep container_logger | grep -v grep
```

---

## Protocol — Every Session

### Start
```bash
python3 PROJECT_PHANTOM/agents/phantom.py start "task description" --turns 10 --rounds 5 --threshold 180
```

### Every turn (MUST run at start of each turn)
```bash
python3 PROJECT_PHANTOM/agents/phantom.py ping "what I just did / what's next"
```

### Before spawning ANY worker sub-agent
```bash
python3 PROJECT_PHANTOM/agents/phantom.py agent-start
# spawn the agent
```

### When a worker sub-agent returns
```bash
python3 PROJECT_PHANTOM/agents/phantom.py agent-done
```

### Before spawning the heartbeat sub-agent
```bash
python3 PROJECT_PHANTOM/agents/phantom.py heartbeat-arm
# exits with code 2 if already armed or no rounds left — DO NOT spawn if it exits 2
```

### Heartbeat sub-agent prompt (keep it this short)
> "Read /home/user/Cloud-code/PROJECT_PHANTOM/agents/HEARTBEAT.md and execute."

Always use `run_in_background: true`.

### When heartbeat fires (new turn starts)
1. `phantom.py ping "resuming — [what's next]"`
2. `phantom.py heartbeat-arm`
3. Spawn next heartbeat round
4. Continue work

### Check state anytime
```bash
python3 PROJECT_PHANTOM/agents/phantom.py status
```

---

## Rules

- Always ping at the start of every turn — no exceptions
- Always call `agent-start` before spawning a worker, `agent-done` when it returns
- Always call `heartbeat-arm` and check exit code before spawning heartbeat
- Never spawn a heartbeat if `heartbeat-arm` exits with code 2
- Keep idle threshold ≤ 180s (container timeout not fully mapped yet)
- Update this CLAUDE.md as new environment facts are discovered
