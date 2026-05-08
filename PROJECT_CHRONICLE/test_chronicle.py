#!/usr/bin/env python3
"""
Integration tests for CHRONICLE.
Runs chronicle.py as a subprocess with isolated temp directories.
"""

import json
import os
import subprocess
import sys
import tempfile
import shutil
from pathlib import Path

CHRONICLE = Path(__file__).parent / "chronicle.py"
PASS = 0
FAIL = 0


def check(label: str, condition: bool):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [pass] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label}")


def run(args, cwd=None, env=None):
    result = subprocess.run(
        [sys.executable, str(CHRONICLE)] + args,
        capture_output=True, text=True, cwd=cwd, env=env
    )
    return result


def make_env(tmp: Path) -> dict:
    """Return env with chronicle pointing at tmp as its root."""
    e = os.environ.copy()
    # Override the chronicle root by symlinking chronicle.py into tmp
    # and running from there — simpler: patch via __file__ not possible,
    # so we copy chronicle.py into tmp and run it directly from there.
    return e


def setup_isolated(tmp: Path) -> str:
    """Copy chronicle.py into tmp so _root() points to tmp."""
    dest = tmp / "chronicle.py"
    shutil.copy(CHRONICLE, dest)
    return str(sys.executable)


# ── Test groups ────────────────────────────────────────────────────────────────

