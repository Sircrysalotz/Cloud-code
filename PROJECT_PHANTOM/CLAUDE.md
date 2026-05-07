# PROJECT: PHANTOM

> Status: Active
> Purpose: Discover and maximize the capabilities of this cloud environment. Build the infrastructure that makes it actually useful.

---

## What is this project?

PHANTOM is a meta-project. It explores environment limits and builds autonomous session tooling that lets Claude work for extended periods without constant user input. Every session improves the system that runs future sessions.

## Key Environment Facts

| Fact | Detail |
|---|---|
| Container keepalive | Stays alive as long as background processes run (heartbeat runner doubles as keepalive) |
| `sleep` is blocked | Use `python3 -c "import time; time.sleep(N)"` instead |
| Sub-agents | Run in background, report back; each return wakes the main session |
| Internet | Allowlist-restricted — GitHub + Anthropic API confirmed reachable |
| Databases | PostgreSQL 16 + Redis 7 available locally (not auto-started) |
| Docker | Binary exists, daemon is not running |
| Idle timeout | Confirmed alive past 10+ min of chat idle; container_logger maps this precisely |
| Idle threshold | Keep ≤ 180s until container timeout is fully mapped |

---

## The Heartbeat System

Enables autonomous extended sessions. The heartbeat fires ONLY when Claude is genuinely idle — not when waiting on sub-agents, not within cooldown, not when rounds are exhausted.

### How turns work (important)

`turns_target` is a **budget floor, not a deadline.**

- Hitting the target prints `TURN TARGET REACHED — keep working` and keeps `status: active`
- Turns beyond the target count normally — there is no upper limit
- **Only `phantom.py complete` ends the session** — call it when the task is genuinely done
- Never call `complete` just because you hit the turn count

### When to call `phantom.py complete`

Call it when:
- All planned work for the session is done and committed
- The user explicitly asks to end the session

