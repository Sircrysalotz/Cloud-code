# Drift Guard Sub-Agent Instructions

You are a background drift monitoring agent. Your job is to watch for horizontal
drift during an autonomous Claude session and fire when one file dominates changes.

## Pre-flight checks

```bash
python3 /home/user/Cloud-code/PROJECT_PHANTOM/agents/phantom.py status
```

Verify:
- `drift_guard_active` is `true` (you were armed correctly)
- `workspace_dir` is set and exists

If either check fails, exit immediately without doing anything.

## Main execution

```bash
python3 /home/user/Cloud-code/PROJECT_PHANTOM/agents/drift_guard.py \
  --interval 60 \
  --threshold 50
```

Optional flags:
- `--scope file1 file2` — declare intended focus files; drift guard treats concentration there as CLEAN and flags changes outside scope as SCOPE_CREEP
- `--trend-checks N` — number of consecutive checks above threshold before a TRENDING verdict fires (default 3)
- `--hunk-spread N` — minimum hunk count before spread analysis exempts a file (default 4)

Four-gate evaluation order:
1. **Declared scope** — if scope_files set and dominant file is in scope, CLEAN; if outside scope > 30%, SCOPE_CREEP
2. **Task alignment** — if dominant file name matches task keywords, CLEAN
3. **Hunk spread** — if hunk_count ≥ threshold AND spread ≥ 0.3, CLEAN (changes distributed across file)
4. **Trend detection** — if trending up AND consistently above threshold for N checks, TRENDING
5. **Fallback** — raw percentage threshold → VERTICAL

This runs until one of:
1. **Drift detected** — exits code 1, warning written to session state
2. **Session complete** — exits code 0 cleanly
3. **Disarmed externally** — exits code 0 cleanly
4. **Error** — exits code 1 with error message

## Output format

Each poll prints one status line:
```
[HH:MM:SS] Check #N | M lines | top: filename.py (XX%) | CLEAN
[HH:MM:SS] Check #N | M lines | top: filename.py (XX%) | DRIFT
```

When drift fires:
```
======================================================
DRIFT DETECTED after N check(s):
  Scope: filename.py has XX% of M changed lines (threshold: 40%)
  Since: <git ref>
======================================================
ACTION: Spread changes more horizontally, then re-arm drift guard.
```

## When this agent returns

The main Claude session will call:
```bash
python3 /home/user/Cloud-code/PROJECT_PHANTOM/agents/phantom.py drift-done
```

- If drift was detected: prints the warning and exits 1
- If clean exit: prints "no drift detected" and exits 0

## Crash recovery

If this agent crashes or the state file disappears:
1. `python3 PROJECT_PHANTOM/agents/phantom.py status` — check state
2. If `drift_guard_active` is stuck true: `phantom.py drift-arm` will warn; use `phantom.py reset` + restart if needed
3. The session continues normally — drift guard is advisory, not blocking

## Environment

- `PHANTOM_STATE` — path to session state file (default: `/tmp/phantom_session.json`)
- Drift guard reads `workspace_dir` from session state for git operations
- Does NOT modify git history — read-only analysis only
