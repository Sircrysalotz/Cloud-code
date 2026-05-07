# PHANTOM Improvement Plan

The system improves itself through dogfood sessions — running PHANTOM to build PHANTOM.
Each session observes friction in real use and fixes it before completing.

**Current version:** v3.2 (528 tests)
**Active branch:** `phantom/v3.3-dogfood` → merges to `claude/document-environment-status-vQRKB`

---

## Dogfood Session Log

| Session | Branch | Fixes | Tests |
|---|---|---|---|
| v3.0 | `phantom/v3-self-improvement` | Profile system, four-gate drift, `check`, `recover`, `report` | ~400 |
| v3.1 | `phantom/v3.1-dogfood` | Anchors, checkpoints, `_eval_criteria`, fire banner, `status --brief` | 481 |
| v3.2 | `phantom/v3.2-dogfood` | HEARTBEAT.md v6 (fabrication), `scope-update`, DRIFT_GUARD.md v4, display fixes | 528 |
| v3.3 | `phantom/v3.3-dogfood` | MD file rewrites, *(in progress)* | — |

---

## Known Friction / Planned Improvements

Priority order based on severity and impact:

### High — correctness issues
| Issue | Proposed fix |
|---|---|
| `drift-done` SCOPE_CREEP message says "spreading changes" — doesn't mention `scope-update` | Update `cmd_drift_done` output to suggest `scope-update` when SCOPE_CREEP fires |
| DRIFT_GUARD.md lacks exact output format docs (unlike HEARTBEAT.md v6) | Add exact status-line format + what "CLEAN: Gate N" looks like |
| After `scope-update`, drift guard still uses old scope (must re-arm manually) | Print clearer reminder; potentially add auto-re-arm flag |

### Medium — usability friction
| Issue | Proposed fix |
|---|---|
| `phantom.py start` done-criteria not shown in `status` output | Add criteria preview to status (or status --verbose) |
| `anchor show` full output is long; `anchor check` is better for resumption | Add CLAUDE.md note: use `anchor check` not `anchor show` after resume |
| Container logger not auto-started on new session — easy to forget | Add `env` command check or start-session warning if logger not running |
| `check` command re-runs git diff on every call — slow if called often | Cache result with timestamp (valid for 30s) |

### Low — polish / docs
| Issue | Proposed fix |
|---|---|
| `history` command shows all turns verbatim — gets long | Add `--last N` flag to show only last N turns |
| `status` fire log shows "last 1" in parentheses — awkward phrasing | Tighten display format |
| DIFF.md / PLAN.md / ANTI_DRIFT.md were stale since v1→v2 *(fixed in v3.3)* | ✓ done |

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
                  "observed at least 1 heartbeat fire" \
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