Do NOT call it:
- When you hit the turn target (that's just a milestone)
- When a heartbeat fires (resume and keep working)
- Between turns (only at true session end)

### Improvement history

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
| File-% drift fires on legitimate single-file tasks | Four-gate eval: declared scope → task alignment → hunk depth → trend |
| No watchdog | Detects poll cycles taking >3x interval |
| **Turn target stops work early** | **`turns_target` is a budget floor — session stays active past target** |
| No test coverage | 381 integration tests in `test_phantom.py` |
| False fire during active coding (no ping) | Filesystem + git index activity signals in heartbeat_runner |
| All config flags must be typed each session | Profile system — named configs in `~/.phantom_profiles.json` |
| No horizontal enforcement during sessions | `drift_guard.py` background agent — four-gate evaluation |
| Single-poll false positives possible | `--min-idle-polls N` — require N consecutive polls above threshold |
| No ETA in status panel | `status` shows "fires in ~Xs (held: signal)" via `next_heartbeat_at` |
| Drift guard bleeds into previous sessions | `session_start_ref` stored on start — drift guard only checks current session |
| No fire timing retrospective | `heartbeat_fires` list in state (last 10 events, shown in `history`) |
| Heartbeat keeps running after `complete` | Runner checks `status == "complete"` and exits cleanly |
| No way to see full session state at a glance | `phantom.py report` — overview, fires, scope snapshot, watchdog events |
| `heartbeat_active` stuck after crash or context loss | `phantom.py recover` — clears stuck flags without wiping session data |
| Heartbeat fires on all file types indiscriminately | `tracked_extensions` + `scan_depth` in state, configurable via `--tracked-exts` |
| Watchdog stalls invisible after runner exits | `watchdog_events[]` written to state — visible in `report` and `status` |
| Drift verdicts give generic "spread changes" advice | Verdict-specific ACTION text: SCOPE_CREEP/VERTICAL/TRENDING each have tailored guidance |
| No resource alerts in container logger | `container_logger v3` — mem/disk threshold alerts with deduplication |
| `scope_guard.py` ignores session boundaries | `--session` flag reads `session_start_ref` from phantom state |
| Common profiles must be recreated each project | Built-in presets: `sprint`, `marathon`, `debug`, `focus` — always available |
| Separate scope/coverage checks require two commands | `phantom.py check` — unified scope + coverage in one shot, session-anchored |
| Coverage targets must be re-specified every run | `--coverage-targets` stored in state at start; loaded by `check` automatically |
| `--scope-threshold` only settable per-run in drift_guard | `--scope-threshold` on `start` — stored in state, read by drift_guard + check |
| Profile list fields not loaded from profile | scope_files, coverage_targets, tracked_extensions, scan_depth all profile-resolved |
| Status/complete/report hide coverage status | All three commands show coverage summary when coverage_targets or scope_files set |
| Test count varies between runs | Accepted: count is git-state-dependent (~502 as of v3.2) |
| `agent-start` for drift-guard blocked heartbeat forever | Protocol fix: drift-guard uses `drift-arm`/`drift-done` only — never `agent-start` |
| `agent-start` for heartbeat also blocks heartbeat | Protocol fix: heartbeat uses `heartbeat-arm` only — never `agent-start` |
| No navigation aids after resume — Claude loses bearing | `phantom.py anchor show/check` — immovable Point A (origin) and Point B (goal) always visible |
| Completion practices are optional — easy to skip | `phantom.py checkpoint` — non-negotiable gates: ping freshness, drift, scope, coverage |
| Anchor criteria always show `[ ]` even when verifiably met | `_eval_criteria()` — auto-marks coverage and drift criteria `[x]` when observable |
| `complete` silently skips pre-flight checks | `_soft_checkpoint()` in `complete` — warns on stale ping, drift, zero coverage |
| Heartbeat fire doesn't say which round it is | Fire banner: "HEARTBEAT FIRED (round N/total)" |
| auto-save `last_session_state.json` fires SCOPE_CREEP on every commit | `drift_guard` v4 auto-detects and ignores `logs/` dir by default |
| Full status is 20+ lines — too much for quick sanity check | `status --brief` — one-line compact summary: turns, HB ETA, coverage, drift, note |
| Anchor/checkpoint/HB-fire/test criteria unverifiable at runtime | `anchor_checks_count`, `checkpoint_calls_count`, `tests_last_count`, `heartbeat_fires[]` — all 4 tracked and auto-eval |
| `ping --tests N` confirmation not shown | Prints "Tests recorded: N" so recording is auditable |
| HB ETA ignores `min_idle_polls` extra delay | ETA = threshold + (min_idle_polls-1) × interval — accurately reflects actual fire time |
| Heartbeat agent uses `run_in_background: true` → runner dies on agent return | `HEARTBEAT.md` v4: CRITICAL note — blocking Bash with `timeout=600000`, never `run_in_background` |
| `scope`, `check`, `checkpoint` show `last_session_state.json` inflating % | All now filter via `_is_auto_generated()` — excludes entire `logs/` dir |
| Fire banner shows `[ ]` for all criteria even when met | `eval_criteria_quick()` in runner evaluates state counters — shows `[x]` for met criteria |
| `DRIFT_GUARD.md` agent uses `run_in_background: true` → process dies on return | `DRIFT_GUARD.md` v4: CRITICAL note — blocking Bash with `timeout=600000`, never `run_in_background` |
| `eval_criteria_quick` in runner duplicates `_eval_criteria` but can't check coverage | `coverage_full` bool written to state by `check` command — runner reads it, no git ops needed |
| Coverage criterion always shows `[ ]` in fire banner even when full | `eval_criteria_quick` now evaluates coverage via `state["coverage_full"]` — shows `[x]` after `check` runs |
| Auto-save creates a new commit every N pings → bloated git log | `auto_save` tracks `auto_save_commit` hash in state — amends own prior commit instead of creating new ones |
| Amended auto-save message stays stale at first turn number | Amend uses `-m` with current turn — git log always shows latest turn number |
| `anchor check` doesn't update `coverage_full` — fire banner shows `[ ]` until `check` runs | `anchor check` now writes `coverage_full` to state whenever coverage targets are set |
| `status --brief` coverage unlabeled — `0/3` looks like a mystery number | Brief now shows `cov:0/3` — label makes it unambiguous |
| `status --brief` note hard-truncated mid-word | Truncates at 37 chars with `...` — clean word-boundary cut |
| `report` scope section shows `last_session_state.json` at 100% (not filtered) | `report` now filters `_SAVED_REL` same as `scope`/`check`/`checkpoint` |
| `report` ping log note hard-truncated mid-word | Truncates at 52 chars with `...` — consistent with brief mode |
| `history` ping log note hard-truncated mid-word | Truncates at 57 chars with `...` |
| heartbeat_runner.py docstring still says v6 despite v7 changes | Updated to v7 with ETA and coverage_full entries |
| Agents use Monitor tool for runner — process dies when Monitor closes (stuck flag) | HEARTBEAT.md + DRIFT_GUARD.md v5: explicit "NOT Monitor tool" warning with root cause |
| `container_vitals.log` in scope analysis (10% inflation) — only `last_session_state.json` was filtered | `_is_auto_generated()` helper filters entire `logs/` dir from all scope paths (phantom.py + drift_guard.py) |
| `report` coverage section lists targets without ✓/✗ — `check` shows them, `report` doesn't | `report` now runs git diff and shows ✓/✗ per target, consistent with `check` |
| Scope declared at start can't be updated mid-session — `start --force` resets everything | `scope-update` command: updates `scope_files`, `coverage_targets`, `scope_threshold` without resetting session state |
| Drift guard agent can fabricate "clean" verdict — real drift goes undetected | `DRIFT_GUARD.md` v4: fabrication prevention section; main session reads state via `drift-done`, not agent text |
| Heartbeat agent fabricates entire fire output using HEARTBEAT.md docs as template — state never updated | `HEARTBEAT.md` v6: fabrication prevention rules + post-flight state verification + exact HOLD/fire formats |
| After fabricated fire, main session has no way to detect it without manual inspection | Protocol: check `rounds_remaining` decreased + `last_heartbeat_fired` set before accepting fire as real |
| `drift-done` SCOPE_CREEP message said "spread changes" — didn't mention `scope-update` | `drift-done` now shows Option A/B with explicit `scope-update` hint for SCOPE_CREEP verdict |
| DIFF.md / PLAN.md / ANTI_DRIFT.md stale since v1→v2 session (3+ versions behind) | Rewrote all three: DIFF.md is now full changelog v1→v3.x; PLAN.md has friction backlog + invariants; ANTI_DRIFT.md has v3.x patterns |
| `drift_guard.py` SCOPE_CREEP action_map still referenced `start --force` (not `scope-update`) | `drift_guard.py` action_map SCOPE_CREEP text updated to `scope-update --scope <files>` |
| `scope-update` doesn't warn when drift guard is currently armed with old scope | `scope-update` now warns: "running process uses OLD scope — re-arm with `drift-arm`" |
| `status` shows no criteria progress — must run `anchor check` to see criterion state | `status` now shows criteria mini-view: `N/M met \| [x] [ ] [ ]` from `_eval_criteria()` |
| Heartbeat agent returns early with "I will relay output once runner exits" (no output) | `HEARTBEAT.md` v7: warning at top — do NOT generate text before Bash call; text = return value |
| Runner sleeps `check_interval` (30s) before first check — agent can return before any output | `heartbeat_runner.py`: `first_iteration` flag skips sleep on first poll; if already idle, fires in < 1s |
| `check` command re-runs git diff on every call — slow if called often | `check` caches result in session state (30s TTL); use `--no-cache` to force fresh run |
| `status` criteria mini-view shows marks only — no criterion text visible | `status --verbose` expands to full list with text and `[x]/[ ]` per criterion |
| Warning-only HEARTBEAT.md v7 still caused early returns — model acknowledges warning as text | `HEARTBEAT.md` v8: execution steps (STEP 1/2/3) placed at the very top before any prose |
| `heartbeat_runner.py` fire banner shows only first 3 criteria — rest hidden | Runner v8: fire banner shows ALL criteria with `Criteria: N/M met` count header |
| No session elapsed visible during marathon — hard to track progress | Runner v8 fire banner + drift_guard status lines include session elapsed (e.g. `+1h05m`) |
| `_eval_criteria` couldn't auto-mark "CLAUDE.md updated" or similar file criteria | New "file updated" pattern: extracts filename from criterion, checks `git diff --name-only` since session start |
| `eval_criteria_quick` (runner) and `_eval_criteria` (phantom.py) are two separate implementations that drift apart | Extracted `criteria.py` shared module; both files import `eval_criteria` from it — one implementation forever |
| Drift guard agent spawned with "Read DRIFT_GUARD.md" causes Pattern 9 (formatted summary) | Direct-command spawn prompt added to CLAUDE.md protocol step 4, same approach as heartbeat |

### Files

| File | Purpose |
|---|---|
| `agents/phantom.py` | Unified session CLI |
| `agents/heartbeat_runner.py` | Polling monitor with all guards |
| `agents/HEARTBEAT.md` | Sub-agent instructions |
| `agents/drift_guard.py` | Horizontal drift monitor |
| `agents/DRIFT_GUARD.md` | Drift guard sub-agent instructions |
| `agents/container_logger.py` | Background vitals daemon |
| `logs/container_vitals.log` | Live container vitals log |
| `logs/last_session_state.json` | Git-persisted session state (survives restart) |
| `tools/scope_guard.py` | Portable drift checker for any git repo |
| `tools/coverage_tracker.py` | Target file coverage checker |
| `tools/setup.sh` | Drop-in environment checker for fresh machines |
| `test_phantom.py` | Full integration test suite (~472 tests) |
| `DIFF.md` | Version changelog (v2.0 → v2.5) |
| `PLAN.md` | Horizontal improvement tracker |
| `ANTI_DRIFT.md` | Anti-drift observations from sessions |

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
  "min_idle_polls": 1,
  "rounds_used": 0,
  "agents_running": 0,
  "active_agent_ids": [],
  "heartbeat_active": false,
  "drift_guard_active": false,
  "drift_warning": null,
  "drift_warned_at": null,
  "last_heartbeat_fired": null,
  "last_activity_source": "ping",
  "last_activity_ts": "2026-05-05 20:00:00",
  "next_heartbeat_at": "2026-05-05 20:03:00",
  "heartbeat_fires": [],
  "watchdog_events": [],
  "ping_log": [],
  "progress_note": "",
  "started": "2026-05-05 20:00:00",
  "completed": null,
  "saved_at": null,
  "status": "active",
  "workspace_dir": "/path/to/cwd",
  "session_start_ref": "abc123...",
  "scope_files": [],
  "coverage_targets": [],
  "scope_threshold": 50.0,
  "tracked_extensions": [],
  "scan_depth": 5,
  "auto_save_every": 5,
  "auto_save_commit": null,
  "coverage_full": null,
  "profile": null,
  "anchor_a": {"ref": "abc123...", "timestamp": "2026-05-05 20:00:00"},
  "anchor_b": {"goal": "task description", "done_criteria": [], "set_at": "2026-05-05 20:00:00"}
}
```

---

## Protocol — Every Session

### 1. Start container logger (once per container boot)
```bash
ps aux | grep container_logger | grep -v grep
# If not running (run from repo root):
nohup python3 PROJECT_PHANTOM/agents/container_logger.py \
  --interval 60 --push-every 5 > /tmp/container_logger.out 2>&1 &
