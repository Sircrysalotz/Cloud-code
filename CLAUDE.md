# WORKSPACE: Cloud-code

This is a multi-project workspace. Each project lives in its own folder with its own `CLAUDE.md` that holds all context for that project. This root file stays minimal — it only defines how the workspace works.

---

## Session Start Protocol

1. Scan the root for folders matching `PROJECT_*/`
2. Present the list to the user and ask: **"Which project are we working on today?"**
3. Once selected, navigate into that folder and read its `CLAUDE.md` before doing anything else
4. That project's `CLAUDE.md` is the source of truth — follow it

If no project is selected, stay at workspace level and only handle workspace-level tasks (adding, removing, or managing projects).

---

## Workspace Structure

```
Cloud-code/
├── CLAUDE.md                    ← You are here (workspace rules only)
├── PROJECT_NIGHTFALL/
│   ├── CLAUDE.md                ← Project context (read on load)
│   └── ...
├── PROJECT_PHANTOM/
│   ├── CLAUDE.md
│   └── ...
├── PROJECT_NOVA/
│   ├── CLAUDE.md
│   └── ...
└── PROJECT_CHRONICLE/
    ├── CLAUDE.md
    └── ...
```

---

## Active Projects

| Codename     | Folder                  | Status    |
|--------------|-------------------------|-----------|
| NIGHTFALL    | `PROJECT_NIGHTFALL/`    | Template  |
| PHANTOM      | `PROJECT_PHANTOM/`      | Active    |
| NOVA         | `PROJECT_NOVA/`         | Template  |
| CHRONICLE    | `PROJECT_CHRONICLE/`    | Active    |

---

## Managing Projects

### Add a new project
```bash
mkdir PROJECT_<CODENAME>
# Then create PROJECT_<CODENAME>/CLAUDE.md with project context
```
- Use a short, memorable codename (e.g. CIPHER, TITAN, ECHO)
- Add a row to the Active Projects table above

### Remove a project
```bash
# Confirm with the user first — this is irreversible
rm -rf PROJECT_<CODENAME>/
```
- Remove its row from the Active Projects table above
- Double-check nothing outside the folder references it

### Rename a project
```bash
mv PROJECT_OLD/ PROJECT_NEW/
```
- Update the folder name reference inside the project's own `CLAUDE.md` if it mentions it
- Update the Active Projects table above

---

## Rules

- Never put project-specific context in this file — it belongs in the project's own `CLAUDE.md`
- Each project must be fully self-contained inside its folder
- Always confirm before deleting a project folder
- When in doubt about which project to work on, ask — don't assume
