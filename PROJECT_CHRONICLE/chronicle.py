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
  tag <query> --tags ...  add tags to existing records matching query
  export                  full markdown report organized by session
  status                  quick overview: counts, last session, freshness
  save                    stage all memory/ files with git
  from-phantom [--state]  import ping notes from a PHANTOM session state file
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
    records = _load_decisions(last=None)  # load all, filter before truncating
    # Apply filters
    if args.session:
        records = [r for r in records if r.get("session") == args.session]
    if args.type:
        records = [r for r in records if r.get("type") == args.type]
    if not records:
        print("No decisions recorded yet.")
        return 0
    total = len(records)
    if args.last:
        records = records[:args.last]  # already sorted newest-first by _load_decisions
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
    # Apply session/type filters before text search
    if args.session:
        records = [r for r in records if r.get("session") == args.session]
    if args.type:
        records = [r for r in records if r.get("type") == args.type]
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
    all_records = _load_decisions()
    if not all_records:
        print("No decisions to summarize.")
        return 0

    session_id = args.session_id or datetime.now().strftime("%Y-%m-%d")
    project = args.project or _root().name

    # Session file: only this session's records
    session_records = [r for r in all_records if r.get("session") == session_id]
    # Fall back to all records if session_id matching yields nothing
    # (e.g. session_id not set on records, or first-time use)
    if not session_records:
        session_records = all_records

    s_decisions = [r for r in session_records if r.get("type") == "decision"]
    s_observations = [r for r in session_records if r.get("type") == "observation"]
    s_failures = [r for r in session_records if r.get("type") == "failure"]

    # Build session summary markdown (scoped to this session only)
    lines = [
        f"# Session Summary — {session_id}",
        f"\nProject: {project}",
        f"Generated: {_now_iso()}",
        f"This session: {len(session_records)} records ({len(s_decisions)} decisions, {len(s_observations)} observations, {len(s_failures)} failures)",
    ]

    if s_decisions:
        lines.append("\n## Decisions")
        for r in s_decisions:
            lines.append(f"- [{r['timestamp']}] {r['message']}")

    if s_observations:
        lines.append("\n## Observations")
        for r in s_observations:
            lines.append(f"- [{r['timestamp']}] {r['message']}")

    if s_failures:
        lines.append("\n## Failures / Dead Ends")
        for r in s_failures:
            lines.append(f"- [{r['timestamp']}] {r['message']}")

    session_md = "\n".join(lines) + "\n"
    session_file = _sessions_dir() / f"{session_id}.md"
    session_file.write_text(session_md)
    print(f"Session summary written: {session_file.name}")

    # MEMORY.md: cumulative across all sessions
    all_decisions = [r for r in all_records if r.get("type") == "decision"]
    all_observations = [r for r in all_records if r.get("type") == "observation"]
    all_failures = [r for r in all_records if r.get("type") == "failure"]
    _update_memory(project, all_decisions, all_observations, all_failures, session_id)
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


