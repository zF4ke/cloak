<p align="center"><img src="assets/mark.svg" width="64" alt="Cloak" /></p>
<h1 align="center">Cloak</h1>
<p align="center">Keep Git projects outside OneDrive, with shortcuts where you work.</p>
<p align="center"><a href="https://github.com/zF4ke/cloak/releases/latest">Download for Windows</a> / <a href="docs/projects.md">Project guide</a> / <a href="docs/cli.md">CLI</a> / <a href="docs/development.md">Development</a></p>

<p align="center"><img src="docs/images/projects-rounded.svg" width="760" alt="Cloak project manager" /></p>

OneDrive can duplicate source files and corrupt Git metadata while syncing an active repository. Cloak stores the real folder outside OneDrive, uses GitHub for commits, and leaves an optional folder shortcut in your familiar Projects folder. Ordinary projects there still sync through OneDrive. Open Git projects from Explorer or use their real local paths in editors and terminals. The original pause/resume tool remains available for ordinary OneDrive projects.

## Get started

1. Download the installer from [Releases](https://github.com/zF4ke/cloak/releases/latest). It installs for your Windows account without Node or administrator access.
2. Install [Git for Windows](https://git-scm.com/downloads/win) and [GitHub CLI](https://cli.github.com/). Run `gh auth login` and `gh auth setup-git`.
3. Open Settings and choose the real project root outside OneDrive and the Projects folder where you want links.
4. Use Add existing for a local folder, Clone repository for another PC's project, or New project to create one. Review the paths before finishing.

Repositories default to private. Imports include `.git` and ignored local files. Existing destinations are never overwritten. [The project guide](docs/projects.md) explains setup and recovery.

If Git cannot read an existing project, Add existing offers **Use latest remote version**. Review the repository and branch before choosing Replace and add. This fresh-clone recovery replaces all local files and unpublished commits, including ignored files. The remote stays unchanged.

## Keep projects current

Cloak fetches at startup and every five minutes by default. Closing the window keeps it in the tray. Enable Launch at Windows sign-in to check after a restart. Choose Quit from the tray to stop checks.

| Local branch           | Automatic behavior                                   |
| ---------------------- | ---------------------------------------------------- |
| Same commits as origin | Keep local edits.                                    |
| Ahead of origin        | Keep commits and edits.                              |
| Diverged               | Keep everything and report that Git needs attention. |
| Strictly behind origin | Apply the chosen local-edit policy.                  |

**The default policy replaces uncommitted edits when a branch is strictly behind.** It also removes nonignored untracked files. Ignored files such as `.env` normally remain. Choose Keep local edits in Settings if updates should wait instead. Automatic checks never commit or push.

Use Sync to publish work. Select changed files and write a commit message. Other staged files and remaining unselected edits block Sync. See [Updates and Sync](docs/projects.md#updates-and-sync).

## What you can do

- Create GitHub repositories, import whole projects and clone repositories.
- Inspect changes, open folders or GitHub, repair missing shortcuts and remove entries without deleting files.
- Use the same project engine from the [CLI](docs/cli.md).
- Keep the original [OneDrive protection](docs/protection.md), log and temporary junction controls.
- Install updates without replacing settings or the project list.
- Find and close apps blocking imports with optional PowerToys integration. Clean abandoned recovery clones automatically. See [recovery](docs/projects.md#recovery).

A shortcut is a small file, so OneDrive cannot traverse it into the repository. Each PC needs its own clone and a shortcut pointing to its local folder. Read [the shortcut decision](docs/adr/004-project-shortcuts.md).

## Guides

| Guide                                | Contents                                               |
| ------------------------------------ | ------------------------------------------------------ |
| [Projects](docs/projects.md)         | Setup, repositories, updates, Sync and another PC.     |
| [CLI](docs/cli.md)                   | Every command and examples.                            |
| [Protection](docs/protection.md)     | Watcher, configuration, logs and manual junction mode. |
| [Installation](docs/installation.md) | Installer, portable build, updates and uninstall.      |
| [Architecture](docs/architecture.md) | Components, stored data and operation flow.            |
| [Development](docs/development.md)   | Run, verify, package and release.                      |
| [Design](docs/design.md)             | Tokens, controls, motion and references.               |
| [Verification](docs/verification.md) | Code reviews, completed checks and remaining limits.   |

Windows x64 is the release target. Binaries are unsigned. Project checks do not install new application releases; run a new Cloak installer manually.