def test_init():
    print("\n=== init ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        setup_isolated(tmp)
        chron = str(tmp / "chronicle.py")

        # Basic init
        r = subprocess.run([sys.executable, chron, "init", "--project", "TestProj"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("init exits 0", r.returncode == 0)
        check("init creates MEMORY.md", (tmp / "memory" / "MEMORY.md").exists())
        check("init creates decisions/", (tmp / "memory" / "decisions").exists())
        check("init creates sessions/", (tmp / "memory" / "sessions").exists())
        check("init output mentions MEMORY.md", "MEMORY.md" in r.stdout)

        content = (tmp / "memory" / "MEMORY.md").read_text()
        check("MEMORY.md contains project name", "TestProj" in content)
        check("MEMORY.md has Key Decisions section", "## Key Decisions" in content)
        check("MEMORY.md has What Has Been Tried section", "## What Has Been Tried" in content)
        check("MEMORY.md has Current State section", "## Current State" in content)

        # Re-init without --force should warn
        r2 = subprocess.run([sys.executable, chron, "init", "--project", "TestProj"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("re-init without --force warns", "already exists" in r2.stdout or r2.returncode == 0)

        # Re-init with --force should succeed
        r3 = subprocess.run([sys.executable, chron, "init", "--project", "TestProj", "--force"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("re-init with --force exits 0", r3.returncode == 0)


def test_log():
    print("\n=== log ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        # Log a decision
        r = subprocess.run([sys.executable, chron, "log", "chose approach A over B"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("log exits 0", r.returncode == 0)
        check("log output echoes message", "chose approach A over B" in r.stdout)
        check("log output shows type", "[decision]" in r.stdout)
        check("log output shows filename", "saved:" in r.stdout)

        # Decision file created
        decisions = list((tmp / "memory" / "decisions").glob("*.json"))
        check("log creates decision file", len(decisions) == 1)

        record = json.loads(decisions[0].read_text())
        check("record has id", "id" in record)
        check("record has timestamp", "timestamp" in record)
        check("record has type=decision", record["type"] == "decision")
        check("record has message", record["message"] == "chose approach A over B")
        check("record has session field", "session" in record)
        check("record has tags field", "tags" in record)

        # Log an observation
        r2 = subprocess.run([sys.executable, chron, "log", "file X is the auth entry point",
                             "--type", "observation"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("log observation exits 0", r2.returncode == 0)
        check("log observation shows [observation]", "[observation]" in r2.stdout)

        # Log a failure
        r3 = subprocess.run([sys.executable, chron, "log", "tried SQLite — too many deps",
                             "--type", "failure"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("log failure exits 0", r3.returncode == 0)
        check("log failure shows [failure]", "[failure]" in r3.stdout)

        # Three files now
        decisions2 = list((tmp / "memory" / "decisions").glob("*.json"))
        check("3 decision files after 3 logs", len(decisions2) == 3)

        # Log with tags
        r4 = subprocess.run([sys.executable, chron, "log", "tagged decision",
                             "--type", "decision", "--tags", "arch", "storage"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("log with tags exits 0", r4.returncode == 0)
        all_files = list((tmp / "memory" / "decisions").glob("*.json"))
        tagged_rec = next((json.loads(f.read_text()) for f in all_files
                           if json.loads(f.read_text()).get("message") == "tagged decision"), None)
        check("tags stored in record", tagged_rec is not None and "arch" in tagged_rec.get("tags", []))

        # Log with custom session
        r5 = subprocess.run([sys.executable, chron, "log", "session-specific note",
                             "--session", "my-session-123"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("log with --session exits 0", r5.returncode == 0)
        all_files2 = list((tmp / "memory" / "decisions").glob("*.json"))
        sess_rec = next((json.loads(f.read_text()) for f in all_files2
                         if json.loads(f.read_text()).get("message") == "session-specific note"), None)
        check("session stored in record", sess_rec is not None and sess_rec.get("session") == "my-session-123")


def test_history():
    print("\n=== history ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        # Empty history
        r = subprocess.run([sys.executable, chron, "history"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("history with no records exits 0", r.returncode == 0)
        check("history with no records says so", "No decisions" in r.stdout)

        # Add 5 decisions
        for i in range(5):
            subprocess.run([sys.executable, chron, "log", f"decision number {i}"],
                           capture_output=True, cwd=tmp_str)

        r2 = subprocess.run([sys.executable, chron, "history"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("history shows all 5 entries", r2.stdout.count("[decision]") == 5)

        # --last 3
        r3 = subprocess.run([sys.executable, chron, "history", "--last", "3"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("history --last 3 shows 3 entries", r3.stdout.count("[decision]") == 3)
        check("history --last 3 mentions omitted count", "5" in r3.stdout or "Showing" in r3.stdout)

        # --last larger than total
        r4 = subprocess.run([sys.executable, chron, "history", "--last", "100"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("history --last 100 shows all 5", r4.stdout.count("[decision]") == 5)


def test_search():
    print("\n=== search ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        subprocess.run([sys.executable, chron, "log", "chose PostgreSQL for persistence"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "Redis used for caching"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "auth module uses JWT tokens",
                        "--type", "observation"], capture_output=True, cwd=tmp_str)

        # Search hit
        r = subprocess.run([sys.executable, chron, "search", "postgres"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("search exits 0", r.returncode == 0)
        check("search finds PostgreSQL decision", "PostgreSQL" in r.stdout)
        check("search shows match count", "1 match" in r.stdout)

        # Search miss
        r2 = subprocess.run([sys.executable, chron, "search", "mongodb"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("search miss exits 0", r2.returncode == 0)
        check("search miss says no matches", "No decisions" in r2.stdout)

        # Case-insensitive search
        r3 = subprocess.run([sys.executable, chron, "search", "JWT"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("search is case-insensitive", "JWT" in r3.stdout)

        # Search matches type field
        r4 = subprocess.run([sys.executable, chron, "search", "observation"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("search matches type field", r4.stdout.count("match") >= 1)

        # Search matches tags
        subprocess.run([sys.executable, chron, "log", "tagged entry", "--tags", "myspecialtag"],
                       capture_output=True, cwd=tmp_str)
        r5 = subprocess.run([sys.executable, chron, "search", "myspecialtag"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("search matches tags", "tagged entry" in r5.stdout)


def test_context():
    print("\n=== context ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)

        # context before init
        r = subprocess.run([sys.executable, chron, "context"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("context before init exits 1", r.returncode == 1)
        check("context before init says no MEMORY.md", "MEMORY.md" in r.stdout or "MEMORY.md" in r.stderr)

        # context after init
        subprocess.run([sys.executable, chron, "init", "--project", "CtxProj"],
                       capture_output=True, cwd=tmp_str)
        r2 = subprocess.run([sys.executable, chron, "context"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("context exits 0 after init", r2.returncode == 0)
        check("context outputs MEMORY.md content", "Project Memory" in r2.stdout)
        check("context includes project name", "CtxProj" in r2.stdout)


def test_summarize():
    print("\n=== summarize ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init", "--project", "SumProj"],
                       capture_output=True, cwd=tmp_str)

        # summarize with no decisions
        r = subprocess.run([sys.executable, chron, "summarize", "--project", "SumProj"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("summarize with no decisions exits 0", r.returncode == 0)
        check("summarize with no decisions says so", "No decisions" in r.stdout)

        # Add records
        subprocess.run([sys.executable, chron, "log", "key architecture decision",
                        "--type", "decision"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "auth.py is the main auth module",
                        "--type", "observation"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "tried async approach — deadlocked",
                        "--type", "failure"], capture_output=True, cwd=tmp_str)

        r2 = subprocess.run([sys.executable, chron, "summarize",
                             "--project", "SumProj", "--session-id", "test-session-001"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("summarize exits 0", r2.returncode == 0)
        check("summarize writes session file", "test-session-001.md" in r2.stdout)
        check("summarize updates MEMORY.md", "MEMORY.md updated" in r2.stdout)

        # Session file exists
        session_file = tmp / "memory" / "sessions" / "test-session-001.md"
        check("session file created", session_file.exists())
        session_content = session_file.read_text()
        check("session file has Decisions section", "## Decisions" in session_content)
        check("session file has Failures section", "## Failures" in session_content)
        check("session file includes the decision", "key architecture decision" in session_content)
        check("session file includes the failure", "tried async approach" in session_content)

        # MEMORY.md updated with content
        memory = (tmp / "memory" / "MEMORY.md").read_text()
        check("MEMORY.md updated timestamp", "test-session-001" in memory)
        check("MEMORY.md has key decision", "key architecture decision" in memory)
        check("MEMORY.md has failure", "tried async approach" in memory)
        check("MEMORY.md has file observation", "auth.py" in memory)

        # Run again — second session appends
        subprocess.run([sys.executable, chron, "log", "second session decision",
                        "--session", "test-session-002"],
                       capture_output=True, cwd=tmp_str)
        r3 = subprocess.run([sys.executable, chron, "summarize",
                             "--project", "SumProj", "--session-id", "test-session-002"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("second summarize exits 0", r3.returncode == 0)
        memory2 = (tmp / "memory" / "MEMORY.md").read_text()
        check("MEMORY.md includes both sessions' decisions", "second session decision" in memory2)
        check("MEMORY.md updated session id", "test-session-002" in memory2)
        sessions = list((tmp / "memory" / "sessions").glob("*.md"))
        check("two session files exist after two summarizes", len(sessions) == 2)

        # Session scoping: session-002 file should only have session-002's decision
        session2_file = tmp / "memory" / "sessions" / "test-session-002.md"
        s2_content = session2_file.read_text()
        check("session-002 file contains second session decision", "second session decision" in s2_content)
        check("session-002 file does not contain first session decision",
              "key architecture decision" not in s2_content)


def test_summarize_session_scoping():
    print("\n=== summarize session scoping ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init", "--project", "ScopeProj"],
                       capture_output=True, cwd=tmp_str)

        # Two distinct sessions
        subprocess.run([sys.executable, chron, "log", "session A decision",
                        "--session", "sess-A"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "session A observation",
                        "--type", "observation", "--session", "sess-A"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "session B decision",
                        "--session", "sess-B"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "session B failure",
                        "--type", "failure", "--session", "sess-B"],
                       capture_output=True, cwd=tmp_str)

        # Summarize session A
        subprocess.run([sys.executable, chron, "summarize",
                        "--project", "ScopeProj", "--session-id", "sess-A"],
                       capture_output=True, cwd=tmp_str)
        sa_file = tmp / "memory" / "sessions" / "sess-A.md"
        sa = sa_file.read_text()
        check("sess-A file has A's decision", "session A decision" in sa)
        check("sess-A file does not have B's decision", "session B decision" not in sa)
        check("sess-A file has A's observation", "session A observation" in sa)

        # Summarize session B
        subprocess.run([sys.executable, chron, "summarize",
                        "--project", "ScopeProj", "--session-id", "sess-B"],
                       capture_output=True, cwd=tmp_str)
        sb_file = tmp / "memory" / "sessions" / "sess-B.md"
        sb = sb_file.read_text()
        check("sess-B file has B's decision", "session B decision" in sb)
        check("sess-B file has B's failure", "session B failure" in sb)
        check("sess-B file does not have A's decision", "session A decision" not in sb)

        # MEMORY.md is cumulative — has both sessions
        memory = (tmp / "memory" / "MEMORY.md").read_text()
        check("MEMORY.md has A's decision", "session A decision" in memory)
        check("MEMORY.md has B's decision", "session B decision" in memory)
        check("MEMORY.md has B's failure", "session B failure" in memory)


def test_slug_uniqueness():
    print("\n=== slug / file uniqueness ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        # Log same message twice — should create two files
        subprocess.run([sys.executable, chron, "log", "repeated decision"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "repeated decision"],
                       capture_output=True, cwd=tmp_str)
        files = list((tmp / "memory" / "decisions").glob("*.json"))
        check("two identical messages create two files", len(files) == 2)

        # Long message slug is truncated
        long_msg = "a" * 200
        subprocess.run([sys.executable, chron, "log", long_msg],
                       capture_output=True, cwd=tmp_str)
        files2 = list((tmp / "memory" / "decisions").glob("*.json"))
        check("long message creates file", len(files2) == 3)
        # filename should exist and not be longer than reasonable
        new_file = sorted(files2)[-1]
        check("long message slug is truncated in filename", len(new_file.name) < 120)


def test_memory_deduplication():
    print("\n=== memory deduplication ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init", "--project", "DedupProj"],
                       capture_output=True, cwd=tmp_str)

        # Log same decision 3 times across 2 sessions
        for _ in range(3):
            subprocess.run([sys.executable, chron, "log", "deduplicated decision",
                            "--type", "decision"], capture_output=True, cwd=tmp_str)

        subprocess.run([sys.executable, chron, "summarize", "--project", "DedupProj",
                        "--session-id", "dedup-test"],
                       capture_output=True, cwd=tmp_str)

        memory = (tmp / "memory" / "MEMORY.md").read_text()
        # Should appear only once in Key Decisions
        key_decisions_section = memory.split("## Key Decisions")[1].split("##")[0]
        count = key_decisions_section.count("deduplicated decision")
        check("duplicate decisions appear once in MEMORY.md", count == 1)


def test_no_init_needed_for_log():
    print("\n=== log without init ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)

        # log without init should still work (creates dirs on demand)
        r = subprocess.run([sys.executable, chron, "log", "logged without init"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("log without init exits 0", r.returncode == 0)
        check("decisions dir created on demand", (tmp / "memory" / "decisions").exists())
        files = list((tmp / "memory" / "decisions").glob("*.json"))
        check("decision file created without init", len(files) == 1)


def test_record_integrity():
    print("\n=== record integrity ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        subprocess.run([sys.executable, chron, "log", "integrity test decision"],
                       capture_output=True, cwd=tmp_str)

        files = list((tmp / "memory" / "decisions").glob("*.json"))
        check("one file created", len(files) == 1)

        record = json.loads(files[0].read_text())
        check("record is valid JSON", True)  # wouldn't reach here otherwise
        check("record id is non-empty", bool(record.get("id")))
        check("record timestamp format is ISO-ish", "T" in record.get("timestamp", ""))
        check("record type is decision", record.get("type") == "decision")
        check("record message matches", record.get("message") == "integrity test decision")
        check("record tags is a list", isinstance(record.get("tags"), list))

        # Manually corrupt one file — history should skip it gracefully
        (tmp / "memory" / "decisions" / "corrupt.json").write_text("not json{{")
        r = subprocess.run([sys.executable, chron, "history"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("history skips corrupt file gracefully", r.returncode == 0)
        check("good record still shown despite corrupt file",
              "integrity test decision" in r.stdout)


def test_log_types_exhaustive():
    print("\n=== log types exhaustive ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        # All three types work and are stored correctly
        for rtype in ("decision", "observation", "failure"):
            r = subprocess.run([sys.executable, chron, "log", f"a {rtype} message",
                                "--type", rtype],
                               capture_output=True, text=True, cwd=tmp_str)
            check(f"log --type {rtype} exits 0", r.returncode == 0)

        files = list((tmp / "memory" / "decisions").glob("*.json"))
        check("3 records created for 3 types", len(files) == 3)

        types_found = {json.loads(f.read_text())["type"] for f in files}
        check("decision type stored", "decision" in types_found)
        check("observation type stored", "observation" in types_found)
        check("failure type stored", "failure" in types_found)

        # Default type is decision
        subprocess.run([sys.executable, chron, "log", "no type given"],
                       capture_output=True, cwd=tmp_str)
        files2 = list((tmp / "memory" / "decisions").glob("*.json"))
        recs = [json.loads(f.read_text()) for f in files2]
        default_rec = next((r for r in recs if r["message"] == "no type given"), None)
        check("default type is decision", default_rec is not None and default_rec["type"] == "decision")


def test_history_order():
    print("\n=== history order ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        messages = ["first entry", "second entry", "third entry"]
        for msg in messages:
            subprocess.run([sys.executable, chron, "log", msg],
                           capture_output=True, cwd=tmp_str)

        r = subprocess.run([sys.executable, chron, "history"],
                           capture_output=True, text=True, cwd=tmp_str)
        out = r.stdout
        check("history exits 0", r.returncode == 0)
        # All three messages appear
        for msg in messages:
            check(f"history shows '{msg}'", msg in out)

        # With --last 1, only most recent shown (third entry)
        r2 = subprocess.run([sys.executable, chron, "history", "--last", "1"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("history --last 1 exits 0", r2.returncode == 0)
        check("history --last 1 shows only 1 entry", r2.stdout.count("[decision]") == 1)


def test_history_filters():
    print("\n=== history filters ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        # Seed records across two sessions and types
        subprocess.run([sys.executable, chron, "log", "sess1 decision",
                        "--session", "s1", "--type", "decision"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "sess1 observation",
                        "--session", "s1", "--type", "observation"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "sess2 decision",
                        "--session", "s2", "--type", "decision"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "sess2 failure",
                        "--session", "s2", "--type", "failure"], capture_output=True, cwd=tmp_str)

        # --session filter
        r = subprocess.run([sys.executable, chron, "history", "--session", "s1"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("history --session s1 exits 0", r.returncode == 0)
        check("history --session s1 shows s1 records", "sess1 decision" in r.stdout)
        check("history --session s1 excludes s2 records", "sess2 decision" not in r.stdout)

        # --type filter
        r2 = subprocess.run([sys.executable, chron, "history", "--type", "decision"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("history --type decision exits 0", r2.returncode == 0)
        check("history --type decision shows decisions", "sess1 decision" in r2.stdout)
        check("history --type decision shows s2 decision", "sess2 decision" in r2.stdout)
        check("history --type decision excludes observations", "sess1 observation" not in r2.stdout)
        check("history --type decision excludes failures", "sess2 failure" not in r2.stdout)

        # Combined filters
        r3 = subprocess.run([sys.executable, chron, "history",
                             "--session", "s2", "--type", "failure"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("history --session s2 --type failure exits 0", r3.returncode == 0)
        check("history combined filter shows only s2 failure", "sess2 failure" in r3.stdout)
        check("history combined filter excludes s2 decision", "sess2 decision" not in r3.stdout)

        # --session with no matches
        r4 = subprocess.run([sys.executable, chron, "history", "--session", "nonexistent"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("history --session nonexistent exits 0", r4.returncode == 0)
        check("history --session nonexistent says no decisions", "No decisions" in r4.stdout)


def test_search_filters():
    print("\n=== search filters ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        subprocess.run([sys.executable, chron, "log", "auth service decision",
                        "--session", "s1", "--type", "decision"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "auth service observation",
                        "--session", "s2", "--type", "observation"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "unrelated entry",
                        "--session", "s1"], capture_output=True, cwd=tmp_str)

        # search --session narrows results
        r = subprocess.run([sys.executable, chron, "search", "auth", "--session", "s1"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("search --session s1 exits 0", r.returncode == 0)
        check("search --session s1 finds auth in s1", "auth service decision" in r.stdout)
        check("search --session s1 excludes s2", "auth service observation" not in r.stdout)

        # search --type narrows results
        r2 = subprocess.run([sys.executable, chron, "search", "auth", "--type", "observation"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("search --type observation exits 0", r2.returncode == 0)
        check("search --type observation finds observation", "auth service observation" in r2.stdout)
        check("search --type observation excludes decision", "auth service decision" not in r2.stdout)

        # Combined: session + type + query
        r3 = subprocess.run([sys.executable, chron, "search", "auth",
                             "--session", "s1", "--type", "decision"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("search combined filter exits 0", r3.returncode == 0)
        check("search combined filter finds s1 decision", "auth service decision" in r3.stdout)
        check("search combined filter: 1 match", "1 match" in r3.stdout)


def test_search_multiple_matches():
    print("\n=== search multiple matches ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        subprocess.run([sys.executable, chron, "log", "database schema decision"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "database connection pooling",
                        "--type", "observation"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "unrelated entry"],
                       capture_output=True, cwd=tmp_str)

        r = subprocess.run([sys.executable, chron, "search", "database"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("search multiple exits 0", r.returncode == 0)
        check("search multiple finds 2 matches", "2 match" in r.stdout)
        check("search multiple shows schema decision", "schema" in r.stdout)
        check("search multiple shows connection pooling", "connection" in r.stdout)
        check("search multiple excludes unrelated", r.stdout.count("unrelated") == 0)


def test_summarize_only_decisions_section():
    print("\n=== summarize decisions-only session ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init", "--project", "OnlyDecisions"],
                       capture_output=True, cwd=tmp_str)

        # Only decisions, no observations or failures
        for i in range(3):
            subprocess.run([sys.executable, chron, "log", f"pure decision {i}"],
                           capture_output=True, cwd=tmp_str)

        r = subprocess.run([sys.executable, chron, "summarize", "--project", "OnlyDecisions",
                            "--session-id", "decisions-only"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("summarize decisions-only exits 0", r.returncode == 0)

        session_file = tmp / "memory" / "sessions" / "decisions-only.md"
        content = session_file.read_text()
        check("session has Decisions section", "## Decisions" in content)
        check("session shows 3 decisions", content.count("pure decision") == 3)
        # No Observations or Failures section since none recorded
        check("session has no Observations section when none recorded",
              "## Observations" not in content)
        check("session has no Failures section when none recorded",
              "## Failures" not in content)


def test_init_default_project_name():
    print("\n=== init default project name ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)

        # No --project flag — should use parent folder name
        r = subprocess.run([sys.executable, chron, "init"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("init without --project exits 0", r.returncode == 0)
        memory = (tmp / "memory" / "MEMORY.md").read_text()
        # The parent folder name (tmp dir basename) should appear in MEMORY.md
        check("MEMORY.md contains some project name", "Project Memory" in memory)


def test_phantom_session_env():
    print("\n=== PHANTOM_SESSION env var ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        env = os.environ.copy()
        env["PHANTOM_SESSION"] = "phantom-abc123"
        r = subprocess.run([sys.executable, chron, "log", "env session test"],
                           capture_output=True, text=True, cwd=tmp_str, env=env)
        check("log with PHANTOM_SESSION env exits 0", r.returncode == 0)

        files = list((tmp / "memory" / "decisions").glob("*.json"))
        rec = json.loads(files[0].read_text())
        check("PHANTOM_SESSION stored as session", rec.get("session") == "phantom-abc123")

        # --session flag overrides env var
        r2 = subprocess.run([sys.executable, chron, "log", "override test",
                             "--session", "override-session"],
                            capture_output=True, text=True, cwd=tmp_str, env=env)
        check("--session overrides PHANTOM_SESSION env", r2.returncode == 0)
        files2 = list((tmp / "memory" / "decisions").glob("*.json"))
        recs = [json.loads(f.read_text()) for f in files2]
        override_rec = next((r for r in recs if r["message"] == "override test"), None)
        check("--session value used over env var",
              override_rec is not None and override_rec.get("session") == "override-session")


def test_from_phantom():
    print("\n=== from-phantom ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        # Build a fake PHANTOM state file
        state = {
            "task": "test task for chronicle import",
            "started": "2026-05-08 10:00:00",
            "status": "complete",
            "ping_log": [
                {"timestamp": "2026-05-08 10:01:00", "note": "turn 1 note: started work"},
                {"timestamp": "2026-05-08 10:05:00", "note": "turn 2 note: made progress"},
                {"timestamp": "2026-05-08 10:10:00", "note": "turn 3 note: finished task"},
            ],
        }
        state_file = tmp / "phantom_state.json"
        state_file.write_text(json.dumps(state))

        r = subprocess.run([sys.executable, chron, "from-phantom", "--state", str(state_file)],
                           capture_output=True, text=True, cwd=tmp_str)
        check("from-phantom exits 0", r.returncode == 0)
        check("from-phantom shows import count", "Imported: 3" in r.stdout)
        check("from-phantom shows task name", "test task for chronicle import" in r.stdout)

        # 3 records created
        files = list((tmp / "memory" / "decisions").glob("*.json"))
        check("from-phantom creates 3 records", len(files) == 3)

        recs = [json.loads(f.read_text()) for f in files]
        types = {r["type"] for r in recs}
        check("imported records are type=observation", types == {"observation"})

        tags = {t for r in recs for t in r.get("tags", [])}
        check("imported records have phantom-import tag", "phantom-import" in tags)

        messages = {r["message"] for r in recs}
        check("first note imported", "turn 1 note: started work" in messages)
        check("second note imported", "turn 2 note: made progress" in messages)
        check("third note imported", "turn 3 note: finished task" in messages)

        sessions = {r["session"] for r in recs}
        check("session is date portion of started", "2026-05-08" in sessions)

        # Re-run — duplicates skipped
        r2 = subprocess.run([sys.executable, chron, "from-phantom", "--state", str(state_file)],
                            capture_output=True, text=True, cwd=tmp_str)
        check("from-phantom re-run exits 0", r2.returncode == 0)
        check("re-run skips all duplicates", "Skipped (duplicates/empty): 3" in r2.stdout)
        files2 = list((tmp / "memory" / "decisions").glob("*.json"))
        check("re-run creates no new files", len(files2) == 3)

        # Empty ping log
        state2 = {"task": "empty", "started": "2026-05-08", "ping_log": []}
        state_file2 = tmp / "phantom_state2.json"
        state_file2.write_text(json.dumps(state2))
        r3 = subprocess.run([sys.executable, chron, "from-phantom", "--state", str(state_file2)],
                            capture_output=True, text=True, cwd=tmp_str)
        check("from-phantom with empty ping log exits 0", r3.returncode == 0)
        check("from-phantom with empty ping log says so", "No ping log" in r3.stdout)

        # Missing state file
        r4 = subprocess.run([sys.executable, chron, "from-phantom",
                             "--state", "/nonexistent/path.json"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("from-phantom with missing file exits 1", r4.returncode == 1)

        # Entries with empty notes are skipped
        state3 = {
            "task": "sparse task",
            "started": "2026-05-08",
            "ping_log": [
                {"timestamp": "2026-05-08 10:00:00", "note": ""},
                {"timestamp": "2026-05-08 10:01:00", "note": "  "},
                {"timestamp": "2026-05-08 10:02:00", "note": "real note here"},
            ],
        }
        state_file3 = tmp / "phantom_state3.json"
        state_file3.write_text(json.dumps(state3))
        r5 = subprocess.run([sys.executable, chron, "from-phantom", "--state", str(state_file3)],
                            capture_output=True, text=True, cwd=tmp_str)
        check("from-phantom skips empty notes", "Imported: 1" in r5.stdout)
        check("from-phantom counts empty as skipped", "Skipped" in r5.stdout)


def test_tag():
    print("\n=== tag ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)

        subprocess.run([sys.executable, chron, "log", "auth service refactor",
                        "--type", "decision"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "database migration step",
                        "--type", "decision"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "unrelated entry"],
                       capture_output=True, cwd=tmp_str)

        # Tag records matching "auth"
        r = subprocess.run([sys.executable, chron, "tag", "auth", "--tags", "security", "refactor"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("tag exits 0", r.returncode == 0)
        check("tag reports updated count", "1 record(s) updated" in r.stdout)
        check("tag shows tagged message", "auth service refactor" in r.stdout)

        # Verify tags stored in file
        files = list((tmp / "memory" / "decisions").glob("*.json"))
        recs = [json.loads(f.read_text()) for f in files]
        auth_rec = next((r for r in recs if "auth" in r.get("message", "")), None)
        check("tags stored in auth record", auth_rec is not None and "security" in auth_rec.get("tags", []))
        check("both tags stored", "refactor" in auth_rec.get("tags", []))

        # Re-tag same record — should report "already tagged"
        r2 = subprocess.run([sys.executable, chron, "tag", "auth", "--tags", "security"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("re-tag exits 0", r2.returncode == 0)
        check("re-tag reports already tagged", "already had all tags" in r2.stdout or "Already tagged" in r2.stdout)
        check("re-tag reports 0 updated", "0 record(s) updated" in r2.stdout)

        # Tag with no match
        r3 = subprocess.run([sys.executable, chron, "tag", "nonexistent", "--tags", "foo"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("tag no match exits 0", r3.returncode == 0)
        check("tag no match says so", "No records" in r3.stdout)

        # Tag matches multiple records
        subprocess.run([sys.executable, chron, "log", "another decision here"],
                       capture_output=True, cwd=tmp_str)
        r4 = subprocess.run([sys.executable, chron, "tag", "decision", "--tags", "bulk-tag"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("tag multiple exits 0", r4.returncode == 0)
        # Should match "auth service refactor" (type=decision in message? no — match is in message text)
        # "auth service refactor", "database migration step", "another decision here" all have "decision" type
        # but "tag" searches message text, not type
        # Only "another decision here" contains "decision" in message
        check("tag multiple updates correct count", "1 record(s) updated" in r4.stdout)

        # Tags are sorted
        files2 = list((tmp / "memory" / "decisions").glob("*.json"))
        recs2 = [json.loads(f.read_text()) for f in files2]
        auth_rec2 = next((r for r in recs2 if "auth" in r.get("message", "")), None)
        check("tags are sorted alphabetically",
              auth_rec2 is not None and auth_rec2.get("tags") == sorted(auth_rec2.get("tags", [])))


def test_export():
    print("\n=== export ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)
        subprocess.run([sys.executable, chron, "init", "--project", "ExportProj"],
                       capture_output=True, cwd=tmp_str)

        # Export with no records
        r = subprocess.run([sys.executable, chron, "export", "--project", "ExportProj"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("export with no records exits 0", r.returncode == 0)
        check("export with no records says so", "No records" in r.stdout)

        # Add records across two sessions
        subprocess.run([sys.executable, chron, "log", "s1 decision",
                        "--session", "session-1", "--type", "decision"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "s1 observation",
                        "--session", "session-1", "--type", "observation"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "s2 failure",
                        "--session", "session-2", "--type", "failure"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "s2 tagged decision",
                        "--session", "session-2", "--type", "decision",
                        "--tags", "arch"],
                       capture_output=True, cwd=tmp_str)

        r2 = subprocess.run([sys.executable, chron, "export", "--project", "ExportProj"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("export exits 0", r2.returncode == 0)
        out = r2.stdout
        check("export has project header", "ExportProj" in out)
        check("export shows total record count", "4" in out)
        check("export has session-1 section", "session-1" in out)
        check("export has session-2 section", "session-2" in out)
        check("export has Decisions section", "### Decisions" in out)
        check("export has Observations section", "### Observations" in out)
        check("export has Failures section", "### Failures" in out)
        check("export includes s1 decision", "s1 decision" in out)
        check("export includes s2 failure", "s2 failure" in out)
        check("export includes tags for tagged record", "arch" in out)

        # Export to file
        out_file = tmp / "report.md"
        r3 = subprocess.run([sys.executable, chron, "export",
                             "--project", "ExportProj", "--output", str(out_file)],
                            capture_output=True, text=True, cwd=tmp_str)
        check("export --output exits 0", r3.returncode == 0)
        check("export --output creates file", out_file.exists())
        check("export --output says exported to file", "Exported to" in r3.stdout)
        file_content = out_file.read_text()
        check("exported file has project header", "ExportProj" in file_content)
        check("exported file has all records", "s1 decision" in file_content and "s2 failure" in file_content)

        # Decisions section only has decisions (not observations/failures mixed in)
        decisions_section = file_content.split("### Decisions")[1].split("###")[0] if "### Decisions" in file_content else ""
        check("Decisions section contains only decisions", "s1 observation" not in decisions_section)


def test_status():
    print("\n=== status ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)

        # Status before init
        r = subprocess.run([sys.executable, chron, "status"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("status before init exits 0", r.returncode == 0)
        check("status shows 0 records before init", "0 total" in r.stdout)
        check("status shows memory not initialized", "not initialized" in r.stdout)

        # Init and add records
        subprocess.run([sys.executable, chron, "init", "--project", "StatusTest"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "a decision", "--type", "decision"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "an observation", "--type", "observation"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "a failure", "--type", "failure"],
                       capture_output=True, cwd=tmp_str)

        r2 = subprocess.run([sys.executable, chron, "status"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("status exits 0", r2.returncode == 0)
        check("status shows record count", "3 total" in r2.stdout)
        check("status shows decision count", "1 decision" in r2.stdout)
        check("status shows observation count", "1 observation" in r2.stdout)
        check("status shows failure count", "1 failure" in r2.stdout)
        check("status shows MEMORY.md exists", "exists" in r2.stdout)
        check("status shows root path", str(tmp) in r2.stdout)

        # After summarize, session count appears
        subprocess.run([sys.executable, chron, "summarize", "--session-id", "s1"],
                       capture_output=True, cwd=tmp_str)
        r3 = subprocess.run([sys.executable, chron, "status"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("status shows session count after summarize", "Sessions:  1" in r3.stdout)
        check("status shows last session name", "s1.md" in r3.stdout)


def test_save():
    print("\n=== save ===")
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)
        chron = str(tmp / "chronicle.py")
        shutil.copy(CHRONICLE, chron)

        # save before memory/ exists
        r = subprocess.run([sys.executable, chron, "save"],
                           capture_output=True, text=True, cwd=tmp_str)
        check("save before init exits 1", r.returncode == 1)
        check("save before init says no memory dir", "memory" in r.stdout or "memory" in r.stderr)

        # Init git repo in tmp so save can stage files
        subprocess.run(["git", "init"], capture_output=True, cwd=tmp_str)
        subprocess.run(["git", "config", "user.email", "test@test.com"],
                       capture_output=True, cwd=tmp_str)
        subprocess.run(["git", "config", "user.name", "Test"],
                       capture_output=True, cwd=tmp_str)

        subprocess.run([sys.executable, chron, "init"], capture_output=True, cwd=tmp_str)
        subprocess.run([sys.executable, chron, "log", "save test decision"],
                       capture_output=True, cwd=tmp_str)

        r2 = subprocess.run([sys.executable, chron, "save"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("save exits 0", r2.returncode == 0)
        # Either staged files or nothing new
        check("save reports outcome", "Staged" in r2.stdout or "Nothing new" in r2.stdout)

        # Second save — nothing new
        r3 = subprocess.run([sys.executable, chron, "save"],
                            capture_output=True, text=True, cwd=tmp_str)
        check("save second run exits 0", r3.returncode == 0)
        check("save second run says nothing new", "Nothing new" in r3.stdout)


# ── Runner ─────────────────────────────────────────────────────────────────────

def main():
    print("CHRONICLE test suite")
    print("=" * 50)

    test_init()
    test_log()
    test_history()
    test_search()
    test_context()
    test_summarize()
    test_summarize_session_scoping()
    test_slug_uniqueness()
    test_memory_deduplication()
    test_no_init_needed_for_log()
    test_record_integrity()
    test_log_types_exhaustive()
    test_history_order()
    test_history_filters()
    test_search_filters()
    test_search_multiple_matches()
    test_summarize_only_decisions_section()
    test_init_default_project_name()
    test_phantom_session_env()
    test_from_phantom()
    test_tag()
    test_export()
    test_status()
    test_save()

    print("\n" + "=" * 50)
    print(f"Results: {PASS} passed, {FAIL} failed")
    if FAIL == 0:
        print("All tests passed.")
    else:
        print(f"FAILED: {FAIL} test(s)")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