def cmd_tag(args):
    """Add tags to existing records matching a search query."""
    d = _decisions_dir()
    if not d.exists():
        print("No decisions directory found.")
        return 1

    query = args.query.lower()
    new_tags = args.tags

    files = sorted(d.glob("*.json"))
    matched = []
    for f in files:
        try:
            record = json.loads(f.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if query in record.get("message", "").lower():
            matched.append((f, record))

    if not matched:
        print(f"No records matching '{args.query}'.")
        return 0

    updated = 0
    for f, record in matched:
        existing_tags = set(record.get("tags", []))
        added = [t for t in new_tags if t not in existing_tags]
        if added:
            record["tags"] = sorted(existing_tags | set(new_tags))
            f.write_text(json.dumps(record, indent=2))
            updated += 1
            print(f"  Tagged: {record['message'][:60]}")
            print(f"    tags now: {record['tags']}")
        else:
            print(f"  Already tagged: {record['message'][:60]}")

    print(f"\n{updated} record(s) updated, {len(matched) - updated} already had all tags.")
    return 0


def cmd_export(args):
    """Generate a full markdown report of all decisions, organized by session."""
    all_records = _load_decisions()
    sessions_dir = _sessions_dir()

    project = args.project or _root().name
    now = _now_iso()

    if not all_records and not (sessions_dir.exists() and any(sessions_dir.glob("*.md"))):
        print("No records to export.")
        return 0

    # Group records by session
    by_session = {}
    for r in all_records:
        sid = r.get("session", "unknown")
        by_session.setdefault(sid, []).append(r)

    lines = [
        f"# CHRONICLE Export — {project}",
        f"\nGenerated: {now}",
        f"Total records: {len(all_records)} across {len(by_session)} session(s)",
    ]

    # Sort sessions chronologically (by earliest record timestamp)
    def session_start(sid):
        recs = by_session[sid]
        return min(r.get("timestamp", "0") for r in recs)

    for sid in sorted(by_session.keys(), key=session_start):
        recs = sorted(by_session[sid], key=lambda r: r.get("timestamp", ""))
        decisions = [r for r in recs if r.get("type") == "decision"]
        observations = [r for r in recs if r.get("type") == "observation"]
        failures = [r for r in recs if r.get("type") == "failure"]

        lines.append(f"\n---\n\n## Session: {sid}")
        lines.append(f"Records: {len(recs)} ({len(decisions)}d / {len(observations)}o / {len(failures)}f)")

        if decisions:
            lines.append("\n### Decisions")
            for r in decisions:
                ts = r.get("timestamp", "")[:10]
                tags = r.get("tags", [])
                tag_str = f" `{'` `'.join(tags)}`" if tags else ""
                lines.append(f"- [{ts}]{tag_str} {r['message']}")

        if observations:
            lines.append("\n### Observations")
            for r in observations:
                ts = r.get("timestamp", "")[:10]
                lines.append(f"- [{ts}] {r['message']}")

        if failures:
            lines.append("\n### Failures / Dead Ends")
            for r in failures:
                ts = r.get("timestamp", "")[:10]
                lines.append(f"- [{ts}] {r['message']}")

    report = "\n".join(lines) + "\n"

    if args.output:
        Path(args.output).write_text(report)
        print(f"Exported to: {args.output}")
    else:
        print(report)

    return 0


def cmd_status(args):
    """Quick overview: record counts, last session, MEMORY.md freshness."""
    total = len(list(_decisions_dir().glob("*.json"))) if _decisions_dir().exists() else 0
    sessions = sorted(_sessions_dir().glob("*.md")) if _sessions_dir().exists() else []
    mf = _memory_file()

    records = _load_decisions()
    by_type = {}
    for r in records:
        t = r.get("type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1

    print("CHRONICLE STATUS")
    print("=" * 40)
    print(f"  Records:   {total} total", end="")
    if by_type:
        breakdown = ", ".join(f"{v} {k}" for k, v in sorted(by_type.items()))
        print(f"  ({breakdown})", end="")
    print()
    print(f"  Sessions:  {len(sessions)}")
    if sessions:
        print(f"  Last session: {sessions[-1].name}")
    print(f"  MEMORY.md: {'exists' if mf.exists() else 'not initialized'}")
    if mf.exists():
        import stat
        mtime = datetime.fromtimestamp(mf.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        print(f"  Updated:   {mtime}")
    print(f"  Root:      {_root()}")
    return 0


def cmd_save(args):
    """Stage all memory/ files with git (new and modified) so nothing appears as untracked or dirty."""
    mem = _memory_dir()
    if not mem.exists():
        print("No memory/ directory found. Run 'init' first.")
        return 1

    import subprocess

    # Check for untracked files in memory/
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", str(mem)],
        capture_output=True, text=True, cwd=_root()
    )
    new_files = [l for l in untracked.stdout.strip().splitlines() if l]

    # Check for modified tracked files in memory/
    modified = subprocess.run(
        ["git", "ls-files", "--modified", str(mem)],
        capture_output=True, text=True, cwd=_root()
    )
    mod_files = [l for l in modified.stdout.strip().splitlines() if l]

    to_stage = new_files + mod_files
    if not to_stage:
        print("Nothing new to stage in memory/.")
        return 0

    result = subprocess.run(
        ["git", "add", str(mem)],
        capture_output=True, text=True, cwd=_root()
    )
    if result.returncode != 0:
        print(f"git add failed: {result.stderr.strip()}")
        return 1

    if new_files:
        print(f"Staged {len(new_files)} new file(s):")
        for f in new_files:
            print(f"  + {f}")
    if mod_files:
        print(f"Staged {len(mod_files)} modified file(s):")
        for f in mod_files:
            print(f"  M {f}")
    return 0


def cmd_from_phantom(args):
    """Import ping notes from a PHANTOM session state file as CHRONICLE observations."""
    _ensure_dirs()

    state_path = args.state
    if not state_path:
        # Try common default locations
        candidates = [
            Path("/tmp/phantom_session.json"),
            Path.home() / ".phantom_session.json",
            Path("logs/last_session_state.json"),
        ]
        for c in candidates:
            if c.exists():
                state_path = str(c)
                break

    if not state_path:
        print("No PHANTOM state file found. Use --state <path>.")
        return 1

    try:
        state = json.loads(Path(state_path).read_text())
    except (json.JSONDecodeError, OSError) as e:
        print(f"Could not read state file: {e}")
        return 1

    ping_log = state.get("ping_log", [])
    if not ping_log:
        print("No ping log entries found in state.")
        return 0

    session_id = state.get("started", "unknown")[:10]  # date portion
    task = state.get("task", "unknown task")
    imported = 0
    skipped = 0

    # Track already-imported messages to avoid duplicates on re-run
    existing = {r.get("message", "") for r in _load_decisions()}

    print(f"Importing from PHANTOM session: {task}")
    print(f"  State file: {state_path}")
    print(f"  Ping entries: {len(ping_log)}")

    for entry in ping_log:
        note = entry.get("note", "").strip()
        if not note or note in existing:
            skipped += 1
            continue

        ts_raw = entry.get("timestamp", _now_iso())
        # Normalize timestamp format
        ts = ts_raw.replace(" ", "T")[:19]

        slug = _slug(note)
        file_ts = ts_raw.replace(" ", "_").replace(":", "-")[:19]
        record = {
            "id": f"{ts}_{slug}",
            "timestamp": ts,
            "session": session_id,
            "type": "observation",
            "message": note,
            "tags": ["phantom-import"],
        }
        fname = _decisions_dir() / f"{file_ts}_{slug}.json"
        # Avoid collision if file already exists
        if fname.exists():
            fname = _decisions_dir() / f"{file_ts}_{slug}_{imported}.json"
        fname.write_text(json.dumps(record, indent=2))
        existing.add(note)
        imported += 1
        print(f"  [observation] {note[:70]}")

    print(f"\nImported: {imported} | Skipped (duplicates/empty): {skipped}")
    return 0


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
    p_hist.add_argument("--session", help="Filter to a specific session ID")
    p_hist.add_argument("--type", choices=["decision", "observation", "failure"],
                        help="Filter to a specific record type")

    # search
    p_search = sub.add_parser("search", help="Search decisions by keyword")
    p_search.add_argument("query", help="Search term")
    p_search.add_argument("--session", help="Limit search to a specific session ID")
    p_search.add_argument("--type", choices=["decision", "observation", "failure"],
                          help="Limit search to a specific record type")

    # context
    sub.add_parser("context", help="Print MEMORY.md for session startup injection")

    # summarize
    p_sum = sub.add_parser("summarize", help="Update MEMORY.md with session learnings")
    p_sum.add_argument("--session-id", help="Session identifier (default: today's date)")
    p_sum.add_argument("--project", help="Project name")

    # tag
    p_tag = sub.add_parser("tag", help="Add tags to existing records matching a search query")
    p_tag.add_argument("query", help="Search term to find records to tag")
    p_tag.add_argument("--tags", nargs="+", required=True, help="Tags to add")

    # export
    p_export = sub.add_parser("export", help="Generate full markdown report organized by session")
    p_export.add_argument("--project", help="Project name")
    p_export.add_argument("--output", help="Write to file instead of stdout")

    # status
    sub.add_parser("status", help="Quick overview: record counts, last session, memory freshness")

    # save
    sub.add_parser("save", help="Stage all memory/ files with git (prevents untracked file noise)")

    # from-phantom
    p_fp = sub.add_parser("from-phantom", help="Import ping notes from a PHANTOM session state file")
    p_fp.add_argument("--state", help="Path to phantom session state JSON (auto-detected if omitted)")

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
    elif args.command == "tag":
        sys.exit(cmd_tag(args))
    elif args.command == "export":
        sys.exit(cmd_export(args))
    elif args.command == "status":
        sys.exit(cmd_status(args))
    elif args.command == "save":
        sys.exit(cmd_save(args))
    elif args.command == "from-phantom":
        sys.exit(cmd_from_phantom(args))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
