#!/usr/bin/env python3
"""
Integration tests for scope_guard.py and coverage_tracker.py.

Run: python3 test_tools.py
"""

import json
import os
import subprocess
import sys
import tempfile

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
SCOPE_GUARD = os.path.join(TOOLS_DIR, "scope_guard.py")
COVERAGE = os.path.join(TOOLS_DIR, "coverage_tracker.py")

PASS = "✓"
FAIL = "✗"
results = []


def run(cmd, cwd=None):
    r = subprocess.run(
        [sys.executable] + cmd,
        capture_output=True, text=True,
        cwd=cwd or TOOLS_DIR,
    )
    return r.returncode, r.stdout, r.stderr


def check(name, passed, detail=""):
    status = PASS if passed else FAIL
    msg = f"  [{status}] {name}"
    if detail and not passed:
        msg += f"\n      {detail}"
    print(msg)
    results.append((name, passed))


def make_git_repo():
    """Create a temp git repo with a few commits for testing."""
    d = tempfile.mkdtemp()
    def git(*args):
        subprocess.run(
            ["git"] + list(args), cwd=d,
            capture_output=True, text=True, check=True,
        )

    git("init")
    git("config", "user.email", "test@test.com")
    git("config", "user.name", "Test")
    git("config", "commit.gpgsign", "false")

    # Initial commit
    with open(os.path.join(d, "a.py"), "w") as f:
        f.write("# a\n" * 10)
    with open(os.path.join(d, "b.py"), "w") as f:
        f.write("# b\n" * 10)
    git("add", ".")
    git("commit", "-m", "init")

    # Second commit — big change to a.py, small to b.py
    with open(os.path.join(d, "a.py"), "w") as f:
        f.write("# changed\n" * 80)
    with open(os.path.join(d, "b.py"), "w") as f:
        f.write("# b changed\n" * 5)
    git("add", ".")
    git("commit", "-m", "work")

    return d


# ─── scope_guard tests ────────────────────────────────────────────────────────

def test_scope_guard():
    print("\n── scope_guard.py ──")
    repo = make_git_repo()

    # Basic run — a.py should be ~94% of changes
    rc, out, err = run([SCOPE_GUARD, "--repo", repo, "--since", "HEAD~1", "--threshold", "50"])
    check("exits 1 when drift detected", rc == 1, out)
    check("output shows a.py", "a.py" in out)
    check("output shows DRIFT DETECTED", "DRIFT DETECTED" in out)

    # Clean run with high threshold
    rc, out, err = run([SCOPE_GUARD, "--repo", repo, "--since", "HEAD~1", "--threshold", "95"])
    check("exits 0 when under threshold", rc == 0)
    check("output shows CLEAN", "CLEAN" in out)

    # JSON output
    rc, out, err = run([SCOPE_GUARD, "--repo", repo, "--since", "HEAD~1", "--threshold", "50", "--json"])
    check("--json exits 1 (drift)", rc == 1)
    try:
        data = json.loads(out)
        check("--json output is valid JSON", True)
        check("JSON has 'files' key", "files" in data)
        check("JSON has 'clean' key", "clean" in data)
        check("JSON clean=false for drift", data.get("clean") == False)
        check("JSON drift list non-empty", len(data.get("drift", [])) > 0)
    except json.JSONDecodeError as e:
        check("--json output is valid JSON", False, str(e))
        check("JSON has 'files' key", False)
        check("JSON has 'clean' key", False)
        check("JSON clean=false for drift", False)
        check("JSON drift list non-empty", False)

    # Quiet mode — no output
    rc, out, err = run([SCOPE_GUARD, "--repo", repo, "--since", "HEAD~1", "--threshold", "50", "--quiet"])
    check("--quiet suppresses output", out.strip() == "")
    check("--quiet still exits 1 on drift", rc == 1)

    # Non-git directory
    rc, out, err = run([SCOPE_GUARD, "--repo", "/tmp", "--since", "HEAD~1"])
    check("exits 2 for non-git directory", rc == 2)

    # No changes
    rc, out, err = run([SCOPE_GUARD, "--repo", repo, "--since", "HEAD", "--threshold", "40"])
    check("exits 0 when no changes", rc == 0)

    # Auto-detect since (no --since flag) — should work without error
    rc, out, err = run([SCOPE_GUARD, "--repo", repo])
    check("auto-detects since without --since flag", rc in (0, 1))
    check("auto-detect doesn't error out (rc != 2)", rc != 2)

    import shutil
    shutil.rmtree(repo)


