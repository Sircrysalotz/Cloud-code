# Drift Guard Sub-Agent Instructions v3

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
- `--scope file1 file2` — override scope files (default: reads from session state set by `phantom.py start --scope`)
- `--scope-threshold N` — % of changes outside declared scope that triggers SCOPE_CREEP (default 30)
- `--hunk-count-min N` — minimum hunk count required before spread analysis can exempt a file (default 4)
- `--hunk-spread N` — minimum hunk spread ratio (0–1) to consider work horizontal (default 0.3)
- `--trend-checks N` — history window: checks above threshold before TRENDING fires (default 3)

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

## Output format (v3)

Each poll prints one rich status line:
```
[HH:MM:SS] Check #N | <total>L | top: filename.py (<pct>%) hunks=<N> [scope <in>/<total>L] | CLEAN: <reason>
```

- `<total>L` — total changed lines since session start
- `hunks=N` — hunk count in dominant file (higher = more spread within that file)
- `[scope in/totalL]` — only shown when scope is declared; shows lines inside vs total
- `| CLEAN: <reason>` — which gate cleared the check, or which fired for drift

### Verdict-specific output when drift fires

**SCOPE_CREEP:**
```
======================================================
DRIFT DETECTED [SCOPE_CREEP] after N check(s):
  ...
======================================================
ACTION: Changes are drifting outside declared scope.
  Option A: Move edits back to scope files.
  Option B: Update scope — phantom.py start --scope <files> --force
  Then re-arm: phantom.py drift-arm
```

**VERTICAL:**
```
ACTION: One file dominates — work is drilling down, not spreading out.
  Spread changes across more files before continuing.
  Then re-arm: phantom.py drift-arm
```

**TRENDING:**
```
ACTION: Slow upward trend detected — vertical drift is building.
  Proactive fix: distribute future changes across other files.
  Then re-arm: phantom.py drift-arm
```

The `drift_warning` written to session state also includes `[in-scope]` markers
on each file in the top-3 list, making it easy to see which are inside scope.

## When this agent returns

The main Claude session will call:
```bash
python3 /home/user/Cloud-code/PROJECT_PHANTOM/agents/phantom.py drift-done
```

- If drift was detected: prints the warning and exits 1
- If clean exit: prints "no drift detected" and exits 0

## On drift: recommended response

| Verdict | Immediate action |
|---|---|
| `SCOPE_CREEP` | Move edits to scope files OR update `--scope` then re-arm |
| `VERTICAL` | Create or touch 2+ other files, then re-arm |
| `TRENDING` | Start next change in a different file, then re-arm |

After spreading changes:
```bash
python3 PROJECT_PHANTOM/agents/phantom.py drift-arm
python3 PROJECT_PHANTOM/agents/phantom.py agent-start --id "drift-guard"
# Spawn: "Read DRIFT_GUARD.md and execute."
```

## Crash recovery

If this agent crashes or the state file disappears:
1. `python3 PROJECT_PHANTOM/agents/phantom.py status` — check state
2. If `drift_guard_active` stuck true with no process: `phantom.py recover` clears it cleanly
3. The session continues normally — drift guard is advisory, not blocking

## Environment

- `PHANTOM_STATE` — path to session state file (default: `/tmp/phantom_session.json`)
- Drift guard reads `workspace_dir` from session state for git operations
- Does NOT modify git history — read-only analysis only