```

### 2. Initialize session
```bash
# Explicit flags
python3 PROJECT_PHANTOM/agents/phantom.py start "task description" \
  --turns 20 --rounds 8 --threshold 180 --interval 30

# With profile (loads saved defaults, overridable by flags)
python3 PROJECT_PHANTOM/agents/phantom.py start "task" --profile sprint

# With declared scope (drift guard uses this — prevents false SCOPE_CREEP)
python3 PROJECT_PHANTOM/agents/phantom.py start "task" \
  --scope agents/phantom.py agents/heartbeat_runner.py test_phantom.py

# With coverage targets (used by 'check' command)
python3 PROJECT_PHANTOM/agents/phantom.py start "task" \
  --coverage-targets agents/phantom.py agents/heartbeat_runner.py agents/drift_guard.py

# With custom scope threshold (used by drift guard + check)
python3 PROJECT_PHANTOM/agents/phantom.py start "task" --scope-threshold 30

# With min-idle-polls (require 2 consecutive idle polls before firing)
python3 PROJECT_PHANTOM/agents/phantom.py start "task" --min-idle-polls 2

# With done criteria (sets anchor Point B on session start)
python3 PROJECT_PHANTOM/agents/phantom.py start "task" \
  --done-criteria "all tests pass" "coverage 4/4" "CLAUDE.md updated"
