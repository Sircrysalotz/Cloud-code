#!/usr/bin/env bash
# PHANTOM setup — run once on a fresh machine/container from the repo root.
# Usage: bash PROJECT_PHANTOM/tools/setup.sh [--check]
#
# --check  : verify environment only (no installs, no file creation)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
AGENTS_DIR="$PROJECT_DIR/agents"
LOGS_DIR="$PROJECT_DIR/logs"
REPO_DIR="$(cd "$PROJECT_DIR/.." && pwd)"

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

_ok()   { echo "  [OK]  $1"; }
_warn() { echo "  [WARN] $1"; }
_fail() { echo "  [FAIL] $1"; ERRORS=$((ERRORS + 1)); }

ERRORS=0

echo "=== PHANTOM Environment Check ==="
echo "  Repo:    $REPO_DIR"
echo "  Project: $PROJECT_DIR"
echo ""

# ── Python ──────────────────────────────────────────────────────────────────
echo "[1/4] Python"
if command -v python3 &>/dev/null; then
    PY_VER=$(python3 --version 2>&1)
    _ok "$PY_VER"
else
    _fail "python3 not found — install Python 3.8+"
fi

# ── Git ──────────────────────────────────────────────────────────────────────
echo "[2/4] Git"
if command -v git &>/dev/null; then
    GIT_VER=$(git --version)
    _ok "$GIT_VER"
    # Verify we're inside a git repo
    if git -C "$REPO_DIR" rev-parse --git-dir &>/dev/null; then
        _ok "Repo root: $REPO_DIR"
    else
        _fail "$REPO_DIR is not a git repository"
    fi
else
    _fail "git not found"
fi

# ── Logs directory ───────────────────────────────────────────────────────────
echo "[3/4] Logs directory"
if [[ -d "$LOGS_DIR" ]]; then
    _ok "$LOGS_DIR exists"
else
    if [[ $CHECK_ONLY -eq 1 ]]; then
        _warn "$LOGS_DIR missing (run without --check to create)"
    else
        mkdir -p "$LOGS_DIR"
        _ok "Created $LOGS_DIR"
    fi
fi

# ── Phantom state / agents ───────────────────────────────────────────────────
echo "[4/4] Phantom agents"
for f in phantom.py heartbeat_runner.py drift_guard.py container_logger.py; do
    if [[ -f "$AGENTS_DIR/$f" ]]; then
        _ok "$f"
    else
        _fail "$f missing from $AGENTS_DIR"
    fi
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [[ $ERRORS -gt 0 ]]; then
    echo "=== $ERRORS issue(s) found. Fix them before starting a session. ==="
    exit 1
fi

echo "=== All checks passed. ==="
if [[ $CHECK_ONLY -eq 0 ]]; then
    echo ""
    echo "Quick start:"
    echo "  python3 PROJECT_PHANTOM/agents/phantom.py start \"task\" --turns 20 --rounds 8"
fi
