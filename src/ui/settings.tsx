import { useState } from "react";
import {
  FolderOpen,
  Save,
  Settings as SettingsIcon,
  RefreshCw,
  GitBranch,
} from "lucide-react";
import type { Settings, Snapshot } from "../shared/types.ts";
import { api, message } from "./api.ts";
import { Button, Notice, Toggle } from "./components.tsx";
import { SelectField } from "./select.tsx";
export function SettingsView({
  snapshot,
  refresh,
  notify,
}: {
  snapshot: Snapshot;
  refresh(): Promise<void>;
  notify(message: string): void;
}) {
  const [draft, setDraft] = useState<Settings>(snapshot.settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft({ ...draft, [key]: value });
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.saveSettings(draft);
      await refresh();
      notify("Settings saved.");
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function choose(key: "projectsFolder" | "linksFolder") {
    try {
      const path = await api.chooseFolder();
      if (path) set(key, path);
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>
          <SettingsIcon size={18} aria-hidden="true" />
          Settings
        </h1>
      </div>
      <div className="settings-content">
        <section className="settings-section">
          <h2>
            <FolderOpen size={16} aria-hidden="true" />
            Folders
          </h2>
          <label className="field">
            Real project folders
            <div className="input-action">
              <input
                value={draft.projectsFolder}
                onChange={(event) => set("projectsFolder", event.target.value)}
              />
              <Button
                aria-label="Choose real project folder"
                icon={FolderOpen}
                disabled={!snapshot.desktop}
                onClick={() => void choose("projectsFolder")}
              />
            </div>
          </label>
          <p className="hint">
            Keep these outside OneDrive. Changing this setting affects new
            projects.
          </p>
          <Toggle
            label="Create project shortcuts"
            checked={draft.createLinks}
            onChange={(value) => set("createLinks", value)}
          />
          {draft.createLinks && (
            <label className="field">
              Shortcuts folder
              <div className="input-action">
                <input
                  value={draft.linksFolder}
                  onChange={(event) => set("linksFolder", event.target.value)}
                />
                <Button
                  aria-label="Choose shortcuts folder"
                  icon={FolderOpen}
                  disabled={!snapshot.desktop}
                  onClick={() => void choose("linksFolder")}
                />
              </div>
            </label>
          )}
        </section>
        <section className="settings-section">
          <h2>
            <RefreshCw size={16} aria-hidden="true" />
            Updates
          </h2>
          <Toggle
            label="Get new commits automatically"
            checked={draft.autoPull}
            onChange={(value) => set("autoPull", value)}
          />
          {draft.autoPull && (
            <>
              <div className="setting-row">
                <label htmlFor="interval">Check every</label>
                <div className="number-unit">
                  <input
                    id="interval"
                    type="number"
                    min="1"
                    max="1440"
                    value={draft.pollMinutes}
                    onChange={(event) =>
                      set("pollMinutes", Number(event.target.value))
                    }
                  />
                  <span>minutes</span>
                </div>
              </div>
              <SelectField
                label="Local edits when behind"
                value={draft.behindEdits}
                onChange={(value) => set("behindEdits", value)}
                options={[
                  { value: "discard", label: "Use GitHub's version" },
                  { value: "keep", label: "Keep local edits" },
                ]}
              />
              <p className="hint">
                {draft.behindEdits === "discard"
                  ? "A newer GitHub commit replaces local edits and untracked files. Files ignored by Git stay local."
                  : "Projects with local edits wait for you to sync them."}{" "}
                Ahead or diverged branches are left alone.
              </p>
            </>
          )}
          <Toggle
            label="Launch at sign-in"
            checked={draft.launchAtLogin}
            onChange={(value) => set("launchAtLogin", value)}
            hint="Cloak checks for updates in the tray, even with its window closed."
          />
        </section>
        <section className="settings-section">
          <h2>
            <GitBranch size={16} aria-hidden="true" />
            GitHub
          </h2>
          {snapshot.github.login ? (
            <p className="account">
              <span className="account-avatar">
                {snapshot.github.login.slice(0, 1).toUpperCase()}
              </span>
              {snapshot.github.login}
            </p>
          ) : (
            <Notice>{snapshot.github.error}</Notice>
          )}
        </section>
        {error && <Notice>{error}</Notice>}
        <Button
          tone="primary"
          icon={Save}
          busy={busy}
          onClick={() => void save()}
        >
          Save settings
        </Button>
      </div>
    </>
  );
}
