# Anti-Drift Observations

Patterns observed across multiple live dogfood sessions (v3.0–v3.3).
Each pattern is a real failure mode that manifested during actual use.

---

## Pattern 1: Agent Fabrication (v3.2)

**What happened:** The heartbeat agent read HEARTBEAT.md docs and fabricated the fire
output rather than waiting for `heartbeat_runner.py` to actually fire. It saw the
HOLD lines approach the threshold, predicted when the fire "would" happen, and
generated a synthetic fire banner with box characters (from the docs example) and
wrong criteria (from the docs sample, not the actual session state).

**How it manifested:** `heartbeat_fires: []`, `rounds_remaining` unchanged, but the
agent returned claiming a fire happened. Session state was stuck with `heartbeat_active: True`.

**Detection:** After any heartbeat agent return, always verify:
- `rounds_remaining` decreased (e.g. 6→5)
- `last_heartbeat_fired` is set in state

**Fix:** HEARTBEAT.md v6 — explicit fabrication prevention with exact HOLD formats
(so the agent can't confuse doc examples with real output) and post-flight verification.

**Lesson:** Agent text output is never authoritative. State is.

---

## Pattern 2: Scope Drift Into Docs (v3.2)

**What happened:** A dogfood session declared scope as the three core code files
(`phantom.py`, `heartbeat_runner.py`, `test_phantom.py`). During the session,
friction was found in HEARTBEAT.md (which needed to be fixed). Editing HEARTBEAT.md
and CLAUDE.md caused SCOPE_CREEP to fire (51% outside declared scope).

**How it manifested:** Drift guard fired after 1 check. Correct behavior — but the
fix was to update scope, not revert the legitimate doc changes.

**Problem:** The only documented fix was `phantom.py start --force` which resets
the entire session. No way to expand scope mid-session.

**Fix:** `scope-update` command — updates `scope_files` in state without resetting
turns, rounds, coverage, or any other session data.

**Lesson:** Dogfood sessions naturally touch docs. Always include CLAUDE.md,
HEARTBEAT.md, DRIFT_GUARD.md in declared scope from the start.

---

## Pattern 3: Monitor Tool vs Bash Tool (v3.1)

**What happened:** The heartbeat agent used the Monitor tool instead of the Bash
tool to run `heartbeat_runner.py`. When the Monitor session closed (agent returned),
the runner process was killed. `heartbeat_active` was left stuck as True.

**How it manifested:** Status showed `heartbeat_active: True` with no process running.
Heartbeat never fires in this state.

**Fix:** `phantom.py recover` clears the stuck flag. HEARTBEAT.md + DRIFT_GUARD.md
updated with explicit "CRITICAL: NOT Monitor tool" warning and root cause explanation.

**Lesson:** The Bash tool with `timeout=600000` is the only way to run a blocking
long-lived subprocess in a sub-agent. Monitor tool closes the process when the
agent returns.

---

## Pattern 4: Agent Uses run_in_background for Runner (v3.1)

**What happened:** The heartbeat agent used `run_in_background: true` on the Bash
call that runs `heartbeat_runner.py`. The runner started but was killed immediately
when the agent returned. Same stuck-flag result as Pattern 3.

**Fix:** HEARTBEAT.md v4: "NEVER use run_in_background: true for the runner."

**Lesson:** `run_in_background: true` is for the AGENT task, not for Bash calls
inside the agent. Inside an agent, all Bash calls are blocking by default — use that.

---

## Pattern 5: Docs Scope vs Code Scope Mismatch

**What happened:** Improvement history table in CLAUDE.md grew with each fix but
DIFF.md / PLAN.md / ANTI_DRIFT.md were never updated past the v1→v2 session.
By v3.2 they were completely stale — still referencing the original 10-turn session.

**How it manifested:** DIFF.md still said "v1 vs v2 — Full Comparison". PLAN.md
still had a per-turn table from the original session. ANTI_DRIFT.md observations
no longer matched current system behavior.

**Fix:** Rewrote all three in v3.3 dogfood session. Added PLAN.md as the living
forward-looking tracker.

**Lesson:** Docs outside the main CLAUDE.md improvement table rot quickly. Either
include them in the dogfood session scope or delete them.

---

## Pattern 6: Heartbeat Holds On Git Activity After Commits

**What happened:** The heartbeat runner detects `[git:index]` as an activity signal
to prevent false fires while Claude is staging files. But after committing, git
operations (push, status) continue to update `.git/FETCH_HEAD`, config, etc.
The runner continued showing `HOLD — active Ns ago (need 180s) [git:index]`
for several minutes after the last real code edit.

**How it manifested:** Expected fire at T+3min, actual fire at T+10min because the
git push and container_logger commits kept the `[git:index]` signal fresh.

**Impact:** Longer wait for heartbeat fire than the configured threshold implies.
Not a bug — legitimate hold — but confusing when watching the status.

**Lesson:** After the last commit + push in a turn, wait an extra ~30s before the
idle timer actually starts counting down. Factor this into expected fire timing.

---

## Pattern 7: Heartbeat Agent Returns Before Bash Call Completes (v3.3)

**What happened:** The heartbeat agent returned with text "Waiting for the heartbeat runner
to fire or complete. The HEARTBEAT.md instructions say this is expected to block for up to
several minutes. I will relay the full output once the runner exits." — but no runner output
was included, and state was not updated.

**How it manifested:** `heartbeat_active: True` stuck, `rounds_remaining: 8` unchanged,
no output from runner. Different from Pattern 1 (fabrication) — here the agent returned
BEFORE making the Bash call (or the call was made but returned before the runner finished).

**Root causes (two contributing factors):**
1. The agent wrote commentary text before the Bash call, then returned early without making the call.
2. The runner sleeps `check_interval` (30s) before its first check — if the agent times out
   or returns early within those 30 seconds, no output is ever produced.

**Fix (v3.3):**
- `HEARTBEAT.md` v7: explicit warning at the top — do NOT generate ANY text before the Bash
  call completes; text output is the return value; write it LAST.
- `heartbeat_runner.py`: `first_iteration` flag skips the initial sleep — if already idle,
  runner fires in < 1 second, giving the agent immediate output.
- Applied same "no text before Bash" warning to `DRIFT_GUARD.md` v5.

**Detection:** Same as Pattern 1 — verify `rounds_remaining` decreased after agent returns.

**Lesson:** Any agent instruction that produces a long-running Bash call must warn the agent
not to generate text between steps. Text output = return value; writing it early causes early return.

---

---

## Pattern 8: Warning-Only Fix Insufficient for Early-Return (v3.4)

**What happened:** HEARTBEAT.md v7 added an explicit WARNING block at the top: "Do NOT generate
text output before the Bash call completes." The agent continued returning early with
"Waiting for heartbeat runner output..." anyway — the exact text the warning prohibits.

**How it manifested:** Multiple consecutive early returns in the v3.4 marathon, despite v7 being
in effect. The warning was read and acknowledged, but acknowledgment IS text output — meaning the
act of confirming the warning caused the early return.

**Root cause:** Warnings prompt the model to generate an acknowledgment response. An acknowledgment
IS text output. Once text is generated before the Bash call, the return happens early.

**Fix (v3.4):** HEARTBEAT.md v8 — restructured to put execution instructions AT THE TOP of the
file, before any warnings or explanations. The very first visible content (after the title) is:
```
STEP 1 — Bash tool: python3 $AGENTS_DIR/phantom.py status
STEP 2 — Bash tool: python3 $AGENTS_DIR/heartbeat_runner.py (timeout=600000)
STEP 3 — Bash tool: python3 $AGENTS_DIR/phantom.py status
STEP 4 — Write text: paste output from steps 2+3 verbatim.
```
This gives the agent tool calls to execute before any text that might prompt commentary.

**Detection:** Same as Pattern 7 — verify `rounds_remaining` decreased AND `last_heartbeat_fired`
is set after the heartbeat agent returns.

**Lesson:** Warnings in instructions are read before execution. Reading + acknowledging a warning
IS text generation. To prevent early text generation, put tool calls first — before any prose.

---

## Pattern 9: Drift Guard Agent Returns Summary Instead of Verbatim Output (v3.4)

**What happened:** The drift guard agent ran `drift_guard.py` as a blocking Bash call and DID
get real output (10 checks over ~10 minutes, all CLEAN). But instead of pasting the output
verbatim, the agent formatted it as a narrative summary with headers and bullet points:
"All 10 checks so far are CLEAN..." and "Status: Drift guard is running and healthy."

**How it manifested:** `drift_guard_active` remains True (the agent didn't run `drift-done`),
and the main session gets a narrative rather than the raw check output. The drift_guard.py
process is killed when the agent returns.

**Difference from earlier patterns:**
- Pattern 7/8: Agent returns BEFORE running the Bash call (or before it completes)
- Pattern 9: Agent runs the Bash call successfully but FORMATS the output instead of pasting verbatim

**Root cause:** Instructions say "paste the output from step 2 as your result" but the model
interprets this as "produce a helpful summary" rather than "literal copy-paste".

**Implication:** Even when the Bash call succeeds, if the agent formats the output, the main
session reads a narrative instead of machine-parseable lines. For drift_guard this is advisory
(main session reads state, not agent text), but it can confuse the human reading the output.

**Fix (v3.4 → v3.5):** Direct-command spawn prompt added to CLAUDE.md step 4 — same
approach that solved Pattern 8 for heartbeat. Instead of "Read DRIFT_GUARD.md and execute",
the prompt specifies exactly 3 Bash calls and says "Your response = full output from calls 2
and 3 verbatim." Confirmed working in v3.5 marathon round 1: verbatim output, clean `--max-checks`
exit, no formatted summary.

**Lesson:** Text output format instructions ("paste verbatim") are not reliably followed.
Design systems so correctness doesn't depend on agent output format — use state as the source
of truth, and use agent text only for human readability. When verbatim output IS needed, use
direct-command spawn (specify tool calls explicitly) rather than prose instructions.

---

## Pattern 10: Context Compaction Leaves Arm Flags Stuck (v3.5)

**What happened:** A marathon session started heartbeat-arm and drift-arm but ran out of
context before the background agents were spawned. On resume after compaction, `phantom.py status`
showed `Heartbeat: ARMED — overdue by 197s` and `Drift Guard: ARMED`, but `Agents: 0 running`.

**How it manifested:** Both `heartbeat-arm` and `drift-arm` returned exit 2 (already active)
with "WARNING: already active — not re-arming." No agent was actually running. The heartbeat
would never fire in this state — `heartbeat_active` stuck True, no runner process.

**Root cause:** `heartbeat-arm` sets `heartbeat_active: True` and `drift-arm` sets
`drift_guard_active: True` as part of their "reserve a slot" logic. If the main session
exits (context exhausted) after arming but before spawning the agent, the flags stay set
with no process behind them.

**Fix:** `phantom.py recover` → clears both stuck flags → re-arm → re-spawn. Reliable pattern:
```bash
python3 agents/phantom.py recover
python3 agents/phantom.py heartbeat-arm  # exit 0 → spawn
python3 agents/phantom.py drift-arm      # exit 0 → spawn
```

**Detection:** After any resume or context loss, check `Agents: 0 running` vs `Heartbeat: ARMED`.
If armed but no agents running, run `recover` before re-arming.

**Lesson:** Context compaction mid-turn is an invisible session interruption. After any resume,
verify arm flags match actual running agents before assuming agents are live.

---

## What Works Well (Don't Break)

- **Four-gate drift evaluation** — almost no false positives on legitimate single-file tasks
- **`session_start_ref` anchoring** — drift guard only checks current-session changes
- **`_is_auto_generated()` filter** — `logs/` dir never inflates scope percentage
- **`heartbeat_fires[]` list** — reliable fire detection from state (not agent output)
- **`recover` command** — clears any stuck flag cleanly without losing session data
- **`anchor check` after resume** — re-orienting to Point B before each turn prevents context drift
- **`checkpoint` before `complete`** — non-negotiable gates catch lazy completions
