import type { AppsView, ProjectView, Settings, ShowNode } from "./types";

/**
 * Sample data for working on the interface in a normal browser (`pnpm dev`, no Tauri).
 * Nothing here runs inside the real app.
 */
const day = 86400;
const now = Math.floor(Date.now() / 1000);

let settings: Settings = {
  language: "it",
  theme: "dark",
  weeklyCheck: true,
  updateSource: { kind: "github", value: "tommi-tr/theatre-suite" },
  appPaths: {},
  lastCheck: now - 3 * day,
  updateNoticeSeen: false,
  showsDir: null,
  held: {},
  production: ["a"],
  showSort: "modified",
  showOrder: [],
};

const base = { documents: 2, inShow: 3, apps: ["diaframma", "bardo", "cantinella"], lastOpened: now, parent: null, missing: false, error: null, subtitle: "", cover: {} };
const shows: ShowNode[] = [
  {
    ...base, path: "C:\\Teatro\\Amleto 2027", id: "a", title: "Amleto", subtitle: "Stagione 2027 · Teatro Comunale", cover: {}, created: now - 60 * day, updated: now,
    children: [
      { ...base, path: "C:\\Teatro\\Amleto 2027\\Copie\\Tour Nord", id: "a1", title: "Amleto · Tour Nord", created: now - 28 * day, updated: now - 6 * day, parent: { id: "a", title: "Amleto" }, children: [], apps: ["diaframma"], documents: 1, inShow: 1 },
      { ...base, path: "D:\\Chiavetta\\Tour Sud", id: "a2", title: "Amleto · Tour Sud", created: now - 20 * day, updated: now - 20 * day, parent: { id: "a", title: "Amleto" }, children: [], apps: ["diaframma"], documents: 1, inShow: 0 },
    ],
  },
  { ...base, path: "C:\\Teatro\\La locandiera", id: "b", title: "La locandiera", subtitle: "Tournée primavera · Compagnia", cover: { color: "#9a6a2a" }, created: now - 90 * day, updated: now - 3 * day, apps: ["diaframma"], documents: 1, inShow: 1, children: [] },
  { ...base, path: "C:\\Teatro\\Sogno", id: "c", title: "Sogno di una notte di mezza estate", subtitle: "Laboratorio", created: now - 120 * day, updated: now - 28 * day, apps: ["bardo"], documents: 1, inShow: 0, children: [] },
];

const project: ProjectView = {
  path: "C:\\Teatro\\Amleto 2027",
  added: 0,
  rebuilt: false,
  project: {
    id: "a", title: "Amleto", subtitle: "Stagione 2027 · Teatro Comunale", cover: {}, created: now - 60 * day, updated: now,
    documents: [
      { id: "d1", app: "diaframma", title: "Scaletta — Atto I", path: "Audio/Scaletta Atto I.diaframma", phase: "show" },
      { id: "d2", app: "diaframma", title: "Scaletta — Atto II", path: "Audio/Scaletta Atto II.diaframma", phase: "show" },
      { id: "d3", app: "diaframma", title: "Prove sonore", path: "Audio/Prove.diaframma", phase: "rehearsals" },
      { id: "d4", app: "bardo", title: "AMLETO — Copione bozza 2", path: "Copione.bardo", phase: "preparation" },
      { id: "d5", app: "diaframma", title: "Scaletta — prima versione", path: "Audio/Vecchia.diaframma", phase: null },
      { id: "d6", app: "cantinella", title: "Produzione", path: "Amleto - produzione.cantinella", phase: "rehearsals" },
      { id: "d7", app: "cue", title: "Serata", path: "Serata.tcue", phase: "show" },
    ],
  },
  exists: { d1: true, d2: true, d3: true, d4: true, d5: false, d6: true, d7: true },
  exports: {
    d4: [
      { name: "Amleto - copione 2.pdf", path: "Amleto - copione 2.pdf", modified: now - day },
      { name: "Amleto - copione 2 - Ofelia.docx", path: "Esportazioni/Amleto - copione 2 - Ofelia.docx", modified: now - 2 * day },
    ],
  },
  readiness: { inShow: 2, issues: [{ docId: "d2", docTitle: "Scaletta — Atto II", docPath: "Audio/Scaletta Atto II.diaframma", app: "diaframma", kind: "filesMissing", count: 2, examples: ["tuono.wav", "pioggia.mp3"] }], ready: false },
};