```

### 3. Ping at the start of every turn (no exceptions)
```bash
python3 PROJECT_PHANTOM/agents/phantom.py ping "what I just did / what's next"

# After running tests, record the count so criteria eval can auto-mark "N+ tests passing":
python3 PROJECT_PHANTOM/agents/phantom.py ping "note" --tests 472
```

### 4. Start drift guard (run alongside heartbeat)
```bash
python3 PROJECT_PHANTOM/agents/phantom.py drift-arm
```
Use `run_in_background: true`.

**Preferred spawn prompt** (direct command — avoids Pattern 9 summary-instead-of-verbatim):
```
You are a phantom drift monitoring agent. Make exactly 3 Bash tool calls in order, then return their output. Do NOT write any text until all 3 calls complete.

Call 1 (Bash, timeout=30000): python3 <AGENTS_DIR>/phantom.py status
  If drift_guard_active=false → stop. Return "Not armed."
Call 2 (Bash, timeout=600000, blocking — NOT run_in_background, NOT Monitor):
  python3 <AGENTS_DIR>/drift_guard.py --interval 60 --threshold 50
Call 3 (Bash, timeout=30000): python3 <AGENTS_DIR>/phantom.py status

Your response = full output from calls 2 and 3 verbatim. Nothing else.
```
Note: the main session calls `drift-done` after this agent returns — the agent does NOT call drift-done.

Fallback: `"Read <path-to-agents-dir>/DRIFT_GUARD.md and execute."`

**IMPORTANT:** Do NOT call `agent-start` for drift guard. It uses `drift-arm`/`drift-done` only.
Calling `agent-start` would increment `agents_running`, permanently blocking the heartbeat.

### 5. Start heartbeat (check exit code first)
```bash
python3 PROJECT_PHANTOM/agents/phantom.py heartbeat-arm
# exit 0 → spawn heartbeat
# exit 2 → already active OR rounds=0 — do NOT spawn
```
Use `run_in_background: true`.

**Preferred spawn prompt** (direct command — avoids "read file" planning step that causes early returns):
```
You are a phantom heartbeat monitoring agent. Make exactly 3 Bash tool calls in order, then return their output. Do NOT write any text until all 3 calls complete.

