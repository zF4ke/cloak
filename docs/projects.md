# Projects

## Choose folders and sign in

Browse starts in the current folder field when it exists. Add existing and OneDrive protection fall back to the configured shortcuts folder. Change folder and local project settings fall back to the real project root. If neither exists yet, Cloak opens an existing parent folder.

Open Settings. Real project folders defaults to `%USERPROFILE%\Projects` and must resolve outside detected OneDrive roots. Shortcuts folder receives optional Windows .lnk folder shortcuts. Keep your existing OneDrive www/Projects folder here so ordinary projects still sync. Explorer opens each shortcut; editors and terminals use the real local project path. Changing these roots affects new projects; it does not move existing entries.

Install Git and GitHub CLI. Run `gh auth login` and `gh auth setup-git` in a terminal. Git also needs your name and email for commits. Settings shows the active GitHub CLI account.

## New project

Choose New project, enter a folder name, review the repository name and visibility, then confirm the paths. Private is the default. Cloak creates a Git folder, README and `.gitignore` for common dependencies, build output and credentials. Repository creation does not upload files. Use Sync to select files, make the first commit and push.

## Add existing

Choose the repository root, not a child folder. Cloak inspects Git and shows the existing origin for confirmation. A folder without Git can become a new private repository. Review the folder move and update policy before finishing.

The entire folder moves, including `.git` and ignored local files. Close editors, terminals and servers using it first. Source and destination must be on the same drive. Cloak never replaces an existing destination. Linked Git worktrees cannot be moved this way. Download OneDrive placeholders before importing.

| Current location                                                  | What Add existing does                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Inside your OneDrive Projects folder                              | Moves the folder to the real project root and creates the optional shortcut.                                       |
| Already at the configured real root under the chosen project name | Keeps the folder in place, registers it and creates the optional shortcut.                                         |
| Anywhere else                                                     | Moves the folder to the configured real root and creates the optional shortcut. The same-drive rule still applies. |

If repository or shortcut setup fails after a move, Cloak keeps and registers the local folder with a warning. Open details to Connect repository or Restore shortcut. If Git initialization failed, repair Git in the retained folder first. Do not delete the folder to clear an error.

## Clone repository

Enter a GitHub HTTPS or SSH URL, then confirm the project name and paths. Private repositories need working Git credentials. A clone contains committed files, not another PC's ignored or uncommitted work.

## Project controls

Change folder updates a project's saved location after you move it yourself, including when its old folder is missing. Select the existing Git repository root outside OneDrive. Cloak checks the origin against the saved repository and updates its recorded shortcut. It does not move, clone or delete project files. Unrelated shortcuts and folders already managed by Cloak are refused.

Click a project row to show its real folder, shortcut, repository, changes and concrete errors. Open folder launches Explorer. The repository link opens GitHub. Restore shortcut recreates a missing shortcut without replacing another entry. Remove from Cloak only removes the list entry; the folder, shortcut and GitHub repository remain.

Search appears after three projects. Needs attention means an operation failed; open the row to inspect the reason.

## Updates and Sync

Automatic checks fetch origin at app startup and at the interval in Settings while Cloak runs in the tray. Check for updates does this immediately even with scheduling disabled. No checks happen while the PC is off or Cloak has quit.

Equal and ahead branches retain local contents. Diverged histories require manual Git resolution. A renamed local branch still follows its origin tracking branch. Detached HEAD and branches tracking another remote require manual handling.

For strictly behind branches, Use GitHub's version replaces tracked content and deletes nonignored untracked files. Previously ignored files remain even if the incoming ignore rules change. If an incoming tracked path conflicts with an ignored file or directory, Cloak blocks the update and asks you to move those files aside. Keep local edits instead blocks updating a dirty folder. A commit or branch switch during fetch aborts replacement. External editors can still write during an operation; use Keep local edits when concurrent work must survive. Automatic checks never commit or push.

Sync explicitly pulls and pushes. With local changes, the app asks for a commit message and file selection. It refuses other already-staged files outside that selection. Remaining unselected edits block pull/push, so a selected commit can succeed while Sync still needs you to deal with other edits. That commit is not reverted. The dialog shows up to 200 changes; review larger sets directly in Git.

## Another PC

