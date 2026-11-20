import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon, Kbd } from "@theatre-suite/ui";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import type { PageSize, PdfComment, PDFDocumentProxy } from "./pdf";
import { commentsOf, dropCache, renderPage } from "./render";
import { useScriptDoc } from "./store";
import { clampZoom, READING_LINE, scriptLive, useScriptView, type Geometry } from "./view";

/** Space around and between pages (px). */
const PAD = 12;
const GAP = 14;
/** One press of ↑ ↓ W S: a small step (px), repeated while held. */
const STEP = 56;
const ZOOM_STEP = 1.1;
const RETURN_MS = 380;
/** Ctrl held this long without other keys shows the peek band. */
const PEEK_SHOW_MS = 160;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function computeGeometry(sizes: PageSize[], viewW: number, viewH: number, zoom: number): Geometry | null {
  if (!sizes.length || viewW <= 0) return null;
  const maxW = Math.max(...sizes.map((s) => s.w));
  const fit = Math.max(0.05, (viewW - 2 * PAD) / maxW);
  const scale = fit * zoom;
  const contentWidth = Math.max(viewW, Math.ceil(maxW * scale + 2 * PAD));
  const tops: number[] = [];
  const heights: number[] = [];
  const widths: number[] = [];
  const lefts: number[] = [];
  let y = PAD;
  for (const s of sizes) {
    const w = Math.round(s.w * scale);
    const h = Math.round(s.h * scale);
    tops.push(y);
    heights.push(h);
    widths.push(w);
    lefts.push(Math.round((contentWidth - w) / 2));
    y += h + GAP;
  }
  return { scale, tops, heights, lefts, widths, contentHeight: y - GAP + PAD, contentWidth, viewHeight: viewH };
}

/** Pages to have on screen: the visible ones and one more on each side. */
function rangeOf(g: Geometry, top: number, h: number): [number, number] {
  let first = 0;
  while (first < g.tops.length - 1 && g.tops[first] + g.heights[first] < top) first++;
  let last = first;
  while (last < g.tops.length - 1 && g.tops[last + 1] < top + h) last++;
  return [Math.max(0, first - 1), Math.min(g.tops.length - 1, last + 1)];
}

const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");

export interface ScriptViewProps {
  /** Prepara: K adds a note. */
  onNoteKey?: () => void;
}

/**
 * The script: pages of the PDF one under the other, scrolled continuously. Only the visible pages (± 1) are in
 * the page; zoom keeps the point under focus; Ctrl held = peek (13_cue.md, "Il copione").
 */
