# Projects

## Choose folders and sign in

Open Settings. Real project folders defaults to `%USERPROFILE%\Projects` and must resolve outside detected OneDrive roots. Links folder receives optional Windows directory junctions. Changing these roots affects new projects; it does not move existing entries.

Install Git and GitHub CLI. Run `gh auth login` and `gh auth setup-git` in a terminal. Git also needs your name and email for commits. Settings shows the active GitHub CLI account.

## New project

Choose New project, enter a folder name, review the repository name and visibility, then confirm the paths. Private is the default. Cloak creates a Git folder, README and `.gitignore` for common dependencies, build output and credentials. Repository creation does not upload files. Use Sync to select files, make the first commit and push.

## Add existing

Choose the repository root, not a child folder. Cloak inspects Git and shows the existing origin for confirmation. A folder without Git can become a new private repository. Review the folder move and update policy before finishing.

The entire folder moves, including `.git` and ignored local files. Close editors, terminals and servers using it first. Source and destination must be on the same drive. Cloak never replaces an existing destination. Linked Git worktrees cannot be moved this way. Download OneDrive placeholders before importing.

If repository or link setup fails after a move, Cloak keeps and registers the local folder with a warning. Open details to Connect repository or Restore folder link. If Git initialization failed, repair Git in the retained folder first. Do not delete the folder to clear an error.

## Clone repository

Enter a GitHub HTTPS or SSH URL, then confirm the project name and paths. Private repositories need working Git credentials. A clone contains committed files, not another PC's ignored or uncommitted work.

## Project controls

Click a project row to show its real folder, link, repository, changes and concrete errors. Open folder launches Explorer. The repository link opens GitHub. Restore folder link recreates a missing link without replacing another folder. Remove from Cloak only removes the list entry; the folder, junction and GitHub repository remain.

Search appears after three projects. Needs attention means an operation failed; open the row to inspect the reason.

## Updates and Sync

Automatic checks fetch origin at app startup and at the interval in Settings while Cloak runs in the tray. Check for updates does this immediately even with scheduling disabled. No checks happen while the PC is off or Cloak has quit.

Equal and ahead branches retain local contents. Diverged histories require manual Git resolution. A renamed local branch still follows its origin tracking branch. Detached HEAD and branches tracking another remote require manual handling.

For strictly behind branches, Use GitHub's version replaces tracked content and deletes nonignored untracked files. Ignored files remain unless the incoming commit needs that same path as a tracked file. Keep local edits instead blocks updating a dirty folder. A commit or branch switch during fetch aborts replacement. External editors can still write during an operation; use Keep local edits when concurrent work must survive. Automatic checks never commit or push.

Sync explicitly pulls and pushes. With local changes, the app asks for a commit message and file selection. It refuses other already-staged files outside that selection. Remaining unselected edits block pull/push, so a selected commit can succeed while Sync still needs you to deal with other edits. That commit is not reverted. The dialog shows up to 200 changes; review larger sets directly in Git.

## Another PC

Install Cloak, Git and GitHub CLI there, sign in, choose its local roots and Clone repository. Each PC needs its own clone and junction. Push committed work before switching. Transfer ignored credentials, environment files and databases separately. Do not sync `.git`, dependencies or the Cloak registry through OneDrive.

## Recovery

| Problem                        | Action                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Destination or link exists     | Inspect it or choose another name. Cloak will not replace it.                                                |
| Authentication fails           | Run `gh auth status`, `gh auth login` and `gh auth setup-git`, then retry.                                   |
| No commit yet                  | Select files in Sync and make the first commit.                                                              |
| Histories differ               | Resolve the branch in Git, then Sync.                                                                        |
| Missing link                   | Open details and Restore folder link.                                                                        |
| Missing repository after setup | Open details and Connect repository.                                                                         |
| Unreadable registry            | Quit Cloak and repair `%LOCALAPPDATA%\cloak\projects.json`. Keep project folders.                            |
| Move fails                     | Close processes using the folder and use a same-drive destination. The error identifies the retained source. |