Install Cloak, Git and GitHub CLI there, sign in, choose its local roots and Clone repository. Each PC needs its own clone and shortcut. Push committed work before switching. Transfer ignored credentials, environment files and databases separately. Do not sync `.git`, dependencies or the Cloak registry through OneDrive.

## Recovery

If Add existing reports that Git cannot read a repository, turn on **Use latest remote version** to rebuild it. Review the GitHub URL and branch, then choose **Replace and add**. Cloak suggests the origin tracking branch if its configuration is readable, even when the index or HEAD is broken. Leave Branch empty to use the remote's default branch. If origin cannot be read, enter the GitHub URL yourself.

This recovery replaces the entire local copy with committed remote content. It deletes unpublished commits, edited files, untracked files and ignored files, including credentials, databases and dependencies. It does not modify GitHub. Ordinary Add existing and automatic updates retain their existing policies.

Cloak clones and verifies the remote outside OneDrive before moving the old folder. A failed clone leaves the original in place. A failed registration restores it. Successful recovery removes the displaced copy and creates the configured project shortcut. If a process or OneDrive prevents a move, close it and retry. If cleanup fails, the warning gives the retained folder path. Linked worktrees require manual Git repair. A healthy repository cannot use this recovery mode.

### Locked folders

For OneDrive cloud-folder errors, Cloak resumes the local OneDrive client and retries the move for up to one minute. Its protection watcher stays out of the way during that attempt. App startup also updates an already-installed watcher, preserving its configuration and whether it was running. Sign-in or network problems still need attention in OneDrive. Normal import preserves the whole folder; this retry never copies over an existing destination.

After a failed import, choose **Unlock folder**. Cloak uses [Microsoft PowerToys File Locksmith](https://learn.microsoft.com/en-us/windows/powertoys/file-locksmith) to list apps holding the folder or its files. If PowerToys is absent, **Get PowerToys** opens Microsoft's installation guide. You can also close the apps yourself and retry; PowerToys is optional.

**Close apps** requests a normal window close. Background tasks without a window may require quitting their parent editor or terminal. **End locking tasks** is a separate disclosure. Enable **Discard unsaved work**, then choose **End tasks** to terminate the listed tasks. This can stop active coding agents and lose unsaved work. Cloak rechecks the folder, current holders and process start times before acting. It protects its own process, launching processes and Windows services. It does not forcibly close arbitrary file handles or automatically retry replacement.

Some processes cannot be inspected by your Windows account. An empty list means no visible holders were found, not proof that Windows has released every lock. For a coding-agent session whose workspace is the source folder, fully quit the parent app before recovery.

### Temporary recovery files

Cloak removes temporary clones immediately after a failed attempt and removes displaced originals after successful registration. It records each new staging folder in `recovery.json`. If deletion fails or the app stops, it retries cleanup at desktop startup and every configured interval, even with automatic Git updates disabled. Run `cloak cleanup` for an immediate cleanup from the CLI.

Cleanup removes abandoned disposable clones. It removes a displaced original only when the registry identifies the verified replacement folder. If replacement was interrupted before registration, it retains `old`, removes the extra clone and reports the original's path. Restore those original files manually. Unknown, altered or currently active recovery folders are not automatically deleted. Older staging folders without a recovery record require manual inspection.

| Problem                        | Action                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Destination or link exists     | Inspect it or choose another name. Cloak will not replace it.                                                                              |
| Authentication fails           | Run `gh auth status`, `gh auth login` and `gh auth setup-git`, then retry.                                                                 |
| No commit yet                  | Select files in Sync and make the first commit.                                                                                            |
| Histories differ               | Resolve the branch in Git, then Sync.                                                                                                      |
| Missing shortcut                   | Open details and Restore shortcut.                                                                                                      |
| Missing repository after setup | Open details and Connect repository.                                                                                                       |
| Unreadable registry            | Quit Cloak and repair `%LOCALAPPDATA%\cloak\projects.json`. Keep project folders.                                                          |
| Move fails                     | Use Unlock folder for app locks. Cloud-provider retries are automatic; finish OneDrive sign-in if requested. Use a same-drive destination. |
| Git index or HEAD unreadable   | Use latest remote version in Add existing after reviewing the deletion warning, URL and branch.                                            |
