# 🧥 cloak

**Pause OneDrive while you work. Let it sync when you step away.**

If you keep code inside a OneDrive folder, you've probably hit the weirdness:
builds failing with `not a regular file` because a source file turned into a
cloud placeholder, long-running processes reading stale file content, sync
locking files mid-compile, conflict copies appearing out of nowhere. None of it
is your fault — it's OneDrive's sync engine fighting your tools for the same
files.

cloak fixes this the simple way: OneDrive just shouldn't be touching your
project while you're working on it. A small background daemon watches your
project folders, pauses OneDrive the moment there's activity, and resumes it
once everything's been quiet for a bit — at which point OneDrive syncs
everything like normal. Your projects stay ordinary OneDrive folders, your
backups keep happening, and you never think about any of it.

## How it works

```
you save / build / run something   →  OneDrive pauses (gracefully, releasing its file handles)
everything quiet for ~90s          →  OneDrive resumes and syncs your changes
```

A few deliberate design choices:

- **It watches the filesystem, not your apps.** Terminal, VS Code, Claude Code,
  Codex, whatever you use next year — all the same to cloak.
- **Your folders are never touched.** Nothing gets moved, junctioned, or
  duplicated. If you uninstall cloak, everything is exactly as it was.
- **Backups can't silently rot.** Even during a marathon session, cloak briefly
  resumes OneDrive every 45 minutes (configurable) so your latest work gets
  synced.
- **It fails safe.** The daemon always restarts OneDrive on exit. If it crashes,
  you're just back to plain OneDrive behavior — nothing is lost or stuck.

One thing cloak can't do for you: if Files-On-Demand is dehydrating your
project files into placeholders, turn that off in OneDrive settings (or
right-click your project folders → *Always keep on this device*). The installer
checks for this and tells you if it's a problem.

## Install

```powershell
git clone https://github.com/zF4ke/cloak.git
cd cloak
# edit config.jsonc → point watchRoots at your project folders
pwsh -File install.ps1
```

That's it. The installer registers the daemon to start at logon, launches it
right away, and validates your config. Then:

```powershell
pwsh -File install.ps1 -Status      # what's running
pwsh -File install.ps1 -Uninstall   # clean removal, resumes OneDrive
```

## Configuration

Everything lives in `config.jsonc`:

| setting | default | meaning |
|---|---|---|
| `watchRoots` | — | folders to watch for work activity |
| `idleSeconds` | `90` | quiet time before OneDrive resumes |
| `maxPauseMinutes` | `45` | longest OneDrive can stay paused, even under constant activity |
| `ignoreDirs` | `.git`, `node_modules`, … | activity here doesn't count |
| `pollSeconds` | `5` | daemon check interval |

Logs go to `%LOCALAPPDATA%\cloak\cloakd.log` if you ever want to see what it's
been doing.

## Also in the box

- **`cloak.ps1`** — a manual mode for when you want a folder *fully* invisible
  to OneDrive: it moves the folder to local disk and leaves a junction in its
  place (`on` / `off` / `status` / `restore-all`). OneDrive skips junctions
  entirely, so nothing inside is synced until you turn it back off.
- **`probe.ps1`** — tests how *your* OneDrive treats junctions before you rely
  on them. Takes a minute, touches nothing but a throwaway folder.
