import { useMemo } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { anchorAtPoint, scriptLive } from "../script/view";
import { useScriptDoc } from "../script/store";
import { usable, type AudioItem, type LightItem, type LoadedSource } from "../model/sources";
import { useLibrary } from "../store/library";
import { useDoc } from "../store/doc";
import { useItemThumb } from "../projection/usePicture";
import type { ProjectionItem } from "../model/show";
import { addItemAt, newGoHere } from "./actions";
import { endItemDrag, startItemDrag, type DragPayload } from "./drag";
import { fmtDuration } from "./format";
import { useLibraryUi, type LibTab } from "./libraryUi";
import { MiniThumb } from "./MiniThumb";
import { SourcesArea } from "./SourcesArea";
import "./prepare.css";

const TABS: { id: LibTab; label: string }[] = [
  { id: "lights", label: "Lights" },
  { id: "audio", label: "Audio" },
  { id: "video", label: "Video" },
];

/** "Nuovo GO qui" (N): the selected library item, or an empty GO, at the reading point of the script. */
export async function placeHere(): Promise<boolean> {
  const c = scriptLive.centre();
  const anchor = c ? await anchorAtPoint(c.x, c.y) : null;
  if (!anchor) return false;
  const item = useLibraryUi.getState().selected;
  if (item) addItemAt(anchor, item);
  else newGoHere(anchor);
  return true;
}

const matches = (q: string, ...fields: (string | number | null)[]) => !q || fields.some((f) => f !== null && String(f).toLowerCase().includes(q));

/** The libraries on the left of Prepara: linked files, then Luci · Audio · Video with search; items drag onto the script. */
export function LibraryPanel() {
  const t = useT();
  const tab = useLibraryUi((s) => s.tab);
  const query = useLibraryUi((s) => s.query);
  const selected = useLibraryUi((s) => s.selected);
  const library = useLibrary((s) => s.library);
  const scriptReady = useScriptDoc((s) => s.status === "ready");
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    if (tab === "video") return [];
    const app = tab === "lights" ? "granvelo" : "diaframma";
    return library.sources.filter((s) => s.link.app === app && usable(s));
  }, [library, tab]);
  const linked = library.sources.some((s) => s.link.app === (tab === "lights" ? "granvelo" : "diaframma"));

  return (
    <aside className="cue-library cue-lib" aria-label={t("Libraries")}>
      <SourcesArea />
      <div className="cue-lib__tabs" role="tablist" aria-label={t("Libraries")}>
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            className={`cue-lib__tab cue-lib__tab--${x.id}`}
            onClick={() => useLibraryUi.getState().setTab(x.id)}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      {tab !== "video" ? (
        <label className="cue-lib__search">
          <Icon name="search" size={13} />
          <input
            className="cue-lib__input"
            type="search"
            value={query}
            placeholder={t("Search…")}
            aria-label={t("Search in the library")}
            onChange={(e) => useLibraryUi.getState().setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), useLibraryUi.getState().setQuery(""))}
          />
        </label>
      ) : null}
      <div className="cue-lib__scroll" role="tabpanel">
        {tab === "video" ? (
          <VideoList selected={selected} />
        ) : !linked ? (
          <p className="cue-lib__note">{tab === "lights" ? t("Link a Granvelo file to see its light memories here.") : t("Link a Diaframma file to see its sound tracks here.")}</p>
        ) : groups.length === 0 ? (
          <p className="cue-lib__note">{t("The linked file cannot be used now: see Linked files above.")}</p>
        ) : (
          groups.map((s) => (tab === "lights" ? <LightGroup key={s.link.id} source={s} q={q} selected={selected} /> : <AudioGroup key={s.link.id} source={s} q={q} selected={selected} />))
        )}
      </div>
      <div className="cue-lib__foot">
        <p className="cue-library__hint">{t("Drag onto the script to create a GO")}</p>
        <Button
          variant="sm"
          kbd="N"
          disabled={!scriptReady}
          title={selected ? t("The selected item at the reading point of the script") : t("An empty GO at the reading point of the script")}
          onClick={() => void placeHere()}
        >
          {t("New GO here")}
        </Button>
      </div>
    </aside>
  );
}

/** The Video tab: the steps of the sequence, then its images and videos (made in Proiezioni). */
function VideoList({ selected }: { selected: DragPayload | null }) {
  const t = useT();
  const items = useDoc((s) => s.show?.projection.items ?? []);
  const rows: { payload: DragPayload; name: string; sub?: string; thumb?: ProjectionItem; step?: boolean }[] = [
    { payload: { kind: "projection", sourceId: "", itemId: "@next" }, name: t("Next step"), sub: t("The next image of the sequence"), step: true },
    { payload: { kind: "projection", sourceId: "", itemId: "@previous" }, name: t("Previous step"), sub: t("The image before"), step: true },
    ...items.map((i) => ({ payload: { kind: "projection" as const, sourceId: "", itemId: i.id }, name: i.name, sub: i.kind === "video" ? `${t("video")}${i.durationSec ? ` · ${fmtDuration(i.durationSec)}` : ""}` : i.kind === "slide" ? t("slide") : undefined, thumb: i })),
  ];
  return (
    <section>
      {rows.map((r) => (
        <div
          key={r.payload.itemId}
          className={`cue-item cue-item--video${same(selected, r.payload) ? " cue-item--on" : ""}`}
          draggable
          role="option"
          aria-selected={same(selected, r.payload)}
          tabIndex={0}
          onDragStart={(e) => startItemDrag(e, r.payload)}
          onDragEnd={endItemDrag}
          onClick={() => useLibraryUi.getState().select(same(selected, r.payload) ? null : r.payload)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              useLibraryUi.getState().select(same(selected, r.payload) ? null : r.payload);
            }
          }}
        >
          {r.thumb ? <VideoThumb item={r.thumb} /> : <span className="cue-vthumb cue-vthumb--step"><Icon name="nextF" size={11} /></span>}
          <span className="cue-item__body">
            <span className="cue-item__name ts-ellipsis">{r.name}</span>
            {r.sub ? <span className="cue-item__sub ts-ellipsis">{r.sub}</span> : null}
          </span>
        </div>
      ))}
      {items.length === 0 ? <p className="cue-lib__note">{t("No images yet: add them in Projections.")}</p> : null}
    </section>
  );
}

