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

---

## v2.2 Additions (heartbeat observability + consecutive idle + session anchoring)

### Bug: drift_guard `find_since()` spanned multiple sessions

On session start, `drift_guard` used `find_since()` which looked back `HEAD~10` — spanning
previous sessions' commits. Result: a legitimate new session could immediately fire SCOPE_CREEP
because the previous session's dominant file was still in the history window.

**Fix:** `phantom.py start` now captures `git rev-parse HEAD` as `session_start_ref` in state.
`drift_guard.py` uses `session_start_ref` as the `--since` ref when available, falling back to
`find_since()` only if not set. This ensures drift guard only checks changes from the current session.

### heartbeat_runner.py: consecutive_idle guard

New `min_idle_polls` field (default 1, stored in state, settable via `--min-idle-polls N`):

| Value | Behavior |
|---|---|
| 1 (default) | Fire on first poll above threshold — same as before |
| 2 | Require 2 consecutive polls above threshold — prevents single-poll false positives |
| 3+ | More conservative — useful in high-noise environments |

HOLD line shows progress: `HOLD — idle 185s (1/2 polls) [ping]`

### heartbeat_runner.py: activity observability

Runner now writes to state when activity signal changes (new file modified, new ping):
- `last_activity_source` — which signal is currently holding the heartbeat
- `last_activity_ts` — when that activity occurred (human-readable)
- `next_heartbeat_at` — estimated fire time = last_activity_ts + threshold

Fire output now includes: `Polls: N consecutive above threshold`

### phantom.py: status panel ETA

`phantom.py status` now shows:
```
Heartbeat:  ARMED — fires in ~47s  (held: file:agents/phantom.py)
```

Instead of just: `Heartbeat:  ARMED`

When heartbeat is overdue: `ARMED — overdue by 12s`

### phantom.py: profile support for min_idle_polls

`min_idle_polls` added to PROFILE_KEYS — can be saved per-profile and loaded with `--profile`.

### HEARTBEAT.md: signal source documentation

Added signal reference table and ETA display documentation.

### heartbeat_runner.py: fire history

Runner appends a fire event to `heartbeat_fires` list in state on each fire:
```json
{"fired_at": "...", "signal": "ping", "gap_seconds": 192, "idle_polls": 1, "turns": 3}
```
Kept to last 10 events. Visible in `phantom.py status` (last 3) and `phantom.py history` (all).

### phantom.py scope improvements

