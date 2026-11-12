import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "prosemirror-view";
import { useT } from "@theatre-suite/core";
import { Icon, Segmented, type IconName } from "@theatre-suite/ui";
import { moveBlocks, scrollToPos } from "../editor/commands";
import { pageOfPos, type Pagination } from "../editor/paginate";
import { getIndex } from "../editor/plugins";
import { useDoc } from "../store/doc";
import { FoldButton, FoldRail } from "../common/Fold";
import { useUi } from "../store/ui";

interface Entry {
  key: string;
  idx: number;
  /** Last block (exclusive) that moves with this entry. */
  end: number;
  pos: number;
  level: number;
  icon: IconName | null;
  label: string;
  page: number | null;
  act: string | null;
  collapsible: boolean;
}


const THUMB_W = 150;

/**
 * Miniature of a printed page, like the side bar of a slide editor: the real blocks of
 * the page (same stylesheet) copied into a small white sheet. Drawn only while visible.
 */
function PageThumb({ view, pages, page, current, onOpen, docRev }: { view: EditorView; pages: Pagination; page: number; current: boolean; onOpen: () => void; docRev: unknown }) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const g = pages.geom;
  const p = pages.pages[page];
  const k = THUMB_W / g.pageW;
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: "240px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !visible) return;
    const draw = () => {
      body.textContent = "";
      const doc = view.state.doc;
      // A page that starts in the middle of a speech skips that block (its start is on the page before).
      const continued = page > 0 && pages.pages[page - 1].firstBlock === p.firstBlock;
      const from = continued ? p.firstBlock + 1 : p.firstBlock;
      const wrap = document.createElement("div");
      wrap.className = "b-doc";
      wrap.style.cssText = `position:absolute;left:${-p.left}px;top:${g.zones[p.zone].top}px;width:${g.contentW}px`;
      doc.forEach((_node, offset, i) => {
        if (i < from || pages.blockPage[i] !== page) return;
        const dom = view.nodeDOM(offset) as HTMLElement | null;
        if (!dom || !(dom instanceof HTMLElement)) return;
        const copy = dom.cloneNode(true) as HTMLElement;
        copy.querySelectorAll(".b-pb, .b-lane, .b-auto-lane").forEach((x) => x.remove());
        copy.removeAttribute("contenteditable");
        copy.classList.remove("ProseMirror-selectednode");
        wrap.appendChild(copy);
      });
      body.appendChild(wrap);
    };
    const id = window.setTimeout(draw, 160);
    return () => window.clearTimeout(id);
  }, [visible, view, pages, page, docRev, p, g]);
  return (
    <button ref={hostRef} type="button" className="bd-pthumb" aria-current={current} onClick={onOpen} title={`${p.number}`}>
      <span className="bd-pthumb__sheet" style={{ width: THUMB_W, height: Math.round(g.pageH * k) }}>
        <div ref={bodyRef} className="bd-pthumb__body" style={{ width: g.pageW, height: g.pageH, transform: `scale(${k})` }} />
      </span>
      <span className="bd-pthumb__num">{p.number}</span>
    </button>
  );
}

