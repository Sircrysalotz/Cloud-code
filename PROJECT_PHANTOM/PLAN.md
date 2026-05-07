# PHANTOM Improvement Plan

The system improves itself through dogfood sessions — running PHANTOM to build PHANTOM.
Each session observes friction in real use and fixes it before completing.

**Current version:** v3.6 (591 tests, in progress)
**Active branch:** `phantom/v3.6-readme-docs` → merges to `claude/document-environment-status-vQRKB`

---

## Dogfood Session Log

| Session | Branch | Fixes | Tests |
|---|---|---|---|
| v3.0 | `phantom/v3-self-improvement` | Profile system, four-gate drift, `check`, `recover`, `report` | ~400 |
| v3.1 | `phantom/v3.1-dogfood` | Anchors, checkpoints, `_eval_criteria`, fire banner, `status --brief` | 481 |
| v3.2 | `phantom/v3.2-dogfood` | HEARTBEAT.md v6 (fabrication), `scope-update`, DRIFT_GUARD.md v4, display fixes | 528 |
| v3.3 | `phantom/v3.3-dogfood` | MD file rewrites, early-return fix, status criteria view, scope-update warning | 557 |
| v3.4 | `phantom/v3.4-marathon` | check caching, status --verbose, HEARTBEAT.md v8, file-updated criterion auto-eval | 576 |
| v3.5 | `phantom/v3.5-shared-criteria` | criteria.py shared module, drift_guard v5 --max-checks, direct-command drift guard, auto-save local-only | 583 |
| v3.6 | `phantom/v3.6-readme-docs` | README.md, human-first commit format, criteria keyword fix, elapsed-time criterion, timing-sensitive test fix, keyword coverage tests, drift warning test | 591 |

---

## Known Friction / Planned Improvements

Priority order based on severity and impact:

### High — correctness issues
| Issue | Proposed fix |
|---|---|
| `drift-done` SCOPE_CREEP message says "spreading changes" — doesn't mention `scope-update` | ✓ Done v3.3: `drift-done` shows Option A/B with explicit `scope-update` hint |
| After `scope-update`, drift guard still uses old scope (must re-arm manually) | ✓ Done v3.3: `scope-update` now warns when drift guard armed (re-arm required) |
| Heartbeat agent returns early before runner fires | ✓ Done v3.3: `HEARTBEAT.md` v7 + runner first-poll-no-sleep fix |
| DRIFT_GUARD.md lacks exact output format docs | ✓ Done v3.3: DRIFT_GUARD.md v5 has status-line format + gate-cleared reason format |
| Warning-only HEARTBEAT.md v7 still caused early returns in v3.4 marathon | ✓ Done v3.4: HEARTBEAT.md v8 puts execution steps first, before any prose |

### Medium — usability friction
| Issue | Proposed fix |
|---|---|
| `phantom.py start` done-criteria not shown in `status` output | ✓ Done v3.4: `status --verbose` shows full criterion text with `[x]/[ ]` per item |
| `anchor show` full output is long; `anchor check` is better for resumption | ✓ Done v3.3: CLAUDE.md note added — use `anchor check` after resume |
| Container logger not auto-started on new session — easy to forget | ✓ Done v3.3: `env` now shows `[OK]` or `[WARN]` for container_logger with start command |
| `check` command re-runs git diff on every call — slow if called often | ✓ Done v3.4: cached in session state (30s TTL); `--no-cache` to force refresh |

