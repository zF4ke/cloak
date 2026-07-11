# 🧥 cloak

**Work on OneDrive-synced projects without OneDrive breaking your tools.**

OneDrive's Files-On-Demand layer wrecks active development: source files get
dehydrated to placeholders mid-build (`not a regular file`), long-running
processes read *stale cached content*, sync grabs *locks* on files you're
compiling, and `build/` churn spawns conflict copies. Every one of these comes
from OneDrive sitting between your tools and the real bytes.

cloak gets it out of the way — **temporarily and automatically**. While you're
working, your project is *cloaked*: OneDrive can't see it. When you stop, it's
*uncloaked* back into place and syncs normally. You keep opening the exact same
`OneDrive/…/Projects/foo` path you always have — nothing about your layout
changes, and there's no second folder hanging around.

## How it works

```
idle      OneDrive/Projects/foo   ← a normal, synced folder. clean.
             │  (you start working)
working   OneDrive/Projects/foo ─(junction)→ C:\…\scratch\foo   ← real bytes, local, OneDrive skips it
             │  (you stop)
idle      OneDrive/Projects/foo   ← bytes moved back, scratch deleted, OneDrive syncs the result
```

- The folder you open is always `Projects/foo`. During work it's a **junction**
  to a local scratch dir, so tools hit local disk and OneDrive ignores the
  reparse point entirely.
- Same NTFS volume ⇒ isolate/restore is an **instant metadata move**, not a copy.
- A background daemon decides *working* vs *idle* from file activity — so
  **no agent, editor, or human ever has to think about it.** Works the same for
  Claude, Codex, VS Code, or a bare terminal.
- **Fails safe:** your bytes always live on local disk; a logon watchdog restores
  any project left cloaked by a crash. You can't lose data or get stranded.

## Status

🚧 Early. Current step: **`probe.ps1`** — measures how *your* OneDrive treats
junctions before we build on the assumption (it varies by version / settings).

```powershell
pwsh -File probe.ps1
```

Roadmap: probe → daemon (activity detection + cloak/uncloak + fail-safe) →
colored `install.ps1` (with a `migrate` for existing folders) → config.

## Name

It cloaks the folder from OneDrive's view. `cloak` / `uncloak`.
