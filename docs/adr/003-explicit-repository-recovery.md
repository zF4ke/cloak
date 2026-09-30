# Explicit recovery replaces an unreadable repository with a fresh clone

Date: 2026-09-30
Status: accepted

## Decision

Offer Use latest remote version only when Add existing cannot read Git metadata or status. Require a separate opt-in and a final Replace and add action. Clone the chosen GitHub branch outside OneDrive before replacing the source. The remote remains unchanged. CLI users supply both `--confirm` and `--use-remote-version`.

## Reason

The owner reported an unreadable Ada index and requested replacement by the latest committed remote version. Ada's HEAD was also unreadable. Repairing the index alone would not cover this damage. A fresh clone does not depend on the damaged object store, refs or index.

## Consequences

Recovery discards the entire old local copy, including ignored files and unpublished commits. The dialog states this next to the opt-in and in final review. Normal import still preserves the whole folder, and automatic updates still preserve ignored files and never replace equal, ahead or diverged histories. Recovery refuses healthy repositories and linked worktrees.

The old folder is displaced temporarily only after a verified clone exists. Registration failure restores the original. Successful registration removes the displaced folder. Failed cleanup, failed rollback or interrupted replacement can leave a `.cloak-recovery-*` directory, which must be inspected before deletion. External editors and OneDrive are not locked by Cloak.
