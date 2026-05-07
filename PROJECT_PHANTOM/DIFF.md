# PHANTOM Version Changelog

Documents improvements across major versions. Each entry is a friction point observed
during a live dogfood session and fixed in the same or next iteration.

---

## v3.3 → v3.4

| Problem | Fix |
|---|---|
| `check` command re-runs git diff on every call — slow if called often | Cache result in session state (30s TTL); `--no-cache` to force refresh |
| `status` criteria mini-view shows marks only — no criterion text | `status --verbose` expands to full list with text and `[x]/[ ]` per criterion |
| `status` criteria mini-view caps at 4 marks with "+N more" — rest hidden | Mini-view now shows ALL marks (no cap); verbose shows text |
| Warning-only HEARTBEAT.md v7 still caused early returns — model acknowledges warning as text | HEARTBEAT.md v8: execution steps appear at the very top, before any prose |
| Warning-only fix insufficient — documented pattern in ANTI_DRIFT.md | Pattern 8 added: warnings prompt acknowledgment text; put tool calls first instead |
| Heartbeat fire banner showed only first 3 criteria — rest hidden in long sessions | Runner v8: fire banner shows ALL criteria with `Criteria: N/M met` count |
| No marathon context in fire banner — hard to know session age at fire time | Runner v8: fire banner includes session elapsed (e.g. `+1h05m`) |
| Drift guard status lines lack session context in long runs | drift_guard.py: each poll line prefixed with `+Xh YYm` elapsed since session start |
| `check` caching stored in external file — cross-session pollution in tests | Cache moved into session state (keyed to same STATE_FILE + session) |

---

## v3.2 → v3.3

| Problem | Fix |
|---|---|
| DIFF.md / PLAN.md / ANTI_DRIFT.md stale since v1→v2 | Rewrote all three to reflect v3.x reality |
| `drift_guard.py` SCOPE_CREEP action_map still referenced `start --force` | `drift_guard.py` action_map text updated to `scope-update --scope <files>` |
| `scope-update` didn't warn when drift guard was armed with old scope | `scope-update` warns: "running process uses OLD scope — re-arm" |
| `status` showed no criteria progress without running `anchor check` | `status` now shows criteria mini-view: `N/M met \| [x] [ ] [ ]` |
| `drift-done` SCOPE_CREEP said "spread changes" — didn't mention `scope-update` | `drift-done` now shows Option A/B with explicit `scope-update` hint |
| Heartbeat agent returns early with commentary before Bash call | `HEARTBEAT.md` v7: warning — do NOT generate text before Bash call completes |
| Runner sleeps 30s before first check — agent can return before any output appears | `heartbeat_runner.py`: `first_iteration` skips sleep; if already idle, fires in < 1s |

---

## v3.1 → v3.2

| Problem | Fix |
|---|---|
| Heartbeat agent fabricated fire output using docs as template — state never updated | `HEARTBEAT.md` v6: fabrication prevention, exact HOLD/fire formats, post-flight state verification |
| After fabricated fire, main session had no way to detect it | Protocol: verify `rounds_remaining` decreased + `last_heartbeat_fired` set; `recover` + re-arm if not |
| Scope declared at `start` can't be updated mid-session — `start --force` resets everything | New `scope-update` command: updates `scope_files`, `coverage_targets`, `scope_threshold` in-place |
| Drift guard agent can fabricate clean verdict — real drift goes undetected | `DRIFT_GUARD.md` v4: fabrication prevention; state is authoritative, not agent text |
| `status --brief` coverage unlabeled — `0/3` looks like a mystery number | Brief shows `cov:0/3` label |
| `status --brief` note hard-truncated mid-word | Truncates at 37 chars with `...` |
| `report` scope section showed `last_session_state.json` at 100% | `report` filters via `_is_auto_generated()` same as `scope`/`check`/`checkpoint` |
| `report` coverage section listed targets without ✓/✗ | `report` shows ✓/✗ per target, consistent with `check` |
| `report` / `history` ping log notes hard-truncated | Truncates at 52 / 57 chars with `...` |
| `coverage_full` not written by `anchor check` — fire banner showed `[ ]` for coverage | `anchor check` writes `coverage_full` to state |
| Auto-save created new commit every N pings → bloated git log | `auto_save_commit` hash in state — amends own prior commit |
| Amended auto-save message stayed stale at first turn number | Amend uses `-m` with current turn |
| `container_vitals.log` inflating scope analysis | `_is_auto_generated()` filters entire `logs/` dir from all scope paths |
| DRIFT_GUARD.md SCOPE_CREEP action said `start --force` to update scope | Updated to `scope-update` command |

