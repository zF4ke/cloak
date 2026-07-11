# 🧥 cloak

**Work on OneDrive-synced projects without OneDrive breaking your tools.**

OneDrive's sync + Files-On-Demand layer wrecks active development: source files
get dehydrated to placeholders mid-build (`not a regular file`), long-running
processes read *stale cached content*, sync grabs *locks* on files you're
compiling, and `build/` churn spawns conflict copies.

cloak gets OneDrive out of the way **while you work, automatically** — and lets
it sync everything back the moment you pause. No wrappers, no aliases, no
per-project setup, no agent (Claude/Codex/whatever) ever has to know it exists.

## How it works

`cloakd` (a tiny background daemon) watches your configurable project roots:

```
you write / build / run   →  OneDrive is gracefully paused (no locks, no stale reads, no churn)
everything idle ~90s      →  OneDrive resumes and syncs the result   ✅ backup
```

- **Tool-agnostic:** it watches the *filesystem*, not your apps. GUI Claude
  Code, Codex, VS Code, a terminal — all identical.
- **One normal folder:** your projects stay plain synced OneDrive folders.
  Nothing moves, no second copy, no junctions (in this mode).
- **Never stale forever:** `maxPauseMinutes` forces a brief resume+sync even
  under continuous activity, so backup can't rot during marathon sessions.
- **Fails safe:** the daemon always restarts OneDrive on exit; if it crashes,
  worst case is plain OneDrive behavior again — never data loss.

Pair it with turning **Files-On-Demand off** (or pinning your project roots)
so files are always real bytes on disk — that kills the placeholder /
dehydration bug class at the root; cloakd handles the lock/stale/churn class.

## Files

| file | what |
|---|---|
| `cloakd.ps1` | the daemon: watch roots → pause on activity → resume on idle |
| `config.jsonc` | roots to watch, idle timing, ignore dirs — the one file you edit |
| `cloak.ps1` | manual junction mode: `on`/`off`/`status`/`restore-all` — fully isolates a folder behind a junction to local disk (probe-verified: OneDrive ignores junctions) |
| `probe.ps1` | measures how *your* OneDrive treats junctions before you trust them |

## Quick start

```powershell
# 1. edit config.jsonc → set watchRoots to your project folders
# 2. run the daemon
pwsh -File cloakd.ps1
```

Installer with a logon Scheduled Task: coming next.

## Name

It cloaks your work from OneDrive's attention while you're in the middle of it.
`cloak` / `uncloak`. It rhymes, so it's good.