/** Outline of the script (or its pages), like the side bar of a PDF reader. */
export function StructurePanel() {
  const t = useT();
  const view = useDoc((s) => s.view);
  const state = useDoc((s) => s.state);
  const pages = useDoc((s) => s.pages);
  const mode = useUi((s) => s.structureView);
  const folded = useUi((s) => s.hidden.structure);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Entry | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const doc = state?.doc;
  const index = state ? getIndex(state) : null;
  const entries = useMemo(() => {
    if (!doc || !index) return [] as Entry[];
    const out: Entry[] = [];
    let act: string | null = null;
    let inTableau = false;
    const count = doc.childCount;
    const nextIdx = (from: number, stops: string[]) => {
      for (let k = from + 1; k < count; k++) if (stops.includes(doc.child(k).type.name)) return k;
      return count;
    };
    doc.forEach((node, pos, i) => {
      const name = node.type.name;
      const page = pageOfPos(pages, index, pos);
      if (name === "act") {
        const info = index.acts.find((a) => a.idx === i);
        act = node.attrs.id;
        inTableau = false;
        out.push({ key: node.attrs.id, idx: i, end: nextIdx(i, ["act", "auto"]), pos, level: 0, icon: "curtain", label: info ? `${info.label}${info.title ? ` · ${info.title}` : ""}` : "", page, act: null, collapsible: true });
      } else if (name === "tableau") {
        const info = index.tableaux.find((a) => a.idx === i);
        inTableau = true;
        out.push({ key: node.attrs.id, idx: i, end: nextIdx(i, ["act", "tableau", "auto"]), pos, level: act ? 1 : 0, icon: "frame", label: info ? `${info.label}${info.title ? ` · ${info.title}` : ""}` : "", page, act, collapsible: false });
      } else if (name === "scene") {
        const info = index.scenes.find((s) => s.idx === i);
        const title = (node.attrs.title as string) || (node.attrs.place as string);
        out.push({ key: node.attrs.id, idx: i, end: nextIdx(i, ["act", "tableau", "scene", "auto"]), pos, level: (act ? 1 : 0) + (inTableau ? 1 : 0), icon: null, label: info ? `${info.label}${title ? ` · ${title}` : ""}` : "", page, act, collapsible: false });
      } else if (name === "auto") {
        const kind = node.attrs.kind as string;
        const cfg = (node.attrs.config ?? {}) as { title?: string };
        const label = kind === "title" ? t("Title page") : kind === "characters" ? cfg.title || t("Characters") : kind === "cast" ? cfg.title || t("Cast and crew") : cfg.title || t("Automatic list");
        const icon: IconName = kind === "title" ? "title" : kind === "characters" ? "users" : kind === "cast" ? "crew" : "list";
        act = null;
        out.push({ key: node.attrs.id, idx: i, end: i + 1, pos, level: 0, icon, label, page, act: null, collapsible: false });
      } else if (name === "section" && node.textContent.trim()) {
        out.push({ key: `sec-${i}`, idx: i, end: nextIdx(i, ["section", "act", "auto"]), pos, level: 0, icon: "type", label: node.textContent.trim(), page, act: null, collapsible: false });
      }
    });
    return out;
  }, [doc, index, pages, t]);

  if (!view || !state || !index) return <aside className="bd-structure" />;
  if (folded) return <FoldRail panel="structure" side="left" label={t("Structure of the script")} />;
  const caretBlock = state.selection.$from.index(0);
  let current: string | null = null;
  for (const e of entries) if (e.idx <= caretBlock) current = e.key;
  const totalPages = pages && !pages.continuous ? pages.pages.length : null;
  let currentPage = -1;
  if (pages && !pages.continuous && pages.pages.length) {
    const b = Math.min(caretBlock, pages.blockPage.length - 1);
    currentPage = pages.blockPage[b] ?? 0;
    for (const sp of pages.splits) if (sp.block === b && sp.pos <= state.selection.from) currentPage = sp.page;
  }

  return (
    <aside className="bd-structure" aria-label={t("Structure of the script")}>
      <div className="bd-structure__head">
        <div className="bd-panel-head">
          <div className="bd-seg-full" style={{ flex: 1 }}>
          <Segmented
            ariaLabel={t("View")}
            small
            value={mode}
            onChange={(m) => useUi.getState().setStructureView(m)}
            options={[
              { value: "tree", label: t("Structure"), icon: "tree" },
              { value: "pages", label: t("Pages"), icon: "pages" },
            ]}
          />
          </div>
          <FoldButton panel="structure" side="left" />
        </div>
        <div className="bd-structure__summary">
          {t("{a} acts · {s} scenes", { a: index.acts.length, s: index.scenes.length })}
          {totalPages ? ` · ${t("{n} pages", { n: totalPages })}` : ""}
        </div>
      </div>
      {mode === "tree" ? (
        <nav className="bd-structure__list">
          {entries
            .filter((e) => !(e.act && collapsed.has(e.act)))
            .map((e) => (
              <button
                key={e.key}
                type="button"
                className={`bd-tree-item${over === e.key && drag && drag.key !== e.key ? " bd-tree-item--drop" : ""}`}
                aria-current={current === e.key}
                draggable
                onDragStart={(ev) => {
                  setDrag(e);
                  ev.dataTransfer.effectAllowed = "move";
                  ev.dataTransfer.setData("text/plain", e.key);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                onDragOver={(ev) => {
                  if (!drag) return;
                  ev.preventDefault();
                  setOver(e.key);
                }}
                onDrop={(ev) => {
                  ev.preventDefault();
                  if (drag && drag.key !== e.key) moveBlocks(view, drag.idx, drag.end, e.idx);
                  setDrag(null);
                  setOver(null);
                }}
                onClick={() => scrollToPos(view, e.pos)}
                style={{ paddingLeft: 6 + e.level * 16 }}
              >
                {e.collapsible ? (
                  <span
                    className="bd-tree-chev"
                    role="button"
                    aria-label={collapsed.has(e.key) ? t("Expand") : t("Collapse")}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      const next = new Set(collapsed);
                      if (next.has(e.key)) next.delete(e.key);
                      else next.add(e.key);
                      setCollapsed(next);
                    }}
                  >
                    <Icon name={collapsed.has(e.key) ? "chevRight" : "chevDown"} size={12} strokeWidth={2.2} />
                  </span>
                ) : null}
                {e.icon ? <Icon name={e.icon} size={14} color="var(--text-2)" /> : <span style={{ width: 4 }} />}
                <span className="bd-tree-item__label">{e.label}</span>
                <span className="bd-tree-item__meta">{e.page ?? ""}</span>
              </button>
            ))}
          {!entries.length ? <div className="bd-structure__summary">{t("Add an act or a scene from the bar above.")}</div> : null}
        </nav>
      ) : (
        <nav className="bd-structure__list bd-pthumbs">
          {pages && !pages.continuous
            ? pages.pages.map((p) => (
                <PageThumb
                  key={p.index}
                  view={view}
                  pages={pages}
                  page={p.index}
                  current={currentPage === p.index}
                  docRev={state.doc}
                  onOpen={() => scrollToPos(view, index.blockPos[p.firstBlock] ?? 0)}
                />
              ))
            : null}
          {pages?.continuous ? <div className="bd-structure__summary">{t("Pages are hidden in the continuous view.")}</div> : null}
        </nav>
      )}
      <div className="bd-structure__foot">{t("Drag acts and scenes to move them: numbers update by themselves.")}</div>
    </aside>
  );
}
