# Project shortcuts alongside ordinary synced projects

Date: 2026-10-01
Status: accepted
Supersedes: [Local Git folders with junctions](002-folder-links.md)

## Decision

Keep managed repositories outside OneDrive. Create ordinary Windows `.lnk` folder shortcuts in the existing synced Projects folder. Ordinary projects in that folder continue syncing through OneDrive. The owner accepted shortcuts after observing OneDrive write through junctions.

## Reason

OneDrive followed Ada's junction and rewrote tracked files, created device-suffixed copies and left a checkpoint reference to a missing object. An outside clone alone does not isolate it when a filesystem link exposes its contents inside OneDrive. Pausing and resuming the activity watcher also cannot provide permanent isolation.

## Consequences

Explorer opens a shortcut's local target. Editors, terminals and coding agents use the real folder path outside OneDrive. A shortcut can sync as a small file, but each PC needs its own clone and shortcut target. Cloak validates shell targets and refuses to overwrite unrelated entries. Deleting a shortcut cannot delete the real repository.

Desktop startup converts registered legacy junctions when project shortcuts are enabled. Conversion creates and registers the replacement before deleting only the recorded junction whose target and identity match. Failed removal stays recorded for retry; a substituted real folder is preserved. Read-only preview and CLI discovery do not migrate links. `cloak shortcuts [project name] --confirm` repairs shortcuts explicitly.

The original manual junction CLI remains available as a separate tool. It does not guarantee OneDrive isolation. Existing registry field names `link`, `linksFolder` and `createLinks` are retained for compatibility; the managed-project UI calls them shortcuts.
