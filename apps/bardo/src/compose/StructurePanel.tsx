import { useMemo, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Icon, Segmented, type IconName } from "@theatre-suite/ui";
import { moveBlocks, scrollToPos } from "../editor/commands";
import { pageOfPos } from "../editor/paginate";
import { getIndex } from "../editor/plugins";
import { useDoc } from "../store/doc";
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

/** Outline of the script (or its pages), like the side bar of a PDF reader. */
export function StructurePanel() {
  const t = useT();
  const view = useDoc((s) => s.view);
  const state = useDoc((s) => s.state);
  const pages = useDoc((s) => s.pages);
  const mode = useUi((s) => s.structureView);
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
  const caretBlock = state.selection.$from.index(0);
  let current: string | null = null;
  for (const e of entries) if (e.idx <= caretBlock) current = e.key;
  const totalPages = pages && !pages.continuous ? pages.pages.length : null;

  return (
    <aside className="bd-structure" aria-label={t("Structure of the script")}>
      <div className="bd-structure__head">
        <div className="bd-seg-full">
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
        <nav className="bd-structure__list">
          {(pages && !pages.continuous ? pages.pages : []).map((p) => {
            const scene = p.scene >= 0 ? index.scenes[p.scene] : null;
            const node = state.doc.child(Math.min(p.firstBlock, state.doc.childCount - 1));
            const preview = node.isTextblock ? node.textContent.slice(0, 40) : scene?.label ?? "";
            return (
              <button key={p.index} type="button" className="bd-tree-item" onClick={() => scrollToPos(view, index.blockPos[p.firstBlock] ?? 0)}>
                <Icon name="pages" size={14} color="var(--text-2)" />
                <span className="bd-tree-item__label">
                  {scene ? `${scene.label} · ` : ""}
                  <span className="ts-muted">{preview}</span>
                </span>
                <span className="bd-tree-item__meta">{p.number}</span>
              </button>
            );
          })}
          {pages?.continuous ? <div className="bd-structure__summary">{t("Pages are hidden in the continuous view.")}</div> : null}
        </nav>
      )}
      <div className="bd-structure__foot">{t("Drag acts and scenes to move them: numbers update by themselves.")}</div>
    </aside>
  );
}
