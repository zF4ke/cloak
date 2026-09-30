# Local Git folders with junctions in Projects

Date: 2026-09-30
Status: accepted

## Decision

Store managed Git folders outside detected OneDrive roots. Create optional Windows directory junctions in the configured Projects folder so applications can open them through familiar paths. The owner explicitly requested links rather than ordinary shortcuts.

## Reason

OneDrive previously created conflicting code and Git metadata copies. Git handles commits between PCs; OneDrive should not be the transport for these repositories. Directory junctions preserve normal folder access alongside non-Git projects.

## Consequences

Microsoft does not support syncing symlinks or junctions with OneDrive. Cloak does not guarantee that a OneDrive version will ignore linked contents. The original probe offers a local observation, not a permanent guarantee. Each PC needs its own local clone and link. Import requires a same-drive move and fails without overwriting an existing destination. Removing a project from Cloak keeps its real folder and junction.
