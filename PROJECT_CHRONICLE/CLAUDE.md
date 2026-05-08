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
  log <message>       ← record a decision/observation mid-session
  summarize           ← end-of-session: extract key learnings, update memory
  context             ← start-of-session: print current memory for injection into context
  history [--last N]  ← show recent decisions
  search <query>      ← find decisions by keyword

memory/
  MEMORY.md           ← living knowledge file (auto-updated by summarize)
  decisions/          ← one JSON file per decision record
    YYYY-MM-DD_HH-MM-SS_<slug>.json
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
  "rationale": "no dependencies, human-readable, git-diffable",
  "outcome": null,
  "tags": ["storage", "architecture"]
}
```

### MEMORY.md Structure

```markdown
# Project Memory — <project name>

Last updated: <timestamp> by session <id>

## What This Project Is
<auto-extracted from session summaries>

## Key Decisions
<auto-maintained list of important decisions with rationale>

## What We Know About Key Files
<auto-extracted file-level knowledge>

## What Has Been Tried / Failed
<anti-patterns and dead ends>

## Current State
<most recent session summary>
```

---

## Integration Points

- **With PHANTOM**: `chronicle.py log` called from ping notes; `chronicle.py summarize` called before `phantom.py complete`
- **Session startup**: `chronicle.py context` prints current MEMORY.md — paste into session start for instant context
- **Git-native**: decisions/ and sessions/ committed to git — survives container restart, readable on GitHub

---

## Files

| File | Purpose |
|---|---|
| `chronicle.py` | Main CLI |
| `memory/MEMORY.md` | Living knowledge file |
| `memory/decisions/` | Individual decision records (JSON) |
| `memory/sessions/` | Per-session summaries (Markdown) |
| `test_chronicle.py` | Integration tests |

---

## Commands

```bash
# Record a decision mid-session
python3 PROJECT_CHRONICLE/chronicle.py log "chose X over Y because Z" --type decision

# Record an observation
python3 PROJECT_CHRONICLE/chronicle.py log "file X is the entry point for all auth" --type observation

# Record something that failed / dead end
python3 PROJECT_CHRONICLE/chronicle.py log "tried approach X — failed because Y" --type failure

# End of session: extract learnings, update MEMORY.md
python3 PROJECT_CHRONICLE/chronicle.py summarize --session-id <id> --project <name>

# Start of session: get current context
python3 PROJECT_CHRONICLE/chronicle.py context

# Browse history
python3 PROJECT_CHRONICLE/chronicle.py history --last 10

# Search decisions
python3 PROJECT_CHRONICLE/chronicle.py search "authentication"
```

---

## Anti-Drift Rules

- `chronicle.py log` must be fast — < 100ms, no blocking I/O
- Decision records are append-only — never edit, only add
- MEMORY.md is the only file that gets rewritten — everything else is append-only
- `summarize` reads recent decisions + session state, rewrites MEMORY.md sections
- Never depend on PHANTOM being installed — CHRONICLE works standalone
- Tests must cover: log, summarize, context, history, search
