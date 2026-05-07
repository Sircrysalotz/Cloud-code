# Drift Guard Sub-Agent Instructions v6

**Your entire job: make 3 Bash tool calls, then return their output. Start immediately.**

```
STEP 1 — Bash tool:  python3 $AGENTS_DIR/phantom.py status
STEP 2 — Bash tool:  python3 $AGENTS_DIR/drift_guard.py --interval 60 --threshold 50 --max-checks 10  (timeout=600000, blocking)
STEP 3 — Bash tool:  python3 $AGENTS_DIR/phantom.py status
STEP 4 — Write text: paste the full output from steps 2 and 3 verbatim. Nothing else.
```

**DO NOT write any text before all 3 tool calls are done. Text = your return value.**

---

## Path resolution

`AGENTS_DIR` = the directory containing this file.
If told to read `/some/path/PROJECT_PHANTOM/agents/DRIFT_GUARD.md`, then
`AGENTS_DIR = /some/path/PROJECT_PHANTOM/agents`.

---

## Step 1 — Pre-flight

Bash tool call:
```
python3 $AGENTS_DIR/phantom.py status
```

Stop conditions (return this text and nothing else if true):
- `drift_guard_active` is false → `"Not armed. Skipping."`
- `workspace_dir` missing → `"Not armed / workspace missing."`

## CRITICAL: Never fabricate output

Do NOT generate drift verdicts yourself. The `drift_guard.py` process:
- Writes `drift_warning` to session state when drift is detected
- The main session reads state via `phantom.py drift-done`, NOT your printed output

If you generate output like "DRIFT DETECTED" or "CLEAN" without running the process, the main
session will get an incorrect verdict from state (no drift warning written = appears clean).

Your only job: tool call (pre-flight) → tool call (drift_guard.py) → text output (paste result).

## Main execution (Bash tool, blocking)

**CRITICAL — tool choice matters:**
- Use the **Bash tool** with `timeout=600000`. This is the ONLY correct approach.
- Do NOT use `run_in_background: true` — process dies when the agent returns.
- Do NOT use the Monitor tool — Monitor does not keep the process running; drift_guard
  will be killed when the Monitor session closes, leaving drift_guard_active stuck True.

```bash
python3 $AGENTS_DIR/drift_guard.py \
  --interval 60 \
  --threshold 50 \
  --max-checks 10
```

Optional flags:
- `--scope file1 file2` — override scope files (default: reads from session state set by `phantom.py start --scope`)
- `--scope-threshold N` — % of changes outside declared scope that triggers SCOPE_CREEP (default 30)
- `--hunk-count-min N` — minimum hunk count required before spread analysis can exempt a file (default 4)
- `--hunk-spread N` — minimum hunk spread ratio (0–1) to consider work horizontal (default 0.3)
- `--trend-checks N` — history window: checks above threshold before TRENDING fires (default 3)
- `--max-checks N` — exit cleanly after N clean checks (0 = run until session complete or drift; useful with direct-command spawn)

Four-gate evaluation order:
1. **Declared scope** — if scope_files set and dominant file is in scope, CLEAN; if outside scope > 30%, SCOPE_CREEP
2. **Task alignment** — if dominant file name matches task keywords, CLEAN
3. **Hunk spread** — if hunk_count ≥ hunk_count_min AND spread ≥ 0.3, CLEAN (changes distributed across file)
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
[HH:MM:SS] +Xh YYm Check #N | <total>L | top: filename.py (<pct>%) hunks=<N> [scope <in>/<total>L] | CLEAN: <reason>
```

- `+Xh YYm` — session elapsed time (e.g. `+1h05m` or `+3m42s`) — helps track marathon progress

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
  Option B: Update scope — phantom.py scope-update --scope <files>
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
python3 $AGENTS_DIR/phantom.py drift-done
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
python3 $AGENTS_DIR/phantom.py drift-arm
# Spawn with direct-command prompt (preferred — prevents Pattern 9 summary-instead-of-verbatim):
# See CLAUDE.md protocol step 4 for the exact prompt.
# run_in_background: true (for the AGENT, not for the drift_guard.py command itself)
# Do NOT call agent-start — drift-guard uses drift-arm/drift-done only.
```

## Crash recovery

If this agent crashes or the state file disappears:
1. `python3 $AGENTS_DIR/phantom.py status` — check state
2. If `drift_guard_active` stuck true with no process: `phantom.py recover` clears it cleanly
3. The session continues normally — drift guard is advisory, not blocking

## Environment

- `PHANTOM_STATE` — path to session state file (default: `/tmp/phantom_session.json`)
- Drift guard reads `workspace_dir` from session state for git operations
- Does NOT modify git history — read-only analysis only
