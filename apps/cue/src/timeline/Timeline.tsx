import { useItemThumb } from "../projection/usePicture";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT, type TFunc } from "@theatre-suite/core";
import { Icon } from "@theatre-suite/ui";
import { actionDept, audioEngineTrackId, numberGos, sortGos, type Action, type Dept, type Go, type GoNumber } from "../model/gos";
import { columns as columnsOf, goViews, type GoView } from "../model/playback";
import { draggedAudioHeight, layoutTimeline, BUTTON_H, type Timeline as TL, type TimelineBox, type TimelineGo } from "../model/timeline";
import type { Library } from "../model/sources";
import type { ProjectionItem } from "../model/show";
import { engineId } from "../lib/audio";
import { useDoc } from "../store/doc";
import { useLink } from "../store/link";
import { reservationView } from "../model/link";
import { useLibrary } from "../store/library";
import { useOutputs } from "../store/outputs";
import { anchorTop, scriptLive, useScriptView } from "../script/view";
import { runClick, useRun } from "../show/run";
import { MemoryThumb } from "./MemoryThumb";
import "./timeline.css";

/**
 * The timeline next to the script (13_cue.md, "Schermata Show"; docs/cue/design): for every GO a dot on the script's
 * edge at its point, a line to its button (34 px; buttons never overlap: model/timeline.ts pushes them down and the
 * line curves), then on through the columns Luci · Audio · Video to the GO's boxes. Box tops are aligned with the
 * button top; the line enters both at half height. The whole layer scrolls with the script (no re-render: a
 * transform follows the scroll). Lines of the last GO given (green) and of the standby (amber; blue when reserved)
 * are drawn thick, above everything; the others grey, under the boxes. Used by Show and Prepara.
 */

/** Horizontal geometry (px from the script's edge), as the design: dot, buttons, then the columns. */
const BTN_X = 24;
const BTN_W = 100;
const BTN_W_NARROW = 84;
const COLS_GAP = 22;
const COL_GAP = 6;
const RIGHT_PAD = 12;
/** Room for the column titles at the top. */
export const HEADS_H = 28;

export interface TimelineProps {
  mode: "show" | "prepare";
  /** Prepara: the GO with the selection ring. */
  selectedGoId?: string | null;
  /** Prepara: a click on a GO button or box selects it. */
  onSelectGo?: (goId: string) => void;
}

interface ColGeom {
  dept: Dept;
  x: number;
  w: number;
}

type BoxState = "on" | "sb" | "past" | "";

const DEPT_LABEL: Record<Dept, string> = { lights: "Lights", audio: "Audio", video: "Video" };

