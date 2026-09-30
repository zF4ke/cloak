# Development

Use Windows x64 with Node 24, Git and GitHub CLI. Keep the clone outside OneDrive.

```powershell
npm ci
npm run build
npm start
```

`npm run dev` starts a Vite preview on 5173 and read-only adapter on 43180. Use the desktop build for mutations and native behavior. Remove `ELECTRON_RUN_AS_NODE` from an environment that sets it before opening Electron. If the Electron binary is missing, run `node node_modules/electron/install.js`.

## Verify

```powershell
npm run build
npm test
npm run package
npm run smoke:native
```

Tests use isolated real Git repositories for imports, ignored files, update policies, concurrency, selected commits, tracking branches and corrupt Git metadata. Installer tests cover retained user data, replacement, rollback, running apps and junction refusal.

The native smoke test starts the packaged app and NSIS installer with temporary data. It checks real preload/IPC, sandbox, menu insets, keyboard dismissal, accessibility, setup extraction, copied app and bundled CLI. It does not migrate live projects or modify normal startup/registration. Screenshots go to `tmp/native`. Inspect resized windows, long content, dialogs, keyboard focus and reduced motion after UI changes.

## Package and release

Install [NSIS](https://nsis.sourceforge.io/) and run `npm run installer`. The portable app is `release/Cloak`; the installer is `release/Cloak-Setup-<version>.exe`. Packaging copies pinned Electron, compiled app and original scripts, stamps the icon/version and retains Electron's license files.

Update `package.json`, build, test, inspect UI and review against the feature spec. Zip the portable folder, generate SHA-256 checksums, and publish artifacts targeting the reviewed commit. Explain limitations in release notes. Binaries are unsigned.

The personal UI skill lives in private `zF4ke/skills`. Its README explains installation. `npm run skill:install` expects a sibling skills checkout; pass `-Source` to the PowerShell helper for another path.
