# Cloak domain terms

| Term                 | Meaning                                                                                                                                      | Example                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Managed project      | A local Git folder recorded in Cloak's project list.                                                                                         | A clone under the configured local Projects folder. |
| Real project folder  | The folder that stores source code, `.git` and local files outside OneDrive.                                                                 | `C:\Users\you\Projects\ada`.                        |
| Project shortcut     | An ordinary Windows shortcut file that opens a real project folder. It does not expose its contents through the synced directory.            | `ada.lnk` alongside ordinary OneDrive projects.     |
| Origin               | The Git remote used to fetch and push a managed project's commits.                                                                           | A GitHub repository URL.                            |
| Tracking branch      | The origin branch that a local branch follows.                                                                                               | Local `work` can track `origin/main`.               |
| Behind               | The remote has commits absent locally, and the local branch has no extra commits.                                                            | A commit pushed on another PC.                      |
| Ahead                | The local branch has commits absent remotely, with no missing remote commits.                                                                | A local commit waiting for explicit Sync.           |
| Diverged             | Both branches contain commits absent from the other.                                                                                         | Both PCs committed separately.                      |
| Local edits          | Tracked modifications and nonignored untracked files that have not been committed.                                                           | A modified source file.                             |
| Check for updates    | Fetch and apply the configured update policy. It never commits or pushes.                                                                    | A tray app interval check.                          |
| Sync                 | Explicitly pull a clean project and push its local commits. The GUI can first commit selected files.                                         | Commit and sync after reviewing changes.            |
| Protection           | The original watcher that pauses and resumes the OneDrive process.                                                                           | Keep working in an ordinary OneDrive project.       |
| Manual junction mode | The original temporary move to scratch storage with a later restore.                                                                         | `cloak on` followed by `cloak off`.                 |
| Registry             | Cloak's local record of settings and managed projects. Not the Windows registry.                                                             | `projects.json`.                                    |
| Repository recovery  | An explicit replacement of an unreadable local project with committed remote content. All local files and unpublished commits are discarded. | Use latest remote version in Add existing.          |
