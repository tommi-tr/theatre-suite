import { useEffect, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { appDef } from "../lib/apps";
import { baseName } from "../lib/format";
import { pickFolder } from "../lib/pick";
import { explain, plural } from "../lib/text";
import type { OpenAllReport, Phase, ShowNode } from "../lib/types";
import { useStore } from "../state/store";

const close = () => useStore.getState().setDialog(null);

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="ln-field">
      <span className="ln-field__label">{label}</span>
      {children}
      {hint ? <span className="ln-field__hint">{hint}</span> : null}
    </label>
  );
}

/* ------------------------------------------------------------ new show */

export function NewShowDialog() {
  const t = useT();
  const settings = useStore((s) => s.settings)!;
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [parent, setParent] = useState(settings.showsDir ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!parent) void api.defaultShowsDir().then(setParent).catch(() => {});
  }, [parent]);

  const create = async () => {
    if (!title.trim() || !parent) return;
    setBusy(true);
    setError("");
    try {
      const path = await api.showCreate(title.trim(), subtitle.trim(), parent);
      await useStore.getState().saveSettings({ showsDir: parent });
      await useStore.getState().refreshShows();
      close();
      await useStore.getState().openShow(path);
    } catch (e) {
      setError(explain(t, e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("New show")}
      icon="curtain"
      width={520}
      onClose={close}
      description={t("A show is a folder. Everything you make for it goes inside.")}
      footer={
        <>
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!title.trim() || !parent || busy} onClick={() => void create()}>{t("Create show")}</Button>
        </>
      }
    >
      <div className="ln-form">
        <Field label={t("Title")}>
          <input className="ln-input" value={title} autoFocus placeholder={t("For example: Hamlet")} onChange={(e) => setTitle(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
        </Field>
        <Field label={t("Season, venue, company (optional)")}>
          <input className="ln-input" value={subtitle} onChange={(e) => setSubtitle(e.currentTarget.value)} />
        </Field>
        <Field label={t("Where to create the folder")} hint={t("A folder with the title of the show will be created here.")}>
          <div className="ln-pathrow">
            <input className="ln-input" value={parent} readOnly />
            <Button onClick={() => void pickFolder(t("Choose where to create the show"), parent).then((d) => d && setParent(d))}>{t("Choose…")}</Button>
          </div>
        </Field>
        {error ? <div className="ln-error">{error}</div> : null}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------- folder without index */

export function AdoptDialog({ path, found }: { path: string; found: number }) {
  const t = useT();
  const [title, setTitle] = useState(baseName(path));
  const [error, setError] = useState("");
  const go = async () => {
    try {
      await api.showAdopt(path, title.trim());
      close();
      await useStore.getState().refreshShows();
      await useStore.getState().openShow(path);
    } catch (e) {
      setError(explain(t, e));
    }
  };
  return (
    <Dialog
      title={t("Use this folder as a show?")}
      icon="folderOpen"
      width={500}
      onClose={close}
      description={
        found > 0
          ? t("This folder is not a show yet, but it contains {docs}. They will be listed; no file is moved or changed.", { docs: plural(t, found, "1 document of the suite", "{n} documents of the suite") })
          : t("This folder is not a show yet and contains no documents of the suite. It will become an empty show.")
      }
      footer={
        <>
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!title.trim()} onClick={() => void go()}>{t("Use as a show")}</Button>
        </>
      }
    >
      <div className="ln-form">
        <Field label={t("Title")}>
          <input className="ln-input" value={title} autoFocus onChange={(e) => setTitle(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && void go()} />
        </Field>
        <div className="ln-pathline">{path}</div>
        {error ? <div className="ln-error">{error}</div> : null}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------- forget */

export function ForgetDialog({ node }: { node: ShowNode }) {
  const t = useT();
  return (
    <Dialog
      title={t("Remove “{title}” from the list?", { title: node.title })}
      icon="x"
      width={480}
      onClose={close}
      description={t("The folder and all its files stay where they are. You can add the show again with “Open a folder…”.")}
      footer={
        <>
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api.showForget(node.path);
                await useStore.getState().refreshShows();
                close();
              } catch (e) {
                useStore.getState().showToast(explain(t, e), "error");
              }
            }}
          >
            {t("Remove from the list")}
          </Button>
        </>
      }
    />
  );
}

/* ---------------------------------------------------- name and subtitle */

export function DetailsDialog({ path }: { path: string }) {
  const t = useT();
  const view = useStore((s) => s.view);
  const [title, setTitle] = useState(view?.project.title ?? "");
  const [subtitle, setSubtitle] = useState(view?.project.subtitle ?? "");
  const [error, setError] = useState("");
  const save = async () => {
    if (!title.trim()) return;
    try {
      await api.projectSetMeta(path, title, subtitle);
      close();
      await useStore.getState().reloadProject();
      await useStore.getState().refreshShows();
    } catch (e) {
      setError(explain(t, e));
    }
  };
  return (
    <Dialog
      title={t("Name of the show")}
      icon="pencil"
      width={500}
      onClose={close}
      description={t("The folder keeps its name; only what you see in the suite changes.")}
      footer={
        <>
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!title.trim()} onClick={() => void save()}>{t("Save")}</Button>
        </>
      }
    >
      <div className="ln-form">
        <Field label={t("Title")}>
          <input className="ln-input" value={title} autoFocus onChange={(e) => setTitle(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
        </Field>
        <Field label={t("Season, venue, company (optional)")}>
          <input className="ln-input" value={subtitle} onChange={(e) => setSubtitle(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
        </Field>
        {error ? <div className="ln-error">{error}</div> : null}
      </div>
    </Dialog>
  );
}

/* --------------------------------------------------------- new document */

export function NewDocDialog({ path, app, phase }: { path: string; app: string; phase: Phase | null }) {
  const t = useT();
  const def = appDef(app);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const create = async () => {
    if (!title.trim()) return;
    try {
      const id = await api.documentNew(path, app, title.trim());
      if (phase) await api.documentSet(path, id, { phase });
      close();
      await useStore.getState().reloadProject();
      await useStore.getState().refreshShows();
    } catch (e) {
      setError(explain(t, e));
    }
  };
  return (
    <Dialog
      title={t("New document · {app}", { app: def?.name ?? app })}
      width={480}
      onClose={close}
      description={t("An empty document is created in the show folder. You open it with {app} when you want to work on it.", { app: def?.name ?? app })}
      footer={
        <>
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!title.trim()} onClick={() => void create()}>{t("Create")}</Button>
        </>
      }
    >
      <div className="ln-form">
        <Field label={t("Name")}>
          <input className="ln-input" value={title} autoFocus placeholder={app === "bardo" ? t("For example: Hamlet — script") : app === "cantinella" ? t("For example: Production") : app === "cue" ? t("For example: The evening show") : t("For example: Cue list — Act I")} onChange={(e) => setTitle(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
        </Field>
        {error ? <div className="ln-error">{error}</div> : null}
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------- what "open all" skipped */

export function OpenAllDialog({ report }: { report: OpenAllReport }) {
  const t = useT();
  const docs = useStore((s) => s.view?.project.documents ?? []);
  /** The file name with its extension, so it is clear which file it is. */
  const fileOf = (id: string) => docs.find((d) => d.id === id)?.path.split(/[\\/]/).pop() ?? "";
  const reason = (r: OpenAllReport["skipped"][number]): string => {
    switch (r.reason) {
      case "notInstalled": return t("{name} is not installed", { name: r.detail });
      case "notNeeded": return t("not needed: {name} is not used while Cue runs the show", { name: r.detail });
      case "oneAtATime": return t("{name} opens one document at a time: open this one from the list", { name: r.detail });
      case "missing": return t("the file {file} cannot be found", { file: r.detail });
      default: return r.detail || t("it could not be started");
    }
  };
  return (
    <Dialog
      title={report.opened.length > 0 ? t("Some documents were not opened") : t("Nothing could be opened")}
      icon="alert"
      width={540}
      onClose={close}
      description={report.opened.length > 0 ? plural(t, report.opened.length, "1 document was opened.", "{n} documents were opened.") : undefined}
      footer={<Button variant="primary" onClick={close}>{t("OK")}</Button>}
    >
      <ul className="ln-skiplist">
        {report.skipped.map((s) => (
          <li key={s.docId}>
            <strong>{fileOf(s.docId) || s.title}</strong>
            {fileOf(s.docId) && fileOf(s.docId).replace(/\.[^.]+$/, "") !== s.title ? <span className="ln-dim">({s.title})</span> : null}
            <span>{reason(s)}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