export function ScriptView({ onNoteKey }: ScriptViewProps) {
  const t = useT();
  const doc = useScriptDoc((s) => s.doc);
  const docKey = useScriptDoc((s) => s.key) ?? "";
  const sizes = useScriptDoc((s) => s.sizes);
  const zoom = useScriptView((s) => s.zoom);
  const peek = useScriptView((s) => s.peek);
  const paper = useSettings((s) => s.settings.paper);
  const brightness = useSettings((s) => s.settings.paperBrightness);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [range, setRange] = useState<[number, number]>([0, 2]);
  const geometry = useMemo(() => computeGeometry(sizes, view.w, view.h, zoom), [sizes, view.w, view.h, zoom]);
  const geoRef = useRef(geometry);
  geoRef.current = geometry;
  /** The point to keep in place across the next change of geometry (zoom), in view px. */
  const focusRef = useRef<{ page: number; fx: number; fy: number; vx: number; vy: number } | null>(null);
  /** The page point at the top of the view (kept when the column is resized). */
  const topRef = useRef<{ page: number; fy: number } | null>(null);

  useEffect(() => () => dropCache(), [docKey]);

  // Size of the view.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    scriptLive.attach(el);
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setView({ w: el.clientWidth, h: el.clientHeight });
    return () => {
      ro.disconnect();
      scriptLive.attach(null);
      scriptLive.setPointer(null);
      useScriptView.getState().setGeometry(null);
    };
  }, []);

  const pageAt = useCallback((g: Geometry, contentY: number) => {
    let i = 0;
    while (i < g.tops.length - 1 && contentY >= g.tops[i + 1] - GAP / 2) i++;
    return i;
  }, []);

  const anim = useRef<{ raf: number | null; target: number; expect: number; tween: { from: number; to: number; start: number; done?: () => void } | null }>({ raf: null, target: 0, expect: 0, tween: null });

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    const g = geoRef.current;
    if (!el || !g) return;
    const top = el.scrollTop;
    // Moved by something else (scroll bar, a jump) while a key step was gliding: the step gives way.
    const an = anim.current;
    if (an.raf !== null && !an.tween && Math.abs(top - an.expect) > 3) {
      cancelAnimationFrame(an.raf);
      an.raf = null;
    }
    const [a, b] = rangeOf(g, top, el.clientHeight);
    setRange((r) => (r[0] === a && r[1] === b ? r : [a, b]));
    const i = pageAt(g, top);
    topRef.current = { page: i, fy: (top - g.tops[i]) / g.heights[i] };
    scriptLive.emit(top);
    const pk = useScriptView.getState().peek;
    if (pk && !pk.returning && !pk.moved && Math.abs(top - pk.fromTop) > 2) useScriptView.getState().setPeek({ ...pk, moved: true, visible: true });
  }, [pageAt]);

  // New geometry: keep the focused point (zoom) or the top of the view (resize, new script).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    useScriptView.getState().setGeometry(geometry);
    if (!el || !geometry) return;
    const f = focusRef.current;
    focusRef.current = null;
    if (f) {
      el.scrollTop = geometry.tops[f.page] + f.fy * geometry.heights[f.page] - f.vy;
      el.scrollLeft = geometry.lefts[f.page] + f.fx * geometry.widths[f.page] - f.vx;
    } else if (topRef.current) {
      const p = Math.min(topRef.current.page, geometry.tops.length - 1);
      el.scrollTop = geometry.tops[p] + topRef.current.fy * geometry.heights[p];
    }
    onScroll();
  }, [geometry, onScroll]);

  /* ---------------- Movement ---------------- */

  const stopAnim = useCallback(() => {
    const a = anim.current;
    if (a.raf !== null) cancelAnimationFrame(a.raf);
    a.raf = null;
    a.tween = null;
  }, []);
  const tick = useCallback(() => {
    const el = scrollRef.current;
    const a = anim.current;
    if (!el) return void (a.raf = null);
    if (a.tween) {
      const k = Math.min(1, (performance.now() - a.tween.start) / RETURN_MS);
      el.scrollTop = a.tween.from + (a.tween.to - a.tween.from) * ease(k);
      if (k >= 1) {
        const done = a.tween.done;
        a.tween = null;
        a.raf = null;
        done?.();
        return;
      }
    } else {
      const d = a.target - el.scrollTop;
      if (Math.abs(d) < 0.6) {
        el.scrollTop = a.target;
        a.raf = null;
        return;
      }
      el.scrollTop += d * 0.3;
    }
    a.expect = el.scrollTop;
    a.raf = requestAnimationFrame(tick);
  }, []);
  const scrollStep = useCallback(
    (dy: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const a = anim.current;
      if (a.tween) return;
      const from = a.raf !== null ? a.target : el.scrollTop;
      a.target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, from + dy));
      if (a.raf === null) a.raf = requestAnimationFrame(tick);
    },
    [tick],
  );
  const tweenTo = useCallback(
    (to: number, done?: () => void) => {
      const el = scrollRef.current;
      if (!el) return;
      stopAnim();
      const a = anim.current;
      a.tween = { from: el.scrollTop, to: Math.max(0, Math.min(el.scrollHeight - el.clientHeight, to)), start: performance.now(), done };
      a.raf = requestAnimationFrame(tick);
    },
    [stopAnim, tick],
  );

  /** Zoom keeping a point of the view in place (the pointer, or the centre). */
  const zoomBy = useCallback(
    (factor: number, at?: { x: number; y: number }) => {
      const el = scrollRef.current;
      const g = geoRef.current;
      if (!el || !g) return;
      const cur = useScriptView.getState().zoom;
      const next = clampZoom(factor === 0 ? 1 : cur * factor);
      if (next === cur) return;
      stopAnim();
      const vx = at?.x ?? el.clientWidth / 2;
      const vy = at?.y ?? el.clientHeight * READING_LINE;
      const cy = el.scrollTop + vy;
      const page = pageAt(g, cy);
      focusRef.current = { page, vx, vy, fx: (el.scrollLeft + vx - g.lefts[page]) / g.widths[page], fy: (cy - g.tops[page]) / g.heights[page] };
      useScriptView.getState().setZoom(next);
    },
    [pageAt, stopAnim],
  );

  const goPage = useCallback(
    (delta: number) => {
      const el = scrollRef.current;
      const g = geoRef.current;
      if (!el || !g) return;
      const cur = pageAt(g, el.scrollTop + 4);
      const target = Math.min(g.tops.length - 1, Math.max(0, cur + delta));
      tweenTo(g.tops[target] - PAD);
    },
    [pageAt, tweenTo],
  );

  /* ---------------- Keys and peek ---------------- */

  const pointerInView = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    const endPeek = () => {
      if (showTimer) clearTimeout(showTimer);
      showTimer = null;
      const st = useScriptView.getState();
      const pk = st.peek;
      if (!pk || pk.returning) return;
      const el = scrollRef.current;
      if (pk.moved && el && Math.abs(el.scrollTop - pk.fromTop) > 1) {
        st.setPeek({ ...pk, returning: true, visible: true });
        tweenTo(pk.fromTop, () => useScriptView.getState().setPeek(null));
      } else st.setPeek(null);
    };
    const onDown = (e: KeyboardEvent) => {
      if (useUi.getState().dialog || isTyping(e.target) || e.altKey || e.metaKey) return;
      const st = useScriptView.getState();
      const el = scrollRef.current;
      if (!el) return;
      if (e.key === "Control") {
        if (e.repeat || st.peek) return;
        stopAnim();
        st.setPeek({ fromTop: el.scrollTop, visible: false, moved: false, returning: false });
        showTimer = setTimeout(() => {
          const pk = useScriptView.getState().peek;
          if (pk && !pk.visible) useScriptView.getState().setPeek({ ...pk, visible: true });
        }, PEEK_SHOW_MS);
        return;
      }
      if (e.ctrlKey) {
        // While peeking ↑ ↓ scroll; any other Ctrl shortcut (Ctrl+L, Ctrl+S…) is not a peek.
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (st.peek && !st.peek.returning) {
            st.setPeek({ ...st.peek, moved: true, visible: true });
            scrollStep(e.key === "ArrowDown" ? STEP : -STEP);
          }
          return;
        }
        if (st.peek && !st.peek.moved && !st.peek.returning) {
          if (showTimer) clearTimeout(showTimer);
          showTimer = null;
          st.setPeek(null);
        }
        return;
      }
      if (e.shiftKey && e.key.length === 1) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const arrows = useSettings.getState().settings.arrowKeys;
      if (k === "ArrowDown" || k === "s") {
        e.preventDefault();
        scrollStep(STEP);
      } else if (k === "ArrowUp" || k === "w") {
        e.preventDefault();
        scrollStep(-STEP);
      } else if (k === "ArrowRight" || k === "d") {
        e.preventDefault();
        if (arrows === "zoom") zoomBy(ZOOM_STEP, pointerInView.current ?? undefined);
        else if (!e.repeat) goPage(1);
      } else if (k === "ArrowLeft" || k === "a") {
        e.preventDefault();
        if (arrows === "zoom") zoomBy(1 / ZOOM_STEP, pointerInView.current ?? undefined);
        else if (!e.repeat) goPage(-1);
      } else if (k === "PageDown" || k === "PageUp") {
        e.preventDefault();
        scrollStep((k === "PageDown" ? 1 : -1) * el.clientHeight * 0.85);
      } else if (k === "k" && onNoteKey && !e.repeat) {
        e.preventDefault();
        onNoteKey();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Control") endPeek();
    };
    const onBlur = () => endPeek();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      if (showTimer) clearTimeout(showTimer);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      useScriptView.getState().setPeek(null);
    };
  }, [goPage, onNoteKey, scrollStep, stopAnim, tweenTo, zoomBy]);

  // The wheel: native scrolling, except with Ctrl (peek: it scrolls, it never zooms) and over the parts that
  // follow the script (notes, columns), where it scrolls the script.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = scrollRef.current;
      if (!el) return;
      const stage = el.closest(".cue-stage");
      const inside = el.contains(e.target as Node);
      const follower = !inside && !!stage?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".cue-panel, .cue-library, textarea");
      if (!e.ctrlKey && !follower) {
        if (inside) stopAnim();
        return;
      }
      if (!inside && !follower && !e.ctrlKey) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      const st = useScriptView.getState();
      if (e.ctrlKey) {
        if (st.peek?.returning) return;
        stopAnim();
        if (!st.peek) st.setPeek({ fromTop: el.scrollTop, visible: true, moved: true, returning: false });
        else if (!st.peek.moved || !st.peek.visible) st.setPeek({ ...st.peek, moved: true, visible: true });
      } else stopAnim();
      el.scrollTop += dy;
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [stopAnim]);

  const onPointerMove = (e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vx = e.clientX - r.left;
    const vy = e.clientY - r.top;
    pointerInView.current = { x: vx, y: vy };
    scriptLive.setPointer({ x: vx + el.scrollLeft, y: vy + el.scrollTop });
  };
  const onPointerLeave = () => {
    pointerInView.current = null;
    scriptLive.setPointer(null);
  };

  const filter = paper === "dark" ? `invert(0.89) hue-rotate(180deg) brightness(${(brightness / 100).toFixed(2)})` : undefined;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const renderScale = geometry ? Math.round(geometry.scale * dpr * 1000) / 1000 : 1;
  const peekLineTop = peek ? peek.fromTop + (geometry?.viewHeight ?? 0) * READING_LINE : 0;
  const [first, last] = range;

  return (
    <div className="cue-script" data-paper={paper}>
      <div ref={scrollRef} className="cue-script__scroll" onScroll={onScroll} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} tabIndex={-1}>
        {geometry && doc ? (
          <div className="cue-script__content" style={{ height: geometry.contentHeight, width: geometry.contentWidth }}>
            {geometry.tops.slice(first, last + 1).map((top, k) => {
              const i = first + k;
              return (
                <PageSlot
                  key={`${docKey}:${i}`}
                  doc={doc}
                  docKey={docKey}
                  page={i + 1}
                  pages={geometry.tops.length}
                  top={top}
                  left={geometry.lefts[i]}
                  width={geometry.widths[i]}
                  height={geometry.heights[i]}
                  renderScale={renderScale}
                  filter={filter}
                />
              );
            })}
            {peek?.visible ? (
              <div className="cue-script__here" style={{ top: peekLineTop }}>
                <span>{t("you were here")}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {geometry ? <ZoomPill zoom={zoom} onZoom={(f) => zoomBy(f)} /> : null}
    </div>
  );
}

function ZoomPill({ zoom, onZoom }: { zoom: number; onZoom: (factor: number) => void }) {
  const t = useT();
  return (
    <div className="cue-zoompill" role="group" aria-label={t("Zoom")}>
      <Button variant="ghost" iconOnly icon="minus" aria-label={t("Zoom out")} title={`${t("Zoom out")} · ←`} onClick={() => onZoom(1 / ZOOM_STEP)} />
      <button type="button" className="cue-zoompill__value" title={t("Fit the page width")} onClick={() => onZoom(0)}>
        {Math.round(zoom * 100)}%
      </button>
      <Button variant="ghost" iconOnly icon="plus" aria-label={t("Zoom in")} title={`${t("Zoom in")} · →`} onClick={() => onZoom(ZOOM_STEP)} />
    </div>
  );
}

interface PageSlotProps {
  doc: PDFDocumentProxy;
  docKey: string;
  page: number;
  pages: number;
  top: number;
  left: number;
  width: number;
  height: number;
  renderScale: number;
  filter?: string;
}

/** One page: white paper at once, the canvas when pdf.js has drawn it; on zoom the old canvas stretches until the new one is ready. */
const PageSlot = memo(function PageSlot({ doc, docKey, page, pages, top, left, width, height, renderScale, filter }: PageSlotProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [comments, setComments] = useState<PdfComment[]>([]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let job: { cancel: () => void } | null = null;
    let disposed = false;
    const start = () => {
      const r = renderPage(doc, docKey, page, renderScale);
      job = r;
      r.promise.then((canvas) => {
        if (disposed || !canvas || !hostRef.current) return;
        if (host.firstChild !== canvas) host.replaceChildren(canvas);
      });
    };
    // A canvas already there (another zoom) stays, stretched, while the sharp one is drawn shortly after.
    const timer = host.firstChild ? setTimeout(start, 140) : null;
    if (!timer) start();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      job?.cancel();
    };
  }, [doc, docKey, page, renderScale]);
  useEffect(() => {
    let alive = true;
    commentsOf(doc, docKey, page).then((c) => alive && setComments(c));
    return () => {
      alive = false;
    };
  }, [doc, docKey, page]);
  return (
    <div className="cue-page" style={{ top, left, width, height }} data-page={page}>
      <div className="cue-page__paper" style={filter ? { filter } : undefined}>
        <div ref={hostRef} className="cue-page__host" />
      </div>
      {comments.map((c, i) => (
        <span
          key={i}
          className={`cue-page__comment${c.icon ? " cue-page__comment--icon" : ""}`}
          style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: c.icon ? undefined : `${c.w * 100}%`, height: c.icon ? undefined : `${c.h * 100}%` }}
        >
          {c.icon ? <Icon name="message" size={13} /> : null}
          <span className="cue-page__tip" role="tooltip">
            {c.author ? <b>{c.author}</b> : null}
            {c.text}
          </span>
        </span>
      ))}
      <span className="cue-page__num">
        {page} / {pages}
      </span>
    </div>
  );
});

/**
 * The peek band, over the script and the columns: "Sbirciata · lascia Ctrl per tornare" (+ "al GO n" once GOs
 * exist: `target`).
 */
export function PeekBand({ target }: { target?: string }) {
  const t = useT();
  const visible = useScriptView((s) => !!s.peek?.visible);
  if (!visible) return null;
  return (
    <div className="cue-peekband" role="status">
      <Icon name="eye" size={15} />
      <span>
        {t("Peek")} · {t("release")} <Kbd>Ctrl</Kbd> {target ? t("to go back {target}", { target }) : t("to go back")}
      </span>
    </div>
  );
}