function VideoThumb({ item }: { item: ProjectionItem }) {
  const url = useItemThumb(item);
  return <span className="cue-vthumb" style={url ? { backgroundImage: `url(${url})` } : undefined} aria-hidden="true" />;
}

const same = (a: DragPayload | null, b: DragPayload) => !!a && a.kind === b.kind && a.sourceId === b.sourceId && a.itemId === b.itemId;

function GroupHead({ source, count }: { source: LoadedSource; count: number }) {
  const t = useT();
  return (
    <div className="cue-lib__group">
      <span className="ts-ellipsis" title={source.link.path}>
        {source.title}
      </span>
      {source.status.state === "otherDocument" ? <Icon name="alert" size={12} /> : null}
      <span className="cue-lib__groupn" aria-label={t("{n} items", { n: count })}>
        {count}
      </span>
    </div>
  );
}

function LightGroup({ source, q, selected }: { source: LoadedSource; q: string; selected: DragPayload | null }) {
  const t = useT();
  const items = source.lights.filter((l) => matches(q, l.name, l.number, l.note));
  return (
    <section>
      <GroupHead source={source} count={items.length} />
      {items.length === 0 ? <p className="cue-lib__note">{q ? t("Nothing found.") : t("No memories in this file.")}</p> : items.map((l) => <LightRow key={l.id} item={l} selected={selected} />)}
    </section>
  );
}

function LightRow({ item, selected }: { item: LightItem; selected: DragPayload | null }) {
  const t = useT();
  const payload: DragPayload = { kind: "light", sourceId: item.key.sourceId, itemId: item.key.itemId };
  return (
    <div
      className={`cue-item cue-item--lights${same(selected, payload) ? " cue-item--on" : ""}`}
      draggable
      role="option"
      aria-selected={same(selected, payload)}
      tabIndex={0}
      title={item.note || undefined}
      onDragStart={(e) => startItemDrag(e, payload)}
      onDragEnd={endItemDrag}
      onClick={() => useLibraryUi.getState().select(same(selected, payload) ? null : payload)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          useLibraryUi.getState().select(same(selected, payload) ? null : payload);
        }
      }}
    >
      <span className="cue-item__num">{item.number}</span>
      <MiniThumb thumb={item.thumbnail} />
      <span className="cue-item__body">
        <span className="cue-item__name ts-ellipsis">{item.name || t("(no name)")}</span>
        {item.note ? <span className="cue-item__sub ts-ellipsis">{item.note}</span> : null}
      </span>
      {item.startsByItself ? (
        <span className="cue-item__auto" title={t("Starts by itself after the memory before it")}>
          <Icon name="nextF" size={11} />
        </span>
      ) : null}
    </div>
  );
}

function AudioGroup({ source, q, selected }: { source: LoadedSource; q: string; selected: DragPayload | null }) {
  const t = useT();
  const items = source.audio.filter((a) => !a.hidden && a.hasFile && matches(q, a.name, a.number));
  return (
    <section>
      <GroupHead source={source} count={items.length} />
      {items.length === 0 ? <p className="cue-lib__note">{q ? t("Nothing found.") : t("No tracks in this file.")}</p> : items.map((a) => <AudioRow key={a.id} item={a} selected={selected} />)}
    </section>
  );
}

function AudioRow({ item, selected }: { item: AudioItem; selected: DragPayload | null }) {
  const t = useT();
  const payload: DragPayload = { kind: "audio", sourceId: item.key.sourceId, itemId: item.key.itemId };
  const noFile = item.path === null;
  return (
    <div
      className={`cue-item cue-item--audio${same(selected, payload) ? " cue-item--on" : ""}`}
      draggable
      role="option"
      aria-selected={same(selected, payload)}
      tabIndex={0}
      onDragStart={(e) => startItemDrag(e, payload)}
      onDragEnd={endItemDrag}
      onClick={() => useLibraryUi.getState().select(same(selected, payload) ? null : payload)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          useLibraryUi.getState().select(same(selected, payload) ? null : payload);
        }
      }}
    >
      <span className="cue-item__num">{item.number ?? ""}</span>
      <span className="cue-item__body">
        <span className="cue-item__name ts-ellipsis">{item.name}</span>
        <span className="cue-item__sub">
          {fmtDuration(item.durationSec)}
          {item.loop ? ` · ${t("loop")}` : ""}
          {noFile ? <span className="cue-item__warn"> · {t("audio file not found")}</span> : null}
        </span>
      </span>
      {item.startsByItself ? (
        <span className="cue-item__auto" title={item.start === "crossfadeFromPrevious" ? t("Starts by itself, crossfading with the track before") : t("Starts by itself when the track before ends")}>
          <Icon name="nextF" size={11} />
        </span>
      ) : null}
    </div>
  );
}
