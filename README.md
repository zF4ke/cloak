# 🧥 cloak

**Pause OneDrive while you work. Let it sync when you step away.**

Keeping code in a OneDrive folder breaks things: files turn into cloud
placeholders mid-build (`not a regular file`), long-running processes read
stale content, sync locks files while you compile. cloak fixes it the simple
way: OneDrive shouldn't touch your project while you're working on it.

A small daemon watches your project folders. Activity stops OneDrive (silently,
by ending its process so it releases your files). Once everything is quiet for a
bit, OneDrive restarts and syncs as normal.

## Install

```powershell
git clone https://github.com/zF4ke/cloak.git
cd cloak
pwsh -File install.ps1
```

The installer asks for your projects folder, writes the config, registers the
daemon to start at logon, and adds a `cloak` command to your PATH. Open a new
terminal to use it.

## Commands

```
cloak status              daemon / task / OneDrive state + recent log
cloak install             install or repair, add cloak to PATH
cloak uninstall           remove the daemon and PATH entry
cloak start | stop        start / stop the daemon
cloak log [-Follow]       show the daemon log
cloak probe               test how OneDrive treats junctions here

cloak on <path>           manually hide a folder from OneDrive (junction mode)
cloak off <path>          restore it
cloak list                show junction-cloaked folders
cloak restore-all         restore all of them
```

## How it behaves

- Watches the filesystem, not your apps. Works with any editor, terminal, or agent.
- Never moves or touches your folders. Uninstall and everything is as it was.
- Resumes OneDrive briefly every 45 min even during long sessions, so backups stay fresh.
- Always restarts OneDrive on exit. A crash just means plain OneDrive behavior again.

If Files-On-Demand is turning your files into placeholders, turn it off or set
your project folders to "Always keep on this device". The installer checks and
warns you about this.

## Configuration

`config.jsonc`:

| setting | default | meaning |
|---|---|---|
| `watchRoots` | set by installer | folders to watch |
| `idleSeconds` | `90` | quiet time before OneDrive resumes |
| `maxPauseMinutes` | `45` | max time paused, even under constant activity |
| `ignoreDirs` | `[]` | directory names whose activity won't pause OneDrive |
| `ignoreFiles` | `[]` | filename globs whose activity won't pause OneDrive (e.g. `*.log`) |
| `pollSeconds` | `5` | how often the daemon checks |
| `scratchDir` | `%LOCALAPPDATA%\cloak\scratch` | where junction mode stashes bytes |

Logs: `%LOCALAPPDATA%\cloak\cloakd.log`

## Junction mode

The `cloak on/off` commands are a separate, manual mode for when you want a
folder *fully* invisible to OneDrive rather than just paused: it moves the
folder to local disk and leaves a junction in its place, so nothing inside syncs
until you `cloak off`. Run `cloak probe` first to confirm your OneDrive ignores
junctions (it touches nothing but a throwaway folder).
