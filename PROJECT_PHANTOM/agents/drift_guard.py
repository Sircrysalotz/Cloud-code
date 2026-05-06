#!/usr/bin/env python3
"""
Phantom Drift Guard v4 — smarter horizontal drift detection.

Four-gate evaluation replaces the naive file-percentage threshold:

  Gate 1 — Declared scope:  if changes stay within --scope files, not drift.
            Fires on SCOPE CREEP instead (changes outside declared scope).
  Gate 2 — Task alignment:  if dominant file matches task keywords, suppress.
            A file that IS the task having 90% of changes is expected.
  Gate 3 — Intra-file depth: many spread hunks = horizontal-within-file, not drift.
            One function growing huge = vertical drilling = drift.
  Gate 4 — Trend detection: track % over checks; warn on sustained upward trend
            even when below threshold, indicating slow vertical drilling.

All gates configurable. Falls back to simple threshold check when no context.

Exit codes:
  0 — clean exit (session complete, disarmed, or SIGTERM)
  1 — drift detected (warning written to session state)

Usage:
  python3 drift_guard.py [options]

Options:
  --interval N        Poll every N seconds (default: 60)
  --threshold N       Raw % threshold — only used as last resort (default: 50)
  --scope f1 f2 ...   Expected focus files (overrides session state scope_files)
  --since REF         Git ref to diff from (default: auto-detect)
  --min-lines N       Min changed lines before checking (default: 20)
  --trend-checks N    Checks needed to detect a trend (default: 3)
  --hunk-spread N     Hunk spread ratio below which file is "vertical" (default: 0.3)
  --ignore-patterns P1 P2 ...
                      Glob-style substrings to exclude from analysis (e.g. logs/ .json)
                      Useful for suppressing known false positives like auto-save files.

v4 additions:
  - --ignore-patterns: filter files matching any pattern substring before analysis
    (solves auto-save last_session_state.json false-positive SCOPE_CREEP)
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime


STATE_FILE = os.environ.get("PHANTOM_STATE", "/tmp/phantom_session.json")
TEMP_FILE  = STATE_FILE + ".tmp"
LOCK_FILE  = STATE_FILE.replace(".json", ".lock")
LOCK_TIMEOUT = 5

STOP_WORDS = {
    "with", "that", "this", "from", "have", "will", "also", "into", "over",
    "then", "when", "where", "while", "about", "build", "make", "adds", "more",
    "each", "some", "only", "both", "very", "just", "does", "uses", "gets",
    "runs", "file", "code", "test", "adds", "runs", "take", "give", "work",
}


# ─── State I/O ────────────────────────────────────────────────────────────────

def read_state() -> dict | None:
    for _ in range(3):
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except json.JSONDecodeError:
            time.sleep(0.1)
        except FileNotFoundError:
            return None
    return None


def acquire_lock() -> bool:
    deadline = time.time() + LOCK_TIMEOUT
    while time.time() < deadline:
        try:
            fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            time.sleep(0.05)
    return False


def release_lock():
    try:
        os.unlink(LOCK_FILE)
    except FileNotFoundError:
        pass


def atomic_write(state: dict):
    if not acquire_lock():
        print("WARNING: Could not acquire lock — phantom.py may be writing. Proceeding anyway.")
    try:
        with open(TEMP_FILE, "w") as f:
            json.dump(state, f, indent=2)
        os.rename(TEMP_FILE, STATE_FILE)
    finally:
        release_lock()


def clear_active_flag():
    state = read_state()
    if state and state.get("drift_guard_active"):
        state["drift_guard_active"] = False
        try:
            atomic_write(state)
            print("\n[drift_guard] Cleared drift_guard_active on exit.")
        except Exception:
            pass


def signal_handler(sig, frame):
    print(f"\n[drift_guard] Signal {sig}. Shutting down.")
    clear_active_flag()
    sys.exit(0)


# ─── Git helpers ──────────────────────────────────────────────────────────────

def git(args, cwd):
    return subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True)


def find_since(workspace: str, base_branch: str | None = None) -> str | None:
    candidates = [base_branch] if base_branch else ["main", "master"]
    for branch in candidates:
        r = git(["merge-base", "HEAD", branch], workspace)
        if r.returncode == 0:
            return r.stdout.strip()
    r = git(["rev-list", "--count", "HEAD"], workspace)
    if r.returncode == 0:
        count = int(r.stdout.strip())
        n = min(10, max(1, count - 1))
        return f"HEAD~{n}"
    return None


def parse_diff_stat(stat_output: str) -> dict[str, int]:
    files = {}
    for line in stat_output.splitlines():
        m = re.match(r"^\s+(.+?)\s+\|\s+(\d+)", line)
        if m:
            files[m.group(1).strip()] = int(m.group(2))
    return files


# ─── Analysis functions ───────────────────────────────────────────────────────

def get_file_scores(workspace: str, since: str) -> tuple[dict, list]:
    """
    Returns (raw_files: {name: lines}, scored: [(name, lines, pct)]).
    scored is sorted by pct descending.
    """
    r = git(["diff", "--stat", since, "HEAD"], workspace)
    if r.returncode != 0:
        return {}, []
    files = parse_diff_stat(r.stdout)
    total = sum(files.values())
    if not total:
        return files, []
    scored = sorted(
        [(name, lines, 100.0 * lines / total) for name, lines in files.items()],
        key=lambda x: -x[2]
    )
    return files, scored


def count_hunks(workspace: str, since: str) -> dict[str, dict]:
    """
    Per-file hunk analysis. Returns:
      {filename: {hunk_count, position_span, hunk_spread}}

    hunk_spread: 0.0 = all changes in one place (vertical),
                 1.0 = changes spread across entire file (horizontal).
    """
    r = git(["diff", "--unified=0", since, "HEAD"], workspace)
    if r.returncode != 0:
        return {}

    result = {}
    current = None

    for line in r.stdout.splitlines():
        if line.startswith("+++ b/"):
            current = line[6:]
            result[current] = {"hunk_count": 0, "positions": []}
        elif line.startswith("@@") and current:
            result[current]["hunk_count"] += 1
            m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", line)
            if m:
                result[current]["positions"].append(int(m.group(1)))

    for fname, data in result.items():
        positions = data.pop("positions")
        if len(positions) >= 2:
            span = max(positions) - min(positions)
            data["position_span"] = span
            # Normalize: 300+ line span = fully spread (1.0)
            data["hunk_spread"] = min(1.0, span / 300.0)
        else:
            data["position_span"] = 0
            data["hunk_spread"] = 0.0

    return result


def extract_task_words(task: str) -> set[str]:
    return {w.lower() for w in re.findall(r'\b[a-zA-Z]{4,}\b', task)
            if w.lower() not in STOP_WORDS}


def file_matches_task(filepath: str, task_words: set[str]) -> bool:
    """True if any task keyword appears in the file path."""
    path_lower = filepath.lower().replace("_", " ").replace("/", " ").replace(".", " ")
    return any(w in path_lower for w in task_words)


def scope_match(filepath: str, scope_files: list[str]) -> bool:
    """True if filepath matches any declared scope file."""
    fp_lower = filepath.lower()
    for s in scope_files:
        s_lower = s.lower()
        if s_lower in fp_lower or os.path.basename(s_lower) in fp_lower:
            return True
    return False


# ─── Trend tracker ────────────────────────────────────────────────────────────

class TrendTracker:
    def __init__(self, window: int = 3):
        self.window = window
        self.history: list[dict[str, float]] = []

    def update(self, scored: list) -> None:
        snapshot = {name: pct for name, _lines, pct in scored}
        self.history.append(snapshot)
        if len(self.history) > self.window + 2:
            self.history.pop(0)

    def trend(self, filename: str) -> tuple[str, float]:
        """
        Returns (direction, avg_delta_per_check).
        direction: 'up' | 'down' | 'stable' | 'unknown'
        """
        pcts = [h.get(filename, 0.0) for h in self.history]
        if len(pcts) < self.window:
            return "unknown", 0.0
        recent = pcts[-self.window:]
        deltas = [recent[i+1] - recent[i] for i in range(len(recent)-1)]
        avg = sum(deltas) / len(deltas) if deltas else 0.0
        if avg > 2.0:
            return "up", avg
        if avg < -2.0:
            return "down", avg
        return "stable", avg

    def consistently_above(self, filename: str, threshold: float) -> bool:
        """True if file has been above threshold for all recent checks."""
        if len(self.history) < self.window:
            return False
        return all(h.get(filename, 0) > threshold for h in self.history[-self.window:])


# ─── Four-gate drift evaluation ───────────────────────────────────────────────

def evaluate_drift(
    scored: list,
    total: int,
    hunk_data: dict,
    trend: TrendTracker,
    task: str,
    scope_files: list[str],
    threshold: float,
    min_lines: int,
    hunk_spread_min: float,
    scope_threshold: float = 30.0,
    hunk_count_min: int = 4,
) -> tuple[bool, str, str]:
    """
    Returns (is_drift: bool, verdict: str, reason: str).
    verdict: 'CLEAN' | 'SCOPE_CREEP' | 'VERTICAL' | 'TRENDING'
    """
    if total < min_lines:
        return False, "CLEAN", f"only {total} lines changed (min {min_lines})"

    if not scored:
        return False, "CLEAN", "no files changed"

    top_name, top_lines, top_pct = scored[0]
    task_words = extract_task_words(task)

    # ── Gate 1: Declared scope ────────────────────────────────────────────────
    if scope_files:
        in_scope  = [(n, l, p) for n, l, p in scored if scope_match(n, scope_files)]
        out_scope = [(n, l, p) for n, l, p in scored if not scope_match(n, scope_files)]
        in_scope_lines  = sum(l for _, l, _ in in_scope)
        out_scope_lines = sum(l for _, l, _ in out_scope)
        out_pct = 100.0 * out_scope_lines / total if total else 0

        if out_pct > scope_threshold:
            files_list = ", ".join(n for n, _, _ in out_scope[:3])
            return (True, "SCOPE_CREEP",
                    f"{out_pct:.0f}% of changes are outside declared scope "
                    f"({files_list}; threshold {scope_threshold:.0f}%)")

        # Within declared scope — check balance within scope
        if len(in_scope) >= 2:
            top_in = in_scope[0]
            in_total = in_scope_lines or 1
            top_in_pct = 100.0 * top_in[1] / in_total
            if top_in_pct > threshold * 1.5:
                # Still check task alignment and hunk spread before flagging
                if not file_matches_task(top_in[0], task_words):
                    depth = hunk_data.get(top_in[0], {})
                    if depth.get("hunk_spread", 0) < hunk_spread_min:
                        return (True, "VERTICAL",
                                f"within scope: {top_in[0]} has {top_in_pct:.0f}% "
                                f"of in-scope changes with low hunk spread "
                                f"({depth.get('hunk_spread', 0):.1%})")
        return False, "CLEAN", f"changes within declared scope ({out_pct:.0f}% outside)"

    # ── Gate 2: Task alignment ────────────────────────────────────────────────
    if task_words and file_matches_task(top_name, task_words):
        matched_words = [w for w in task_words if w in top_name.lower()]
        # Even aligned files can drift if trending badly AND very dominant
        t_dir, t_rate = trend.trend(top_name)
        if t_dir == "up" and top_pct > threshold * 1.4 and trend.consistently_above(top_name, threshold):
            return (True, "TRENDING",
                    f"task-aligned {top_name} is trending up "
                    f"(+{t_rate:.1f}%/check, now {top_pct:.0f}%) — "
                    f"consistently dominant despite alignment")
        return (False, "CLEAN",
                f"{top_name} matches task keywords {matched_words} "
                f"({top_pct:.0f}% — expected)")

    # ── Gate 3: Intra-file depth ──────────────────────────────────────────────
    if top_pct > threshold:
        depth = hunk_data.get(top_name, {})
        hunk_count  = depth.get("hunk_count", 0)
        hunk_spread = depth.get("hunk_spread", 0.0)

        if hunk_count >= hunk_count_min and hunk_spread >= hunk_spread_min:
            # Many spread hunks = horizontal work within file
            # Still flag if trending badly
            t_dir, t_rate = trend.trend(top_name)
            if t_dir == "up" and trend.consistently_above(top_name, threshold):
                return (True, "TRENDING",
                        f"{top_name}: {hunk_count} hunks spread across file "
                        f"but trending up (+{t_rate:.1f}%/check, {top_pct:.0f}%) — "
                        f"consider spreading to other files")
            return (False, "CLEAN",
                    f"{top_name}: {hunk_count} hunks, spread={hunk_spread:.1%} "
                    f"— horizontal work within file ({top_pct:.0f}%)")

    # ── Gate 4: Trend detection ───────────────────────────────────────────────
    if top_pct <= threshold:
        t_dir, t_rate = trend.trend(top_name)
        if t_dir == "up" and trend.consistently_above(top_name, threshold * 0.7):
            return (True, "TRENDING",
                    f"{top_name} trending up (+{t_rate:.1f}%/check, now {top_pct:.0f}%) "
                    f"— slow vertical drift building")
        return False, "CLEAN", f"top file {top_name} at {top_pct:.0f}% (threshold {threshold:.0f}%)"

    # ── Fallback: raw threshold ───────────────────────────────────────────────
    depth = hunk_data.get(top_name, {})
    return (True, "VERTICAL",
            f"{top_name} has {top_pct:.0f}% of {total} changed lines "
            f"(threshold {threshold:.0f}%, hunks={depth.get('hunk_count',0)}, "
            f"spread={depth.get('hunk_spread',0):.1%})")


# ─── Main loop ────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="Drift Guard v3 — smarter horizontal drift detection")
    p.add_argument("--interval",     type=int,   default=60)
    p.add_argument("--threshold",    type=float, default=50.0,
                   help="Raw %% threshold (last-resort gate, default 50)")
    p.add_argument("--scope",        nargs="+",  default=None,
                   help="Declared focus files (suppresses false positives)")
    p.add_argument("--since",        default=None)
    p.add_argument("--min-lines",    type=int,   default=20)
    p.add_argument("--trend-checks", type=int,   default=3,
                   help="History window for trend detection")
    p.add_argument("--hunk-spread",  type=float, default=0.3,
                   help="Min hunk spread ratio to consider work horizontal")
    p.add_argument("--scope-threshold", type=float, default=30.0,
                   help="%% of changes outside declared scope that triggers SCOPE_CREEP (default 30)")
    p.add_argument("--hunk-count-min",  type=int,   default=4,
                   help="Min hunks required before spread analysis exempts a file (default 4)")
    p.add_argument("--ignore-patterns", nargs="+", default=None,
                   help="Substring patterns to exclude from drift analysis (e.g. logs/ .json)")
    return p.parse_args()


def main():
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT,  signal_handler)

    args = parse_args()

    state = read_state()
    if not state:
        print("ERROR: No session state. Run phantom.py start first.")
        sys.exit(1)

    if not state.get("drift_guard_active"):
        print("ERROR: Not armed. Run phantom.py drift-arm before spawning.")
        sys.exit(1)

    workspace = state.get("workspace_dir", "")
    if not workspace or not os.path.isdir(workspace):
        print("ERROR: workspace_dir not set or missing in session state.")
        print("  Start session with an up-to-date phantom.py.")
        clear_active_flag()
        sys.exit(1)

    task           = state.get("task", "")
    scope_files    = args.scope or state.get("scope_files") or []
    ignore_patterns = args.ignore_patterns or []
    # Prefer session_start_ref (stored at session start) — only checks this session's changes
    since        = args.since or state.get("session_start_ref") or find_since(workspace)
    # Use session state scope_threshold when CLI scope-threshold is at default
    threshold       = args.threshold  # raw file % threshold (not overridden by state)
    scope_threshold = (state.get("scope_threshold", args.scope_threshold)
                       if args.scope_threshold == 30.0 else args.scope_threshold)
    tracker      = TrendTracker(window=args.trend_checks)
    checks       = 0

    print("Drift Guard v4 active")
    print(f"  Workspace:  {workspace}")
    since_src = "cli" if args.since else ("session_start_ref" if state.get("session_start_ref") else "auto")
    print(f"  Threshold:  {args.threshold:.0f}% | Poll: {args.interval}s | Since: {since} ({since_src})")
    print(f"  Hunk spread min: {args.hunk_spread:.0%} | Hunk count min: {args.hunk_count_min}")
    print(f"  Scope threshold: {scope_threshold:.0f}% outside | Trend window: {args.trend_checks} checks")
    if scope_files:
        print(f"  Scope:      {', '.join(scope_files)}")
    else:
        print(f"  Scope:      auto (task alignment + hunk analysis)")
    if ignore_patterns:
        print(f"  Ignore:     {', '.join(ignore_patterns)}")
    print(f"  Task:       {task[:70]}{'...' if len(task) > 70 else ''}")

    while True:
        time.sleep(args.interval)
        checks += 1
        ts = datetime.now().strftime("%H:%M:%S")

        state = read_state()
        if not state:
            print(f"[{ts}] ERROR: State file lost.")
            sys.exit(1)

        if state.get("status") == "complete":
            print(f"[{ts}] Session complete. Drift guard shutting down.")
            clear_active_flag()
            sys.exit(0)

        if not state.get("drift_guard_active"):
            print(f"[{ts}] Disarmed externally. Exiting.")
            sys.exit(0)

        # Gather data
        _files, scored = get_file_scores(workspace, since)
        # Apply ignore patterns — filter out known false-positive paths
        if ignore_patterns:
            scored = [
                (n, l, p) for n, l, p in scored
                if not any(pat in n for pat in ignore_patterns)
            ]
            # Recalculate percentages after filtering
            new_total = sum(l for _, l, _ in scored)
            if new_total > 0:
                scored = [(n, l, 100.0 * l / new_total) for n, l, _ in scored]
                scored.sort(key=lambda x: -x[2])

        total = sum(l for _, l, _ in scored)

        if not scored or total < args.min_lines:
            note = f"only {total} lines" if total > 0 else "no changes yet"
            print(f"[{ts}] Check #{checks} — {note}")
            continue

        hunk_data = count_hunks(workspace, since)
        tracker.update(scored)

        top_name, _top_lines, top_pct = scored[0]

        # Evaluate
        is_drift, verdict, reason = evaluate_drift(
            scored, total, hunk_data, tracker,
            state.get("task", ""),
            scope_files,
            threshold,
            args.min_lines,
            args.hunk_spread,
            scope_threshold=scope_threshold,
            hunk_count_min=args.hunk_count_min,
        )

        # Build a richer per-check summary line with gate context
        scope_note = ""
        if scope_files:
            in_scope = sum(l for n, l, _ in scored if scope_match(n, scope_files))
            out_scope = total - in_scope
            scope_note = f" [scope {in_scope}/{total}L]"
        top_hunk = hunk_data.get(top_name, {})
        hunk_note = f" hunks={top_hunk.get('hunk_count','?')}" if top_hunk else ""
        print(f"[{ts}] Check #{checks} | {total}L | top: {top_name} ({top_pct:.0f}%){hunk_note}{scope_note} | {verdict}: {reason[:60]}")

        if not is_drift:
            continue

        # Verdict-specific action guidance
        action_map = {
            "SCOPE_CREEP": (
                "Changes are drifting outside declared scope.\n"
                "  Option A: Move edits back to scope files.\n"
                "  Option B: Update scope — phantom.py start --scope <files> --force\n"
                "  Then re-arm: phantom.py drift-arm"
            ),
            "VERTICAL": (
                "One file dominates — work is drilling down, not spreading out.\n"
                "  Spread changes across more files before continuing.\n"
                "  Then re-arm: phantom.py drift-arm"
            ),
            "TRENDING": (
                "Slow upward trend detected — vertical drift is building.\n"
                "  Proactive fix: distribute future changes across other files.\n"
                "  Then re-arm: phantom.py drift-arm"
            ),
        }
        action = action_map.get(verdict, "Spread changes, then re-arm: phantom.py drift-arm")

        # Build warning
        warning_lines = [
            f"DRIFT DETECTED [{verdict}] after {checks} check(s):",
            f"  {reason}",
            f"  Since: {since}",
            f"  Top files:",
        ]
        for name, lines, pct in scored[:3]:
            depth = hunk_data.get(name, {})
            hunk_info = f"{depth.get('hunk_count', '?')} hunks, spread={depth.get('hunk_spread', 0):.0%}"
            in_scope_flag = " [in-scope]" if scope_files and scope_match(name, scope_files) else ""
            warning_lines.append(f"    {pct:5.1f}%  {name}  ({hunk_info}){in_scope_flag}")

        warning = "\n".join(warning_lines)

        state["drift_warning"]      = warning
        state["drift_warned_at"]    = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        state["drift_guard_active"] = False
        atomic_write(state)

        print("=" * 54)
        print(warning)
        print("=" * 54)
        print(f"ACTION: {action}")
        sys.exit(1)


if __name__ == "__main__":
    main()
