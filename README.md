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

The installer asks for your projects folder, writes the config, and registers
the daemon to start at logon.

```powershell
pwsh -File install.ps1 -Status      # what's running
pwsh -File install.ps1 -Uninstall   # clean removal
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
| `ignoreDirs` | `.git`, `node_modules`, ... | activity here doesn't count |

Logs: `%LOCALAPPDATA%\cloak\cloakd.log`

## Extras

- `cloak.ps1`: manual mode. Moves a folder to local disk and leaves a junction,
  making it fully invisible to OneDrive until you turn it back off
  (`on` / `off` / `status` / `restore-all`).
- `probe.ps1`: tests how your OneDrive treats junctions. Touches nothing but a
  throwaway folder.
