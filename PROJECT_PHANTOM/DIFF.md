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
| Test coverage | 0 tests | 352 passing integration tests |

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
| `test_phantom.py` | Integration test suite (352 tests) covering all phantom.py commands, heartbeat_runner, drift_guard, container_logger |
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
This separation is enforced in `test_phantom.py` via `TEST_ENV`.

---

## Summary

v2 is a significant improvement across all dimensions:
- More robust (locks, guards, retries, SIGTERM handlers)
- More observable (rich status, drift reporting, per-poll logs, session summary)
- More testable (env var isolation, 352 tests)
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

---

## v2.6 — Portability: no hardcoded machine paths + env command

### Problem: all scripts contained hardcoded `/home/user/Cloud-code` paths

Every `.py` file, `.md` file, and test used absolute paths tied to one machine.
Cloning to a different path broke everything silently.

### Fix: self-locating paths everywhere

**phantom.py + container_logger.py** — `_find_repo_dir()` pattern:
```python
_AGENTS_DIR  = os.path.dirname(os.path.abspath(__file__))
_PROJECT_DIR = os.path.dirname(_AGENTS_DIR)

def _find_repo_dir() -> str:
    try:
        r = subprocess.run(["git", "rev-parse", "--show-toplevel"],
            cwd=_AGENTS_DIR, capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return os.path.dirname(_PROJECT_DIR)

REPO_DIR = _find_repo_dir()
```
`git rev-parse` finds the actual repo root on any machine; pure-filesystem fallback handles
the no-git edge case. `_SAVED_REL` uses `os.path.relpath(SAVED_STATE_FILE, REPO_DIR)` so
`git add` works regardless of where the repo is checked out.

**HEARTBEAT.md + DRIFT_GUARD.md** — `$AGENTS_DIR` path-resolution preamble:
```
Determine AGENTS_DIR from the path you were given for this file.
For example: if told to read `/some/path/PROJECT_PHANTOM/agents/HEARTBEAT.md`,
then `AGENTS_DIR = /some/path/PROJECT_PHANTOM/agents`.
```
All `python3 /home/user/Cloud-code/...` commands replaced with `python3 $AGENTS_DIR/...`.
Sub-agents derive the correct path from wherever they were spawned — works on any machine.

**test_phantom.py** — `GIT_ROOT` computed from `__file__`:
```python
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
GIT_ROOT    = os.path.dirname(PROJECT_DIR)
```
All 12 hardcoded `"/home/user/Cloud-code"` literals replaced with `GIT_ROOT`.

**CLAUDE.md** — spawn prompts use `<path-to-agents-dir>` placeholder; container logger
command uses repo-relative path; test count corrected to 352.

### New: `phantom.py env` command

Environment inspector for verifying portability on a new machine:
```
python3 PROJECT_PHANTOM/agents/phantom.py env
```

Output:
```
=== PHANTOM Environment ===
Paths:
  agents_dir:  /path/to/PROJECT_PHANTOM/agents
  project_dir: /path/to/PROJECT_PHANTOM
  repo_dir:    /path/to/repo
  state_file:  /tmp/phantom_session.json
  profiles:    /root/.phantom_profiles.json
  logs_dir:    /path/to/PROJECT_PHANTOM/logs
Tools:
  [OK]   python3 3.11.15
  [OK]   git version 2.43.0
Directories:
  [OK]   logs_dir exists
  [OK]   agents_dir exists
Session:
  [OK]   active — task: ...
  [OK]   turns 2/25 | rounds 8 remaining
===========================
```
Shows `[WARN]` for missing directories or absent git. No active session → warns instead of failing.

### New: `tools/setup.sh`

Drop-in environment checker for fresh machines:
```bash
bash PROJECT_PHANTOM/tools/setup.sh          # checks + creates logs dir
bash PROJECT_PHANTOM/tools/setup.sh --check  # verify only (no side effects)
```
Checks: python3 present, git present + valid repo, logs dir exists.
Exits 1 if any check fails; prints quick-start command on success.

### New: `PROJECT_PHANTOM/.gitignore`

Excludes `logs/container_vitals.log` from accidental `git add -A` adds on fresh machines.

### Test coverage

| Version | Tests |
|---|---|
| v2.0 | 46 |
| v2.1 | 152 |
| v2.2 | 168 |
| v2.3 | 284 |
| v2.4 | 329 |
| v2.5 | 352 |
| v2.6 | 368 |

New tests (16): `env` command (10), `test_env()` function covering no-session warning,
paths section, tools section, active-session display (6 additional).

---

## v2.7 — Observability polish + bug fixes

### `status` and `report` show drift guard state

Both `phantom.py status` and `phantom.py report` previously showed heartbeat state but
silently skipped drift guard state. Now both show:

```
Drift Guard: ARMED            ← when drift_guard_active = true
Drift Guard: idle             ← when idle, no pending warning
Drift Guard: idle  ⚠ WARNING PENDING — run 'drift-done' to review
                              ← when drift_warning is set but guard is idle
```

`status` also prints the full warning text inline (after the scope/coverage lines).
`report` prints it before the watchdog section.
`complete` (session summary) also shows a truncated warning notice if one is pending.

### Bug fix: `--auto-save-every` flag silently ignored since session start

**Root cause:** `--auto-save-every` was registered in the `config create` subparser but never
added to the `start` subparser. Any `--auto-save-every N` passed at session start was silently
dropped by argparse. Additionally, the `resolve()` call used `5` as `cli_default` instead of
`None`, so `auto_save_every` was stored as `None` in state when the flag was not given.

This caused a `TypeError: unsupported operand type(s) for %: 'int' and 'NoneType'` in
`auto_save()` on every ping, silently breaking all ping commands with exit code 1.

**Fixes:**
- Added `--auto-save-every` to the `start` subparser
- Fixed `resolve()` call to use `None` as `cli_default` (consistent with other optional flags)

### `cmd_start` initializes all runtime fields

Previously, runtime fields were absent from the initial state dict and populated lazily by
the code that used them. Now `cmd_start` initializes them all explicitly:

```
drift_guard_active, drift_warning, drift_warned_at, heartbeat_fires, watchdog_events,
ping_log, last_activity_source, last_activity_ts, next_heartbeat_at,
completed, saved_at, auto_save_every
```

This makes the state self-describing from the first `phantom.py start`, and prevents any
field from being `None` when other code expects a list or bool.

### Module docstring updated

`phantom.py` docstring updated from stale 7-command list to full 20-command reference
with section headers (lifecycle, heartbeat/drift, worker agents, profile management).

### Test coverage

| Version | Tests |
|---|---|
| v2.0 | 46 |
| v2.1 | 152 |
| v2.2 | 168 |
| v2.3 | 284 |
| v2.4 | 329 |
| v2.5 | 352 |
| v2.6 | 368 |
| v2.7 | 377 |

New tests (9): drift guard in `status` (4), drift guard in `report` (4),
`--auto-save-every` stored at start (1), `auto_save_every` default=5 (1),
runtime fields initialized at start (5).