# ─── coverage_tracker tests ───────────────────────────────────────────────────

def test_coverage_tracker():
    print("\n── coverage_tracker.py ──")
    repo = make_git_repo()

    # Full coverage — both files touched
    rc, out, err = run([COVERAGE,
        "--targets", "a.py", "b.py",
        "--repo", repo, "--since", "HEAD~1"])
    check("exits 0 when all targets touched", rc == 0, out)
    check("shows FULL COVERAGE", "FULL COVERAGE" in out)
    check("checkmarks for both files", out.count("✓") >= 2)

    # Partial coverage — c.py not touched
    rc, out, err = run([COVERAGE,
        "--targets", "a.py", "c.py",
        "--repo", repo, "--since", "HEAD~1"])
    check("exits 1 when some targets untouched", rc == 1)
    check("shows INCOMPLETE", "INCOMPLETE" in out)
    check("marks c.py as not modified", "c.py" in out and "← not yet modified" in out)

    # JSON output
    rc, out, err = run([COVERAGE,
        "--targets", "a.py", "b.py",
        "--repo", repo, "--since", "HEAD~1",
        "--json"])
    check("--json exits 0 (full coverage)", rc == 0)
    try:
        data = json.loads(out)
        check("--json output is valid JSON", True)
        check("JSON full_coverage=true", data.get("full_coverage") == True)
        check("JSON coverage_pct=100", data.get("coverage_pct") == 100.0)
        check("JSON touched list has 2 files", len(data.get("touched_files", [])) == 2)
    except json.JSONDecodeError as e:
        check("--json output is valid JSON", False, str(e))
        check("JSON full_coverage=true", False)
        check("JSON coverage_pct=100", False)
        check("JSON touched list has 2 files", False)

    # Quiet mode
    rc, out, err = run([COVERAGE,
        "--targets", "a.py", "b.py",
        "--repo", repo, "--since", "HEAD~1",
        "--quiet"])
    check("--quiet suppresses output", out.strip() == "")
    check("--quiet exits 0 on full coverage", rc == 0)

    # Targets file
    tfile = os.path.join(repo, "targets.txt")
    with open(tfile, "w") as f:
        f.write("# tracked files\na.py\nb.py\n")
    rc, out, err = run([COVERAGE,
        "--targets-file", tfile,
        "--repo", repo, "--since", "HEAD~1"])
    check("--targets-file works", rc == 0)
    check("--targets-file shows FULL COVERAGE", "FULL COVERAGE" in out)

    # Missing targets file
    rc, out, err = run([COVERAGE,
        "--targets-file", "/nonexistent/targets.txt",
        "--repo", repo])
    check("missing --targets-file exits 2", rc == 2)

    # No targets at all
    rc, out, err = run([COVERAGE, "--repo", repo, "--since", "HEAD~1"])
    check("no targets exits 2", rc == 2)

    # Non-git directory
    rc, out, err = run([COVERAGE,
        "--targets", "a.py",
        "--repo", "/tmp"])
    check("exits 2 for non-git directory", rc == 2)

    # Directory as target
    import tempfile
    subdir = os.path.join(repo, "src")
    os.makedirs(subdir)
    with open(os.path.join(subdir, "c.py"), "w") as f:
        f.write("# c\n" * 5)
    subprocess.run(["git", "add", "."], cwd=repo, capture_output=True)
    subprocess.run(["git", "commit", "-m", "add src/"], cwd=repo, capture_output=True)
    rc, out, err = run([COVERAGE,
        "--targets", "src/",
        "--repo", repo, "--since", "HEAD~1"])
    check("directory prefix target works", rc == 0)

    import shutil
    shutil.rmtree(repo)


# ─── Run all ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Anti-Drift Tools Integration Tests")
    print("=" * 50)

    test_scope_guard()
    test_coverage_tracker()

    print("\n" + "=" * 50)
    passed = sum(1 for _, p in results if p)
    total = len(results)
    print(f"  Results: {passed}/{total} passed")
    if passed < total:
        print("  FAILED:")
        for name, p in results:
            if not p:
                print(f"    - {name}")
    print("=" * 50)
    sys.exit(0 if passed == total else 1)
