import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "prosemirror-view";
import { useT } from "@theatre-suite/core";
import { Icon } from "@theatre-suite/ui";
import { createEditorState } from "../editor/setup";
import { nodeViews, posById } from "../editor/nodeviews";
import { clipboardTextParser } from "../editor/keys";
import { getPagination, setContinuous, type Pagination } from "../editor/paginate";
import { DOC_WORDS } from "../editor/autoRender";
import { formatCss, headerText } from "../format/css";
import { getData } from "../model/defaults";
import type { DocIndex } from "../model/derive";
import type { DocData } from "../model/types";
import { getIndex } from "../editor/plugins";
import { notePos } from "../editor/commands";
import { useDoc, useData, useIndex } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { AutocompletePopup, SpeakerPickerPopup } from "./Popups";
import { ContextMenu } from "./ContextMenu";
import { FindBar } from "./FindBar";

/** Keeps the stylesheet of the script (format) in the page. */
export function FormatStyle() {
  const data = useData();
  const css = useMemo(() => (data ? formatCss(data.format, data) : ""), [data?.format, data?.characters, data]);
  return <style id="b-format">{css}</style>;
}

function hfContext(p: Pagination, pageIdx: number, data: DocData, index: DocIndex) {
  const page = p.pages[pageIdx];
  const scene = page.scene >= 0 ? index.scenes[page.scene] : null;
  const act = page.act >= 0 ? index.acts[page.act] : null;
  const actScene = [act?.label, scene?.label].filter(Boolean).join(" · ");
  return {
    title: data.meta.title,
    actScene,
    page: page.number,
    pages: p.pages.length,
    version: `${data.lang === "it" ? "Versione" : "Version"} ${data.version}`,
    characters: page.speakers.map((id) => data.characters.find((c) => c.id === id)?.name ?? "").filter(Boolean).join(", "),
    lang: data.lang,
  };
}

/** White sheets, headers and footers drawn behind the text. */
function PageLayer({ p, data, index, x, y }: { p: Pagination; data: DocData; index: DocIndex; x: number; y: number }) {
  const g = p.geom;
  const f = data.format;
  const hs = f.styles.header;
  const font = { fontFamily: hs.font === "mono" ? "'Courier Prime', monospace" : hs.font === "sans" ? "'Geist Sans', sans-serif" : "'Source Serif 4', Georgia, serif", fontSize: `${hs.size}pt`, fontStyle: hs.italic ? "italic" : "normal", color: hs.color } as const;
  if (p.continuous) {
    return null;
  }
  return (
    <>
      {p.pages.map((page) => {
        const ctx = hfContext(p, page.index, data, index);
        const zone = g.zones[page.zone];
        const showHeader = page.zone === "script" || f.header.onDocPages;
        const showFooter = page.index > 0 || f.footer.onFirstPage;
        const left = page.left;
        const contentLeft = -left;
        const contentRight = g.pageW - contentLeft - g.contentW;
        return (
          <div key={page.index} className="b-sheet" style={{ left: x + left, top: y + page.top, width: g.pageW, height: g.pageH }}>
            {showHeader ? (
              <div className="b-sheet__hf" style={{ ...font, left: contentLeft, right: contentRight, top: Math.max(8, zone.top * 0.45) }}>
                <span>{headerText(f.header.left, ctx)}</span>
                <span>{headerText(f.header.center, ctx)}</span>
                <span>{headerText(f.header.right, ctx)}</span>
              </div>
            ) : null}
            {showFooter ? (
              <div className="b-sheet__hf" style={{ ...font, fontStyle: "normal", left: contentLeft, right: contentRight, bottom: Math.max(8, zone.bottom * 0.4) }}>
                <span>{headerText(f.footer.left, ctx)}</span>
                <span>{headerText(f.footer.center, ctx)}</span>
                <span>{headerText(f.footer.right, ctx)}</span>
              </div>
            ) : null}
            {f.watermark ? <div className="b-sheet__wm">{f.watermark}</div> : null}
          </div>
        );
      })}
    </>
  );
}

/** Note cards next to the page, at the height of their text. */
function NotesLayer({ view, laneLeft }: { view: EditorView; laneLeft: number }) {
  const t = useT();
  const state = useDoc((s) => s.state);
  const pages = useDoc((s) => s.pages);
  const [cards, setCards] = useState<{ id: string; top: number; text: string; author: string }[]>([]);
  useLayoutEffect(() => {
    if (!state) return;
    const data = getData(state.doc);
    const rootTop = view.dom.getBoundingClientRect().top;
    const scale = view.dom.offsetWidth ? view.dom.getBoundingClientRect().width / view.dom.offsetWidth : 1;
    let lastBottom = -Infinity;
    const out: { id: string; top: number; text: string; author: string }[] = [];
    for (const n of data.notes) {
      const pos = notePos(state.doc, n.id);
      if (pos < 0) continue;
      try {
        const c = view.coordsAtPos(pos + 1);
        let top = (c.top - rootTop) / scale - 4;
        if (top < lastBottom + 6) top = lastBottom + 6;
        lastBottom = top + 62;
        out.push({ id: n.id, top, text: n.text, author: n.author });
      } catch {
        /* not drawn */
      }
    }
    setCards(out);
  }, [state, pages, view]);
  return (
    <>
      {cards.map((c) => (
        <button
          key={c.id}
          type="button"
          className="bd-note-card"
          style={{ left: laneLeft, top: c.top }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => useUi.getState().openDialog("note", undefined, c.id)}
        >
          <span className="bd-note-card__head">
            <Icon name="note" size={12} />
            {c.author || t("Note")}
          </span>
          <span className="bd-note-card__text">{c.text || t("Empty note: click to write it.")}</span>
        </button>
      ))}
    </>
  );
}

