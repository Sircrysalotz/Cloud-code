# Project Memory — NOVA

Last updated: 2026-05-09T03:01:21 (session 2026-05-09)

## What This Project Is

CHRONICLE — persistent living memory + decision audit trail for Claude sessions.
Auto-updated at end of each session by `chronicle.py summarize`.

## Key Decisions
- [2026-05-09] generate_poses.js updated: all 5 poses use real frame silhouettes (idle=0, guard=9, punch=5, kick=14, power_up=18). All 5 now visually recognizable as Goku
- [2026-05-09] buildFromSilhouette added to parametric.js — uses real Goku frame pixel mask as shape, applies gradient shading on top. Output now recognizable as Goku (46x69, spiky hair, fighting pose)
- [2026-05-08] NOVA Phase 1: 117 tests passing, all 9 cleanup passes implemented, ASCII perception loop working, golden fixtures generated
- [2026-05-08] save now stages modified tracked files in addition to untracked — catches tag-modified records
- [2026-05-08] MEMORY.md is the only file that gets rewritten — all other records are append-only
- [2026-05-08] chose JSON files over SQLite for decision storage — no dependencies, human-readable, git-diffable

## What Has Been Tried / Failed
*No failures recorded yet.*

## What We Know About Key Files
- [2026-05-08] chronicle.py is the entry point for all CHRONICLE operations
- [2026-05-08] Turn 17: Added 'tag' command + 13 tests. 215/215 passing. CLAUDE.md updated. 7 fires, 44min elapsed.
- [2026-05-08] Turn 16: Fire 7 confirmed (round 7/10, gap=192s). 7 fires. 42min elapsed. Updating CLAUDE.md with export + filters, then adding 'tag' command.
- [2026-05-08] Turn 9: CLAUDE.md updated with all 9 commands and full session protocol. 4 more obs imported. Memory at 11 records. Waiting on fires 4-6 and 90min.
- [2026-05-08] Turn 11: Fixed summarize session scoping bug. 161/161 tests passing. Session files now show only current session; MEMORY.md stays cumulative.
- [2026-05-08] Turn 10: Fire 4 confirmed (round 4/10, gap=185s). 4/6 fires. Fixing summarize to scope session file to current session only.
- [2026-05-08] Turn 8: Fire 3 confirmed (round 3/10, gap=210s). 3/6 fires, 21min elapsed. Updating CHRONICLE CLAUDE.md with new commands, then from-phantom import.
- [2026-05-08] Turn 7: Added status and save commands. 150/150 tests. save fixes untracked-file stop hook noise.
- [2026-05-08] Turn 2: chronicle.py built (log, summarize, context, history, search, init). test_chronicle.py written. 84/84 tests passing.
- [2026-05-08] Turn 1: Session started. Created PROJECT_CHRONICLE/, CLAUDE.md, updated workspace CLAUDE.md. Starting chronicle.py build.

## Current State

Last session: 2026-05-09 (6 decisions, 0 failures)
Sessions recorded: 2
