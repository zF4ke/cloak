# Release verification

Reviewed on 30 September 2026 against `08b1591` and the accepted [desktop specification](specs/desktop-project-manager.md).

## Code review

Independent reviews checked repository standards and the feature specification. Both final passes reported no remaining material findings.

| Review        | Resolved findings                                                                                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standards     | Process-lock creation, stale recovery and crash-safe release; original CLI streaming and argument forwarding; installer registration ownership; real-path checks before clearing package output.                                  |
| Specification | Preservation of ignored files when ignore rules change; incoming tracked-path collisions including Windows case variants; literal Git filenames; visible retry after a link failure; selected-file commits and tracking branches. |

## Completed checks

- TypeScript check and production build passed.
- All 21 integration tests passed with no skips. They use real local Git repositories and separate processes, plus installer replacement/rollback and a redirected packaging fixture.
- The packaged native app passed preload/IPC and sandbox checks, populated project imports, onboarding, initial progress-track state, dropdown inset, keyboard dismissal and automated WCAG checks with zero reported violations.
- The actual NSIS installer extracted, installed and updated the bundled app. The explicit per-user installation pass verified Windows Installed apps registration, Start menu shortcut and CLI PATH. Settings remained outside application replacement. The installed CLI read the isolated project registry.
- The native installer welcome layout was checked for equal space above and below its complete content group. The owned SVG exports to transparent PNG and ICO.
- Production dependencies reported zero known vulnerabilities at verification time.
- README and guide links resolve. Real app screenshots were inspected. The portable ZIP contains its app and CLI, passes archive integrity checks and excludes test/dev output.

## Limits

Automated Git operations used local remotes. They did not create a new live GitHub test repository or migrate the owner's projects. OneDrive behavior varies by client version; the [junction decision](adr/002-folder-links.md) records Microsoft's support limitation. External editors are not locked during Git updates, so the chosen discard policy can lose concurrent edits. Binaries are unsigned.

Automated accessibility checks cover specific rendered states, not a complete accessibility certification. Broader taste and usability remain matters for real use. The original protection daemon was preserved and its configuration/command bridge checked, but this release did not perform a live OneDrive pause/resume endurance test.
