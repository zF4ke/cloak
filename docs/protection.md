# OneDrive protection

Open OneDrive in the navigation. This is the original activity watcher for ordinary OneDrive projects, independent of managed Git folders.

Enter existing watched folders, one per line, then Set up. Setup deploys the daemon locally and adds its sign-in entry. Start and Stop control it. Stop attempts to resume OneDrive. The page shows current state, log and concrete status failures.

File activity stops the entire OneDrive process so it releases files. After the idle interval, the daemon starts OneDrive. It waits for OneDrive I/O to settle before watching again. Maximum pause gives sync a chance during long sessions. This does not pause an individual folder.

## Configuration

Expand Timing and exclusions in the watched-folder group. Save protection settings changes that group. Restart protection to apply edits. Logs and manual commands remain outside the group.

| Setting            | Default             | Meaning                                         |
| ------------------ | ------------------- | ----------------------------------------------- |
| `watchRoots`       | Chosen during setup | Existing folders whose activity triggers pause. |
| `idleSeconds`      | 90                  | Quiet seconds before resuming.                  |
| `settleMaxMinutes` | 30                  | Maximum wait for sync I/O to settle.            |
| `maxPauseMinutes`  | 45                  | Maximum continuous pause.                       |
| `pollSeconds`      | 5                   | Daemon checking interval.                       |
| `ignoreDirs`       | Empty               | Excluded directory names.                       |
| `ignoreFiles`      | Empty               | Excluded filename globs.                        |
| `scratchDir`       | Local Cloak scratch | Temporary junction storage.                     |

Config is JSON with comments at `%LOCALAPPDATA%\cloak\config.jsonc`. Change scratch storage there. Source installations ask for paths; the template contains no fixed user paths.

## Manual junction mode

Expand Manual junction mode and choose Cloak a folder. The whole folder moves to scratch storage with a junction at its old path. Restore moves it back. These records use separate `state.json`, not the managed-project list.

Test OneDrive behavior runs a short probe on a throwaway folder. Microsoft does not support syncing OneDrive junctions; the probe is an observation, not a permanent guarantee. Download placeholders and close processes using a folder before moving it.

## Remove protection

Expand CLI and installation, then Uninstall protection. This stops the daemon and removes its startup entry without deleting managed projects. Restore temporary folders first if desired. If status is unavailable, inspect the error rather than assuming the daemon is stopped.
