import { Fragment, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { api, errorText } from "../lib/api";
import { APPS, appDef } from "../lib/apps";
import { fmtDate } from "../lib/format";
import { pickFolder } from "../lib/pick";
import { explain, plural } from "../lib/text";
import type { AppStatus, ShowNode, ShowSort } from "../lib/types";
import { useStore } from "../state/store";
import { AppIcon } from "../components/AppLogos";
import { ShowCover } from "../components/ShowCover";

/** Key of a show in the saved order and in the production list. */
const keyOf = (n: ShowNode) => n.id || n.path;

/** A root show is in production if it, or one of its copies, was marked so. */
function inProduction(n: ShowNode, ids: Set<string>): boolean {
  return ids.has(keyOf(n)) || n.children.some((c) => inProduction(c, ids));
}

function sortShows(list: ShowNode[], sort: ShowSort, order: string[], lang: string): ShowNode[] {
  const byModified = (a: ShowNode, b: ShowNode) => b.updated - a.updated;
  const out = [...list];
  if (sort === "name") out.sort((a, b) => a.title.localeCompare(b.title, lang, { sensitivity: "base", numeric: true }));
  else if (sort === "modified") out.sort(byModified);
  else {
    const pos = new Map(order.map((k, i) => [k, i]));
    out.sort((a, b) => (pos.get(keyOf(a)) ?? 1e9) - (pos.get(keyOf(b)) ?? 1e9) || byModified(a, b));
  }
  return out;
}

export function Home() {
  const t = useT();
  const lang = useLang();
  const shows = useStore((s) => s.shows);
  const apps = useStore((s) => s.apps);
  const settings = useStore((s) => s.settings);
  const { setDialog, openShow, showToast, saveSettings } = useStore.getState();
  const [dragKey, setDragKey] = useState<string | null>(null);

  const openFolder = async () => {
    const dir = await pickFolder(t("Open a show folder"));
    if (dir) await openShow(dir);
  };

  const updates = (apps?.apps ?? []).filter((a) => a.status.state === "available").length + (apps?.launcher.status.state === "available" ? 1 : 0);
  const sort: ShowSort = settings?.showSort ?? "modified";
  const prodIds = new Set(settings?.production ?? []);
  const sorted = sortShows(shows, sort, settings?.showOrder ?? [], lang);
  const production = sorted.filter((n) => inProduction(n, prodIds));
  const others = sorted.filter((n) => !inProduction(n, prodIds));

  /** Dropping a card on another one puts it there; the order becomes "personal". */
  const drop = (target: ShowNode) => {
    if (!dragKey || dragKey === keyOf(target)) return;
    const group = production.some((n) => keyOf(n) === dragKey) ? production : others;
    if (!group.some((n) => keyOf(n) === keyOf(target))) return;
    const keys = group.map(keyOf).filter((k) => k !== dragKey);
    keys.splice(keys.indexOf(keyOf(target)), 0, dragKey);
    const full = group === production ? [...keys, ...others.map(keyOf)] : [...production.map(keyOf), ...keys];
    void saveSettings({ showSort: "custom", showOrder: full });
  };

  const grid = (list: ShowNode[]) => (
    <div className="ln-show-list">
      {list.map((s) => (
        <ShowCard
          key={s.path}
          node={s}
          dragging={dragKey === keyOf(s)}
          onDragStart={() => setDragKey(keyOf(s))}
          onDragEnd={() => setDragKey(null)}
          onDrop={() => drop(s)}
        />
      ))}
    </div>
  );

  return (
    <div className="ln-home">
      <section className="ln-suite" aria-labelledby="suite-h">
        <header className="ln-section-head">
          <h2 id="suite-h">{t("Suite")}</h2>
          <span className="ln-grow" />
          <Button className="ln-headbtn" icon="download" onClick={() => useStore.getState().go({ name: "suite" })}>
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
          {shows.length > 1 ? (
            <label className="ln-sort">
              <span>{t("Sort by")}</span>
              <select className="ln-input ln-input--sm" value={sort} onChange={(e) => void saveSettings({ showSort: e.currentTarget.value as ShowSort })}>
                <option value="modified">{t("Last modified")}</option>
                <option value="name">{t("Name")}</option>
                <option value="custom">{t("Personal (drag the cards)")}</option>
              </select>
            </label>
          ) : null}
          <span className="ln-grow" />
          <Button className="ln-headbtn" icon="folderOpen" onClick={() => void openFolder().catch((e) => showToast(errorText(e), "error"))}>
            {t("Open a folder…")}
          </Button>
          <Button className="ln-headbtn" icon="plus" onClick={() => setDialog({ kind: "newShow" })}>
            {t("New show")}
          </Button>
        </header>
        {shows.length === 0 ? (
          <div className="ln-empty">
            <Icon name="curtain" size={30} />
            <strong>{t("No shows yet")}</strong>
            <p>{t("Create your first show, or open a folder you already have. Everything you make for a show stays together in its folder.")}</p>
          </div>
        ) : production.length > 0 ? (
          <>
            <h3 className="ln-group-head"><span className="ln-dot ln-dot--go" />{t("In production")}</h3>
            {grid(production)}
            {others.length > 0 ? (
              <>
                <h3 className="ln-group-head ln-group-head--other">{t("Other shows")}</h3>
                {grid(others)}
              </>
            ) : null}
          </>
        ) : (
          grid(others)
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
  const held = status?.held ?? null;
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
              <span className="ln-suite-card__ver" title={held ? t("You are keeping this version") : undefined}>
                {held ? <Icon name="lock" size={11} /> : null}
                {installed.version}
              </span>
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

interface CardDrag {
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}

function ShowCard({ node, dragging, onDragStart, onDragEnd, onDrop }: { node: ShowNode } & CardDrag) {
  const t = useT();
  const lang = useLang();
  const { openShow, setDialog, showToast } = useStore.getState();
  const [over, setOver] = useState(false);
  const gone = node.missing;
  return (
    <article
      className={`ln-card${gone ? " ln-card--gone" : ""}${dragging ? " ln-card--dragging" : ""}${over && !dragging ? " ln-card--over" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", node.title);
        onDragStart();
      }}
      onDragEnd={() => {
        setOver(false);
        onDragEnd();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
    >
      <button type="button" className="ln-card__main" disabled={gone} onClick={() => void openShow(node.path)} aria-label={t("Open {title}", { title: node.title })}>
        <ShowCover path={node.path} title={node.title} cover={node.cover} height={104} radius="9px 9px 0 0" letter />
        <div className="ln-card__body">
          <div className="ln-card__title">{node.title}</div>
          {/* Always one line, so every card has the same height. */}
          <div className="ln-card__sub">{node.subtitle || "\u00a0"}</div>
          {gone ? (
            <div className="ln-card__warn"><Icon name="alert" size={13} />{t("The folder cannot be found any more.")}</div>
          ) : (
            <div className="ln-card__meta">
              {node.apps.length > 0 ? (
                <span className="ln-card__apps">
                  {node.apps.map((a) => <AppIcon key={a} id={a} size={16} />)}
                </span>
              ) : null}
              <span>{plural(t, node.documents, "1 document", "{n} documents")}</span>
              <span className="ln-dim">·</span>
              <span className="ln-dim">{t("modified on {date}", { date: fmtDate(node.updated, lang) })}</span>
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
