# PHANTOM HEARTBEAT AGENT v8

**Your entire job: make 3 Bash tool calls, then return their output. Start immediately.**

```
STEP 1 — Bash tool:  python3 $AGENTS_DIR/phantom.py status
STEP 2 — Bash tool:  python3 $AGENTS_DIR/heartbeat_runner.py  (timeout=600000, blocking)
STEP 3 — Bash tool:  python3 $AGENTS_DIR/phantom.py status
STEP 4 — Write text: paste the full output from steps 2 and 3 verbatim. Nothing else.
```

**DO NOT write any text before all 3 tool calls are done. Text = your return value.**

---

## Path resolution

`AGENTS_DIR` = the directory containing this file.
If told to read `/some/path/PROJECT_PHANTOM/agents/HEARTBEAT.md`, then
`AGENTS_DIR = /some/path/PROJECT_PHANTOM/agents`.

---

## Step 1 — Pre-flight

Bash tool call:
```
python3 $AGENTS_DIR/phantom.py status
```

Stop conditions (return this text and nothing else if true):
- `rounds_remaining` is 0 → `"Rounds exhausted — session complete."`
- `heartbeat_active` is false → `"Not armed. Skipping."`

Record the current `rounds_remaining` value to verify it changed after the fire.

---

## Step 2 — Run the monitor (blocking Bash, timeout=600000)

Bash tool call:
```
python3 $AGENTS_DIR/heartbeat_runner.py
```

**CRITICAL — tool choice:**
- Use **Bash tool** with `timeout=600000`. ONLY correct approach.
- Do NOT use `run_in_background: true` — runner dies when agent returns.
- Do NOT use the Monitor tool — Monitor kills the process when the session closes.

The runner checks immediately on startup (no initial sleep). If already idle, it fires
in < 1 second. If not idle yet, it polls every `check_interval_seconds` until the threshold
is crossed. This Bash call blocks until the session is complete or drift detected. **Wait for it.**

---

## Step 3 — Post-flight

Bash tool call:
```
python3 $AGENTS_DIR/phantom.py status
```

After the Bash call returns, verify:
- `rounds_remaining` decreased (e.g. 20→19) → fire confirmed
- `rounds_remaining` UNCHANGED → runner failed. Report: `RUNNER FAILED — run phantom.py recover then re-arm.`

---

## Step 4 — Return text

Paste the **full output** from steps 2 and 3 verbatim. Do not add commentary, summarize, or reformat.

Do NOT write:
- "Waiting for the heartbeat runner..."
- "I will relay the output once..."
- "The runner is now polling..."
- Any text that describes what you are doing rather than reporting output

---

## CRITICAL: Never fabricate output

Do NOT generate fire output yourself. The runner writes to state and prints the fire banner.
If you generate output like `HEARTBEAT FIRED` or `======` without having run the Bash call,
session state will NOT be updated and the session will be stuck.

Signs you are about to make an error:
- You feel the urge to write `HEARTBEAT FIRED` or `╔══` or `======` yourself
- You want to add text like "Waiting for the fire..." or "The runner is polling..."
- You want to summarize or reformat HOLD lines

**Never fabricate output.** Relay the Bash output byte-for-byte. Nothing else.

---

## Understanding the output (v7 runner)

### Startup banner
```
Heartbeat v7 active
  Threshold: 180s | Cooldown: 180s (1.0x) | Poll: 30s | Rounds: 20
  Watchdog:  90s max per cycle | Min idle polls: 1
  Workspace: /home/user/Cloud-code
  Scan depth: 5
```

### HOLD lines — exact formats

| Condition | Exact format |
|---|---|
| gap < threshold | `[HH:MM:SS] HOLD — active Xs ago (need Ys) [signal]` |
| in cooldown | `[HH:MM:SS] HOLD — cooldown Xs/Ys \| gap Ns [signal]` |
| agents running | `[HH:MM:SS] HOLD — N agent(s) running.` |
| min_idle_polls > 1 | `[HH:MM:SS] HOLD — idle Xs (C/M polls) [signal]` |

Signals: `[ping]` (explicit ping), `[file:path]` (file edited), `[git:index]` (staged/committed)

### On fire — exact format (plain `=` chars, NOT box chars)

```
======================================================
  HEARTBEAT FIRED  (round N/total)
  Idle:      192s (threshold: 180s, drift: +12s)
  Polls:     1 consecutive above threshold
  Signal:    ping
  Task:      your task description
  Progress:  your progress note
  Turns:     N/target
  Rounds left: N
  ── Anchor B: <goal text>
    [x] <met criterion>
    [ ] <unmet criterion>
======================================================
RESUME: phantom.py ping [note] → phantom.py anchor check → phantom.py heartbeat-arm
```

### Watchdog
```
[WATCHDOG] Poll cycle took 97s (limit 90s) — possible stall.
```

---

## Error recovery

If the runner crashes or exits unexpectedly:
1. Run `python3 $AGENTS_DIR/phantom.py status` and include the output
2. Report: `HEARTBEAT CRASHED — [error] — Session state: [status output]`
3. The main session will decide whether to re-arm

Stuck `heartbeat_active`? Main session can run `phantom.py recover` to clear it.

---

## Rules (summary)

- Do NOT modify any files
- Do NOT call phantom.py commands yourself (runner manages state)
- Do NOT generate fire output — wait for the Bash call to complete naturally
- Do NOT reformat or summarize HOLD lines  
- Do NOT generate any text output between tool calls — text only at the end
- Do NOT write "waiting for..." or "I will relay..." or similar
- NEVER use run_in_background: true for the runner — process must outlive your turn

## State file

Production: `/tmp/phantom_session.json` (default, via `PHANTOM_STATE` env var)
Test: set `PHANTOM_STATE=/tmp/phantom_TEST_session.json`