---

## v3.0 → v3.1

| Problem | Fix |
|---|---|
| No navigation aids after resume — Claude loses bearing | `anchor show/check` — immovable Point A (origin) and Point B (goal) |
| Completion practices optional — easy to skip | `checkpoint` — non-negotiable gates: ping freshness, drift, scope, coverage |
| Anchor criteria always `[ ]` even when verifiably met | `_eval_criteria()` — auto-marks coverage, drift, tests, HB-fire, anchor/checkpoint uses |
| `complete` silently skipped pre-flight | `_soft_checkpoint()` in `complete` — warns on stale ping, drift, zero coverage |
| Heartbeat fire didn't say which round | Fire banner: "HEARTBEAT FIRED (round N/total)" |
| Auto-save `last_session_state.json` triggered SCOPE_CREEP on every commit | `drift_guard` v4 auto-detects and ignores `logs/` dir |
| Agents used `run_in_background: true` for runner — process dies | `HEARTBEAT.md` v4 + `DRIFT_GUARD.md` v3: explicit "NOT run_in_background" warning |
| `agent-start` for drift-guard blocked heartbeat forever | Protocol fix: drift-guard uses `drift-arm`/`drift-done` only |
| Full status 20+ lines — too much for quick check | `status --brief` — one-line compact summary |
| `ping --tests N` confirmation not shown | Prints "Tests recorded: N" |
| HB ETA ignored `min_idle_polls` extra delay | ETA = threshold + (polls-1)×interval |

---

## v2.x → v3.0

| Problem | Fix |
|---|---|
| No declared scope → drift guard fires false positives | Four-gate drift evaluation: declared scope → task alignment → hunk spread → trend |
| All config flags must be typed each session | Profile system — named configs in `~/.phantom_profiles.json` |
| No way to see full session overview | `phantom.py report` — fires, scope snapshot, watchdog events |
| `heartbeat_active` stuck after crash | `phantom.py recover` — clears stuck flags without wiping state |
| Heartbeat fires on all file types | `tracked_extensions` + `scan_depth` configurable |
| Common profiles recreated every project | Built-in presets: `sprint`, `marathon`, `debug`, `focus` |
| Separate scope/coverage checks | `phantom.py check` — unified scope + coverage in one shot |
| Coverage targets re-specified every run | `--coverage-targets` stored in state at start |
| Drift verdicts gave generic advice | Verdict-specific ACTION: SCOPE_CREEP/VERTICAL/TRENDING each tailored |
| `scope_guard.py` ignored session boundaries | `--session` flag reads `session_start_ref` from state |
| Turn target stopped work early | `turns_target` is a budget floor — only `complete` ends the session |

---

## v1 → v2

| Problem | Fix |
|---|---|
| State file path hardcoded | `PHANTOM_STATE` env var — full test isolation |
| Concurrent write corruption | Lock file with 5s timeout |
| Session silent overwrite | Warns + requires `--force` |
| Poll interval hardcoded | `--interval N` stored in state |
| No cooldown control | `--cooldown-factor` configurable |
| Agent tracking — count only | Count + named IDs |
| No session summary | Auto-prints on `complete` |
| `status` was raw JSON dump | Rich formatted status panel |
| 0 tests | 352+ integration tests → 528 as of v3.2 |
| No filesystem/git activity signals | v3 runner: `[file:]` + `[git:index]` hold signals |
| No watchdog | Detects poll cycles >3x interval |
| No per-round drift reporting | Shows `+Ns` past threshold on fire |
