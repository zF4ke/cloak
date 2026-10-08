import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FolderOpen,
  GitBranch,
  Globe,
  Lock,
  Plus,
} from "lucide-react";
import type { Inspection, ProjectPlan, Snapshot } from "../shared/types.ts";
import { api, message } from "./api.ts";
import { FolderUnlock } from "./folder-unlock.tsx";
import {
  Button,
  Disclosure,
  Icon,
  Modal,
  Notice,
  Toggle,
} from "./components.tsx";

export function Onboarding({
  mode,
  snapshot,
  onClose,
  onDone,
}: {
  mode: ProjectPlan["mode"];
  snapshot: Snapshot;
  onClose(): void;
  onDone(warning?: string): void;
}) {
  const [step, setStep] = useState(0),
    [name, setName] = useState(""),
    [source, setSource] = useState(""),
    [repository, setRepository] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private"),
    [inspection, setInspection] = useState<Inspection>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [recover, setRecover] = useState(false),
    [branch, setBranch] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const errorRegion = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRegion.current?.scrollIntoView({ block: "nearest" });
  }, [error]);
  const reduced = useReducedMotion();
  const existing = Boolean(inspection?.git?.remote),
    title =
      mode === "new"
        ? "New project"
        : mode === "import"
          ? "Add existing project"
          : "Clone repository";
  async function next() {
    setBusy(true);
    setError("");
    try {
      if (step === 0 && mode === "import") {
        const result = await api.inspect(source);
        setInspection(result);
        setName(result.name);
        if (!result.recovery || inspection?.path !== result.path) {
          setRepository(
            result.recovery
              ? (result.recovery.remote ?? "")
              : (result.git?.remote ?? result.name.replace(/\s+/g, "-")),
          );
          setBranch(result.recovery?.branch ?? "");
          setRecover(false);
        }
        if (result.recovery && (inspection?.path !== result.path || !recover))
          return;
      }
      if (step === 0 && mode === "clone") {
        if (!repository.trim())
          throw new Error("Enter a GitHub repository URL.");
        if (!name)
          setName(
            repository
              .replace(/\/$/, "")
              .split(/[/:]/)
              .at(-1)
              ?.replace(/\.git$/, "") ?? "",
          );
      }
      if (step === 0 && mode === "new" && !name.trim())
        throw new Error("Give your project a name.");
      if (step === 0 && mode === "new" && !repository)
        setRepository(name.replace(/\s+/g, "-"));
      if (step === 1 && recover && !repository.trim())
        throw new Error("Enter the GitHub repository URL to restore from.");
      setStep(step + 1);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    setBusy(true);
    setError("");
    try {
      const result = await api.create({
        mode,
        name,
        source,
        repository,
        visibility,
        createRepository: mode !== "clone" && !existing && !recover,
        useRemote: existing || recover,
        recovery: recover
          ? { confirmed: true, branch: branch.trim() || undefined }
          : undefined,
      });
      onDone(result.warning);
    } catch (error) {
      setError(message(error));
      setBusy(false);
    }
  }
  const destination = `${snapshot.settings.projectsFolder.replace(/[\\/]$/, "")}\\${name}`;
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy && !unlockBusy) onClose();
      }}
      footer={
        <>
          <Button
            icon={ArrowLeft}
            disabled={busy || unlockBusy}
            onClick={() => (step ? setStep(step - 1) : onClose())}
          >
            {step ? "Back" : "Cancel"}
          </Button>
          <Button
            tone="primary"
            icon={step === 2 ? Check : ArrowRight}
            busy={busy}
            disabled={
              unlockBusy ||
              !snapshot.gitAvailable ||
              (step === 0 && Boolean(inspection?.recovery) && !recover) ||
              (step === 2 &&
                !existing &&
                !recover &&
                mode !== "clone" &&
                !snapshot.github.login)
            }
            onClick={() => void (step === 2 ? create() : next())}
          >
            {busy && step === 2
              ? recover
                ? "Recovering"
                : "Setting up"
              : step === 2
                ? recover
                  ? "Replace and add"
                  : mode === "import"
                    ? "Add project"
                    : "Create project"
                : "Continue"}
          </Button>
        </>
      }
    >
      <div className="steps" aria-label={`Setup step ${step + 1} of 3`}>
        <div className="step-track" aria-hidden="true">
          <motion.div
            initial={false}
            animate={{ scaleX: step / 2 }}
            style={{ originX: 0 }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: "spring", stiffness: 350, damping: 32 }
            }
          />
        </div>
        {[
          { label: "Folder", icon: FolderOpen },
          { label: "Repository", icon: GitBranch },
          { label: "Ready", icon: Check },
        ].map(({ label, icon }, index) => (
          <div
            className={`step ${index === step ? "current" : index < step ? "complete" : ""}`}
            aria-current={index === step ? "step" : undefined}
            key={label}
          >
            <span>
              <Icon icon={index < step ? Check : icon} />
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: reduced ? 0 : 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduced ? 0 : -8 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
          className="setup-step"
        >
          {step === 0 && mode === "new" && (
            <label className="field">
              Project name
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My project"
              />
            </label>
          )}
          {step === 0 && mode === "import" && (
            <label className="field">
              Project folder
              <div className="input-action">
                <input
                  autoFocus
                  disabled={busy}
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value);
                    setInspection(undefined);
                    setRecover(false);
                    setError("");
                  }}
                  placeholder="C:\Projects\my-project"
                />
                <Button
                  icon={FolderOpen}
                  aria-label="Choose project folder"
                  disabled={busy || !snapshot.desktop}
                  onClick={async () => {
                    const path = await api.chooseFolder({
                      path: source,
                      location: "onedrive",
                    });
                    if (path) {
                      setSource(path);
                      setInspection(undefined);
                      setRecover(false);
                      setError("");
                    }
                  }}
                />
              </div>
            </label>
          )}
          {step === 0 && inspection?.recovery && (
            <div className="recovery-choice">
              <Notice>Git can't read this project.</Notice>
              {inspection.worktree ? (
                <p className="hint">
                  This is a linked Git worktree. Repair it in Git before
                  importing.
                </p>
              ) : (
                <Toggle
                  label="Use latest remote version"
                  checked={recover}
                  disabled={busy}
                  onChange={setRecover}
                  hint="Fresh clone. Deletes all local files and unpublished commits, including ignored files."
                />
              )}
              <Disclosure title="Git error">
                <pre className="log">{inspection.recovery.error}</pre>
              </Disclosure>
            </div>
          )}
          {step === 0 && mode === "clone" && (
            <label className="field">
              GitHub repository
              <input
                autoFocus
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                placeholder="https://github.com/owner/project"
              />
            </label>
          )}
          {step === 1 && (
            <>
              {mode !== "new" && (
                <label className="field">
                  Project name
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}
              {recover ? (
                <>
                  <label className="field">
                    GitHub repository
                    <input
                      value={repository}
                      onChange={(event) => setRepository(event.target.value)}
                      placeholder="https://github.com/owner/project"
                    />
                  </label>
                  <label className="field">
                    Branch
                    <input
                      value={branch}
                      onChange={(event) => setBranch(event.target.value)}
                      placeholder="Remote default"
                    />
                  </label>
                </>
              ) : existing ? (
                <div className="repository-choice">
                  <Icon icon={GitBranch} />
                  <div>
                    <h3>Use this repository</h3>
                    <p>{inspection?.git?.remote}</p>
                  </div>
                  <Icon icon={Check} />
                </div>
              ) : mode === "clone" ? (
                <div className="repository-choice">
                  <Icon icon={GitBranch} />
                  <span>{repository}</span>
                </div>
              ) : (
                <>
                  <label className="field">
                    Repository name
                    <input
                      value={repository}
                      onChange={(event) => setRepository(event.target.value)}
                    />
                  </label>
                  <div className="segmented" aria-label="Repository visibility">
                    {(["private", "public"] as const).map((value) => (
                      <button
                        key={value}
                        aria-pressed={visibility === value}
                        onClick={() => setVisibility(value)}
                      >
                        {visibility === value && (
                          <motion.span
                            layoutId="visibility"
                            className="segment-background"
                            transition={
                              reduced
                                ? { duration: 0 }
                                : {
                                    type: "spring",
                                    stiffness: 480,
                                    damping: 34,
                                  }
                            }
                          />
                        )}
                        <Icon icon={value === "private" ? Lock : Globe} />
                        <span>
                          {value === "private" ? "Private" : "Public"}
                        </span>
                      </button>
                    ))}
                  </div>
                  {visibility === "public" && (
                    <Notice>Anyone can see a public repository.</Notice>
                  )}
                  {!snapshot.github.login && (
                    <Notice>{snapshot.github.error}</Notice>
                  )}
                </>
              )}
            </>
          )}
          {step === 2 && (
            <div className="review">
              {!recover && (
                <div className="review-symbol">
                  <Icon icon={mode === "new" ? Plus : FolderOpen} />
                </div>
              )}
              <h3>{name}</h3>
              {recover && (
                <Notice>
                  Replaces all local files and unpublished commits, including
                  ignored files. The remote repository is unchanged.
                </Notice>
              )}
              <dl>
                {recover && (
                  <div>
                    <dt>Replace</dt>
                    <dd>{inspection?.path}</dd>
                  </div>
                )}
                <div>
                  <dt>Folder</dt>
                  <dd>{destination}</dd>
                </div>
                <div>
                  <dt>Repository</dt>
                  <dd>{repository}</dd>
                </div>
                {recover && (
                  <div>
                    <dt>Branch</dt>
                    <dd>{branch.trim() || "Remote default"}</dd>
                  </div>
                )}
                {!existing && mode !== "clone" && !recover && (
                  <div>
                    <dt>Visibility</dt>
                    <dd>{visibility === "private" ? "Private" : "Public"}</dd>
                  </div>
                )}
                {snapshot.settings.createLinks && (
                  <div>
                    <dt>Shortcut</dt>
                    <dd>
                      {snapshot.settings.linksFolder}\{name}.lnk
                    </dd>
                  </div>
                )}
              </dl>
              {mode === "import" &&
                !recover &&
                inspection?.path !== destination && (
                  <p className="hint">
                    Cloak moves the whole folder, including local files. Close
                    anything using it first.
                  </p>
                )}
              {snapshot.settings.autoPull && (
                <p className="hint">
                  Automatic updates are enabled.{" "}
                  {snapshot.settings.behindEdits === "discard"
                    ? "GitHub's version replaces local edits when this branch is behind."
                    : "Local edits are kept."}
                </p>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {!snapshot.gitAvailable && (
        <Notice>Install Git before setting up a project.</Notice>
      )}
      {error && (
        <div ref={errorRegion}>
          <Notice>{error}</Notice>
          {/folder is open|Windows (?:blocked|could not) mov|\b(?:EBUSY|EPERM|EACCES|UNKNOWN)\b/.test(
            error,
          ) &&
            step === 2 &&
            mode === "import" &&
            inspection && (
              <FolderUnlock
                key={inspection.path}
                path={inspection.path}
                onBusy={setUnlockBusy}
              />
            )}
        </div>
      )}
    </Modal>
  );
}
