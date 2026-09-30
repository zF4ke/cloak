# Working on Cloak

Read `CONTEXT.md` and the relevant guide in `docs/` before changing a behavior. The desktop project manager and original OneDrive protection are separate systems. Keep the original CLI available.

Use `docs/specs/desktop-project-manager.md` for the accepted requirements and `docs/design.md` for interface decisions. Preserve the update policy in `docs/adr/001-automatic-updates.md`. Do not reset equal, ahead or diverged projects.

Keep Git and filesystem mutations in `src/core/`, not React components or IPC handlers. Execute commands with argument arrays, without a shell. Validate resolved folder boundaries before moving or recursively deleting files. Never use a live project for an automated test.

Keep native credentials in Git and GitHub CLI. Do not add tokens to Cloak's registry. Preserve sandboxed renderers, explicit IPC methods and sender validation.

Use named reusable controls, consistent insets, keyboard interactions and reduced motion. Inspect real rendered states after UI edits. Native app corners belong to Windows. Record durable design lessons in the `zF4ke/skills` repository without publishing personal reference screenshots here.

Run `npm run build` and the relevant integration tests. Run `npm run smoke:native` after installer, packaging, preload or IPC changes. Use `docs/development.md` for packaging and release instructions. Do not claim a live OneDrive or GitHub operation was verified if only an isolated fixture was tested.

Track substantial follow-up work in GitHub Issues using `docs/agents/issue-tracker.md`. Keep this repository's docs aligned with its actual behavior.
