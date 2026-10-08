import { useState } from "react";
import {
  Cloud,
  FolderOpen,
  Pause,
  Play,
  Save,
  Shield,
  Terminal,
} from "lucide-react";
import type { ProtectionConfig, Snapshot } from "../shared/types.ts";
import { api, message } from "./api.ts";
import { Button, Disclosure, Icon, Modal, Notice } from "./components.tsx";
import { AnimatePresence } from "motion/react";
export function ProtectionView({
  snapshot,
  refresh,
  notify,
}: {
  snapshot: Snapshot;
  refresh(): Promise<void>;
  notify(message: string): void;
}) {
  const [draft, setDraft] = useState<ProtectionConfig>(snapshot.config),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [output, setOutput] = useState("");
  const [manual, setManual] = useState(false),
    [path, setPath] = useState(""),
    [confirm, setConfirm] = useState<"uninstall" | "restore-all">();
  async function command(
    action: Parameters<typeof api.protectionAction>[0],
    path?: string,
  ) {
    setBusy(action);
    setError("");
    try {
      if (action === "install") await api.saveProtection(draft);
      const result = await api.protectionAction(action, path);
      setOutput(result);
      setConfirm(undefined);
      await refresh();
      notify(
        action === "stop"
          ? "Protection stopped. OneDrive can run normally."
          : "Done.",
      );
      return true;
    } catch (error) {
      setError(message(error));
      return false;
    } finally {
      setBusy("");
    }
  }
  async function save() {
    setBusy("save");
    setError("");
    try {
      await api.saveProtection(draft);
      await refresh();
      notify("Saved. Restart protection to apply the changes.");
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>
          <Icon icon={Cloud} />
          OneDrive
        </h1>
      </div>
      <div className="settings-content">
        <section className="protection-overview">
          <div className="protection-symbol">
            <Icon icon={Shield} />
          </div>
          <div>
            <h2>
              {snapshot.protection.error
                ? "Protection status unavailable"
                : snapshot.protection.daemon
                  ? "Protection is on"
                  : "Protection is off"}
            </h2>
            <p>
              {snapshot.protection.daemon
                ? "Cloak pauses OneDrive when watched folders change."
                : "Keep the pause/resume tool for projects that still use OneDrive."}
            </p>
          </div>
          <Button
            tone={snapshot.protection.daemon ? "quiet" : "primary"}
            icon={snapshot.protection.daemon ? Pause : Play}
            busy={!!busy}
            disabled={!snapshot.desktop || Boolean(snapshot.protection.error)}
            onClick={() =>
              void command(
                snapshot.protection.daemon
                  ? "stop"
                  : snapshot.protection.installed
                    ? "start"
                    : "install",
              )
            }
          >
            {snapshot.protection.daemon
              ? "Stop"
              : snapshot.protection.installed
                ? "Start"
                : "Set up"}
          </Button>
        </section>
        {snapshot.protection.error ? (
          <Notice>{snapshot.protection.error}</Notice>
        ) : (
          <div className="cloud-state">
            <Icon icon={Cloud} />
            <span>OneDrive</span>
            <strong>
              {snapshot.protection.oneDrive ? "Running" : "Stopped"}
            </strong>
          </div>
        )}
        {error && <Notice>{error}</Notice>}
        <section className="settings-section protection-config">
          <h2>Watched folders</h2>
          <label className="field">
            <span className="sr-only">Watched folders, one per line</span>
            <textarea
              rows={3}
              value={draft.watchRoots.join("\n")}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  watchRoots: event.target.value.split("\n").filter(Boolean),
                })
              }
            />
          </label>
          <Disclosure title="Timing and exclusions">
            <div className="config-grid">
              {(
                [
                  {
                    key: "idleSeconds",
                    label: "Resume after idle",
                    unit: "seconds",
                    min: 10,
                    max: 3600,
                  },
                  {
                    key: "maxPauseMinutes",
                    label: "Maximum pause",
                    unit: "minutes",
                    min: 1,
                    max: 1440,
                  },
                  {
                    key: "settleMaxMinutes",
                    label: "Maximum sync wait",
                    unit: "minutes",
                    min: 1,
                    max: 1440,
                  },
                  {
                    key: "pollSeconds",
                    label: "Check interval",
                    unit: "seconds",
                    min: 1,
                    max: 60,
                  },
                ] as const
              ).map((field) => (
                <label className="field" key={field.key}>
                  {field.label}
                  <div className="number-unit">
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      value={draft[field.key]}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          [field.key]: Number(event.target.value),
                        })
                      }
                    />
                    <span>{field.unit}</span>
                  </div>
                </label>
              ))}
            </div>
            <label className="field">
              Ignored folders
              <input
                value={draft.ignoreDirs.join(", ")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    ignoreDirs: event.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="node_modules, dist"
              />
            </label>
            <label className="field">
              Ignored filenames
              <input
                value={draft.ignoreFiles.join(", ")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    ignoreFiles: event.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="*.log, *.tmp"
              />
            </label>
          </Disclosure>
          <Button
            icon={Save}
            busy={busy === "save"}
            onClick={() => void save()}
          >
            Save protection settings
          </Button>
        </section>
        <Disclosure title="Activity log">
          <pre className="log">
            {snapshot.protection.log.join("\n") || "No activity yet."}
          </pre>
        </Disclosure>
        <Disclosure title="Manual junction mode">
          <p className="hint">
            The original temporary move-and-restore mode is still available.
            Managed Git projects use permanent local folders instead.
          </p>
          <div className="button-row">
            <Button icon={FolderOpen} onClick={() => setManual(true)}>
              Cloak a folder
            </Button>
            <Button
              busy={busy === "probe"}
              disabled={!snapshot.desktop || !!busy}
              onClick={() => void command("probe")}
            >
              Test OneDrive behavior
            </Button>
          </div>
          {snapshot.protection.legacy.map((entry) => (
            <div className="legacy-row" key={entry.path}>
              <span>{entry.path}</span>
              <Button
                disabled={!!busy}
                onClick={() => void command("off", entry.path)}
              >
                Restore
              </Button>
            </div>
          ))}
          {snapshot.protection.legacy.length > 0 && (
            <Button disabled={!!busy} onClick={() => setConfirm("restore-all")}>
              Restore all
            </Button>
          )}
        </Disclosure>
        <Disclosure title="CLI and installation">
          <div className="cli-line">
            <Icon icon={Terminal} />
            <code>cloak status</code>
          </div>
          <p className="hint">
            The existing CLI also supports start, stop, log, probe, on, off,
            list and restore-all.
          </p>
          {snapshot.protection.installed && (
            <Button tone="danger" onClick={() => setConfirm("uninstall")}>
              Uninstall protection
            </Button>
          )}
        </Disclosure>
        {output && (
          <Disclosure title="Command output">
            <pre className="log">{output}</pre>
          </Disclosure>
        )}
      </div>
      <AnimatePresence>
        {manual && (
          <Modal
            title="Cloak a folder"
            onClose={() => {
              if (!busy) setManual(false);
            }}
            footer={
              <>
                <Button onClick={() => setManual(false)}>Cancel</Button>
                <Button
                  tone="primary"
                  busy={!!busy}
                  disabled={!path || !snapshot.desktop}
                  onClick={async () => {
                    if (await command("on", path)) setManual(false);
                  }}
                >
                  Cloak folder
                </Button>
              </>
            }
          >
            <label className="field">
              Folder
              <div className="input-action">
                <input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                />
                <Button
                  icon={FolderOpen}
                  aria-label="Choose folder to cloak"
                  onClick={async () => {
                    const selected = await api.chooseFolder({
                      path: path || draft.watchRoots[0],
                      location: "onedrive",
                    });
                    if (selected) setPath(selected);
                  }}
                />
              </div>
            </label>
            <p className="hint">
              Moves the folder to local scratch storage and leaves a junction.
              Restore it from this page or the CLI.
            </p>
            {error && <Notice>{error}</Notice>}
          </Modal>
        )}
        {confirm && (
          <Modal
            title={
              confirm === "uninstall"
                ? "Uninstall protection?"
                : "Restore all cloaked folders?"
            }
            onClose={() => {
              if (!busy) setConfirm(undefined);
            }}
            footer={
              <>
                <Button onClick={() => setConfirm(undefined)}>Cancel</Button>
                <Button
                  tone="danger"
                  busy={!!busy}
                  onClick={() => void command(confirm)}
                >
                  {confirm === "uninstall" ? "Uninstall" : "Restore all"}
                </Button>
              </>
            }
          >
            <p>
              {confirm === "uninstall"
                ? "Stops the daemon and removes its startup entry. Managed projects stay where they are."
                : "Moves temporary junction-cloaked folders back into OneDrive, where they can sync again."}
            </p>
            {error && <Notice>{error}</Notice>}
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}