const v = (version: string, daysAgo: number, notes = "", kept = false) => ({
  version,
  published: new Date((now - daysAgo * day) * 1000).toISOString(),
  notes,
  url: "https://github.com/tommi-tr/theatre-suite/releases",
  installable: true,
  kept,
});

const apps: AppsView = {
  apps: [
    {
      id: "diaframma", name: "Diaframma", installed: { path: "", version: "0.2.0" }, status: { state: "available", latest: "0.3.0", url: "" },
      latest: { version: "0.3.0", url: "", notes: "" }, held: null,
      versions: [v("0.3.0", 1, "Fade più morbidi, nuova finestra EDITING."), v("0.2.0", 12, "", true), v("0.1.0", 30, "", true)],
    },
    {
      id: "bardo", name: "Bardo", installed: { path: "", version: "0.1.1" }, status: { state: "upToDate" },
      latest: { version: "0.1.1", url: "", notes: "" }, held: null, versions: [v("0.1.1", 2, "", true), v("0.1.0", 9)],
    },
    {
      id: "cantinella", name: "Cantinella", installed: null, status: { state: "available", latest: "0.1.0", url: "" },
      latest: { version: "0.1.0", url: "", notes: "Prima versione: struttura, rubrica, importazione vCard e CSV." }, held: null, versions: [v("0.1.0", 0)],
    },
    {
      id: "cue", name: "Cue", installed: null, status: { state: "available", latest: "0.3.0", url: "" },
      latest: { version: "0.3.0", url: "", notes: "I GO sul copione, le colonne Luci · Audio · Video e lo Show." }, held: null, versions: [v("0.3.0", 0), v("0.2.0", 1), v("0.1.0", 2)],
    },
  ],
  launcher: { id: "launcher", name: "Theatre Suite", installed: { path: "", version: "0.4.4" }, status: { state: "available", latest: "0.4.5", url: "" }, latest: { version: "0.4.5", url: "", notes: "" }, held: null, versions: [v("0.4.5", 0, "Cue nella suite."), v("0.4.4", 1, "", true), v("0.4.3", 2)] },
  checkedAt: now - 3 * day,
  error: null,
};

export async function demo(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case "app_info": return { name: "Theatre Suite", version: "0.4.4", os: "demo" };
    case "startup_show": return null;
    case "settings_load": return settings;
    case "settings_save": settings = args!.settings as Settings; return;
    case "default_shows_dir": return "C:\\Users\\tu\\Documenti\\Theatre Suite";
    case "shows_list": case "shows_rescan": return shows;
    case "project_get": return project;
    case "show_open": return { path: args!.path, notAShow: false, rebuilt: false, foundDocuments: 2 };
    case "show_open_all": return { opened: ["d1"], skipped: [{ docId: "d2", title: "Scaletta — Atto II", reason: "oneAtATime", detail: "Diaframma" }] };
    case "apps_status": case "updates_check": case "app_install": return apps;
    case "app_hold": {
      const a = apps.apps.find((x) => x.id === args!.appId);
      if (a) {
        a.held = args!.keep ? (a.installed?.version ?? null) : null;
        a.status = a.held ? { state: "held", latest: "0.3.0" } : { state: "available", latest: "0.3.0", url: "" };
      }
      return { ...apps };
    }
    case "updates_check_if_due": return null;
    case "copy_size": return 412 * 1024 * 1024;
    case "nested_default": return `${args!.path}\\Copie`;
    case "cover_get": return null;
    case "document_new": return "d9";
    default: return;
  }
}
