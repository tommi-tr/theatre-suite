import { useEffect, useMemo, useRef, useState } from "react";
import { useT, type TFunc } from "@theatre-suite/core";
import { Button, confirmYesNo, Icon, NumberField, Segmented } from "@theatre-suite/ui";
import { closeOutput, chooseMonitor, nextItem, openOutput, projErrorText, refreshMonitors, setBlank, stepItem, fireItem, toggleBlank, toggleTest, useProj } from "../lib/projection";
import { addImages, addSlidesFromPdf, addSlidesFromPowerPoint, addVideos, chooseBlankImage, clearBlankImage, useImporting } from "../lib/projImport";
import { pptSupported } from "../lib/ppt";
import { COLOR_KEYS, effectiveColor, moveItem, NEUTRAL, removeItem, resetItemColor, setColorValue, transitionText, updateItem, withTransitionKind, type ColorKey } from "../model/projection";
import type { Projection, ProjectionItem } from "../model/show";
import { ProjectionScreen } from "../projection/ProjectionScreen";
import { useItemThumb } from "../projection/usePicture";
import { fmtDuration } from "../prepare/format";
import { useDoc } from "../store/doc";
import { acceptVideo, useVideoCheck } from "../lib/videoCheck";
import { useUi } from "../store/ui";
import "./projections.css";

const num = (v: number) => v.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

export function transitionLabel(t: TFunc, tr: ProjectionItem["transition"]): string {
  const x = transitionText(tr);
  if (x.kind === "cut") return t("Cut");
  return `${x.kind === "dissolve" ? t("Dissolve") : t("Through black")} ${num(x.seconds ?? 0)} s`;
}