Call 1 (Bash, timeout=30000): python3 <AGENTS_DIR>/phantom.py status
  If rounds_remaining=0 or heartbeat_active=false → stop. Return "Not armed / no rounds."
Call 2 (Bash, timeout=600000, blocking — NOT run_in_background, NOT Monitor):
  python3 <AGENTS_DIR>/heartbeat_runner.py
Call 3 (Bash, timeout=30000): python3 <AGENTS_DIR>/phantom.py status

Your response = full output from calls 2 and 3 verbatim. Nothing else.
```

Fallback (if direct approach unavailable): `"Read <path-to-agents-dir>/HEARTBEAT.md and execute."`
**IMPORTANT:** Do NOT call `agent-start` for heartbeat either. Use `heartbeat-arm` only.

### 6. When heartbeat fires
```bash
# Verify the fire actually happened (agent may fabricate output from docs)
python3 PROJECT_PHANTOM/agents/phantom.py status
# Check: rounds_remaining decreased AND last_heartbeat_fired is set
# If rounds_remaining UNCHANGED and heartbeat_active stuck True → fabricated fire:
python3 PROJECT_PHANTOM/agents/phantom.py recover   # clear stuck flag, then re-arm

# If fire was real — resume:
python3 PROJECT_PHANTOM/agents/phantom.py ping "resuming — [what I'm doing next]"
python3 PROJECT_PHANTOM/agents/phantom.py heartbeat-arm   # check exit code
# if exit 0: spawn next heartbeat round
# Continue work immediately — do NOT wait for heartbeat
```

### 7. When drift guard returns
```bash
python3 PROJECT_PHANTOM/agents/phantom.py drift-done
# exit 0 → clean, re-arm if continuing: phantom.py drift-arm
# exit 1 → drift detected — spread changes then re-arm
```

### 8. Before spawning any worker sub-agent
```bash
python3 PROJECT_PHANTOM/agents/phantom.py agent-start --id "worker-name"
# spawn the agent
# when it returns:
python3 PROJECT_PHANTOM/agents/phantom.py agent-done --id "worker-name"
```
**Worker agents only** — NOT for heartbeat or drift guard. Those have their own arm/done commands.

### 9. Explicitly end the session (when truly done)
```bash
python3 PROJECT_PHANTOM/agents/phantom.py complete
```

---

## Useful Commands

```bash
# Check status (shows heartbeat ETA, activity source, fire log, watchdog)
python3 PROJECT_PHANTOM/agents/phantom.py status