export function Editor() {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const loadRev = useDoc((s) => s.loadRev);
  const pages = useDoc((s) => s.pages);
  const data = useData();
  const index = useIndex();
  const zoom = useSettings((s) => s.settings.zoom);
  const spellcheck = useSettings((s) => s.settings.spellcheck);
  const showMarks = useSettings((s) => s.settings.showMarks);
  const continuous = useSettings((s) => s.settings.continuous);
  const focusMode = useUi((s) => s.focusMode);
  const tRef = useRef(t);
  tRef.current = t;

  // Create the editor once; replace its state when another script is loaded.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const doc = useDoc.getState().doc;
    if (!doc) return;
    const make = (d: typeof doc) =>
      createEditorState(d, {
        hints: () => ({
          afterSpeech: tRef.current("Name of the next character and Tab, or write a stage direction"),
          direction: tRef.current("Write a stage direction, or a character's name and Tab"),
          speech: tRef.current("What the character says…"),
          paragraph: tRef.current("Write here…"),
          section: tRef.current("Section title"),
        }),
        onPages: (p) => useDoc.getState().setPages(p),
        contLabel: () => DOC_WORDS[getData(useDoc.getState().view?.state.doc ?? d).lang].continued,
      });
    let v = useDoc.getState().view;
    if (!v || !v.dom.isConnected || v.dom.parentElement !== host) {
      v?.destroy();
      v = new EditorView(host, {
        state: make(doc),
        nodeViews,
        clipboardTextParser,
        attributes: { class: "b-doc", spellcheck: "true" },
        dispatchTransaction(tr) {
          const view = useDoc.getState().view!;
          const next = view.state.apply(tr);
          view.updateState(next);
          useDoc.getState().onState(next, tr);
        },
        handleDOMEvents: {
          mousedown(view, e) {
            const el = (e.target as HTMLElement).closest(".b-speaker");
            if (el && e.button === 0) {
              const sp = el.closest(".b-speech") as HTMLElement | null;
              const pos = sp?.dataset.id ? posById(view.state.doc, sp.dataset.id) : -1;
              if (pos >= 0) {
                e.preventDefault();
                useUi.getState().setSpeakerPicker({ pos, mode: "change" });
                return true;
              }
            }
            return false;
          },
          contextmenu(_view, e) {
            e.preventDefault();
            useUi.getState().setContextMenu({ x: e.clientX, y: e.clientY });
            return true;
          },
        },
      });
      useDoc.getState().setView(v);
    } else {
      v.updateState(make(doc));
      useDoc.getState().setView(v);
    }
    setView(v);
  }, [loadRev]);

  useEffect(
    () => () => {
      useDoc.getState().view?.destroy();
      useDoc.getState().setView(null);
    },
    [],
  );

  useEffect(() => {
    if (!view) return;
    view.dom.setAttribute("spellcheck", spellcheck ? "true" : "false");
    view.dom.setAttribute("lang", data?.lang ?? "it");
    view.dom.setAttribute("data-namepos", data?.format.speech.namePos ?? "left");
  }, [view, spellcheck, data?.lang, data?.format.speech.namePos]);

  useEffect(() => {
    if (!view) return;
    const st = getPagination(view.state);
    if ((st?.continuous ?? false) !== continuous) {
      setContinuous(view, continuous);
    }
  }, [view, continuous]);

  const g = pages?.geom;
  const format = data?.format;
  const contentW = g?.contentW ?? 600;
  const pageW = g?.pageW ?? 794;
  const totalH = pages && g && !pages.continuous ? pages.pages.length * (g.pageH + g.gap) - g.gap : (view?.dom.offsetHeight ?? 1000) + 160;
  const top0 = pages && pages.pages.length && !pages.continuous ? -pages.pages[0].top : 72;
  const left0 = pages && pages.pages.length && !pages.continuous ? -pages.pages[0].left : (pageW - contentW) / 2;
  const laneGap = (format ? format.page.script.outer : 25) * (96 / 25.4) + 16;
  const laneLeft = left0 + contentW + laneGap;
  const stackW = pageW + (focusMode ? 0 : 190);

  return (
    <div className={`b-canvas${showMarks ? " bd-marks" : ""}${focusMode ? " bd-focus" : ""}${continuous ? " bd-continuous" : ""}`} ref={canvasRef}>
      <FindBar />
      <div className="b-zoom" style={{ width: stackW * zoom, height: totalH * zoom }}>
        <div className="b-stack" style={{ width: stackW, height: totalH, transform: `scale(${zoom})` }}>
          {continuous ? <div className="b-sheet" style={{ left: 0, top: 0, width: pageW, height: totalH }} /> : null}
          {pages && data && index ? <PageLayer p={pages} data={data} index={index} x={left0} y={top0} /> : null}
          <div className="b-editor-host" ref={hostRef} style={{ left: left0, top: top0, width: contentW, ["--lane-x" as string]: `${laneGap}px` }} />
          {view && !focusMode ? <NotesLayer view={view} laneLeft={laneLeft} /> : null}
        </div>
      </div>
      {view ? <AutocompletePopup view={view} /> : null}
      {view ? <SpeakerPickerPopup view={view} /> : null}
      {view ? <ContextMenu view={view} /> : null}
    </div>
  );
}

/** Index and position of the caret, for the status bar. */
export function caretInfo(view: EditorView | null) {
  if (!view) return null;
  const st = view.state;
  const index = getIndex(st);
  const pos = st.selection.from;
  return { index, pos };
}
