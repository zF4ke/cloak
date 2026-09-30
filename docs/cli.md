# CLI

The desktop installer adds `cloak` to PATH. The portable folder contains `cloak.cmd`. Both share the tray app's registry and mutation lock.

```powershell
cloak projects
cloak new "My project" --confirm
cloak add "C:\Users\you\OneDrive\Projects\my-project" --confirm
cloak clone https://github.com/you/my-project --confirm
cloak check
cloak cleanup
cloak shortcuts --confirm
cloak sync "My project"
```

| Command                  | Behavior                                                                     |
| ------------------------ | ---------------------------------------------------------------------------- |
| `projects`               | Names, real paths, branches and change counts.                               |
| `new <name> --confirm`   | Create local Git folder, private GitHub repository and optional shortcut.    |
| `add <folder> --confirm` | Import whole folder and reuse origin or create a repository.                 |
| `clone <url> --confirm`  | Clone a GitHub repository into local storage.                                |
| `check`                  | Fetch all projects and apply the configured update policy.                   |
| `sync <name>`            | Pull and push a clean, committed project. Does not commit files.             |
| `cleanup`                | Remove disposable recovery folders and report originals needing restoration. |

Use `--public` on new/add to create a public repository. `--confirm` authorizes setup, folder move/shortcut and needed repository creation. Quote paths with spaces. Set roots and update preferences in desktop Settings. Check can discard edits on a behind branch under the default policy. Read [Projects](projects.md#updates-and-sync).

For an unreadable repository, explicit recovery is available through:

```powershell
cloak add "C:\Users\you\OneDrive\Projects\my-project" --confirm --use-remote-version
```

This replaces **all local files and unpublished commits, including ignored files** with a fresh remote clone. It leaves GitHub unchanged. Cloak reads origin and its tracking branch without depending on the index. Add `--repository https://github.com/you/my-project` if origin is missing or incorrect. Add `--branch main` to select a branch. Otherwise, the discovered origin tracking branch or remote default is used. Read [Recovery](projects.md#recovery) before using it.

## Original protection commands

| Command                   | Behavior                                                  |
| ------------------------- | --------------------------------------------------------- |
| `status`                  | Daemon, OneDrive state and recent log.                    |
| `install`                 | Install/repair pause-resume daemon and its startup entry. |
| `start`, `stop`           | Control protection; stop attempts to resume OneDrive.     |
| `log`, `log -Follow`      | Show recent activity or follow the log.                   |
| `on <path>`, `off <path>` | Move a folder to scratch with a junction, or restore it.  |
| `list`, `restore-all`     | Inspect or restore temporary junction folders.            |
| `probe`                   | Short local observation of OneDrive junction behavior.    |
| `uninstall`               | Remove protection, not the desktop application.           |

For source-only protection, run `powershell.exe -File .\cloak.ps1 status` and use `install.ps1` interactively. Managed-project source commands need Node 24, `npm ci`, `npm run build`, then `node dist/cli.cjs projects`. Packaged CLI bundles the runtime.

## Project shortcuts

`cloak shortcuts --confirm` creates or repairs shortcuts for every managed project. Use `cloak shortcuts "My project" --confirm` for one. Enable Create project shortcuts and select the existing synced Projects folder in desktop Settings first. Existing shortcuts targeting another folder are preserved and reported as collisions. Confirmed repair converts a recorded legacy junction only if it still points to the managed repository. Deleting a shortcut leaves the real folder untouched.
