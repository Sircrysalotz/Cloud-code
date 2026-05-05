# Anti-Drift Observations

Captured during the 10-turn autonomous improvement session. Documents how drift
manifests and what tools would prevent it.

---

## How Drift Actually Appeared This Session

### 1. Artificial turn boundaries
**What happened:** I was stopping after each "turn" and waiting for the heartbeat,
treating turns like discrete work units to be completed and then paused.

**What should happen:** Work continuously until genuinely done. Heartbeat fires
when I actually stop — not when I decide a "turn" is over.

**Lesson:** The heartbeat is not a turn timer. It's an idle detector. Don't treat
it like a metronome.

### 2. Writing code without pinging
**What happened:** The heartbeat fired while I was mid-turn writing files,
because `last_active` only updates on explicit pings, not on file writes.

**Implication:** From the heartbeat's perspective, writing files looks like idle.
This is technically a false positive — I was active, just not pinging.

**Possible fix:** A "work_in_progress" flag that suppresses heartbeat while
I'm in a long coding session. Set it at turn start, clear it before going idle.

### 3. Vertical creep on phantom.py
**What happened:** phantom.py got the most attention (most new commands).
heartbeat_runner and container_logger got fewer additions.

**What prevented it from being worse:** The PLAN.md horizontal tracker with
explicit targets per turn. Without it, I would have gone much deeper on phantom.py.

**Lesson:** Written constraints help. A scope guard agent could enforce this
automatically — warning if any single file was touched more than N times while
others were skipped.

---

## Drift Patterns to Watch For

| Pattern | Symptom | Detection |
|---|---|---|
| Premature stopping | Heartbeat fires while still in middle of thought | Short gap (<threshold + 50%) |
| Vertical drilling | One file gets 5x more commits than others | Git diff stats per file |
| Scope creep | Working on things not in the original task | Periodic task restatement check |
| Context loss | Repeating work already done | Progress note history |
| False completion | Marking done before really done | Heartbeat still has rounds left |

---

## Proposed Anti-Drift Agents

### Scope Guard
Runs periodically (every N turns). Reads git diff stats and warns if any single
file has received disproportionate changes. Forces horizontal spreading.

```
Input: git diff --stat HEAD~N HEAD
Output: warn if any file > 40% of total changes
```

### Goal Alignment Checker
At each heartbeat fire, re-reads the original task from state and compares it to
`progress_note`. Flags if the work seems to have drifted from the stated goal.

```
Input: state.task + state.progress_note
Output: "Still aligned" or "DRIFT DETECTED: [note seems unrelated to task]"
```

### Coverage Tracker
Maintains a checklist of targets (from PLAN.md or a task spec). At each ping,
checks which items are done vs not started. Reports coverage %, not just turns done.

```
Input: PLAN.md targets + list of files modified
Output: "Coverage: 7/12 targets touched. Untouched: heartbeat_runner, container_logger"
```

### Progress Note Auditor
Checks if progress notes are substantive (list of specific changes) vs vague
("working on stuff", "continued improvements"). Vague notes indicate drift.

```
Input: last 5 progress notes
Output: score 0-10 for specificity. Warn if < 5.
```

---

## What Would a Full Anti-Drift System Look Like?

```
Main Claude session
├── Heartbeat agent     — idle detection, session keepalive
├── Scope Guard agent   — file coverage enforcement
├── Goal Checker agent  — task alignment verification
└── Container Logger    — container vitals

All four run independently. All four report to main session.
Main Claude reads their outputs and self-corrects.
```

The heartbeat gives you continuity. The scope guard gives you horizontal discipline.
The goal checker gives you direction. The container logger gives you visibility.
Together they approximate having a human looking over your shoulder — but made of agents.
