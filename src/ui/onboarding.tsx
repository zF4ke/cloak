import { useState } from "react";
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
import { Button, Icon, Modal, Notice } from "./components.tsx";

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
        setRepository(result.git?.remote ?? result.name.replace(/\s+/g, "-"));
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
        createRepository: mode !== "clone" && !existing,
        useRemote: existing,
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
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button
            icon={ArrowLeft}
            disabled={busy}
            onClick={() => (step ? setStep(step - 1) : onClose())}
          >
            {step ? "Back" : "Cancel"}
          </Button>
          <Button
            tone="primary"
            icon={step === 2 ? Check : ArrowRight}
            busy={busy}
            disabled={
              !snapshot.gitAvailable ||
              (step === 2 &&
                !existing &&
                mode !== "clone" &&
                !snapshot.github.login)
            }
            onClick={() => void (step === 2 ? create() : next())}
          >
            {busy && step === 2
              ? "Setting up"
              : step === 2
                ? mode === "import"
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
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="C:\Projects\my-project"
                />
                <Button
                  icon={FolderOpen}
                  aria-label="Choose project folder"
                  disabled={!snapshot.desktop}
                  onClick={async () => {
                    const path = await api.chooseFolder();
                    if (path) setSource(path);
                  }}
                />
              </div>
            </label>
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
              {existing ? (
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
              <div className="review-symbol">
                <Icon icon={mode === "new" ? Plus : FolderOpen} />
              </div>
              <h3>{name}</h3>
              <dl>
                <div>
                  <dt>Folder</dt>
                  <dd>{destination}</dd>
                </div>
                <div>
                  <dt>Repository</dt>
                  <dd>{repository}</dd>
                </div>
                {!existing && mode !== "clone" && (
                  <div>
                    <dt>Visibility</dt>
                    <dd>{visibility === "private" ? "Private" : "Public"}</dd>
                  </div>
                )}
                {snapshot.settings.createLinks && (
                  <div>
                    <dt>Folder link</dt>
                    <dd>
                      {snapshot.settings.linksFolder}\{name}
                    </dd>
                  </div>
                )}
              </dl>
              {mode === "import" && inspection?.path !== destination && (
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
      {error && <Notice>{error}</Notice>}
    </Modal>
  );
}
