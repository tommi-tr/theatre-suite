import { Fragment } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { api, errorText } from "../lib/api";
import { APPS, appDef } from "../lib/apps";
import { fmtDate } from "../lib/format";
import { pickFolder } from "../lib/pick";
import { explain, plural } from "../lib/text";
import type { AppStatus, ShowNode } from "../lib/types";
import { useStore } from "../state/store";
import { AppIcon } from "../components/AppLogos";
import { ShowCover } from "../components/ShowCover";

export function Home() {
  const t = useT();
  const shows = useStore((s) => s.shows);
  const apps = useStore((s) => s.apps);
  const { setDialog, openShow, showToast } = useStore.getState();

  const openFolder = async () => {
    const dir = await pickFolder(t("Open a show folder"));
    if (dir) await openShow(dir);
  };

  const updates = (apps?.apps ?? []).filter((a) => a.status.state === "available").length + (apps?.launcher.status.state === "available" ? 1 : 0);

  return (
    <div className="ln-home">
      <section className="ln-suite" aria-labelledby="suite-h">
        <header className="ln-section-head">
          <h2 id="suite-h">{t("Suite")}</h2>
          <span className="ln-grow" />
          <Button icon="download" onClick={() => useStore.getState().go({ name: "suite" })}>
            {t("Explore, install and update")}
            {updates > 0 ? <span className="ln-dot-badge" title={t("New version available")} /> : null}
          </Button>
        </header>
        <div className="ln-suite-row">
          {APPS.map((def) => (
            <SuiteCard key={def.id} id={def.id} status={apps?.apps.find((a) => a.id === def.id) ?? null} />
          ))}
        </div>
      </section>

      <section className="ln-shows" aria-labelledby="shows-h">
        <header className="ln-section-head">
          <h2 id="shows-h">{t("Shows")}</h2>
          <span className="ln-grow" />
          <Button icon="folderOpen" onClick={() => void openFolder().catch((e) => showToast(errorText(e), "error"))}>
            {t("Open a folder…")}
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: "newShow" })}>
            {t("New show")}
          </Button>
        </header>
        {shows.length === 0 ? (
          <div className="ln-empty">
            <Icon name="curtain" size={30} />
            <strong>{t("No shows yet")}</strong>
            <p>{t("Create your first show, or open a folder you already have. Everything you make for a show stays together in its folder.")}</p>
          </div>
        ) : (
          <div className="ln-show-list">
            {shows.map((s) => (
              <ShowCard key={s.path} node={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** One app of the suite, in the row at the top: what it is and whether it can be started. */
function SuiteCard({ id, status }: { id: string; status: AppStatus | null }) {
  const t = useT();
  const def = appDef(id)!;
  const installed = status?.installed ?? null;
  const update = status?.status.state === "available" ? status.status : null;
  return (
    <div className={`ln-suite-card${installed ? "" : " ln-suite-card--off"}`} style={{ ["--app" as string]: def.accent.dark }}>
      <AppIcon id={id} size={40} />
      <div className="ln-suite-card__text">
        <div className="ln-suite-card__name">{def.name}</div>
        <div className="ln-suite-card__role">{t(def.role)}</div>
      </div>
      <div className="ln-suite-card__end">
        {def.soon && !installed ? (
          <span className="ln-chip">{t("Coming soon")}</span>
        ) : installed ? (
          <>
            {update ? (
              <span className="ln-chip ln-chip--update" title={t("New version available")}>{update.latest}</span>
            ) : installed.version ? (
              <span className="ln-suite-card__ver">{installed.version}</span>
            ) : null}
            <Button
              variant="sm"
              onClick={() => void api.appLaunch(id).catch((e) => useStore.getState().showToast(explain(t, e), "error"))}
            >
              {t("Open")}
            </Button>
          </>
        ) : (
          <span className="ln-chip ln-chip--off">{t("Not installed")}</span>
        )}
      </div>
    </div>
  );
}

function ShowCard({ node }: { node: ShowNode }) {
  const t = useT();
  const lang = useLang();
  const { openShow, setDialog, showToast } = useStore.getState();
  const gone = node.missing;
  return (
    <article className={`ln-card${gone ? " ln-card--gone" : ""}`}>
      <button type="button" className="ln-card__main" disabled={gone} onClick={() => void openShow(node.path)} aria-label={t("Open {title}", { title: node.title })}>
        <ShowCover path={node.path} title={node.title} cover={node.cover} height={104} radius="9px 9px 0 0" letter />
        <div className="ln-card__body">
          <div className="ln-card__title">{node.title}</div>
          {node.subtitle ? <div className="ln-card__sub">{node.subtitle}</div> : null}
          {gone ? (
            <div className="ln-card__warn"><Icon name="alert" size={13} />{t("The folder cannot be found any more.")}</div>
          ) : (
            <div className="ln-card__meta">
              <span className="ln-card__apps">
                {node.apps.map((a) => <AppIcon key={a} id={a} size={16} />)}
              </span>
              <span>{plural(t, node.documents, "1 document", "{n} documents")}</span>
              <span className="ln-dim">· {t("modified on {date}", { date: fmtDate(node.updated, lang) })}</span>
            </div>
          )}
        </div>
      </button>

      <div className="ln-card__tools">
        {gone ? null : (
          <>
            <Button variant="ghost" iconOnly icon="folderOpen" aria-label={t("Show in folder")} title={t("Show in folder")} onClick={() => void api.reveal(node.path).catch((e) => showToast(errorText(e), "error"))} />
            <Button variant="ghost" iconOnly icon="duplicate" aria-label={t("Make a copy")} title={t("Make a copy")} onClick={() => setDialog({ kind: "copy", node })} />
          </>
        )}
        <Button variant="ghost" iconOnly icon="x" aria-label={t("Remove from the list")} title={t("Remove from the list")} onClick={() => setDialog({ kind: "forget", node })} />
      </div>

      {node.children.length > 0 ? (
        <div className="ln-copies">
          <div className="ln-copies__head">{plural(t, node.children.length, "1 copy", "{n} copies")}</div>
          <ul>
            <CopyItems nodes={node.children} />
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function CopyItems({ nodes }: { nodes: ShowNode[] }) {
  const t = useT();
  const lang = useLang();
  const openShow = useStore.getState().openShow;
  return (
    <>
      {nodes.map((c) => (
        <Fragment key={c.path}>
          <li>
            <button type="button" className="ln-copy" disabled={c.missing} onClick={() => void openShow(c.path)}>
              <span className="ln-copy__title">{c.title}</span>
              <span className="ln-copy__meta">
                {c.missing
                  ? t("The folder cannot be found any more.")
                  : t("Copied on {copied} · modified on {modified}", { copied: fmtDate(c.created, lang), modified: fmtDate(c.updated, lang) })}
              </span>
            </button>
            {c.children.length > 0 ? (
              <ul>
                <CopyItems nodes={c.children} />
              </ul>
            ) : null}
          </li>
        </Fragment>
      ))}
    </>
  );
}
