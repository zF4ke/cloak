# Architecture

Desktop and CLI share one project engine. The original OneDrive daemon stays separate. No server or cloud database is required.

```mermaid
flowchart LR
  UI[React UI] --> PRE[Sandboxed preload]
  PRE --> IPC[Validated Electron IPC]
  IPC --> S[Service]
  CLI[Bundled CLI] --> S
  S --> P[Project engine]
  S --> PR[Protection adapter]
  P --> LOCK[Process lock]
  LOCK --> REG[Local registry]
  P --> FS[Real folders and junctions]
  P --> G[Git and GitHub CLI]
  G --> GH[GitHub]
  PR --> PS[PowerShell commands]
  PS --> D[OneDrive daemon]
  D --> OD[OneDrive process]
```

| Module                             | Owns                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/ui`                           | Project/setup/settings views, controls and motion. Reads snapshots and invokes explicit actions. |
| `src/app`                          | Window, tray, sign-in launch, picker and IPC boundary.                                           |
| `src/core/service.ts`              | Scheduler and command dispatch shared by desktop/CLI.                                            |
| `src/core/projects.ts`             | Registry, imports, links and Git mutation policy.                                                |
| `src/core/git.ts`                  | Parsed branch, changes, remote and commit counts.                                                |
| `src/core/recovery.ts`             | Verified fresh clones, folder swaps, owned-link rollback and displaced-copy cleanup.             |
| `src/core/lock.ts`                 | Mutation coordination across app and CLI.                                                        |
| `src/core/storage.ts`              | JSON registry writes through temporary file and rename.                                          |
| `src/core/protection.ts`           | JSONC configuration and PowerShell bridge.                                                       |
| `src/core/desktop-installation.ts` | Running-app detection and transactional Windows registration.                                    |
| `src/setup`                        | App-styled installer and staged file replacement.                                                |
| PowerShell scripts                 | Original watcher and temporary junction records.                                                 |

## Operation flow

Setup collects a plan and validates resolved roots, OneDrive boundaries, repository identity and destination/link collisions. It moves, clones or creates the real folder, configures origin, creates a junction and writes the registry. Post-move failures keep the folder with a repairable warning.

Explicit repository recovery first reads available origin/tracking configuration without depending on the damaged index or HEAD. After opt-in, it clones into a temporary directory under the real project root and verifies a committed branch. It checks that the source directory's identity has not changed, displaces the source, installs the clone, creates or reuses the link and writes the registry. Registration failure restores the original and removes only a link this operation created. Successful registration removes the displaced copy. Retained directories and failed rollback paths appear in the error or warning. See [repository recovery](adr/003-explicit-repository-recovery.md).

An update takes the process lock and reloads the registry. It fetches origin, finds the tracking branch, compares commits and applies policy. HEAD and branch are checked again before replacement. Errors attach to the individual project. Sync optionally commits selected files, requires a clean tree, pulls and pushes.

Cloak publishes an initialized lock directory atomically, avoiding an empty lock if a process crashes during initialization. Recovery renames a dead owner's lock to a tiny `projects.recovered-<token>` record. Keeping that record prevents another stale reader from claiming a replacement live lock. These coordination records contain only a process ID and token. They are not project backups. The lock does not lock external Git clients or editors. Git/GitHub CLI own credentials; Cloak stores paths and settings, not tokens. The renderer has no Node access. Electron verifies its own main frame and dispatches explicit methods.

NSIS extracts setup into temporary storage. The custom Electron installer stages application files, checks that the installed copy is closed, swaps folders and registers Windows integration. User data remains outside `app`. Uninstall targets the fixed local app directory only.

The Vite preview is read-only. The release uses local IPC and does not start an HTTP server. See [the domain glossary](../CONTEXT.md) and [accepted decisions](adr/001-automatic-updates.md).

`FolderUnlocker` owns optional PowerToys discovery, scans and expiring close tickets. `folder-locks.ps1` reads process metadata and requests normal window close or explicit termination after verifying start time. The renderer supplies an opaque ticket, never arbitrary process IDs. File Locksmith is an installed dependency, not bundled with Cloak. `recovery-cleanup.ts` runs under Cloak's project lock and validates staging identity against `recovery.json`. Only a registered matching replacement permits deletion of displaced originals. Pending restore paths appear in the desktop UI.
