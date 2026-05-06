# Anti-Drift Observations

Captured during the 10-turn autonomous improvement session. Documents how drift
manifests and what tools would prevent it.

---

## How Drift Actually Appeared This Session

### 1. Artificial turn boundaries
**What happened:** I was stopping after each "turn" and waiting for the heartbeat,
treating turns like discrete work units to be completed and then paused.

**What should happen:** Work continuously until genuinely done. Heartbeat fires
when I actually stop — not when I decide a "turn" is over.

**Lesson:** The heartbeat is not a turn timer. It's an idle detector. Don't treat
it like a metronome.

### 2. Writing code without pinging
**What happened:** The heartbeat fired while I was mid-turn writing files,
because `last_active` only updates on explicit pings, not on file writes.

**Implication:** From the heartbeat's perspective, writing files looks like idle.
This is technically a false positive — I was active, just not pinging.

**Possible fix:** A "work_in_progress" flag that suppresses heartbeat while
I'm in a long coding session. Set it at turn start, clear it before going idle.

### 3. Vertical creep on phantom.py
**What happened:** phantom.py got the most attention (most new commands).
heartbeat_runner and container_logger got fewer additions.

**What prevented it from being worse:** The PLAN.md horizontal tracker with
explicit targets per turn. Without it, I would have gone much deeper on phantom.py.

**Lesson:** Written constraints help. A scope guard agent could enforce this
automatically — warning if any single file was touched more than N times while
others were skipped.

---

## Drift Patterns to Watch For

| Pattern | Symptom | Detection |
|---|---|---|
| Premature stopping | Heartbeat fires while still in middle of thought | Short gap (<threshold + 50%) |
| Vertical drilling | One file gets 5x more commits than others | Git diff stats per file |
| Scope creep | Working on things not in the original task | Periodic task restatement check |
| Context loss | Repeating work already done | Progress note history |
| False completion | Marking done before really done | Heartbeat still has rounds left |

---

## Anti-Drift Agents: Proposed → Built

### ✅ Scope Guard — `tools/scope_guard.py`
Built. Reads git diff stats, warns if any file exceeds a % threshold.
Session-anchored via `--session` (uses `session_start_ref` from phantom state).
Threshold configurable via `--scope-threshold` at `phantom.py start`.

```
phantom.py scope --session          # session-only view
phantom.py scope --threshold 30     # stricter threshold
```

### ✅ Coverage Tracker — `tools/coverage_tracker.py` + `phantom.py check`
Built in two forms:
1. `tools/coverage_tracker.py` — standalone per-file coverage checker
2. `phantom.py check` — unified scope + coverage in one command, session-anchored

Targets stored in session state via `--coverage-targets` at start.
`phantom.py status` and `phantom.py report` show live coverage count.

```
phantom.py check                    # scope + coverage vs session_start_ref
phantom.py status                   # shows "Coverage: N/M (X%)" inline
```

### ✅ Drift Guard — `agents/drift_guard.py`
Built as background sub-agent (not periodic — runs for the whole session).
Four-gate evaluation: scope match → task alignment → hunk spread → trend.
Writes verdict + warning to session state. `phantom.py drift-done` to review.

### ⬜ Goal Alignment Checker — not built
Would compare `state.task` to `progress_note` on each heartbeat fire.
Current proxy: `phantom.py report` shows task + last 5 progress notes side by side.

### ⬜ Progress Note Auditor — not built
Would score note specificity. Currently enforced by protocol only:
ping notes should list specific changes, not vague summaries.

---

## Lessons from v2.6–v2.8 Sessions

### 4. Coverage check silently broken by path prefix
**What happened:** `phantom.py check` showed 0/N coverage for months because
`git diff --name-only` (run from repo root) returns `PROJECT_PHANTOM/agents/phantom.py`
but coverage_targets store `agents/phantom.py`. Direct comparison always failed.

**Fix:** Added `_PROJECT_PREFIX = os.path.relpath(_PROJECT_DIR, REPO_DIR) + os.sep`
and strip it from git diff output before matching. Now works portably on any repo.

**Lesson:** Always verify tool output before trusting it. "0% coverage" is a red flag
that should have been investigated sooner rather than accepted as accurate.

### 5. Hardcoded strings silently survive portability passes
**What happened:** `container_logger.py` had `git add "PROJECT_PHANTOM/logs/..."` hardcoded
as a string literal — not a variable, so grep for `/home/user/` missed it.

**Fix:** `_LOG_REL = os.path.relpath(LOG_FILE, REPO_DIR)` computed at module load.

**Lesson:** Portability checks must grep for project folder name, not just absolute paths.

---

## What the Full System Looks Like Now

```
Main Claude session
├── Heartbeat agent       — idle detection, session keepalive (heartbeat_runner.py)
├── Drift Guard agent     — horizontal drift monitor (drift_guard.py)
├── Container Logger      — vitals daemon (container_logger.py)
├── tools/scope_guard.py  — portable git diff scope checker
└── tools/coverage_tracker.py  — target file coverage checker

phantom.py check    — unified scope + coverage in one command
phantom.py status   — live view: heartbeat ETA, coverage count, drift state
phantom.py report   — full session overview with all of the above
```

The heartbeat gives continuity. The drift guard gives horizontal discipline.
The coverage check gives target accountability. Together they approximate
having a human looking over your shoulder — but made of agents.
