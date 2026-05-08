# PROJECT: CHRONICLE

> Status: Active
> Purpose: Give Claude persistent, living memory across sessions. Auto-build a knowledge layer and decision audit trail as work happens — no manual maintenance.

---

## The Problem This Solves

Every Claude session starts from zero. You re-explain the codebase, re-establish context, re-discover what was tried before. CLAUDE.md helps but it's static — you have to update it manually. There's no record of *why* decisions were made, what failed, or what matters most in a project.

CHRONICLE fixes this automatically:
- **Living memory** — a self-updating knowledge file per project, written as Claude works
- **Decision audit trail** — structured records of what was decided, why, and what the outcome was
- **Session summaries** — at session end, key learnings are extracted and persisted for the next session

---

## Architecture

```
chronicle.py          ← main CLI
memory/
  MEMORY.md           ← living knowledge file (auto-updated by summarize)
  decisions/          ← one JSON file per decision record
    YYYY-MM-DD_HH-MM-SS_XXXXXX_<slug>.json
  sessions/           ← one summary file per session
    YYYY-MM-DD_<session-id>.md
```

### Decision Record Format

```json
{
  "id": "2026-05-08T21:00:00_chose-json-over-sqlite",
  "timestamp": "2026-05-08T21:00:00",
  "session": "session-id",
  "type": "decision",
  "message": "chose JSON files over SQLite for decision storage",
  "tags": ["storage", "architecture"]
}
```

### MEMORY.md Structure

```markdown
# Project Memory — <project name>

Last updated: <timestamp> by session <id>

## What This Project Is
<auto-extracted>

## Key Decisions
<cumulative, deduplicated>

## What Has Been Tried / Failed
<failures across all sessions>

## What We Know About Key Files
<observations mentioning filenames>

## Current State
<most recent session info>
```

---

## Commands

```bash
# Initialize memory/ structure for this project
python3 chronicle.py init [--project NAME] [--force]

# Record a decision, observation, or failure mid-session
python3 chronicle.py log "message" [--type decision|observation|failure] [--session ID] [--tags TAG ...]

# Show recent records
python3 chronicle.py history [--last N]

# Search records by keyword (matches message, type, tags)
python3 chronicle.py search "query"

# Print MEMORY.md — paste at session start for instant context
python3 chronicle.py context

# End-of-session: extract learnings, update MEMORY.md, write session summary
python3 chronicle.py summarize [--session-id ID] [--project NAME]

# Quick overview: record counts, last session, MEMORY.md freshness
python3 chronicle.py status

# Stage all memory/ files with git (run before ending session to prevent untracked file noise)
python3 chronicle.py save

# Import ping notes from a PHANTOM session state file as observations
python3 chronicle.py from-phantom [--state /path/to/phantom_session.json]
```

---

## Session Protocol (use with PHANTOM)

### Start of session
```bash
# 1. Get current context
python3 PROJECT_CHRONICLE/chronicle.py context
# Paste output at top of session — instant orientation

# 2. Log initial decision/plan
python3 PROJECT_CHRONICLE/chronicle.py log "starting: <what we're doing today>" --type decision
```

### During session
```bash
# Record key decisions as they happen (fast — < 100ms)
python3 PROJECT_CHRONICLE/chronicle.py log "chose X over Y because Z" --type decision
python3 PROJECT_CHRONICLE/chronicle.py log "file X is the auth entry point" --type observation
python3 PROJECT_CHRONICLE/chronicle.py log "tried async approach — deadlocked on Y" --type failure

# Check what's been recorded
python3 PROJECT_CHRONICLE/chronicle.py status
```

### End of session
```bash
# 1. Import ping notes from PHANTOM (if using PHANTOM)
python3 PROJECT_CHRONICLE/chronicle.py from-phantom
# Auto-detects /tmp/phantom_session.json

# 2. Update MEMORY.md with session learnings
python3 PROJECT_CHRONICLE/chronicle.py summarize --project <name>

# 3. Stage all memory files (prevents untracked file noise)
python3 PROJECT_CHRONICLE/chronicle.py save

# 4. Commit
git add PROJECT_CHRONICLE/memory/
git commit -m "Chronicle: session summary and decisions"
```

---

## Integration with PHANTOM

CHRONICLE and PHANTOM pair naturally:
- PHANTOM tracks **what Claude is doing** (session state, pings, fires)
- CHRONICLE tracks **what Claude learned** (decisions, failures, knowledge)

```bash
# After each PHANTOM session, import its ping log:
python3 PROJECT_CHRONICLE/chronicle.py from-phantom --state /tmp/phantom_session.json

# PHANTOM_SESSION env var is used as session ID when set:
export PHANTOM_SESSION="2026-05-08-build-session"
python3 PROJECT_CHRONICLE/chronicle.py log "key insight" --type observation
```

`from-phantom` is idempotent — safe to run multiple times, duplicates are skipped.

---

## Files

| File | Purpose |
|---|---|
| `chronicle.py` | Main CLI (init, log, history, search, context, summarize, status, save, from-phantom) |
| `memory/MEMORY.md` | Living knowledge file — rewritten by `summarize` |
| `memory/decisions/` | Individual records (JSON, append-only) |
| `memory/sessions/` | Per-session summaries (Markdown) |
| `test_chronicle.py` | Integration tests (150 tests) |

---

## Design Invariants

1. `log` must be fast — < 100ms, no blocking I/O
2. Decision records are append-only — never edit, only add
3. MEMORY.md is the only file that gets rewritten
4. `summarize` reads all records and rewrites MEMORY.md sections
5. CHRONICLE works standalone — no dependency on PHANTOM being installed
6. `from-phantom` is idempotent — safe to re-run, duplicates skipped
7. `save` only stages genuinely untracked files — no false positives on re-run

---

## Anti-Drift Rules

- Run `chronicle.py save` before ending any session (prevents stop-hook noise)
- Run `chronicle.py from-phantom` + `summarize` at session end to persist learnings
- Run `chronicle.py context` at session start to restore orientation
- Commit `memory/` regularly — it's meant to be git-persisted
