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

export type Issue = { docId: string; docTitle: string; app: string } & (
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
  readiness: Readiness;
  added: number;
  rebuilt: boolean;
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
  reason: "notInstalled" | "oneAtATime" | "missing" | "failed";
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
}

export interface Latest {
  version: string;
  url: string;
  notes: string;
}

export type UpdateStatus =
  | { state: "notInstalled" }
  | { state: "upToDate" }
  | { state: "available"; latest: string; url: string }
  | { state: "unknown" };

export interface AppStatus {
  id: string;
  name: string;
  installed: { path: string; version: string | null } | null;
  status: UpdateStatus;
  latest: Latest | null;
}

export interface AppsView {
  apps: AppStatus[];
  launcher: AppStatus;
  checkedAt: number;
  error: string | null;
}
