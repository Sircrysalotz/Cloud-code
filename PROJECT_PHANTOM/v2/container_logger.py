#!/usr/bin/env python3
"""
Container vitals logger. Runs as a background daemon.

Logs a timestamped heartbeat every LOG_INTERVAL seconds.
Every PUSH_EVERY entries, commits and pushes the log to git so it
survives container death. The last pushed entry = last confirmed alive.
"""

import os
import subprocess
import time
from datetime import datetime

REPO_DIR    = "/home/user/Cloud-code"
LOG_FILE    = os.path.join(REPO_DIR, "PROJECT_PHANTOM/logs/container_vitals.log")
LOG_INTERVAL  = 60   # seconds between log entries
PUSH_EVERY    = 5    # push after every N entries (~5 minutes)


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def read_uptime() -> str:
    try:
        with open("/proc/uptime") as f:
            secs = float(f.read().split()[0])
        m, s = divmod(int(secs), 60)
        h, m = divmod(m, 60)
        return f"{h}h {m}m {s}s"
    except Exception:
        return "unknown"


def read_load() -> str:
    try:
        with open("/proc/loadavg") as f:
            parts = f.read().split()
        return f"{parts[0]} {parts[1]} {parts[2]}"
    except Exception:
        return "unknown"


def git_push(entry_count: int):
    try:
        subprocess.run(
            ["git", "add", "PROJECT_PHANTOM/logs/container_vitals.log"],
            cwd=REPO_DIR, capture_output=True, timeout=30
        )
        subprocess.run(
            ["git", "commit", "-m",
             f"[container-logger] vitals push — entry {entry_count}\n\nhttps://claude.ai/code/session_01URz48AEdtJbKdvuHxoBEJ6"],
            cwd=REPO_DIR, capture_output=True, timeout=30
        )
        result = subprocess.run(
            ["git", "push"],
            cwd=REPO_DIR, capture_output=True, timeout=30
        )
        if result.returncode == 0:
            return "pushed"
        else:
            return f"push failed: {result.stderr.decode().strip()[:80]}"
    except Exception as e:
        return f"git error: {e}"


def main():
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    entry_count = 0

    with open(LOG_FILE, "a") as f:
        f.write(f"[{now()}] LOGGER STARTED — pid={os.getpid()} interval={LOG_INTERVAL}s push_every={PUSH_EVERY}\n")
        f.flush()

    print(f"Container vitals logger running. PID={os.getpid()}")
    print(f"Log: {LOG_FILE}")
    print(f"Logging every {LOG_INTERVAL}s, pushing every {PUSH_EVERY} entries (~{PUSH_EVERY * LOG_INTERVAL // 60}m)")

    while True:
        time.sleep(LOG_INTERVAL)
        entry_count += 1
        uptime = read_uptime()
        load   = read_load()
        push_status = ""

        if entry_count % PUSH_EVERY == 0:
            push_status = " | " + git_push(entry_count)

        line = f"[{now()}] ALIVE #{entry_count:04d} | uptime={uptime} | load={load}{push_status}\n"

        with open(LOG_FILE, "a") as f:
            f.write(line)
            f.flush()

        print(line.strip())


if __name__ == "__main__":
    main()
