#!/usr/bin/env python3
"""
CHRONICLE — living project memory + decision audit trail for Claude sessions.

Commands:
  log <message>           record a decision, observation, or failure
  summarize               end-of-session: update MEMORY.md with key learnings
  context                 print current MEMORY.md for session startup injection
  history [--last N]      show recent decision records
  search <query>          find decisions by keyword
  init [--project NAME]   initialize memory/ structure for this project
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path


# ── Paths ──────────────────────────────────────────────────────────────────────

def _root() -> Path:
    """Chronicle root: directory containing chronicle.py."""
    return Path(__file__).parent


def _memory_dir() -> Path:
    return _root() / "memory"


def _decisions_dir() -> Path:
    return _memory_dir() / "decisions"


def _sessions_dir() -> Path:
    return _memory_dir() / "sessions"


def _memory_file() -> Path:
    return _memory_dir() / "MEMORY.md"


def _ensure_dirs():
    _decisions_dir().mkdir(parents=True, exist_ok=True)
    _sessions_dir().mkdir(parents=True, exist_ok=True)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _slug(text: str, max_len: int = 40) -> str:
    """Convert text to a filename-safe slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:max_len]


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _now_file() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S_%f")


def _load_decisions(last: int = None) -> list:
    d = _decisions_dir()
    if not d.exists():
        return []
    files = sorted(d.glob("*.json"), reverse=True)
    if last is not None:
        files = files[:last]
    records = []
    for f in files:
        try:
            records.append(json.loads(f.read_text()))
        except (json.JSONDecodeError, OSError):
            pass
    return records


# ── Commands ───────────────────────────────────────────────────────────────────

def cmd_init(args):
    _ensure_dirs()
    mf = _memory_file()
    if mf.exists() and not args.force:
        print(f"MEMORY.md already exists. Use --force to reinitialize.")
        return 0

    project = args.project or _root().name
    mf.write_text(f"""# Project Memory — {project}

Last updated: {_now_iso()}

## What This Project Is

*Not yet summarized. Run `chronicle.py summarize` at end of first session.*

## Key Decisions

*No decisions recorded yet.*

## What Has Been Tried / Failed

*No failures recorded yet.*

## What We Know About Key Files

*No file knowledge recorded yet.*

## Current State

*No session summaries yet.*
""")
    print(f"Initialized: {mf}")
    print(f"  decisions/ : {_decisions_dir()}")
    print(f"  sessions/  : {_sessions_dir()}")
    return 0


def cmd_log(args):
    _ensure_dirs()
    ts = _now_iso()
    file_ts = _now_file()
    slug = _slug(args.message)
    record = {
        "id": f"{ts}_{slug}",
        "timestamp": ts,
        "session": args.session or os.environ.get("PHANTOM_SESSION", "unknown"),
        "type": args.type,
        "message": args.message,
        "tags": args.tags or [],
    }
    fname = _decisions_dir() / f"{file_ts}_{slug}.json"
    fname.write_text(json.dumps(record, indent=2))
    print(f"[{record['type']}] {record['message']}")
    print(f"  saved: {fname.name}")
    return 0


def cmd_history(args):
    records = _load_decisions(last=args.last)
    if not records:
        print("No decisions recorded yet.")
        return 0
    total = len(list(_decisions_dir().glob("*.json"))) if _decisions_dir().exists() else 0
    shown = len(records)
    if args.last and total > shown:
        print(f"Showing last {shown} of {total} decisions\n")
    for r in reversed(records):
        ts = r.get("timestamp", "?")
        rtype = r.get("type", "?")
        msg = r.get("message", "")
        tags = r.get("tags", [])
        tag_str = f"  [{', '.join(tags)}]" if tags else ""
        print(f"{ts}  [{rtype}]{tag_str}")
        print(f"  {msg}")
    return 0


def cmd_search(args):
    records = _load_decisions()
    query = args.query.lower()
    matches = [
        r for r in records
        if query in r.get("message", "").lower()
        or query in r.get("type", "").lower()
        or any(query in t.lower() for t in r.get("tags", []))
    ]
    if not matches:
        print(f"No decisions matching '{args.query}'.")
        return 0
    print(f"{len(matches)} match(es) for '{args.query}':\n")
    for r in reversed(matches):
        ts = r.get("timestamp", "?")
        rtype = r.get("type", "?")
        msg = r.get("message", "")
        print(f"{ts}  [{rtype}]")
        print(f"  {msg}")
    return 0


def cmd_context(args):
    mf = _memory_file()
    if not mf.exists():
        print("No MEMORY.md found. Run `chronicle.py init` first.")
        return 1
    print(mf.read_text())
    return 0


