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

## What Works Well (Don't Break)

- **Four-gate drift evaluation** — almost no false positives on legitimate single-file tasks
- **`session_start_ref` anchoring** — drift guard only checks current-session changes
- **`_is_auto_generated()` filter** — `logs/` dir never inflates scope percentage
- **`heartbeat_fires[]` list** — reliable fire detection from state (not agent output)
- **`recover` command** — clears any stuck flag cleanly without losing session data
- **`anchor check` after resume** — re-orienting to Point B before each turn prevents context drift
- **`checkpoint` before `complete`** — non-negotiable gates catch lazy completions
