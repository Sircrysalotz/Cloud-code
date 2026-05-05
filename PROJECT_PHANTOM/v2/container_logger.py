#!/usr/bin/env python3
"""
Container vitals logger v2. Runs as a background daemon.

v2 additions:
  - PID file prevents duplicate loggers from running simultaneously
  - Memory and disk usage included in every vitals line
  - Git push retry logic (3 attempts with backoff)
  - CLI args for configurable intervals
  - Graceful SIGTERM handling
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from datetime import datetime

REPO_DIR  = "/home/user/Cloud-code"
LOG_FILE  = os.path.join(REPO_DIR, "PROJECT_PHANTOM/logs/container_vitals.log")
PID_FILE  = "/tmp/phantom_container_logger.pid"


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def write_pid():
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))


def read_pid() -> int | None:
    try:
        with open(PID_FILE) as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return None


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def check_duplicate() -> bool:
    """Returns True if a duplicate is already running."""
    existing_pid = read_pid()
    if existing_pid and pid_alive(existing_pid):
        print(f"ERROR: container_logger already running (PID {existing_pid}). Exiting.")
        return True
    return False


def cleanup_pid():
    try:
        os.unlink(PID_FILE)
    except FileNotFoundError:
        pass


def read_uptime() -> str:
    try:
        with open("/proc/uptime") as f:
            secs = float(f.read().split()[0])
        m, s = divmod(int(secs), 60)
        h, m = divmod(m, 60)
        return f"{h}h {m}m {s}s"
    except Exception:
        return "?"


def read_load() -> str:
    try:
        with open("/proc/loadavg") as f:
            p = f.read().split()
        return f"{p[0]}/{p[1]}/{p[2]}"
    except Exception:
        return "?"


def read_mem() -> str:
    try:
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                info[k.strip()] = int(v.strip().split()[0])
        total = info.get("MemTotal", 0)
        avail = info.get("MemAvailable", 0)
        used  = total - avail
        pct   = used / total * 100 if total else 0
        return f"{used // 1024}MB/{total // 1024}MB ({pct:.0f}%)"
    except Exception:
        return "?"


def read_disk() -> str:
    try:
        st = os.statvfs(REPO_DIR)
        total = st.f_blocks * st.f_frsize
        free  = st.f_bavail * st.f_frsize
        used  = total - free
        pct   = used / total * 100 if total else 0
        return f"{used // (1024**3)}GB/{total // (1024**3)}GB ({pct:.0f}%)"
    except Exception:
        return "?"


def rotate_log(max_lines: int = 500):
    """Keep log file under max_lines by dropping oldest entries."""
    try:
        with open(LOG_FILE) as f:
            lines = f.readlines()
        if len(lines) > max_lines:
            kept = lines[-max_lines:]
            with open(LOG_FILE, "w") as f:
                f.write(f"[{now()}] LOG ROTATED — kept last {max_lines} of {len(lines)} lines\n")
                f.writelines(kept)
    except FileNotFoundError:
        pass


def git_push(entry_count: int) -> str:
    for attempt in range(1, 4):
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
            err = result.stderr.decode().strip()[:60]
            if attempt < 3:
                time.sleep(2 ** attempt)
                continue
            return f"push failed: {err}"
        except Exception as e:
            if attempt < 3:
                time.sleep(2 ** attempt)
                continue
            return f"git error: {e}"
    return "push failed after 3 attempts"


def main(log_interval: int, push_every: int):
    if check_duplicate():
        sys.exit(1)

    write_pid()
    signal.signal(signal.SIGTERM, lambda s, f: (cleanup_pid(), sys.exit(0)))
    signal.signal(signal.SIGINT,  lambda s, f: (cleanup_pid(), sys.exit(0)))

    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    entry_count = 0

    with open(LOG_FILE, "a") as f:
        f.write(f"[{now()}] LOGGER STARTED — pid={os.getpid()} interval={log_interval}s push_every={push_every}\n")
        f.flush()

    print(f"Container vitals logger v2 | PID={os.getpid()}")
    print(f"  Log:     {LOG_FILE}")
    print(f"  Interval: {log_interval}s | Push every: {push_every} entries (~{push_every * log_interval // 60}m)")

    try:
        while True:
            time.sleep(log_interval)
            entry_count += 1
            uptime = read_uptime()
            load   = read_load()
            mem    = read_mem()
            disk   = read_disk()
            push_status = ""

            if entry_count % push_every == 0:
                rotate_log()
                push_status = " | " + git_push(entry_count)

            line = (
                f"[{now()}] ALIVE #{entry_count:04d} | "
                f"up={uptime} | load={load} | "
                f"mem={mem} | disk={disk}{push_status}\n"
            )

            with open(LOG_FILE, "a") as f:
                f.write(line)
                f.flush()

            print(line.strip())
    finally:
        cleanup_pid()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Container vitals logger v2")
    parser.add_argument("--interval",    type=int, default=60, help="Seconds between log entries")
    parser.add_argument("--push-every",  type=int, default=5,  help="Push to git every N entries")
    args = parser.parse_args()
    main(args.interval, args.push_every)
