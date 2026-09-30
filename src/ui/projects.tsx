import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  GitBranch,
  Link,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import type { ProjectView, Snapshot, ProjectPlan } from "../shared/types.ts";
import { api, message } from "./api.ts";
import {
  Button,
  Disclosure,
  Icon,
  IconButton,
  Modal,
  Notice,
} from "./components.tsx";
import { Onboarding } from "./onboarding.tsx";
import { SelectField } from "./select.tsx";

export function ProjectsView({
  snapshot,
  refresh,
  notify,
}: {
  snapshot: Snapshot;
  refresh(): Promise<void>;
  notify(message: string): void;
}) {
  const [mode, setMode] = useState<ProjectPlan["mode"]>(),
    [filter, setFilter] = useState(""),
    [selected, setSelected] = useState<string>();
  const [connect, setConnect] = useState<ProjectView>(),
    [commit, setCommit] = useState<ProjectView>(),
    [forget, setForget] = useState<ProjectView>(),
    [busy, setBusy] = useState<string>(),
    [error, setError] = useState("");
  const reduced = useReducedMotion();
  const projects = snapshot.projects.filter((p) =>
    p.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const detail = snapshot.projects.find((p) => p.id === selected);
  async function action(
    id: string,
    operation: () => Promise<unknown>,
    success?: string,
  ) {
    setBusy(id);
    setError("");
    try {
      await operation();
      await refresh();
      if (success) notify(success);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>
          <Icon icon={Folder} />
          Projects
        </h1>
        {snapshot.projects.length > 0 && (
          <IconButton
            label="Check for updates"
            icon={RefreshCw}
            disabled={Boolean(busy)}
            onClick={() =>
              void action(
                "check",
                () => api.checkUpdates(),
                "Projects checked.",
              )
            }
          />
        )}
      </div>
      <div className="action-grid">
        {(
          [
            { mode: "new", label: "New project", icon: Plus, color: "purple" },
            {
              mode: "import",
              label: "Add existing",
              icon: FolderOpen,
              color: "blue",
            },
            {
              mode: "clone",
              label: "Clone repository",
              icon: GitBranch,
              color: "peach",
            },
          ] as const
        ).map((action) => (
          <button
            className={`action-tile ${action.color}`}
            key={action.mode}
            onClick={() => setMode(action.mode)}
          >
            <Icon icon={action.icon} />
            <span>{action.label}</span>
            <Icon icon={ChevronRight} className="tile-arrow" />
          </button>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      {snapshot.projects.length > 3 && (
        <label className="search">
          <Icon icon={Search} />
          <input
            aria-label="Search projects"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Find a project"
          />
        </label>
      )}
      {snapshot.projects.length === 0 ? (
        <div className="empty-projects">
          <Icon icon={Folder} />
          <span>No projects yet</span>
        </div>
      ) : (
        <div className="project-list">
          {projects.map((project) => {
            const changed = project.git?.changes.length ?? 0,
              ahead = project.git?.ahead ?? 0;
            return (
              <motion.div
                layout={!reduced}
                className={`project-row ${selected === project.id ? "selected" : ""}`}
                key={project.id}
                transition={{ type: "spring", stiffness: 450, damping: 36 }}
              >
                <button
                  className="project-select"
                  onClick={() =>
                    setSelected(
                      project.id === selected ? undefined : project.id,
                    )
                  }
                  aria-expanded={selected === project.id}
                >
                  <div className="project-symbol">
                    <Icon icon={Folder} />
                  </div>
                  <div className="project-identity">
                    <strong>{project.name}</strong>
                    <span>
                      <Icon icon={GitBranch} />
                      {project.git?.branch ?? "Unavailable"}
                    </span>
                  </div>
                  <div className="project-status">
                    {project.error ? (
                      "Unavailable"
                    ) : project.update?.message ? (
                      "Needs attention"
                    ) : changed ? (
                      `${changed} ${changed === 1 ? "change" : "changes"}`
                    ) : ahead ? (
                      `${ahead} to push`
                    ) : (
                      <Icon icon={Check} />
                    )}
                  </div>
                </button>
                <div className="row-actions">
                  <IconButton
                    label={`Open ${project.name}`}
                    icon={FolderOpen}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void action(project.id, () => api.openProject(project.id))
                    }
                  />
                  <IconButton
                    label={`Sync ${project.name}`}
                    icon={RefreshCw}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      changed
                        ? setCommit(project)
                        : void action(
                            project.id,
                            () => api.sync(project.id),
                            "Project synced.",
                          )
                    }
                  />
                </div>
              </motion.div>
            );
          })}
          {projects.length === 0 && (
            <p className="no-results">No projects found.</p>
          )}
        </div>
      )}
      <AnimatePresence>
        {detail && (
          <motion.section
            key={detail.id}
            className="project-detail"
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            aria-label={`${detail.name} details`}
          >
            <div className="detail-heading">
              <h2>{detail.name}</h2>
              <Button
                icon={FolderOpen}
                onClick={() =>
                  void action(detail.id, () => api.openProject(detail.id))
                }
              >
                Open folder
              </Button>
            </div>
            <dl className="detail-values">
              <div>
                <dt>Folder</dt>
                <dd>{detail.path}</dd>
              </div>
              {detail.link && (
                <div>
                  <dt>Link</dt>
                  <dd>{detail.link}</dd>
                </div>
              )}
              {detail.git?.remote && (
                <div>
                  <dt>Repository</dt>
                  <dd>
                    <button
                      className="text-link"
                      onClick={() =>
                        void action(detail.id, () =>
                          api.openRepository(detail.id),
                        )
                      }
                    >
                      {detail.git.remote}
                      <Icon icon={ExternalLink} />
                    </button>
                  </dd>
                </div>
              )}
            </dl>
            {(detail.error || detail.update?.message) && (
              <Notice>{detail.error || detail.update?.message}</Notice>
            )}
            {!detail.git?.remote && detail.git && (
              <Button icon={GitBranch} onClick={() => setConnect(detail)}>
                Connect repository
              </Button>
            )}
            {detail.linkMissing && (
              <Button
                icon={Link}
                busy={busy === detail.id}
                onClick={() =>
                  void action(
                    detail.id,
                    () => api.repairLink(detail.id),
                    "Folder link restored.",
                  )
                }
              >
                Restore folder link
              </Button>
            )}
            {!!detail.git?.changes.length && (
              <Disclosure title={`${detail.git.changes.length} local changes`}>
                <ul className="changed-files">
                  {detail.git.changes.slice(0, 100).map((change) => (
                    <li key={change.path}>
                      <code>{change.status.trim()}</code>
                      <span>{change.path}</span>
                    </li>
                  ))}
                </ul>
                {detail.git.changes.length > 100 && (
                  <p className="hint">
                    Open Git to inspect the remaining files.
                  </p>
                )}
              </Disclosure>
            )}
            <div className="detail-footer">
              <Button
                icon={ArrowUp}
                busy={busy === detail.id}
                disabled={Boolean(busy)}
                onClick={() =>
                  detail.git?.changes.length
                    ? setCommit(detail)
                    : void action(
                        detail.id,
                        () => api.sync(detail.id),
                        "Project synced.",
                      )
                }
              >
                Sync
              </Button>
              <Button icon={Trash2} onClick={() => setForget(detail)}>
                Remove from Cloak
              </Button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {mode && (
          <Onboarding
            mode={mode}
            snapshot={snapshot}
            onClose={() => setMode(undefined)}
            onDone={(warning) => {
              setMode(undefined);
              notify(warning || "Project added.");
              void refresh();
            }}
          />
        )}
        {connect && (
          <RepositoryDialog
            project={connect}
            busy={busy === connect.id}
            error={error}
            onClose={() => setConnect(undefined)}
            onSave={async (repository, create, visibility) => {
              await action(
                connect.id,
                async () => {
                  await api.connectRepository(
                    connect.id,
                    repository,
                    create,
                    visibility,
                  );
                  setConnect(undefined);
                },
                "Repository connected.",
              );
            }}
          />
        )}
        {commit && (
          <CommitDialog
            project={commit}
            error={error}
            busy={busy === commit.id}
            onClose={() => setCommit(undefined)}
            onSave={async (data) => {
              await action(
                commit.id,
                async () => {
                  await api.sync(commit.id, data);
                  setCommit(undefined);
                },
                "Changes committed and synced.",
              );
            }}
          />
        )}
        {forget && (
          <Modal
            title={`Remove ${forget.name}?`}
            onClose={() => setForget(undefined)}
            footer={
              <>
                <Button onClick={() => setForget(undefined)}>Cancel</Button>
                <Button
                  tone="danger"
                  busy={busy === forget.id}
                  onClick={() =>
                    void action(forget.id, async () => {
                      await api.forget(forget.id);
                      setForget(undefined);
                      setSelected(undefined);
                    })
                  }
                >
                  Remove
                </Button>
              </>
            }
          >
            <p>
              The folder, link and GitHub repository stay where they are. This
              only removes the project from Cloak's list.
            </p>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}
function CommitDialog({
  project,
  busy,
  error,
  onClose,
  onSave,
}: {
  project: ProjectView;
  busy: boolean;
  error: string;
  onClose(): void;
  onSave(data: { message: string; files: string[] }): Promise<void>;
}) {
  const changes = project.git?.changes ?? [],
    [text, setText] = useState(""),
    [files, setFiles] = useState<string[]>([]);
  return (
    <Modal
      title={`Sync ${project.name}`}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="primary"
            icon={ArrowUp}
            busy={busy}
            disabled={!text.trim() || !files.length}
            onClick={() => void onSave({ message: text, files })}
          >
            Commit and sync
          </Button>
        </>
      }
    >
      <label className="field">
        Commit message
        <input
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="What changed?"
        />
      </label>
      <div className="file-selection">
        <label className="select-all">
          <input
            type="checkbox"
            disabled={changes.length > 200}
            checked={files.length === changes.length}
            onChange={(event) =>
              setFiles(event.target.checked ? changes.map((c) => c.path) : [])
            }
          />
          Select all
        </label>
        {changes.slice(0, 200).map((change) => (
          <label key={change.path}>
            <input
              type="checkbox"
              checked={files.includes(change.path)}
              onChange={(event) =>
                setFiles(
                  event.target.checked
                    ? [...files, change.path]
                    : files.filter((p) => p !== change.path),
                )
              }
            />
            <code>{change.status.trim()}</code>
            <span>{change.path}</span>
          </label>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      {changes.length > 200 && (
        <Notice>
          There are more than 200 changed files. Review the full list in Git.
        </Notice>
      )}
    </Modal>
  );
}

function RepositoryDialog({
  project,
  busy,
  error,
  onClose,
  onSave,
}: {
  project: ProjectView;
  busy: boolean;
  error: string;
  onClose(): void;
  onSave(
    repository: string,
    create: boolean,
    visibility: "private" | "public",
  ): Promise<void>;
}) {
  const [create, setCreate] = useState(true),
    [repository, setRepository] = useState(project.name.replace(/\s+/g, "-")),
    [visibility, setVisibility] = useState<"private" | "public">("private");
  return (
    <Modal
      title="Connect repository"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="primary"
            busy={busy}
            disabled={!repository.trim()}
            onClick={() => void onSave(repository, create, visibility)}
          >
            {create ? "Create repository" : "Connect"}
          </Button>
        </>
      }
    >
      <SelectField
        label="Repository"
        value={create ? "new" : "existing"}
        onChange={(value) => {
          setCreate(value === "new");
          setRepository(
            value === "new" ? project.name.replace(/\s+/g, "-") : "",
          );
        }}
        options={[
          { value: "new", label: "Create on GitHub", icon: Plus },
          {
            value: "existing",
            label: "Use existing repository",
            icon: GitBranch,
          },
        ]}
      />
      <label className="field">
        {create ? "Repository name" : "GitHub URL"}
        <input
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
        />
      </label>
      {create && (
        <SelectField<"private" | "public">
          label="Visibility"
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "private", label: "Private" },
            { value: "public", label: "Public" },
          ]}
        />
      )}
      {error && <Notice>{error}</Notice>}
    </Modal>
  );
}