# Full session report (overview, fire history, scope snapshot, watchdog events)
python3 PROJECT_PHANTOM/agents/phantom.py report

# Full session history (turns, fires, scope)
python3 PROJECT_PHANTOM/agents/phantom.py history

# Soft reset: clear stuck flags (heartbeat_active, agents_running) without losing session
python3 PROJECT_PHANTOM/agents/phantom.py recover

# Horizontal scope check (last 5 commits)
python3 PROJECT_PHANTOM/agents/phantom.py scope

# Scope check — this session only (uses session_start_ref)
python3 PROJECT_PHANTOM/agents/phantom.py scope --session

# Scope check with custom threshold
python3 PROJECT_PHANTOM/agents/phantom.py scope --threshold 30

# Unified scope + coverage check (anchored to session_start_ref)
python3 PROJECT_PHANTOM/agents/phantom.py check

# Check with explicit coverage targets
python3 PROJECT_PHANTOM/agents/phantom.py check --targets agents/phantom.py agents/heartbeat_runner.py

# Check with custom drift threshold
python3 PROJECT_PHANTOM/agents/phantom.py check --threshold 30

# Update scope mid-session (without resetting turns or state)
python3 PROJECT_PHANTOM/agents/phantom.py scope-update --scope agents/phantom.py CLAUDE.md
python3 PROJECT_PHANTOM/agents/phantom.py scope-update --coverage-targets agents/phantom.py agents/heartbeat_runner.py
python3 PROJECT_PHANTOM/agents/phantom.py scope-update --scope-threshold 40
# Then re-arm drift guard: phantom.py drift-arm

# Save state to git (survives container restart)
python3 PROJECT_PHANTOM/agents/phantom.py save

# Restore state after restart
python3 PROJECT_PHANTOM/agents/phantom.py restore

# Emergency cleanup (clears all state files)
python3 PROJECT_PHANTOM/agents/phantom.py reset

# Environment check (verify paths, tools, and session on any machine)
python3 PROJECT_PHANTOM/agents/phantom.py env

# ── Anchor-based navigation ──────────────────────────────────────────────────
# After resume, prefer anchor check (not anchor show) — it evaluates criteria in one step
python3 PROJECT_PHANTOM/agents/phantom.py anchor check

