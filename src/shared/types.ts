export type Settings = {
  projectsFolder: string;
  linksFolder: string;
  createLinks: boolean;
  autoPull: boolean;
  pollMinutes: number;
  launchAtLogin: boolean;
  behindEdits: "discard" | "keep";
};
export type ManagedProject = {
  id: string;
  name: string;
  path: string;
  link?: string;
  legacyLink?: string;
  remote?: string;
  addedAt: string;
};
export type Change = { path: string; status: string };
export type GitState = {
  branch: string;
  remote?: string;
  changes: Change[];
  ahead: number;
  behind: number;
  hasCommit: boolean;
};
export type ProjectView = ManagedProject & {
  git?: GitState;
  error?: string;
  linkMissing?: boolean;
  update?: { checkedAt: string; message?: string };
};
export type ProtectionConfig = {
  watchRoots: string[];
  idleSeconds: number;
  maxPauseMinutes: number;
  settleMaxMinutes: number;
  pollSeconds: number;
  ignoreDirs: string[];
  ignoreFiles: string[];
  scratchDir: string;
};
export type ProtectionState = {
  daemon: boolean;
  installed: boolean;
  oneDrive: boolean;
  error?: string;
  log: string[];
  legacy: { path: string; scratch: string }[];
};
export type Snapshot = {
  recoveryWarnings?: string[];
  settings: Settings;
  projects: ProjectView[];
  github: { available: boolean; login?: string; error?: string };
  gitAvailable: boolean;
  protection: ProtectionState;
  config: ProtectionConfig;
  desktop: boolean;
};
export type ProjectPlan = {
  mode: "new" | "import" | "clone";
  name: string;
  source?: string;
  repository?: string;
  visibility: "private" | "public";
  createRepository: boolean;
  useRemote: boolean;
  recovery?: { confirmed: true; branch?: string };
};
export type Inspection = {
  path: string;
  name: string;
  git?: GitState;
  inOneDrive: boolean;
  worktree: boolean;
  recovery?: { error: string; remote?: string; branch?: string };
};
export type CloakApi = {
  folderLocks(path: string): Promise<FolderLocks>;
  closeFolderLocks(token: string, force: boolean): Promise<FolderLocks>;
  openUnlockHelp(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  inspect(path: string): Promise<Inspection>;
  create(
    plan: ProjectPlan,
  ): Promise<{ project: ManagedProject; warning?: string }>;
  sync(
    id: string,
    commit?: { message: string; files: string[] },
  ): Promise<void>;
  checkUpdates(): Promise<void>;
  connectRepository(
    id: string,
    repository: string,
    create: boolean,
    visibility: "private" | "public",
  ): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  saveProtection(config: ProtectionConfig): Promise<void>;
  protectionAction(
    action:
      | "install"
      | "uninstall"
      | "start"
      | "stop"
      | "probe"
      | "restore-all"
      | "on"
      | "off",
    path?: string,
  ): Promise<string>;
  repairLink(id: string): Promise<void>;
  changeFolder(id: string, path: string): Promise<void>;
  forget(id: string): Promise<void>;
  openProject(id: string): Promise<void>;
  openRepository(id: string): Promise<void>;
  chooseFolder(): Promise<string | undefined>;
};
export type LockingApp = {
  pid: number;
  name: string;
  started: string;
  protected: boolean;
  canClose: boolean;
};
export type FolderLocks = {
  available: boolean;
  token?: string;
  apps: LockingApp[];
  message?: string;
};
declare global {
  interface Window {
    cloak?: CloakApi;
  }
}