/** Proiezioni: the sequence on the left, the output preview in the centre, the retouch of the selected item on the right. */
export function ProjectionsMode() {
  const t = useT();
  const show = useDoc((s) => s.show);
  const change = useDoc((s) => s.change);
  const current = useProj((s) => s.current);
  const blank = useProj((s) => s.blank);
  const out = useProj((s) => s.out);
  const windowOpen = useProj((s) => s.windowOpen);
  const monitors = useProj((s) => s.monitors);
  const busy = useImporting((s) => s.busy);
  const [selected, setSelected] = useState<string | null>(null);
  const [scope, setScope] = useState<"this" | "all">("this");
  const [menu, setMenu] = useState(false);
  const [canPpt, setCanPpt] = useState(false);
  const p = show?.projection;
  const items = p?.items ?? [];
  const sel = items.find((i) => i.id === selected) ?? null;
  const cur = items.find((i) => i.id === current) ?? null;
  const next = nextItem(items, current);
  const videoState = useVideoCheck((s) => s.byId);
  const videoOk = useMemo(() => Object.fromEntries(Object.entries(videoState).map(([id, v]) => [id, v !== "missing"])) as Record<string, boolean>, [videoState]);
  const screen = chooseMonitor(monitors, p?.screen ?? null);

  useEffect(() => void refreshMonitors(), []);
  useEffect(() => void pptSupported().then(setCanPpt), []);
  // A selected item that was deleted (or a show that changed): select the first.
  useEffect(() => {
    if (selected && !items.some((i) => i.id === selected)) setSelected(items[0]?.id ?? null);
    else if (!selected && items.length) setSelected(items[0].id);
  }, [items, selected]);

  if (!p) return null;
  const edit = (fn: (p: Projection) => Projection, key?: string) => change((s) => ({ ...s, projection: fn(s.projection) }), key);

  const play = (id: string) => void fireItem(id).catch((e) => useUi.getState().showToast(projErrorText(t, e), "error"));
  const step = (dir: "next" | "previous") =>
    void stepItem(dir)
      .then((ok) => ok || useUi.getState().showToast(projErrorText(t, new Error("end-of-sequence")), "error"))
      .catch((e) => useUi.getState().showToast(projErrorText(t, e), "error"));

  const remove = async (item: ProjectionItem) => {
    const used = (show?.gos ?? []).some((g) => g.actions.some((a) => (a as { projectionItemId?: string }).projectionItemId === item.id));
    const ok = await confirmYesNo({
      title: t("Remove from the sequence"),
      message: used ? t("“{name}” is used by a GO: that GO will show nothing. Remove it anyway?", { name: item.name }) : t("Remove “{name}” from the sequence? The video file, if any, stays on the disk.", { name: item.name }),
      cancel: t("Cancel"),
      confirm: t("Remove"),
      danger: true,
      close: t("Close"),
    });
    if (ok) edit((x) => removeItem(x, item.id));
  };

  const addTo = async (fn: () => Promise<unknown>) => {
    setMenu(false);
    await fn();
  };

  const colorBase = scope === "all" || !sel ? NEUTRAL : (p.color ?? NEUTRAL);
  const colorNow = scope === "all" || !sel ? (p.color ?? NEUTRAL) : effectiveColor(p, sel);
  const setColor = (k: ColorKey, v: number) => edit((x) => setColorValue(x, scope === "all" || !sel ? "all" : sel.id, k, v), `proj-color-${k}`);
  const COLOR_LABEL: Record<ColorKey, string> = { brightness: t("Brightness"), contrast: t("Contrast"), temperature: t("Temperature"), saturation: t("Saturation") };

  return (
    <div className="cue-proj">
      <aside className="cue-proj__seq" aria-label={t("Sequence")}>
        <h2 className="cue-proj__h">{t("Sequence")}</h2>
        <div className="cue-proj__list">
          <BlankRow p={p} t={t} />
          <SeqList items={items} selected={selected} current={current} nextId={next?.id ?? null} videoOk={videoOk} t={t} onSelect={setSelected} onPlay={play} onMove={(a, b) => edit((x) => ({ ...x, items: moveItem(x.items, a, b) }))} />
          {items.length === 0 ? <p className="cue-proj__empty">{t("Nothing here yet. Add the images and videos of the show, or the slides of a presentation.")}</p> : null}
        </div>
        <div className="cue-proj__add">
          {menu ? (
            <div className="cue-proj__menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void addTo(() => addImages(t))}>
                <Icon name="image" size={15} />
                {t("Images…")}
              </button>
              <button type="button" role="menuitem" onClick={() => void addTo(() => addVideos(t))}>
                <Icon name="video" size={15} />
                {t("Video (MP4)…")}
              </button>
              <button type="button" role="menuitem" onClick={() => void addTo(() => addSlidesFromPdf(t))} title={t("Export the presentation as PDF from PowerPoint (File → Export → PDF), then choose it here. Works on every computer.")}>
                <Icon name="file" size={15} />
                {t("Slides from a PDF…")}
                <span className="cue-proj__tag">{t("recommended")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!canPpt}
                onClick={() => void addTo(() => addSlidesFromPowerPoint(t))}
                title={canPpt ? t("PowerPoint exports the slides as images by itself. Needs PowerPoint installed on this computer.") : t("Only on Windows with PowerPoint installed.")}
              >
                <Icon name="layers" size={15} />
                {t("Slides from a PowerPoint file…")}
              </button>
            </div>
          ) : null}
          <Button variant="tool" icon="plus" disabled={!!busy} onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            {busy ?? t("Images, video or PowerPoint")}
          </Button>
        </div>
      </aside>

      <section className="cue-proj__centre" aria-label={t("Output")}>
        <div className="cue-proj__bar">
          <span className="cue-proj__out">
            <b className="cue-proj__live">{t("Output")}</b>
            {windowOpen ? (
              <span>
                {screen ? ` · ${screenLabel(screen, t)}` : ` · ${t("preview window")}`}
              </span>
            ) : (
              <span> · {t("off")}</span>
            )}
          </span>
          <span className="ts-spacer" />
          <Button variant="sm" onClick={() => void (windowOpen ? closeOutput() : openOutput().catch((e) => useUi.getState().showToast(projErrorText(t, e), "error")))}>
            {windowOpen ? t("Turn the output off") : t("Turn the output on")}
          </Button>
          <Button variant="sm" kbd="T" on={blank} onClick={() => void toggleBlank()} title={t("Blank image on the output, and back")}>
            {t("Blank")}
          </Button>
        </div>
        <div className="cue-proj__stage">
          <div className="cue-proj__preview" data-blank={blank || undefined}>
            <ProjectionScreen state={out} preview />
            <div className="cue-proj__caption">
              {blank ? t("Blank image on the output") : cur ? t("On the output: {name}", { name: cur.name }) : t("Nothing on the output yet")}
              {next ? ` · ${t("next: {name}", { name: next.name })}` : ""}
              {next?.kind === "video" && videoOk[next.id] ? ` (${t("found in the show folder")})` : ""}
            </div>
          </div>
          <div className="cue-proj__steps">
            <Button variant="tool" icon="prevF" onClick={() => step("previous")}>
              {t("Previous")}
            </Button>
            <Button variant="tool" icon="nextF" onClick={() => step("next")}>
              {t("Next")}
            </Button>
          </div>
        </div>
      </section>

      <aside className="cue-proj__insp" aria-label={t("Retouch")}>
        {sel ? (
          <>
            <h2 className="cue-proj__h ts-ellipsis" title={sel.name}>
              {sel.name}
            </h2>
            <p className="cue-proj__sub">{t("Transition in")}</p>
            <Segmented
              ariaLabel={t("Transition in")}
              small
              value={sel.transition.kind}
              onChange={(k) => edit((x) => updateItem(x, sel.id, { transition: withTransitionKind(sel.transition, k) }))}
              options={[
                { value: "cut", label: t("Cut") },
                { value: "dissolve", label: t("Dissolve") },
                { value: "throughBlack", label: t("Black") },
              ]}
            />
            <div className="cue-proj__field">
              <span>{t("Duration")}</span>
              {sel.transition.kind === "cut" ? (
                <span className="cue-proj__dim">—</span>
              ) : (
                <NumberField
                  className="cue-proj__num"
                  label={t("Duration")}
                  value={sel.transition.seconds}
                  text={`${num(sel.transition.seconds)} s`}
                  min={0.1}
                  max={10}
                  onCommit={(v) => edit((x) => updateItem(x, sel.id, { transition: { kind: sel.transition.kind as "dissolve" | "throughBlack", seconds: Math.round(v * 10) / 10 } }))}
                />
              )}
            </div>
            <p className="cue-proj__sub">{scope === "all" ? t("Colour · all items") : t("Colour · only this item")}</p>
            {COLOR_KEYS.map((k) => (
              <div key={k} className="cue-proj__field">
                <span>{COLOR_LABEL[k]}</span>
                <NumberField
                  className={`cue-proj__num${colorNow[k] !== colorBase[k] ? " cue-proj__num--mod" : ""}`}
                  label={COLOR_LABEL[k]}
                  value={colorNow[k]}
                  text={signed(colorNow[k])}
                  min={-100}
                  max={100}
                  onCommit={(v) => setColor(k, Math.round(v))}
                />
              </div>
            ))}
            <Segmented
              ariaLabel={t("Colour applies to")}
              small
              value={scope}
              onChange={setScope}
              options={[
                { value: "this", label: t("This") },
                { value: "all", label: t("All") },
              ]}
            />
            {scope === "this" && sel.color ? (
              <Button variant="ghost" onClick={() => edit((x) => resetItemColor(x, sel.id))}>
                {t("Back to the colour of all")}
              </Button>
            ) : null}
            {sel.kind === "video" ? (
              <div className="cue-proj__field">
                <span>{t("At the end of the video")}</span>
                <select className="ts-select" aria-label={t("At the end of the video")} value={sel.atEnd ?? "hold"} onChange={(e) => edit((x) => updateItem(x, sel.id, { atEnd: e.currentTarget.value as "hold" | "black" | "loop" }))}>
                  <option value="hold">{t("stays on the last frame")}</option>
                  <option value="black">{t("goes black")}</option>
                  <option value="loop">{t("plays again")}</option>
                </select>
              </div>
            ) : null}
            <div className="cue-proj__actions">
              <Button variant="tool" icon="playF" onClick={() => play(sel.id)}>
                {t("Show it on the output")}
              </Button>
              <Button variant="ghost" icon="trash" onClick={() => void remove(sel)}>
                {t("Remove")}
              </Button>
            </div>
            {sel.kind === "video" && sel.path ? (
              <p className="cue-proj__note" data-bad={videoOk[sel.id] === false || undefined}>
                {videoOk[sel.id] === false ? t("Video not found: {path}", { path: sel.path }) : `${sel.path}${sel.durationSec ? ` · ${fmtDuration(sel.durationSec)}` : ""}`}
              </p>
            ) : null}
            {sel.kind === "video" && videoState[sel.id] === "changed" ? (
              <div className="cue-proj__changed" role="alert">
                <p>{t("This video changed since it was added (another cut, or another file with the same name).")}</p>
                <Button
                  variant="sm"
                  icon="check"
                  onClick={() => void acceptVideo(sel).then(() => useUi.getState().showToast(t("This version of the video is now the right one."))).catch(() => useUi.getState().showToast(t("Video not found: {path}", { path: sel.path ?? "" }), "error"))}
                >
                  {t("Use this version")}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <h2 className="cue-proj__h">{t("Retouch")}</h2>
            <p className="cue-proj__note">{t("Choose an item of the sequence to set its transition and colour.")}</p>
          </>
        )}
        <div className="cue-proj__blank">
          <p className="cue-proj__sub">{t("Blank image")}</p>
          <p className="cue-proj__note">{p.blank.kind === "image" ? t("Your image") : t("Black")}</p>
          <div className="cue-proj__actions">
            <Button variant="sm" onClick={() => void chooseBlankImage(t)}>
              {t("Choose image…")}
            </Button>
            {p.blank.kind === "image" ? (
              <Button variant="sm" onClick={() => clearBlankImage()}>
                {t("Black")}
              </Button>
            ) : null}
          </div>
        </div>
      </aside>

    </div>
  );
}

/** The bottom line in Proiezioni: how many items and videos (missing, changed), and the test pattern. */
export function ProjectionsStatusLine() {
  const t = useT();
  const items = useDoc((s) => s.show?.projection.items) ?? [];
  const byId = useVideoCheck((s) => s.byId);
  const videos = items.filter((i) => i.kind === "video");
  const missing = videos.filter((i) => byId[i.id] === "missing").length;
  const changed = videos.filter((i) => byId[i.id] === "changed").length;
  return (
    <>
      <span>
        {t("{n} items", { n: items.length })}
        {videos.length ? ` · ${videos.length === 1 ? t("1 video outside the file") : t("{n} videos outside the file", { n: videos.length })}` : ""}
      </span>
      {missing ? <span className="cue-proj__bad">{t("{n} not found", { n: missing })}</span> : null}
      {changed ? <span className="cue-proj__warn">{changed === 1 ? t("1 changed") : t("{n} changed", { n: changed })}</span> : null}
      <span className="ts-spacer" />
      <button
        type="button"
        className="cue-proj__link"
        onClick={() =>
          void (async () => {
            if (!useProj.getState().windowOpen) await openOutput().catch((e) => useUi.getState().showToast(projErrorText(t, e), "error"));
            await toggleTest();
          })()
        }
      >
        {t("Test pattern on the projector")}
      </button>
    </>
  );
}

const screenLabel = (m: { index: number; width: number; height: number }, t: TFunc) => `${t("Screen {n}", { n: m.index + 1 })} · ${m.width} × ${m.height} · ${t("full screen")}`;

/** Which video files are there (computed when the list changes; the demo says yes). */

function BlankRow({ p, t }: { p: Projection; t: TFunc }) {
  const blank = useProj((s) => s.blank);
  return (
    <div className={`cue-seqrow cue-seqrow--blank${blank ? " cue-seqrow--live" : ""}`}>
      <span className="cue-seqrow__thumb cue-seqrow__thumb--black" />
      <span className="cue-seqrow__name ts-ellipsis">{p.blank.kind === "image" ? t("Blank · your image") : t("Blank · black")}</span>
      <button type="button" className="cue-seqrow__go" title={t("Show the blank image")} onClick={() => void setBlank(true)}>
        <Icon name="playF" size={11} />
      </button>
    </div>
  );
}

function SeqList({
  items,
  selected,
  current,
  nextId,
  videoOk,
  t,
  onSelect,
  onPlay,
  onMove,
}: {
  items: readonly ProjectionItem[];
  selected: string | null;
  current: string | null;
  nextId: string | null;
  videoOk: Record<string, boolean>;
  t: TFunc;
  onSelect: (id: string) => void;
  onPlay: (id: string) => void;
  onMove: (from: number, to: number) => void;
}) {
  const dragFrom = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const byId = useVideoCheck((s) => s.byId);
  const changed = useMemo(() => new Set(Object.entries(byId).filter(([, v]) => v === "changed").map(([id]) => id)), [byId]);
  const rows = useMemo(() => items, [items]);
  return (
    <>
      {rows.map((item, i) => (
        <div key={item.id}>
          <div className="cue-seq__between">
            <Icon name="arrowDown" size={11} />
            {transitionLabel(t, item.transition)}
          </div>
          <div
            className={`cue-seqrow${item.id === current ? " cue-seqrow--live" : item.id === nextId ? " cue-seqrow--next" : ""}${item.id === selected ? " cue-seqrow--sel" : ""}${over === i ? " cue-seqrow--over" : ""}`}
            draggable
            role="option"
            aria-selected={item.id === selected}
            tabIndex={0}
            onClick={() => onSelect(item.id)}
            onDoubleClick={() => onPlay(item.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect(item.id);
              else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.altKey) {
                e.preventDefault();
                onMove(i, i + (e.key === "ArrowUp" ? -1 : 1));
              }
            }}
            onDragStart={(e) => {
              dragFrom.current = i;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", "");
            }}
            onDragOver={(e) => {
              if (dragFrom.current === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom.current !== null && dragFrom.current !== i) onMove(dragFrom.current, i);
              dragFrom.current = null;
              setOver(null);
            }}
            onDragEnd={() => {
              dragFrom.current = null;
              setOver(null);
            }}
          >
            <Thumb item={item} />
            <span className="cue-seqrow__name ts-ellipsis" title={item.name}>
              {item.name}
            </span>
            {item.kind === "video" && videoOk[item.id] === false ? <Icon name="alert" size={13} /> : null}
            {item.kind === "video" && changed.has(item.id) ? <span className="cue-seqrow__changed">{t("changed")}</span> : null}
          </div>
        </div>
      ))}
    </>
  );
}

function Thumb({ item }: { item: ProjectionItem }) {
  const url = useItemThumb(item);
  return (
    <span className="cue-seqrow__thumb" style={url ? { backgroundImage: `url(${url})` } : undefined}>
      {item.kind === "video" ? (
        <span className="cue-seqrow__badge">
          <Icon name="playF" size={8} />
          {item.durationSec ? fmtDuration(item.durationSec) : ""}
        </span>
      ) : null}
    </span>
  );
}