# anchor show: just displays anchors, no criteria evaluation (use only for quick reference)
python3 PROJECT_PHANTOM/agents/phantom.py anchor show

# Re-orient: compare current position against origin and goal
python3 PROJECT_PHANTOM/agents/phantom.py anchor check

# Set (or update) done criteria for Point B
python3 PROJECT_PHANTOM/agents/phantom.py anchor set-goal --criteria \
  "all tests pass" "coverage 4/4" "CLAUDE.md updated"

# ── Checkpoint gates ─────────────────────────────────────────────────────────
# Run non-negotiable gate checks (ping freshness, drift, scope, coverage)
python3 PROJECT_PHANTOM/agents/phantom.py checkpoint

# Strict mode: scope drift is a hard failure + require full coverage
python3 PROJECT_PHANTOM/agents/phantom.py checkpoint --gate --require-full-coverage
```

---

## Profiles

Named configurations stored in `~/.phantom_profiles.json` (or `PHANTOM_PROFILES` env var).

### Built-in presets (always available — no setup required)

| Name | turns | threshold | Description |
|---|---|---|---|
| `sprint` | 10 | 120s | Fast iteration — quick heartbeat cycles |
| `marathon` | 30 | 180s | Long autonomous run — many rounds |
| `debug` | 5 | 60s | Short cycles for testing |
| `focus` | 20 | 240s | Deep single-task, strict drift guard |

User-created profiles with the same name override built-ins.

```bash
# List all profiles (shows built-ins + user profiles)
python3 PROJECT_PHANTOM/agents/phantom.py config list

# Use a built-in preset
python3 PROJECT_PHANTOM/agents/phantom.py start "task" --profile marathon

# Create a custom profile (user profiles override built-ins)
python3 PROJECT_PHANTOM/agents/phantom.py config create myprofile \
  --description "Custom setup" --turns 15 --rounds 6 --threshold 150

# Show / update / delete
python3 PROJECT_PHANTOM/agents/phantom.py config show sprint
python3 PROJECT_PHANTOM/agents/phantom.py config set myprofile turns 15
python3 PROJECT_PHANTOM/agents/phantom.py config delete myprofile
```

Profile keys: `turns`, `rounds`, `threshold`, `interval`, `cooldown_factor`,
`min_idle_polls`, `scope_threshold`, `scope_files`, `coverage_targets`,
`tracked_extensions`, `scan_depth`, `auto_save_every`, `description`

---

## Drift Guard

Runs as a background sub-agent. Uses four-gate evaluation — won't fire false positives on legitimate single-file tasks.

### Four gates (checked in order)

1. **Declared scope** — if `--scope` was set on `phantom.py start`, concentrating on scope files is CLEAN. Creeping outside scope > 30% (configurable `--scope-threshold`) fires `SCOPE_CREEP`.
2. **Task alignment** — if the dominant file name matches keywords in the task description, CLEAN. (Editing `drift_guard.py` when task says "improve drift guard".)
3. **Hunk spread** — if hunk_count ≥ 4 (configurable `--hunk-count-min`) AND spread ≥ 0.3 (configurable `--hunk-spread`), CLEAN. (Many hunks distributed across file = horizontal work.)
4. **Trend detection** — if dominant file is trending upward AND consistently above threshold for N checks (configurable `--trend-checks`), fires `TRENDING`.
5. **Fallback** — raw percentage > `--threshold` (default 50%) → `VERTICAL`.

### Verdicts

| Verdict | Meaning | Action |
|---|---|---|
| `CLEAN` | No drift | Continue |
| `SCOPE_CREEP` | Changes outside declared scope | Spread back into scope files |
| `VERTICAL` | One file dominates (last-resort) | Break work into more files |
| `TRENDING` | Slow upward creep detected | Spread changes proactively |

### Key fix: session anchoring

Drift guard uses `session_start_ref` from session state as the `--since` git ref. This ensures it only checks changes made in the current session — not historical commits from previous sessions.

---

## Container Logger

Runs independently. Maps container uptime and vitals.

```bash
tail -20 PROJECT_PHANTOM/logs/container_vitals.log
ps aux | grep container_logger | grep -v grep
```

Last pushed entry on GitHub = last confirmed alive before container death.

---

## Testing

```bash
python3 PROJECT_PHANTOM/test_phantom.py
# ~472 tests covering all phantom.py commands, heartbeat_runner, drift_guard, container_logger
```

---

## Troubleshooting

### `heartbeat_active` stuck as True, no process running
```bash
# Soft reset — clears stuck flags, preserves session data
python3 PROJECT_PHANTOM/agents/phantom.py recover