def cmd_summarize(args):
    _ensure_dirs()
    records = _load_decisions()
    if not records:
        print("No decisions to summarize.")
        return 0

    session_id = args.session_id or datetime.now().strftime("%Y-%m-%d")
    project = args.project or _root().name

    # Partition by type
    decisions = [r for r in records if r.get("type") == "decision"]
    observations = [r for r in records if r.get("type") == "observation"]
    failures = [r for r in records if r.get("type") == "failure"]

    # Build session summary markdown
    lines = [
        f"# Session Summary — {session_id}",
        f"\nProject: {project}",
        f"Generated: {_now_iso()}",
        f"Total records: {len(records)} ({len(decisions)} decisions, {len(observations)} observations, {len(failures)} failures)",
    ]

    if decisions:
        lines.append("\n## Decisions")
        for r in decisions:
            lines.append(f"- [{r['timestamp']}] {r['message']}")

    if observations:
        lines.append("\n## Observations")
        for r in observations:
            lines.append(f"- [{r['timestamp']}] {r['message']}")

    if failures:
        lines.append("\n## Failures / Dead Ends")
        for r in failures:
            lines.append(f"- [{r['timestamp']}] {r['message']}")

    session_md = "\n".join(lines) + "\n"
    session_file = _sessions_dir() / f"{session_id}.md"
    session_file.write_text(session_md)
    print(f"Session summary written: {session_file.name}")

    # Update MEMORY.md
    _update_memory(project, decisions, observations, failures, session_id)
    print(f"MEMORY.md updated.")
    return 0


def _update_memory(project, decisions, observations, failures, session_id):
    mf = _memory_file()
    now = _now_iso()

    # Load all-time records for cumulative sections
    all_records = _load_decisions()
    all_decisions = [r for r in all_records if r.get("type") == "decision"]
    all_failures = [r for r in all_records if r.get("type") == "failure"]
    all_obs = [r for r in all_records if r.get("type") == "observation"]

    # Key decisions: deduplicate by message, keep most recent
    seen = set()
    unique_decisions = []
    for r in all_decisions:
        msg = r.get("message", "")
        if msg not in seen:
            seen.add(msg)
            unique_decisions.append(r)

    # File observations: find observations mentioning file names
    file_obs = [r for r in all_obs if re.search(r'\bfile\b|\b\w+\.py\b|\b\w+\.md\b', r.get("message", ""), re.I)]

    # Current state: last session summary
    sessions = sorted(_sessions_dir().glob("*.md"), reverse=True)
    current_state = f"Last session: {session_id} ({len(decisions)} decisions, {len(failures)} failures)"

    sections = [
        f"# Project Memory — {project}",
        f"\nLast updated: {now} (session {session_id})",
        "\n## What This Project Is",
        "\nCHRONICLE — persistent living memory + decision audit trail for Claude sessions.",
        "Auto-updated at end of each session by `chronicle.py summarize`.",
        "\n## Key Decisions",
    ]

    if unique_decisions:
        for r in unique_decisions[-20:]:  # keep last 20 unique decisions
            sections.append(f"- [{r['timestamp'][:10]}] {r['message']}")
    else:
        sections.append("*No decisions recorded yet.*")

    sections.append("\n## What Has Been Tried / Failed")
    if all_failures:
        for r in all_failures[-10:]:
            sections.append(f"- [{r['timestamp'][:10]}] {r['message']}")
    else:
        sections.append("*No failures recorded yet.*")

    sections.append("\n## What We Know About Key Files")
    if file_obs:
        for r in file_obs[-10:]:
            sections.append(f"- [{r['timestamp'][:10]}] {r['message']}")
    else:
        sections.append("*No file knowledge recorded yet.*")

    sections.append("\n## Current State")
    sections.append(f"\n{current_state}")
    sections.append(f"Sessions recorded: {len(sessions)}")

    mf.write_text("\n".join(sections) + "\n")


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="CHRONICLE — project memory + audit trail")
    sub = parser.add_subparsers(dest="command")

    # init
    p_init = sub.add_parser("init", help="Initialize memory/ structure")
    p_init.add_argument("--project", help="Project name (default: parent folder name)")
    p_init.add_argument("--force", action="store_true", help="Reinitialize even if MEMORY.md exists")

    # log
    p_log = sub.add_parser("log", help="Record a decision, observation, or failure")
    p_log.add_argument("message", help="What to record")
    p_log.add_argument("--type", choices=["decision", "observation", "failure"], default="decision")
    p_log.add_argument("--session", help="Session ID (default: $PHANTOM_SESSION or 'unknown')")
    p_log.add_argument("--tags", nargs="+", help="Optional tags")

    # history
    p_hist = sub.add_parser("history", help="Show recent decisions")
    p_hist.add_argument("--last", type=int, help="Show only last N entries")

    # search
    p_search = sub.add_parser("search", help="Search decisions by keyword")
    p_search.add_argument("query", help="Search term")

    # context
    sub.add_parser("context", help="Print MEMORY.md for session startup injection")

    # summarize
    p_sum = sub.add_parser("summarize", help="Update MEMORY.md with session learnings")
    p_sum.add_argument("--session-id", help="Session identifier (default: today's date)")
    p_sum.add_argument("--project", help="Project name")

    args = parser.parse_args()

    if args.command == "init":
        sys.exit(cmd_init(args))
    elif args.command == "log":
        sys.exit(cmd_log(args))
    elif args.command == "history":
        sys.exit(cmd_history(args))
    elif args.command == "search":
        sys.exit(cmd_search(args))
    elif args.command == "context":
        sys.exit(cmd_context(args))
    elif args.command == "summarize":
        sys.exit(cmd_summarize(args))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