### Low — polish / docs
| Issue | Proposed fix |
|---|---|
| `history` command shows all turns verbatim — gets long | ✓ Done v3.3: `history --last N` shows only last N ping entries with "N omitted" notice |
| `status` fire log shows "last 1" in parentheses — awkward phrasing | ✓ Done v3.3: shows "N total, showing last M" |
| DIFF.md / PLAN.md / ANTI_DRIFT.md were stale since v1→v2 *(fixed in v3.3)* | ✓ done |
| `_eval_criteria` can't auto-mark file-based criteria like "CLAUDE.md updated" | ✓ Done v3.4: new "file updated" heuristic — `git diff --name-only` since session start |
| `eval_criteria_quick` and `_eval_criteria` are separate implementations that diverge | ✓ Done v3.5: `criteria.py` shared module — imported by both, one implementation forever |
| Drift guard agent returns formatted summary every round (Pattern 9) | ✓ Done v3.5: direct-command spawn prompt in CLAUDE.md step 4 |
| `drift_guard.py` runs until session complete — blocks direct-command agent for hours | ✓ Done v3.5: `--max-checks N` flag — exit cleanly after N checks, re-arm after |
| `auto_save()` creates new git commit every N pings → history spam ("auto-save turn X" every 5 turns) | ✓ Done v3.5: `auto_save()` writes `last_session_state.json` locally only; no git commits |
| `last_session_state.json` and `container_vitals.log` tracked by git → stop hook fires every ping | ✓ Done v3.5: both untracked via `git rm --cached`; `.gitignore` updated |
| `DRIFT_GUARD.md` v5 uses warning-based "Do NOT generate text" approach — proved insufficient (Pattern 8 equivalent) | ✓ Done v3.5: `DRIFT_GUARD.md` v6 — execution-first format (STEP 1/2/3/4 at top) matching HEARTBEAT.md v8 |
| Context compaction leaves arm flags stuck with no running process — pattern undocumented | ✓ Done v3.5: ANTI_DRIFT.md Pattern 10 + CLAUDE.md troubleshooting entry + improvement history |
| No README — humans landing in the folder have no entry point | ✓ Done v3.6: `README.md` — plain English overview, quick start, commands, troubleshooting |
| Commit messages all technical — humans can't understand git log at a glance | ✓ Done v3.6: commit format section in `CLAUDE.md` — line 1 plain English, body technical |
| File criteria only matched "updated/changed/done/committed" — "README.md created" always `[ ]` | ✓ Done v3.6: `criteria.py` expanded keyword list: "created", "documented", "added", "written" |
| No way to auto-verify elapsed-time criteria like "session elapsed 90+ minutes" | ✓ Done v3.6: `criteria.py` elapsed-time heuristic — checks `(now - started) >= N minutes` |
| `test_phantom.py` "effective gap < 300s" test fails after any lull — wrong semantics (should verify function uses fs mtime, not that it's fresh) | ✓ Done v3.6: assertion changed to `ts > 1577836800` — correct invariant, not environment-sensitive |
| `criteria.py` keywords "written" and "changed" added in v3.6 but had no tests — could silently break | ✓ Done v3.6: two new test checks; all 6 trigger words (updated, created, documented, added, written, changed) now have dedicated coverage |
| CLAUDE.md direct-command spawn prompts opened with preamble ("You are... Do NOT write text") — Pattern 8 trigger observed v3.6 marathon | ✓ Done v3.6: both spawn prompts restructured to calls-first format — Bash calls at top, explanation after |

---

## How to Run a Dogfood Session

```bash
# 1. Create the next branch
git checkout claude/document-environment-status-vQRKB
git checkout -b phantom/v3.N-dogfood
git push -u origin phantom/v3.N-dogfood

# 2. Start the session
python3 PROJECT_PHANTOM/agents/phantom.py start "dogfood vN — ..." \
  --turns 20 --rounds 8 --threshold 180 --interval 30 \
  --scope agents/phantom.py agents/heartbeat_runner.py test_phantom.py \
          agents/HEARTBEAT.md agents/DRIFT_GUARD.md CLAUDE.md \
  --coverage-targets agents/phantom.py agents/heartbeat_runner.py agents/drift_guard.py \
  --done-criteria "N+ tests passing" "coverage 3/3" "CLAUDE.md updated" \
                  "observed 6+ heartbeat fires" \
                  "session elapsed 90+ minutes" \
                  "anchor check used at least once" "checkpoint before completion"

# 3. Arm agents, work, iterate
# 4. checkpoint → complete → merge
git checkout claude/document-environment-status-vQRKB
git merge phantom/v3.N-dogfood
git push origin claude/document-environment-status-vQRKB

# 5. Prep next branch
git checkout -b phantom/v3.(N+1)-dogfood
git push -u origin phantom/v3.(N+1)-dogfood
git checkout claude/document-environment-status-vQRKB
```

---

## Architecture Invariants

These must remain true across all versions:

1. **State is authoritative** — agent text output is advisory; state file is truth
2. **Heartbeat only fires when genuinely idle** — all guards must pass simultaneously
3. **Drift guard is advisory** — blocking on drift verdict is never correct
4. **`complete` is the only session ender** — turn count is a budget, not deadline
5. **Tests must pass before every commit** — no broken-window commits
6. **All scope paths filter `_is_auto_generated()`** — logs dir never inflates scope %
7. **`criteria.py` is the single eval implementation** — never duplicate criterion logic in phantom.py or heartbeat_runner.py; all heuristics live in `eval_criteria()` only
8. **Commit messages are human-first** — line 1 is plain English anyone can read; technical details go in the body