# Hard reset — only if recover isn't enough
python3 PROJECT_PHANTOM/agents/phantom.py reset
# Then re-start or re-arm as needed
```

### Drift guard fires SCOPE_CREEP immediately on session start
Cause: `session_start_ref` not in state (session started before it was added) → `find_since()` falls back to `HEAD~10` spanning previous sessions.
Fix: patch the state manually or restart with current phantom.py:
```bash
python3 -c "
import json, subprocess, os
f = '/tmp/phantom_session.json'
s = json.load(open(f))
s['session_start_ref'] = subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
import tempfile; tmp = f+'.tmp'
with open(tmp,'w') as fp: json.dump(s, fp)
os.rename(tmp, f)
print('patched')
"
```

### Session auto-completed at turn target
Old behavior (pre-fix). Update phantom.py — turns are now a budget, not a deadline. Session only ends with `phantom.py complete`.

### Heartbeat kept running after `phantom.py complete`
Old behavior (pre-fix). Runner now checks `status == "complete"` on each poll and exits cleanly.

### Heartbeat fires immediately (threshold too low)
Increase `--threshold` or check `--min-idle-polls`. With `--min-idle-polls 2`, requires two consecutive polls over threshold.

### Heartbeat agent reported a fire but state was not updated
Symptom: heartbeat agent returned with fire banner, but `heartbeat_fires: []` and `rounds_remaining` unchanged.
Cause: agent fabricated the fire output using HEARTBEAT.md docs as a template — runner was killed before firing.
Fix:
```bash
python3 PROJECT_PHANTOM/agents/phantom.py recover   # clear stuck heartbeat_active
python3 PROJECT_PHANTOM/agents/phantom.py heartbeat-arm  # re-arm and spawn new agent
```

### Container dies mid-session
```bash
python3 PROJECT_PHANTOM/agents/phantom.py restore   # recovers saved state
```

---

## Anti-Drift Rules

- Always ping at the start of every turn — no exceptions
- Always call `agent-start` before spawning a worker, `agent-done` when it returns
- Always call `heartbeat-arm` and check exit code before spawning heartbeat
- Keep idle threshold ≤ 180s until container timeout is fully mapped
- Update this CLAUDE.md as new environment facts are discovered
- The correct flow: work continuously → stop when genuinely done → heartbeat fires → resume → repeat
- **Never call `complete` because you hit the turn count — only when the work is truly done**
- Use `scope --session` to verify horizontal distribution after each commit batch
- **Never call `agent-start` for heartbeat or drift-guard** — they use their own arm/done commands
- `agents_running` must stay 0 while heartbeat and drift-guard run, or the heartbeat is blocked forever
- Run `anchor check` after every heartbeat resume — always re-orient before working
- Run `checkpoint` before calling `complete` — ensure all gates pass first
- `logs/` directory auto-saves on every ping-divisible turn (amends one commit, no new commits) — this is expected, not drift; the entire `logs/` dir is filtered from scope analysis
- **Always verify heartbeat fires are real** — after the HB agent returns, check `rounds_remaining` decreased and `last_heartbeat_fired` is set; if not, run `recover` and re-arm
- **Use direct-command spawn for heartbeat AND drift guard** — "Read X.md and execute" causes planning text (Patterns 8/9); direct command prompts for both are in the protocol above
- **Don't re-arm heartbeat immediately after commits** — git:index stays fresh for ~3min after push; arm after the next turn's work is committed, then go idle
