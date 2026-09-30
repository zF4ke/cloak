# CLI

The desktop installer adds `cloak` to PATH. The portable folder contains `cloak.cmd`. Both share the tray app's registry and mutation lock.

```powershell
cloak projects
cloak new "My project" --confirm
cloak add "C:\Users\you\OneDrive\Projects\my-project" --confirm
cloak clone https://github.com/you/my-project --confirm
cloak check
cloak sync "My project"
```

| Command                  | Behavior                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| `projects`               | Names, real paths, branches and change counts.                        |
| `new <name> --confirm`   | Create local Git folder, private GitHub repository and optional link. |
| `add <folder> --confirm` | Import whole folder and reuse origin or create a repository.          |
| `clone <url> --confirm`  | Clone a GitHub repository into local storage.                         |
| `check`                  | Fetch all projects and apply the configured update policy.            |
| `sync <name>`            | Pull and push a clean, committed project. Does not commit files.      |

Use `--public` on new/add to create a public repository. `--confirm` authorizes setup, folder move/link and needed repository creation. Quote paths with spaces. Set roots and update preferences in desktop Settings. Check can discard edits on a behind branch under the default policy. Read [Projects](projects.md#updates-and-sync).

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
