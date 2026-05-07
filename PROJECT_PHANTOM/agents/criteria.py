#!/usr/bin/env python3
"""
Shared criteria evaluator for PHANTOM session done-criteria.

Used by both phantom.py (_eval_criteria) and heartbeat_runner.py (eval_criteria_quick)
so fire banners and anchor checks always show identical results.

Auto-eval patterns — write done-criteria using these forms to get [x]/[ ] automatically:

  Pattern              Example criterion                     What it checks
  ─────────────────────────────────────────────────────────────────────────────────
  coverage             "coverage 4/4" / "full coverage"      state["coverage_full"]
  drift clean          "drift clean" / "no drift"            not state["drift_warning"]
  anchor check         "anchor check used at least once"     anchor_checks_count > 0
  checkpoint           "checkpoint before completion"        checkpoint_calls_count > 0
  heartbeat fires      "observed 6+ heartbeat fires"         len(heartbeat_fires) >= N
  tests passing        "583+ tests passing"                  tests_last_count >= N
  file updated/created "CLAUDE.md updated" / "README.md created"
                                                             git diff --name-only since session start
                       (trigger words: updated, changed, done, committed,
                                       created, documented, added, written)
  elapsed time         "session elapsed 90+ minutes"         (now - started).total_seconds()/60 >= N
                       (trigger words: elapsed, minute, min + a number)
"""

import re
import subprocess
from datetime import datetime


def eval_criteria(state: dict) -> list[tuple[str, bool]]:
    """
    Evaluate each done-criterion against observable session state.
    Returns list of (criterion_text, is_done) pairs in original order.
    """
    criteria = (state.get("anchor_b") or {}).get("done_criteria") or []
    if not criteria:
        return []

    coverage_full   = bool(state.get("coverage_full"))
    drift_warning   = state.get("drift_warning")
    anchor_checks   = state.get("anchor_checks_count", 0)
    ckpt_calls      = state.get("checkpoint_calls_count", 0)
    hb_fires        = len(state.get("heartbeat_fires", []))
    tests_count     = state.get("tests_last_count", 0)
    start_ref       = state.get("session_start_ref", "")
    workspace       = state.get("workspace_dir", ".")
    started_str     = state.get("started", "")
    try:
        elapsed_minutes = (datetime.now() - datetime.strptime(started_str, "%Y-%m-%d %H:%M:%S")).total_seconds() / 60
    except Exception:
        elapsed_minutes = 0

    # Cache git diff result so multiple file-criteria don't each spawn git
    _diff_files: list[str] | None = None

    def _get_diff_files() -> list[str]:
        nonlocal _diff_files
        if _diff_files is None:
            if not start_ref:
                _diff_files = []
            else:
                try:
                    out = subprocess.check_output(
                        ["git", "diff", "--name-only", start_ref, "HEAD"],
                        stderr=subprocess.DEVNULL,
                        cwd=workspace,
                    ).decode()
                    _diff_files = [p for p in out.splitlines() if p]
                except Exception:
                    _diff_files = []
        return _diff_files

    results = []
    for c in criteria:
        cl = c.lower()
        done = False

        if "coverage" in cl:
            done = coverage_full

        elif "drift" in cl and ("clean" in cl or "no" in cl):
            done = not bool(drift_warning)

        elif "anchor check" in cl:
            done = anchor_checks > 0

        elif "checkpoint" in cl and ("used" in cl or "before" in cl or "run" in cl):
            done = ckpt_calls > 0

        elif "heartbeat fire" in cl or ("heartbeat" in cl and "fire" in cl):
            m = re.search(r'(\d+)', c)
            needed = int(m.group(1)) if m else 1
            done = hb_fires >= needed

        elif ("elapsed" in cl or "minute" in cl or "session" in cl) and re.search(r'\d+', c) and ("minute" in cl or "min" in cl):
            m = re.search(r'(\d+)', c)
            needed_min = int(m.group(1)) if m else 0
            done = elapsed_minutes >= needed_min

        elif "test" in cl and ("pass" in cl or "passing" in cl):
            m = re.search(r'(\d+)', c)
            if m and tests_count > 0:
                done = tests_count >= int(m.group(1))

        # File updated/created: "CLAUDE.md updated", "README.md created", etc.
        elif re.search(r'\b[\w.\-]+\.(?:py|md|txt|json|sh|yml|yaml)\b', c):
            fm = re.search(r'\b([\w.\-/]+\.(?:py|md|txt|json|sh|yml|yaml))\b', c)
            if fm and any(kw in cl for kw in ("updated", "changed", "done", "committed", "created", "documented", "added", "written")):
                fname = fm.group(1)
                diff_files = _get_diff_files()
                done = any(
                    p == fname or p.endswith("/" + fname)
                    for p in diff_files
                )

        results.append((c, done))
    return results
