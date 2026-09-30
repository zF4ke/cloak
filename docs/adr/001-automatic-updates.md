# Automatic updates only replace strictly behind branches

Date: 2026-09-30
Status: accepted

## Decision

Check origin when Cloak starts and periodically while its tray app runs. Fetch first, then compare local and remote commits. Equal and ahead branches stay unchanged. Divergence requires manual Git resolution.

For strictly behind branches, the owner's chosen default is `Use GitHub's version`. Reset tracked content to the origin tracking branch and remove nonignored untracked files. Keep ignored local files. The alternative `Keep local edits` blocks updating a dirty project. Explicit Sync always requires a clean working tree after the selected commit.

## Reason

The owner uses GitHub as the authoritative copy between PCs and explicitly chose to discard uncommitted edits when a local branch is behind. A commit comparison alone does not make those edits obsolete, so the UI and docs state this consequence directly.

## Consequences

Automatic updates can delete uncommitted tracked work and nonignored untracked files under the default policy. Equal, ahead and diverged histories do not authorize replacement. A branch change or commit during fetch aborts replacement. Cloak never commits or pushes automatically. External editors and Git clients are not locked by Cloak; do not edit a project during an automatic replacement if those edits must survive.
