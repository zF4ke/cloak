# Release verification

Reviewed on 30 September 2026 against `08b1591` and the accepted [desktop specification](specs/desktop-project-manager.md).

The 0.2.1 recovery change was also reviewed against `d8adbec` and [issue 1](https://github.com/zF4ke/cloak/issues/1). Both review axes reported no remaining material findings after the fixes below.

The 0.2.2 unlock and cleanup change was reviewed against `f29322e` and [issue 2](https://github.com/zF4ke/cloak/issues/2). Standards and specification reviews both reported no remaining material findings. Fixes pin process handles before validating start time, tolerate exited or inaccessible holders, verify original and clone identities before cleanup, preserve retry records after failed deletion and keep cleanup failures from blocking scheduled Git checks.

The cloud-move follow-up was reviewed against `a30c100`. Both final reviews are clear. Provider resume precedes inaccessible metadata reads, native verification returns cloud error codes for retry, deployed watcher upgrades serialize across processes, and browser previews do not refresh protection.

## Code review

Independent reviews checked repository standards and the feature specification. Both final passes reported no remaining material findings.

| Review        | Resolved findings                                                                                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standards     | Process-lock creation, stale recovery and crash-safe release; original CLI streaming and argument forwarding; installer registration ownership; real-path checks before clearing package output.                                  |
| Specification | Preservation of ignored files when ignore rules change; incoming tracked-path collisions including Windows case variants; literal Git filenames; visible retry after a link failure; selected-file commits and tracking branches. |

Recovery review fixed source substitution during cloning, rollback ownership of folder links, stale inspection responses and unreported staging cleanup failures. The UI pass fixed dialog footer overlap and moved the deletion consequence above long paths in final review.

## Completed checks

- TypeScript check and production build passed.
- All 55 integration tests passed with no skips for 0.2.2. New fixtures cover real Windows directory locks, explicit termination, protected processes, process exits during close, mismatched start times, substituted folders, abandoned clones, interrupted installation, altered originals and deletion retries. A disconnected isolated Cloud Files sync root exercises the UNKNOWN move path. Provider readiness is simulated by unregistering that test root, then the actual native move preserves its folder identity and local content. Concurrent watcher upgrades create one replacement and preserve configuration and running intent. Live Ada was inspected for locks but not moved or unlocked.
- All 34 integration tests passed with no skips for 0.2.1. They use real local Git repositories and separate processes, plus installer replacement/rollback and a redirected packaging fixture. Recovery fixtures cover unreadable index/HEAD, origin tracking and remote-default branches, all-file replacement, clone failure, registration rollback, in-place recovery, linked worktree refusal, destination collision, source substitution, external link ownership, retained staging errors and nested junctions.
- The packaged native app passed preload/IPC and sandbox checks, populated project imports, onboarding, initial progress-track state, dropdown inset, keyboard dismissal and automated WCAG checks with zero reported violations.
- The actual NSIS installer extracted, installed and updated the bundled app. The explicit per-user installation pass verified Windows Installed apps registration, Start menu shortcut and CLI PATH. Settings remained outside application replacement. The installed CLI read the isolated project registry.
- The native installer welcome layout was checked for equal space above and below its complete content group. The owned SVG exports to transparent PNG and ICO.
- The 0.2.1 recovery dialog passed keyboard toggle and automated WCAG checks. The deletion warning and final action remain visible at the 620 x 420 CSS viewport used for the minimum-size layout check. The installed CLI refuses an unreadable ordinary import and rejects an invalid recovery URL without changing the source. The per-user update preserved the owner's project registry byte for byte.
- Production dependencies reported zero known vulnerabilities at verification time.
- README and guide links resolve. Real app screenshots were inspected. The portable ZIP contains its app and CLI, passes archive integrity checks and excludes test/dev output.

## Limits

Automated Git operations used local remotes. They did not create a new live GitHub test repository or migrate the owner's projects. OneDrive behavior varies by client version; the [junction decision](adr/002-folder-links.md) records Microsoft's support limitation. External editors are not locked during Git updates, so the chosen discard policy can lose concurrent edits. Binaries are unsigned.

Automated accessibility checks cover specific rendered states, not a complete accessibility certification. Broader taste and usability remain matters for real use. The original protection daemon was preserved and its configuration/command bridge checked, but this release did not perform a live OneDrive pause/resume endurance test.
