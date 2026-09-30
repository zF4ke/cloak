import { useLayoutEffect, useRef, useState } from "react";
import { AppWindow, Download, Unlock } from "lucide-react";
import type { FolderLocks } from "../shared/types.ts";
import { api, message } from "./api.ts";
import { Button, Disclosure, Icon, Notice, Toggle } from "./components.tsx";

export function FolderUnlock({
  path,
  onBusy,
}: {
  path: string;
  onBusy(value: boolean): void;
}) {
  const [report, setReport] = useState<FolderLocks>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [force, setForce] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (report) region.current?.scrollIntoView({ block: "nearest" });
  }, [report]);
  async function act(action: "inspect" | "close" | "end") {
    setBusy(true);
    onBusy(true);
    setError("");
    setForce(false);
    try {
      setReport(
        action === "inspect"
          ? await api.folderLocks(path)
          : await api.closeFolderLocks(report!.token!, action === "end"),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  const groups = new Map<string, number>();
  for (const app of report?.apps ?? [])
    groups.set(app.name, (groups.get(app.name) ?? 0) + 1);
  const closable = report?.apps.some((app) => app.canClose && !app.protected);
  const terminable = report?.apps.some((app) => !app.protected);
  return (
    <div className="folder-unlock" ref={region}>
      {!report ? (
        <Button icon={Unlock} busy={busy} onClick={() => void act("inspect")}>
          Unlock folder
        </Button>
      ) : !report.available ? (
        <>
          <p className="hint">{report.message}</p>
          <Button
            icon={Download}
            disabled={busy}
            onClick={() =>
              void api
                .openUnlockHelp()
                .catch((error) => setError(message(error)))
            }
          >
            Get PowerToys
          </Button>
        </>
      ) : (
        <>
          {report.apps.length > 0 ? (
            <>
              <ul className="locking-apps" aria-label="Apps using this folder">
                {[...groups].map(([name, count]) => (
                  <li key={name}>
                    <Icon icon={AppWindow} />
                    <span>{name}</span>
                    {count > 1 && <span className="hint">×{count}</span>}
                  </li>
                ))}
              </ul>
              {closable ? (
                <Button
                  icon={Unlock}
                  busy={busy}
                  onClick={() => void act("close")}
                >
                  Close apps
                </Button>
              ) : (
                <p className="hint">
                  Close the parent app to release these background tasks.
                </p>
              )}
              {terminable && (
                <Disclosure title="End locking tasks">
                  <Toggle
                    checked={force}
                    onChange={setForce}
                    disabled={busy}
                    label="Discard unsaved work"
                    hint="Stops the listed tasks, including active coding agents."
                  />
                  <Button
                    tone="danger"
                    disabled={!force || busy}
                    busy={busy}
                    onClick={() => void act("end")}
                  >
                    End tasks
                  </Button>
                </Disclosure>
              )}
            </>
          ) : (
            <Notice success>No locking apps found. Retry the import.</Notice>
          )}
          {report.message && report.apps.length > 0 && (
            <p className="hint">{report.message}</p>
          )}
          <Button disabled={busy} onClick={() => void act("inspect")}>
            Check again
          </Button>
        </>
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