function mmss(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const stripExt = (name: string) => name.replace(/\.(wav|mp3|flac|ogg|aiff?|m4a|aac|opus)$/i, "");

export function Timeline({ mode, selectedGoId = null, onSelectGo }: TimelineProps) {
  const t = useT();
  const gos = useDoc((s) => s.show?.gos);
  const heights = useDoc((s) => s.show?.layout.audioBoxHeights);
  const items = useDoc((s) => s.show?.projection.items);
  const geometry = useScriptView((s) => s.geometry);
  const library = useLibrary((s) => s.library);
  const playback = useRun((s) => s.playback);
  const role = useRun((s) => s.role);
  const linkState = useLink((s) => s.info);
  const locked = useRun((s) => s.locked);
  const autoPending = useRun((s) => s.autoPending);
  // Only which sounds play (not their position): the boxes do not re-render ten times a second.
  const playingKey = useOutputs((s) => (s.audio ? s.audio.voices.map((v) => v.trackId).sort().join("|") : null));
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<{ actionId: string; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Follow the script's scroll without re-rendering.
  useEffect(
    () =>
      scriptLive.onScroll((top) => {
        if (layerRef.current) layerRef.current.style.transform = `translate3d(0, ${-top}px, 0)`;
      }),
    [],
  );

  const list = useMemo(() => sortGos(gos ?? []), [gos]);
  const audioHeights = useMemo(() => (drag ? { ...(heights ?? {}), [drag.actionId]: drag.height } : (heights ?? {})), [heights, drag]);
  const timeline = useMemo<TL | null>(() => {
    if (!geometry) return null;
    const last = geometry.tops.length - 1;
    const endY = last >= 0 ? geometry.tops[last] + geometry.heights[last] : 0;
    return layoutTimeline(list, {
      anchorToY: (a) => anchorTop(geometry, a) ?? (a.page < 1 ? geometry.tops[0] : endY),
      audioHeights,
      endY,
    });
  }, [geometry, list, audioHeights]);

  const numbers = useMemo(() => new Map(numberGos(list).map((n) => [n.id, n])), [list]);
  const views = useMemo(() => new Map(goViews(playback, list, role).map((v) => [v.id, v])), [playback, list, role]);
  const cols = useMemo(() => columnsOf(playback, list), [playback, list]);
  const playing = useMemo(() => (playingKey === null ? null : new Set(playingKey ? playingKey.split("|") : [])), [playingKey]);
  const byId = useMemo(() => new Map(list.map((g) => [g.id, g])), [list]);
  const lastIndex = useMemo(() => list.findIndex((g) => g.id === playback.lastGoId), [list, playback.lastGoId]);
  const projItems = useMemo(() => new Map((items ?? []).map((p) => [p.id, p])), [items]);

  const geo = useMemo(() => {
    const present = timeline?.columns ?? [];
    const btnW = width > 0 && width < 380 ? BTN_W_NARROW : BTN_W;
    const colsX = BTN_X + btnW + COLS_GAP;
    const n = present.length;
    const avail = Math.max(0, width - colsX - RIGHT_PAD);
    const w = n ? Math.max(60, (avail - COL_GAP * (n - 1)) / n) : 0;
    const colGeom: ColGeom[] = present.map((dept, i) => ({ dept, x: colsX + i * (w + COL_GAP), w }));
    return { btnW, colGeom, colX: new Map(colGeom.map((c) => [c.dept, c])) };
  }, [timeline, width]);

  const onButton = useCallback(
    (goId: string) => {
      if (mode === "prepare") onSelectGo?.(goId);
      else if (!useRun.getState().locked) runClick(t, goId);
    },
    [mode, onSelectGo, t],
  );

  const startResize = useCallback(
    (e: React.PointerEvent, box: TimelineBox) => {
      if (useRun.getState().locked) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      const root = rootRef.current;
      if (!root) return;
      const top = root.getBoundingClientRect().top;
      let h = box.height;
      const move = (ev: PointerEvent) => {
        h = draggedAudioHeight(box, ev.clientY - top + scriptLive.scrollTop());
        setDrag({ actionId: box.actionId, height: h });
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        setDrag(null);
        const value = Math.round(h);
        if (value !== heights?.[box.actionId])
          useDoc.getState().change((s) => ({ ...s, layout: { ...s.layout, audioBoxHeights: { ...s.layout.audioBoxHeights, [box.actionId]: value } } }), `audioHeight:${box.actionId}`);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    },
    [heights],
  );

  if (!geometry || !timeline) return <div ref={rootRef} className="cue-tl" />;

  const resv = reservationView(linkState, t);
  const reservedByMe = resv.mine;
  const boxState = (box: TimelineBox, go: Go, index: number): BoxState => {
    const action = go.actions.find((a) => a.id === box.actionId);
    if (!action) return "";
    const dept = actionDept(action);
    const sb = dept === "lights" ? cols.lights.standby : dept === "audio" ? cols.audio.standby : cols.video.standby;
    if (action.kind === "audio") {
      const inModel = cols.audio.inScene.some((p) => p.actionId === action.id);
      const on = playing ? inModel && playing.has(engineId(action.ref.sourceId, audioEngineTrackId(action))) : inModel;
      if (on) return "on";
    } else if (action.kind !== "audioStop") {
      const slot = dept === "lights" ? cols.lights.inScene : cols.video.inScene;
      if (slot?.goId === go.id && slot.actionIds.includes(action.id)) return "on";
    }
    if (sb?.goId === go.id && sb.actionIds.includes(action.id)) return "sb";
    if (lastIndex >= 0 && index <= lastIndex) return "past";
    return "";
  };

  const activeIds = [playback.lastGoId, playback.standbyId].filter((x): x is string => !!x);
  const lineColor = (v: GoView | undefined): string | null => {
    if (!v) return null;
    if (v.status === "last") return "var(--go)";
    // Reserved by the other computer: this one cannot give it, so its line stays grey (only the dot stays amber).
    if (v.status === "standby" && v.fireable && !resv.other) return reservedByMe ? "var(--pre)" : "var(--sb)";
    return null;
  };
  const lineEndX = (row: TimelineGo): number | null => {
    if (!row.lineEnd) return null;
    const c = geo.colX.get(row.lineEnd);
    return c ? c.x + c.w - 6 : null;
  };
  const pathTo = (row: TimelineGo) => (row.curved ? `M0 ${row.dotY}C${BTN_X * 0.55} ${row.dotY} ${BTN_X * 0.45} ${row.lineY} ${BTN_X} ${row.lineY}` : `M0 ${row.dotY}H${BTN_X}`);
  const height = timeline.height + 40;

  return (
    <div ref={rootRef} className="cue-tl" data-mode={mode} data-locked={locked ? "" : undefined}>
      <div ref={layerRef} className="cue-tl__layer" style={{ height }}>
        <svg className="cue-tl__svg cue-tl__svg--back" width={Math.max(1, width)} height={height} aria-hidden="true">
          {timeline.gos.map((row) => {
            if (activeIds.includes(row.goId) && lineColor(views.get(row.goId))) return null;
            const v = views.get(row.goId);
            const past = v?.status === "past";
            const stroke = past ? "var(--border-strong)" : "var(--text-3)";
            const xe = lineEndX(row);
            return (
              <g key={row.goId}>
                <path d={pathTo(row)} stroke={stroke} strokeWidth={1.5} fill="none" />
                {xe !== null ? <path d={`M${BTN_X + geo.btnW} ${row.lineY}H${xe}`} stroke={stroke} strokeWidth={1} strokeOpacity={0.6} fill="none" /> : null}
                <circle cx={0} cy={row.dotY} r={4.5} fill={v?.status === "standby" ? "var(--sb)" : stroke} />
              </g>
            );
          })}
        </svg>
        {timeline.gos.map((row) => {
          const go = byId.get(row.goId)!;
          return row.boxes.map((box) => {
            const c = geo.colX.get(box.column);
            if (!c) return null;
            const action = go.actions.find((a) => a.id === box.actionId);
            if (!action) return null;
            return (
              <TimelineBoxView
                key={box.actionId}
                box={box}
                action={action}
                x={c.x}
                w={c.w}
                state={boxState(box, go, row.index)}
                library={library}
                projItems={projItems}
                selected={mode === "prepare" && selectedGoId === go.id}
                onSelect={mode === "prepare" && onSelectGo ? () => onSelectGo(go.id) : undefined}
                onResize={startResize}
                t={t}
              />
            );
          });
        })}
        {timeline.gos.map((row) => (
          <GoButton
            key={row.goId}
            row={row}
            go={byId.get(row.goId)!}
            number={numbers.get(row.goId)}
            view={views.get(row.goId)}
            width={geo.btnW}
            selected={mode === "prepare" && selectedGoId === row.goId}
            mine={reservedByMe}
            reservedByOther={resv.goLabel}
            autoWaiting={autoPending?.goId === row.goId}
            onPress={onButton}
            t={t}
          />
        ))}
        <svg className="cue-tl__svg cue-tl__svg--front" width={Math.max(1, width)} height={height} aria-hidden="true">
          {timeline.gos.map((row) => {
            const color = activeIds.includes(row.goId) ? lineColor(views.get(row.goId)) : null;
            if (!color) return null;
            const xe = lineEndX(row);
            return (
              <g key={row.goId}>
                <path d={pathTo(row)} stroke={color} strokeWidth={2.5} fill="none" />
                {xe !== null ? <path d={`M${BTN_X + geo.btnW} ${row.lineY}H${xe}`} stroke={color} strokeWidth={2.5} fill="none" /> : null}
                <circle cx={0} cy={row.dotY} r={5.5} fill={color} />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="cue-tl__heads" style={{ height: HEADS_H }}>
        {geo.colGeom.map((c) => (
          <span key={c.dept} className={`cue-tl__head cue-tl__head--${c.dept}`} style={{ left: c.x, width: c.w }}>
            {t(DEPT_LABEL[c.dept])}
          </span>
        ))}
      </div>
      {!list.length ? <EmptyTimeline mode={mode} /> : null}
    </div>
  );
}

function EmptyTimeline({ mode }: { mode: "show" | "prepare" }) {
  const t = useT();
  return (
    <div className="cue-tl__empty">
      <Icon name="pin" size={20} />
      <p>{mode === "prepare" ? t("No GOs yet: drag a memory, a track or an image from the library onto the script.") : t("This show has no GOs yet: create them in Prepare by dragging memories and tracks onto the script.")}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Button                                                               */
/* ------------------------------------------------------------------ */

interface GoButtonProps {
  row: TimelineGo;
  go: Go;
  number: GoNumber | undefined;
  view: GoView | undefined;
  width: number;
  selected: boolean;
  mine: boolean;
  /** The other computer holds the reservation: the standby is grey with this label ("Prenotato dal secondario"). */
  reservedByOther: string | null;
  autoWaiting: boolean;
  onPress: (goId: string) => void;
  t: TFunc;
}

const GoButton = memo(function GoButton({ row, go, number, view, width, selected, mine, reservedByOther, autoWaiting, onPress, t }: GoButtonProps) {
  const n = number?.text ?? "";
  const status = view?.status ?? "future";
  const held = status === "standby" && !!reservedByOther;
  const other = (view && !view.fireable) || held;
  let main: string;
  let sub: string | null = null;
  if (held && view?.fireable) {
    main = `${n} · ${reservedByOther}`;
  } else if (other) {
    main = `${n} · ${view!.reason === "givenBySecondary" ? t("given by the secondary") : t("given by the primary")}`;
  } else if (status === "last") main = `GO ${n}`;
  else if (status === "standby") main = `STBY ${n}`;
  else main = n;
  if (!other && go.auto) sub = autoWaiting && status === "standby" ? t("starts by itself…") : t("starts by itself");
  const cls = [
    "cue-gob",
    other ? "cue-gob--other" : `cue-gob--${status}`,
    selected ? "cue-gob--sel" : "",
    mine && status === "standby" && !other ? "cue-gob--mine" : "",
    sub ? "cue-gob--two" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const title = [go.label ? `${n}` : `GO ${n}`, go.note ?? "", status === "future" ? t("Click: make it the standby") : ""].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className={cls}
      style={{ top: row.buttonTop, left: BTN_X, width, height: BUTTON_H }}
      data-go={go.id}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPress(go.id)}
    >
      <span className="cue-gob__main">{main}</span>
      {sub ? <span className="cue-gob__sub">{sub}</span> : null}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Box                                                                  */
/* ------------------------------------------------------------------ */

interface BoxViewProps {
  box: TimelineBox;
  action: Action;
  x: number;
  w: number;
  state: BoxState;
  library: Library;
  projItems: Map<string, ProjectionItem>;
  selected: boolean;
  onSelect?: () => void;
  onResize: (e: React.PointerEvent, box: TimelineBox) => void;
  t: TFunc;
}

/** The picture of an image or video in its box on the timeline (a frame), or its icon while it loads / when it has none. */
function ProjThumb({ item }: { item: ProjectionItem | undefined }) {
  const url = useItemThumb(item);
  return (
    <span className="cue-box__proj" data-kind={item?.kind ?? "image"} style={url ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
      {url ? null : <Icon name={item?.kind === "video" ? "video" : "image"} size={14} />}
    </span>
  );
}

/** The whole name of a box, as a tooltip: a narrow or short box cuts it with "…". */
function boxTitle(action: Action, library: BoxViewProps["library"], projItems: BoxViewProps["projItems"]): string | undefined {
  switch (action.kind) {
    case "light": {
      const m = library.light(action.ref);
      return m ? `M${m.number} ${m.name}` : undefined;
    }
    case "audio":
    case "audioStop": {
      const tr = action.ref ? library.track(action.ref) : null;
      return tr ? stripExt(tr.name) : undefined;
    }
    case "projection": {
      const item = action.projectionItemId ? projItems.get(action.projectionItemId) : undefined;
      return item?.name;
    }
    default:
      return undefined;
  }
}

const TimelineBoxView = memo(function TimelineBoxView({ box, action, x, w, state, library, projItems, selected, onSelect, onResize, t }: BoxViewProps) {
  const h = box.bottom - box.top;
  // A squeezed box keeps its colour and its name; the words IN SCENA / STANDBY need room. The line of the GO crosses
  // only the first box of a column (stack 0): below it a stacked box can start its name at the top.
  const under = box.stack > 0;
  const tight = h < (under ? 40 : 58);
  // Very little room: smaller name, no padding below, so that the name stays whole under the line.
  const compact = h < (under ? 26 : 46);
  const label = tight ? null : state === "on" ? t("IN SCENE") : state === "sb" ? t("STANDBY") : null;
  let body: React.ReactNode = null;
  let missing = false;
  // Room for a thumbnail: the line, the label, the thumbnail, the name.
  const roomy = h >= 86;
  switch (action.kind) {
    case "light": {
      const m = library.light(action.ref);
      missing = !m;
      body = m ? (
        <>
          {roomy ? <MemoryThumb thumb={m.thumbnail} className="cue-box__thumb" height={30} /> : null}
          <span className="cue-box__name">
            <span className="cue-box__num">M{m.number}</span> {m.name}
          </span>
        </>
      ) : (
        <span className="cue-box__name cue-box__missing">{t("Missing memory")}</span>
      );
      break;
    }
    case "audio": {
      const tr = library.track(action.ref);
      missing = !tr;
      body = tr ? (
        <span className="cue-box__name">
          {stripExt(tr.name)} <span className="cue-box__dur">{mmss(tr.playSec ?? tr.durationSec)}</span>
          {tr.loop ? <Icon name="repeat" size={11} /> : null}
        </span>
      ) : (
        <span className="cue-box__name cue-box__missing">{t("Missing track")}</span>
      );
      break;
    }
    case "audioStop": {
      const tr = action.ref ? library.track(action.ref) : null;
      const fade = action.times?.fade;
      body = (
        <span className="cue-box__name">
          <Icon name="stopF" size={10} /> {action.ref ? t("Stop {name}", { name: tr ? stripExt(tr.name) : "?" }) : t("Stop every sound")}
          {typeof fade === "number" ? <span className="cue-box__dur"> · {fade.toLocaleString("it-IT")} s</span> : null}
        </span>
      );
      break;
    }
    case "projection": {
      const item = action.projectionItemId ? projItems.get(action.projectionItemId) : undefined;
      body = (
        <>
          {roomy ? (
            <ProjThumb item={item} />
          ) : null}
          <span className="cue-box__name">{item ? item.name : action.step === "next" ? t("Next image") : action.step === "previous" ? t("Previous image") : t("Image")}</span>
        </>
      );
      break;
    }
    case "powerpoint":
      body = <span className="cue-box__name">PowerPoint · {action.powerpoint === "next" ? t("next") : action.powerpoint === "previous" ? t("previous") : action.powerpoint}</span>;
      break;
  }
  return (
    <div
      className={`cue-box cue-box--${box.column}${state ? ` cue-box--${state}` : ""}${missing ? " cue-box--missing" : ""}${selected ? " cue-box--sel" : ""}${tight ? " cue-box--tight" : ""}${compact ? " cue-box--compact" : ""}${under ? " cue-box--under" : ""}${onSelect ? " cue-box--click" : ""}`}
      style={{ left: x, width: w, top: box.top, height: Math.max(16, h) }}
      title={boxTitle(action, library, projItems)}
      onClick={onSelect}
    >
      {label ? (
        <span className="cue-box__label">
          <span className="cue-box__dot" />
          {label}
        </span>
      ) : null}
      {body}
      {box.resizable ? <span className="cue-box__grip" title={t("Drag to change the height (only a reminder)")} onPointerDown={(e) => onResize(e, box)} /> : null}
    </div>
  );
});