- `--session` flag: uses `session_start_ref` as base ref (only this session's changes)
- `--threshold` flag: configurable concentration warning level (default 50%)
- Previously hardcoded `50` and `HEAD~5`

### phantom.py history improvements

Now shows fire event history with timestamp, signal, gap, idle_polls, and turn number.
Also shows declared scope files if set.

Test coverage: 152 → 168 tests (168/168 passing)

---

## v2.3 Additions (massive horizontal improvement session — 8+ hours)

### phantom.py: report command

New `phantom.py report` command — full session overview on demand:
- Task, status, started, elapsed, profile
- Turns taken/target with "budget floor" reminder
- Rounds used/remaining
- Heartbeat state (armed/idle, ETA, held-by signal)
- Fire history (all events)
- Scope snapshot (this session's git diff, percentage per file)
- Watchdog stall history
- Scan config (tracked extensions, scan depth)

### phantom.py: recover command

New `phantom.py recover` command — soft reset that clears stuck flags without losing session data:
- Clears `heartbeat_active` → False
- Clears `agents_running` → 0 and empties `active_agent_ids`
- Clears `drift_guard_active` → False
- Preserves task, turns, rounds, history, and all other session data
- No-op when no flags are stuck (reports clean state)
- Use before `reset` when session data should be kept

### heartbeat_runner.py v5: configurable scan settings + watchdog state

New state fields `tracked_extensions` and `scan_depth` (set via `phantom.py start`):
- `--tracked-exts .py .ts` — only track these file extensions for activity signals
- `--scan-depth 3` — limit os.walk depth (default 5) for large repos

Watchdog events now written to state (`watchdog_events[]`, last 10):
- Includes `at`, `cycle_secs`, `limit_secs`, `turns` per event
- Visible in `phantom.py status` (last event) and `phantom.py report` (full list)

`scan_workspace()` and `get_last_activity()` accept `tracked_exts` and `scan_depth` params.
`DEFAULT_TRACKED_EXTS` replaces the hardcoded `TRACKED_EXTS` set.

### drift_guard.py v3: richer output + verdict-specific ACTION messages

Per-check line format improved:
```
[HH:MM:SS] Check #N | <total>L | top: file.py (<pct>%) hunks=<N> [scope <in>/<total>L] | CLEAN: reason
```

Verdict-specific ACTION messages replace generic "spread changes and re-arm":
| Verdict | ACTION guidance |
|---|---|
| `SCOPE_CREEP` | Option A: move edits to scope files. Option B: update `--scope` |
| `VERTICAL` | One file dominates — spread changes across more files |
| `TRENDING` | Proactive: distribute future changes, then re-arm |

Warning top-file list shows `[in-scope]` markers for declared scope files.
DRIFT_GUARD.md v3: documents new output format, verdict table, recover command for crashes.

### container_logger.py v3: memory and disk threshold alerts

New CLI flags `--mem-alert N` (default 80%) and `--disk-alert N` (default 90%):
- Logs `ALERT` prefix instead of `ALIVE` when any threshold exceeded
- Prints `⚠ ALERT:` line to stdout with metric details
- Alert deduplication with hysteresis: resets at 90% of threshold
- `read_mem()` and `read_disk()` now return `(str, float)` tuples for programmatic use

### tools/scope_guard.py: --session flag

New `--session` flag reads `session_start_ref` from phantom session state:
- `python3 scope_guard.py --session` — uses current session's start as diff base
- `--state-file PATH` — override PHANTOM_STATE for custom state file path
- Falls back to auto-detect if state missing or ref not found
- `--json` output includes `"session": bool` field
- New `read_session_start_ref()` function for programmatic access

### Built-in profile presets

4 presets always available, no setup required:
| Profile | turns | threshold | Description |
|---|---|---|---|
| `sprint` | 10 | 120s | Fast iteration — quick heartbeat cycles |
| `marathon` | 30 | 180s | Long autonomous run — many rounds |
| `debug` | 5 | 60s | Short cycles for testing |
| `focus` | 20 | 240s | Deep single-task, strict drift guard |

User-created profiles override built-ins by name.
`config list` shows built-in and user sections separately, with "(overridden by user)" note.
`config show <name>` shows `[built-in]` label for presets.

### Test coverage

| Version | Tests |
|---|---|
| v2.0 | 46 |
| v2.1 | 152 |
| v2.2 | 168 |
| v2.3 | 284 |

New tests added: report command (7), recover command (11), tracked_extensions/scan_depth (7),
watchdog events (3), scope_match/verdict triggers (7), SCOPE_CREEP/VERTICAL/TRENDING (3),
container_logger v3 (10), scope_guard --session (14), built-in profiles (29).

---

## v2.4 — Phase ∞: cmd_check + coverage_tracker --session + ping_log + HEARTBEAT.md v3

### phantom.py — `check` command

New unified command that prints scope + coverage in one shot, anchored to `session_start_ref`:

```
phantom.py check [--threshold N] [--targets file1 file2 ...]
```

- Scope section: git diff stat parsed into per-file percentages; warns `⚠ DRIFT RISK` when any file exceeds threshold
- Coverage section: uses `--targets` if given, else falls back to `scope_files` from state
- Shows `✓ FULL COVERAGE` or `⚠ INCOMPLETE: N target(s) not yet touched`
- Session-anchored: uses `session_start_ref` so it never bleeds into previous sessions
- No session → exits 1 with clear message

### scope_guard.py — `--session` flag

- `--session` reads `session_start_ref` from phantom session state
- `--state-file` overrides default state path (for test isolation)
- `--json` output includes `"session": bool` field
- Fallback: if state missing, prints WARNING and falls back to auto-detect

### coverage_tracker.py — `--session` flag

- Same `--session` + `--state-file` pattern as scope_guard
- `read_session_start_ref()` function reads from `PHANTOM_STATE` or given path
- `--json` output includes `"session": bool` field
- Fallback: WARNING + auto-detect when state missing

### phantom.py — `ping_log` entries

- `ping` appends `{turn, note, at}` to `ping_log[]` (capped at 20)
- `history` command shows full ping log with turn/timestamp/note
- `report` command shows last 5 pings

### HEARTBEAT.md v3

- Documents v5 runner startup banner (scan_depth, tracked_exts lines)
- HOLD signal table: `[ping]`, `[file:path]`, `[git:index]`
- Watchdog format + state write behavior
- `recover` command for stuck flags
- Test isolation via `PHANTOM_STATE` env var

### Test coverage

| Version | Tests |
|---|---|
| v2.0 | 46 |
| v2.1 | 152 |
| v2.2 | 168 |
| v2.3 | 284 |
| v2.4 | 329 |

New tests (45): `check` command (11), coverage_tracker --session (14),
scope_guard --session (14, moved from v2.3), ping_log round-trip (6).

---

## v2.5 — Protocol fixes + coverage_targets + scope_threshold propagation

### Critical bug fix: `agent-start` for drift-guard blocked heartbeat forever

**Root cause:** CLAUDE.md protocol called `agent-start --id "drift-guard"` before spawning the drift guard sub-agent. This incremented `agents_running` to 1, permanently blocking the heartbeat runner (which holds while `agents_running > 0`). All prior sessions had `rounds_used: 0` as a result.

**Fix:** Removed `agent-start`/`agent-done` calls for drift-guard and heartbeat from CLAUDE.md.
Both are monitors, not workers — they use `drift-arm`/`drift-done` and `heartbeat-arm` only.
Added explicit IMPORTANT warnings in the protocol and anti-drift rules.

### phantom.py — `--coverage-targets` on start

`--coverage-targets` was declared in the profile schema but never registered in `start`'s argparse subparser. Flag silently ignored. Fixed — now stored in state and automatically loaded by `check`.

### phantom.py — `--scope-threshold` on start

`--scope-threshold` on `start` now stores in state, read by:
- `drift_guard.py` — when CLI `--scope-threshold` is at default (30%), loads from state
- `phantom.py scope` — when CLI `--threshold` is at default (50%), loads from state
- `phantom.py check` — uses state scope_threshold
- `scope_guard.py --session` — when CLI `--threshold` is at default (40%), loads from state

### Profile list fields resolved from profile

`scope_files`, `coverage_targets`, `tracked_extensions`, `scan_depth` now fall through to profile defaults when not explicitly given on CLI. Previously only scalar fields (turns, rounds, threshold) loaded from profiles.

### phantom.py — status/complete/report coverage display

All three commands now show a Coverage summary line when `coverage_targets` or `scope_files` is set in state.

### phantom.py — `check` command

`check` now also supports `--json` flag:
```json
{
  "task": "...", "since": "...", "threshold": 40,
  "scope": {"files": [...], "max_pct": 33.1, "clean": true},
  "coverage": {"targets": [...], "touched": [...], "untouched": [...], "pct": 66.7, "full": false}
}
```

### scope_guard.py — `--session` reads `scope_threshold`

Previously `--session` only read `session_start_ref` from state. Now also reads `scope_threshold` and uses it when the CLI `--threshold` is at default (40%). This ensures `scope_guard --session` respects the threshold configured at session start without requiring a separate flag.

### drift_guard.py — reads `scope_threshold` from state

When `--scope-threshold` CLI is at default (30%), drift_guard now reads `scope_threshold` from session state. Ensures drift guard respects `--scope-threshold` set at `phantom.py start`.

### Test count stability

Fixed conditional `check()` blocks (`if out.strip(): check(...)`) that caused test count to vary between 340 and 346 depending on run order. All checks are now unconditional.

### Test coverage

| Version | Tests |
|---|---|
| v2.0 | 46 |
| v2.1 | 152 |
| v2.2 | 168 |
| v2.3 | 284 |
| v2.4 | 329 |
| v2.5 | 352 |

New tests (23): `check` --json (14), coverage_targets profile loading (2), status/complete/report coverage display (3), scope --session scope_threshold (1), scope_guard --session scope_threshold (3).
