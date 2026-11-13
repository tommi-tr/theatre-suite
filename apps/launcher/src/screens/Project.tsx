import { useMemo, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Icon, Segmented } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { APPS, appDef } from "../lib/apps";
import { explain, plural } from "../lib/text";
import { PHASES, type Doc, type ExportFile, type Phase, type ProjectView } from "../lib/types";
import { fmtDate } from "../lib/format";
import { useStore } from "../state/store";
import { AppIcon } from "../components/AppLogos";
import { ShowCover } from "../components/ShowCover";

type PhaseFilter = Phase | "all";

export function ProjectScreen({ path }: { path: string }) {
  const t = useT();
  const lang = useLang();
  const view = useStore((s) => s.view);
  const production = useStore((s) => s.settings?.production ?? []);
  const { go, setDialog, reloadProject, showToast, refreshShows } = useStore.getState();
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [showIssues, setShowIssues] = useState(false);

  const docs = view?.project.documents ?? [];
  const counts = useMemo(() => {
    const c: Record<PhaseFilter, number> = { all: docs.length, preparation: 0, rehearsals: 0, show: 0 };
    for (const d of docs) if (d.phase) c[d.phase] += 1;
    return c;
  }, [docs]);

  if (!view || view.path !== path) return null;
  const p = view.project;
  const shown = docs.filter((d) => phase === "all" || d.phase === phase);
  const columns = APPS.filter((a) => !a.soon || docs.some((d) => d.app === a.id));
  const unknown = shown.filter((d) => !appDef(d.app));

  const patch = async (doc: Doc, change: Record<string, unknown>) => {
    try {
      await api.documentSet(path, doc.id, change);
      await reloadProject();
      void refreshShows();
    } catch (e) {
      showToast(explain(t, e), "error");
    }
  };
  const open = async (doc: Doc) => {
    try {
      await api.documentOpen(path, doc.id);
    } catch (e) {
      showToast(explain(t, e), "error");
    }
  };
  const remove = async (doc: Doc) => {
    try {
      await api.documentRemove(path, doc.id);
      await reloadProject();
      void refreshShows();
      showToast(t("“{name}” removed from the show.", { name: fileName(doc.path) }));
    } catch (e) {
      showToast(explain(t, e), "error");
    }
  };
  const openFile = async (f: ExportFile) => {
    try {
      await api.fileOpen(path, f.path);
    } catch (e) {
      showToast(explain(t, e), "error");
    }
  };
  const isProduction = production.includes(p.id);
  const toggleProduction = () => {
    const next = isProduction ? production.filter((x) => x !== p.id) : [...production, p.id];
    void useStore.getState().saveSettings({ production: next });
    showToast(isProduction ? t("Moved out of the shows in production.") : t("Now among the shows in production: it is at the top of the Home."));
  };
  const openAll = async () => {
    try {
      const report = await api.showOpenAll(path);
      if (report.skipped.length > 0) setDialog({ kind: "openAll", report });
      else showToast(plural(t, report.opened.length, "Opened 1 document.", "Opened {n} documents."));
    } catch (e) {
      showToast(explain(t, e), "error");
    }
  };

  const ready = view.readiness;
  const phaseOptions: Array<{ value: PhaseFilter; label: string }> = [
    { value: "all", label: `${t("All")} · ${counts.all}` },
    ...PHASES.map((ph) => ({ value: ph as PhaseFilter, label: `${t(phaseName(ph))} · ${counts[ph]}` })),
  ];

  return (
    <div className="ln-project">
      <header className="ln-hero">
        <ShowCover path={path} title={p.title} cover={p.cover} height={168} radius="0" style={{ position: "absolute", inset: 0, height: "100%" }} />
        <div className="ln-hero__shade" />
        <div className="ln-hero__content">
          <button type="button" className="ln-back" onClick={() => go({ name: "home" })}>
            <Icon name="arrowLeft" size={15} />
            {t("Shows")}
          </button>
          <div className="ln-hero__titles">
            {p.parent ? <div className="ln-hero__kicker">{t("Copy of {title}", { title: p.parent.title })}</div> : null}
            <h1>{p.title}</h1>
            {p.subtitle ? <p>{p.subtitle}</p> : null}
          </div>
          <div className="ln-hero__tools">
            <Button icon="pencil" onClick={() => setDialog({ kind: "details", path })}>{t("Name")}</Button>
            <Button icon="image" onClick={() => setDialog({ kind: "cover", path })}>{t("Change cover")}</Button>
            <Button icon="duplicate" onClick={() => {
              const node = findNode(useStore.getState().shows, path);
              if (node) setDialog({ kind: "copy", node });
            }}>{t("Make a copy")}</Button>
            <Button icon="pin" on={isProduction} aria-pressed={isProduction} title={t("Shows in production stay at the top of the Home")} onClick={toggleProduction}>
              {t("In production")}
            </Button>
            <Button icon="folderOpen" onClick={() => void api.reveal(path).catch((e) => showToast(explain(t, e), "error"))}>{t("Show in folder")}</Button>
          </div>
        </div>
      </header>

      <div className="ln-bar">
        <Segmented<PhaseFilter> ariaLabel={t("Phase")} options={phaseOptions} value={phase} onChange={setPhase} />
        <span className="ln-grow" />
        <ReadyPill ready={ready.ready} inShow={ready.inShow} issues={ready.issues.length} open={showIssues} onToggle={() => setShowIssues(!showIssues)} />
        <Button variant="primary" icon="curtain" disabled={ready.inShow === 0} title={t("Opens the documents in the Show phase")} onClick={() => void openAll()}>
          {t("Open everything for the show")}
        </Button>
      </div>

      {showIssues && ready.issues.length > 0 ? (
        <ul className="ln-issues">
          {ready.issues.map((i, k) => (
            <li key={k}>
              <Icon name="alert" size={14} />
              <strong title={i.docPath}>{fileName(i.docPath)}</strong>
              {i.docTitle !== stem(i.docPath) ? <span className="ln-dim">({i.docTitle})</span> : null}
              <span>{issueText(t, i)}</span>
              {i.kind === "documentMissing" ? (
                <Button variant="sm" icon="trash" onClick={() => {
                  const d = docs.find((x) => x.id === i.docId);
                  if (d) void remove(d);
                }}>
                  {t("Remove from the show")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="ln-columns" data-count={columns.length}>
        {columns.map((def) => {
          const list = shown.filter((d) => d.app === def.id);
          return (
            <section key={def.id} className="ln-col" style={{ ["--app" as string]: def.accent.dark, ["--app-light" as string]: def.accent.light }}>
              <header className="ln-col__head">
                <AppIcon id={def.id} size={26} />
                <div>
                  <h3>{def.name}</h3>
                  <span>{t(def.role)}</span>
                </div>
                <span className="ln-grow" />
                <span className="ln-col__count">{list.length}</span>
              </header>
              <div className="ln-col__list">
                {list.length === 0 ? <div className="ln-col__empty">{t("Nothing here")}</div> : null}
                {list.map((d) => (
                  <DocRow
                    key={d.id}
                    doc={d}
                    exists={view.exists[d.id] !== false}
                    exports={view.exports?.[d.id] ?? []}
                    lang={lang}
                    onOpen={() => void open(d)}
                    onPatch={(c) => void patch(d, c)}
                    onRemove={() => void remove(d)}
                    onOpenFile={(f) => void openFile(f)}
                  />
                ))}
              </div>
              {def.canCreate ? (
                <button type="button" className="ln-col__new" onClick={() => setDialog({ kind: "newDoc", path, app: def.id, phase: phase === "all" ? null : phase })}>
                  <Icon name="plus" size={14} />
                  {t("New document")}
                </button>
              ) : def.soon ? (
                <div className="ln-col__soon">{t("Coming soon")}</div>
              ) : null}
            </section>
          );
        })}
        {unknown.length > 0 ? (
          <section className="ln-col">
            <header className="ln-col__head"><h3>{t("Other")}</h3></header>
            <div className="ln-col__list">
              {unknown.map((d) => (
                <DocRow
                    key={d.id}
                    doc={d}
                    exists={view.exists[d.id] !== false}
                    exports={view.exports?.[d.id] ?? []}
                    lang={lang}
                    onOpen={() => void open(d)}
                    onPatch={(c) => void patch(d, c)}
                    onRemove={() => void remove(d)}
                    onOpenFile={(f) => void openFile(f)}
                  />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** "Audio/Prove.diaframma" → "Prove.diaframma". */
function fileName(rel: string): string {
  return rel.split(/[\\/]/).pop() ?? rel;
}

function stem(rel: string): string {
  return fileName(rel).replace(/\.[^.]+$/, "");
}

function phaseName(ph: Phase): string {
  return ph === "preparation" ? "Preparation" : ph === "rehearsals" ? "Rehearsals" : "Show";
}

function findNode(nodes: import("../lib/types").ShowNode[], path: string): import("../lib/types").ShowNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    const c = findNode(n.children, path);
    if (c) return c;
  }
  return null;
}

function issueText(t: ReturnType<typeof useT>, i: ProjectView["readiness"]["issues"][number]): string {
  switch (i.kind) {
    case "documentMissing":
      return t("the file cannot be found");
    case "unreadable":
      return t("the file cannot be read");
    case "filesMissing":
      return `${plural(t, i.count, "1 sound file is missing", "{n} sound files are missing")}${i.examples.length ? ` (${i.examples.join(", ")}${i.count > i.examples.length ? "…" : ""})` : ""}`;
  }
}

function ReadyPill({ ready, inShow, issues, open, onToggle }: { ready: boolean; inShow: number; issues: number; open: boolean; onToggle: () => void }) {
  const t = useT();
  if (inShow === 0) {
    return (
      <span className="ln-ready ln-ready--none">
        <Icon name="curtain" size={14} />
        <span className="ln-ready__text">{t("No document in the Show phase")}</span>
      </span>
    );
  }
  if (ready) {
    return (
      <span className="ln-ready ln-ready--ok">
        <Icon name="check" size={14} strokeWidth={2.4} />
        <span className="ln-ready__text">{t("Everything is ready for tonight")}</span>
      </span>
    );
  }
  return (
    <button type="button" className="ln-ready ln-ready--warn" onClick={onToggle} aria-expanded={open}>
      <Icon name="alert" size={14} />
      <span className="ln-ready__text">{plural(t, issues, "1 thing to check before the show", "{n} things to check before the show")}</span>
      <Icon name={open ? "chevUp" : "chevDown"} size={13} />
    </button>
  );
}

/** A document of the show. One click selects it, a double click (or Enter) opens it with its app. */
function DocRow({
  doc,
  exists,
  exports,
  lang,
  onOpen,
  onPatch,
  onRemove,
  onOpenFile,
}: {
  doc: Doc;
  exists: boolean;
  exports: ExportFile[];
  lang: string;
  onOpen: () => void;
  onPatch: (c: Record<string, unknown>) => void;
  onRemove: () => void;
  onOpenFile: (f: ExportFile) => void;
}) {
  const t = useT();
  const [showExports, setShowExports] = useState(false);
  return (
    <div className={`ln-docwrap${doc.phase === "show" ? " ln-docwrap--show" : ""}`}>
      <div className={`ln-doc${doc.phase === "show" ? " ln-doc--show" : ""}${exists ? "" : " ln-doc--missing"}`}>
        <button
          type="button"
          className="ln-doc__main"
          onDoubleClick={() => exists && onOpen()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && exists) {
              e.preventDefault();
              onOpen();
            }
          }}
          title={exists ? t("Double click to open") : t("The file cannot be found")}
        >
          <span className="ln-doc__title">{doc.title}</span>
          <span className="ln-doc__path">{exists ? doc.path : `${fileName(doc.path)} · ${t("not found")}`}</span>
        </button>
        {exists ? (
          <select
            className="ln-doc__phase"
            aria-label={t("Phase")}
            value={doc.phase ?? ""}
            onChange={(e) => onPatch({ phase: e.currentTarget.value || null })}
          >
            <option value="">{t("No phase")}</option>
            {PHASES.map((ph) => (
              <option key={ph} value={ph}>{t(phaseName(ph))}</option>
            ))}
          </select>
        ) : (
          <Button variant="sm" icon="trash" title={t("The file is no longer in the folder: take it off the list")} onClick={onRemove}>
            {t("Remove")}
          </Button>
        )}
      </div>
      {exports.length > 0 ? (
        <div className="ln-exports">
          <button type="button" className="ln-exports__toggle" aria-expanded={showExports} onClick={() => setShowExports(!showExports)}>
            <Icon name={showExports ? "chevDown" : "chevRight"} size={12} />
            {plural(t, exports.length, "1 exported copy", "{n} exported copies")}
          </button>
          {showExports ? (
            <ul>
              {exports.map((f) => (
                <li key={f.path}>
                  <button type="button" className="ln-export" title={`${f.path}\n${t("Double click to open")}`} onDoubleClick={() => onOpenFile(f)} onKeyDown={(e) => e.key === "Enter" && onOpenFile(f)}>
                    <span className="ln-export__ext">{f.name.split(".").pop()?.toUpperCase()}</span>
                    <span className="ln-export__name">{f.name}</span>
                    <span className="ln-export__date">{fmtDate(f.modified, lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
