/** Shapes of what the native side sends (see crates/theatre-project and src-tauri/src/lib.rs). */

export type Phase = "preparation" | "rehearsals" | "show";
export const PHASES: Phase[] = ["preparation", "rehearsals", "show"];

export interface Cover {
  image?: string | null;
  color?: string | null;
}

export interface ParentRef {
  id: string;
  title: string;
}

export interface Summary {
  path: string;
  id: string;
  title: string;
  subtitle: string;
  cover: Cover;
  documents: number;
  /** Documents in the Show phase. */
  inShow: number;
  apps: string[];
  created: number;
  updated: number;
  lastOpened: number;
  parent: ParentRef | null;
  missing: boolean;
  error: string | null;
}

export interface ShowNode extends Summary {
  children: ShowNode[];
}

export interface Doc {
  id: string;
  app: string;
  title: string;
  path: string;
  phase?: Phase | null;
}

export interface Project {
  id: string;
  title: string;
  subtitle: string;
  cover: Cover;
  parent?: ParentRef | null;
  created: number;
  updated: number;
  documents: Doc[];
}

export type Issue = { docId: string; docTitle: string; docPath: string; app: string } & (
  | { kind: "documentMissing" }
  | { kind: "filesMissing"; count: number; examples: string[] }
  | { kind: "unreadable" }
);

export interface Readiness {
  inShow: number;
  issues: Issue[];
  ready: boolean;
}

export interface ProjectView {
  path: string;
  project: Project;
  exists: Record<string, boolean>;
  /** Copies exported from each Bardo script, found in the show folder. */
  exports: Record<string, ExportFile[]>;
  readiness: Readiness;
  added: number;
  rebuilt: boolean;
}

export interface ExportFile {
  name: string;
  /** Relative to the show folder. */
  path: string;
  modified: number;
}

export interface OpenResult {
  path: string;
  notAShow: boolean;
  rebuilt: boolean;
  foundDocuments: number;
}

export interface Skipped {
  docId: string;
  title: string;
  reason: "notInstalled" | "oneAtATime" | "notNeeded" | "missing" | "failed";
  detail: string;
}

export interface OpenAllReport {
  opened: string[];
  skipped: Skipped[];
}

export interface Settings {
  language: "it" | "en";
  theme: "dark" | "light" | "system";
  weeklyCheck: boolean;
  updateSource: { kind: "github" | "url"; value: string };
  appPaths: Record<string, string>;
  lastCheck: number;
  updateNoticeSeen: boolean;
  showsDir?: string | null;
  /** App id → version the person keeps (no update offered). */
  held: Record<string, string>;
  /** Ids of the shows in production (shown first). */
  production: string[];
  showSort: ShowSort;
  /** Ids in the order chosen by dragging. */
  showOrder: string[];
}

export type ShowSort = "name" | "modified" | "custom";

export interface Latest {
  version: string;
  url: string;
  notes: string;
}

export type UpdateStatus =
  | { state: "notInstalled" }
  | { state: "upToDate" }
  | { state: "available"; latest: string; url: string }
  | { state: "held"; latest: string }
  | { state: "unknown" };

export interface AppStatus {
  id: string;
  name: string;
  installed: { path: string; version: string | null } | null;
  status: UpdateStatus;
  latest: Latest | null;
  /** Every published version, newest first. */
  versions: VersionInfo[];
  held: string | null;
}

export interface VersionInfo {
  version: string;
  published: string;
  notes: string;
  url: string;
  installable: boolean;
  /** Installer already on this computer. */
  kept: boolean;
}

export interface InstallProgress {
  app: string;
  version: string;
  step: "download" | "install" | "done";
  received: number;
  total: number;
}

export interface AppsView {
  apps: AppStatus[];
  launcher: AppStatus;
  checkedAt: number;
  error: string | null;
}
