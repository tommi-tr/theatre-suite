import { useRef, useState, type ReactNode } from "react";
import { useT } from "@theatre-suite/core";
import { Icon, type IconName } from "@theatre-suite/ui";
import { clearManualFormatting, currentBlock, insertPageBreak, insertPart, inlineDirection, setBlockType, setParagraphAttr, toggleMarkType, updateData } from "../editor/commands";
import { extraCategories, getData } from "../model/defaults";
import { schema } from "../model/schema";
import { useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { copyCut, markWithCategory, newNote, paste } from "./actions";
import { CAT_ICONS } from "./Popups";

export function RGroup({ label, children, rows }: { label: string; children: ReactNode; rows?: boolean }) {
  return (
    <div className="bd-rgroup">
      {rows ? <div className="bd-rgroup__rows">{children}</div> : <div className="bd-rgroup__body">{children}</div>}
      <div className="bd-rgroup__label">{label}</div>
    </div>
  );
}

export function RCol({ children }: { children: ReactNode }) {
  return <div className="bd-rcol">{children}</div>;
}

export function RB({ icon, children, onClick, pressed, disabled, title, iconOnly, label }: { icon: IconName; children?: ReactNode; onClick?: () => void; pressed?: boolean; disabled?: boolean; title?: string; iconOnly?: boolean; label?: string }) {
  return (
    <button
      type="button"
      className={`bd-rb${iconOnly ? " bd-rb--icon" : ""}`}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-label={iconOnly ? label : undefined}
      disabled={disabled}
      title={title ?? label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}

export function RBig({ icon, children, onClick, pressed, wide, title }: { icon: IconName; children: ReactNode; onClick?: () => void; pressed?: boolean; wide?: boolean; title?: string }) {
  return (
    <button type="button" className={`bd-rbig${wide ? " bd-rbig--wide" : ""}`} aria-pressed={pressed} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <Icon name={icon} size={22} strokeWidth={1.8} />
      {children}
    </button>
  );
}

export const Sep = () => <span className="bd-rsep" />;

/** A small menu opened from a ribbon button. */
function MenuButton({ icon, label, children }: { icon: IconName; label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="bd-rb"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ left: Math.min(r.left, window.innerWidth - 250), top: r.bottom + 4 });
          setOpen(!open);
        }}
      >
        <Icon name={icon} size={15} />
        {label}
        <Icon name="chevDown" size={11} />
      </button>
      {open ? (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 59 }} onMouseDown={() => setOpen(false)} />
          <div className="bd-menu" role="menu" style={{ position: "fixed", ...pos }} onMouseDown={(e) => e.preventDefault()}>
            {children(() => setOpen(false))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The bar of the Componi phase (no formatting here: that lives in Formatta). */
export function ComposeRibbon() {
  const t = useT();
  const view = useDoc((s) => s.view);
  const state = useDoc((s) => s.state);
  const spell = useSettings((s) => s.settings.spellcheck);
  if (!view || !state) return <div className="bd-ribbon" />;
  const data = getData(state.doc);
  const block = currentBlock(state);
  const type = block?.node.type.name;
  const ui = useUi.getState();
  const builtin = data.categories.slice(0, 6);
  const others = data.categories.slice(6);
  const extras = extraCategories(data.lang).filter((c) => !data.categories.some((x) => x.id === c.id));
  return (
    <div className="bd-ribbon" role="toolbar" aria-label={t("Compose tools")}>
      <RGroup label={t("Clipboard")}>
        <RBig icon="clipboard" onClick={() => paste(view, t, false)}>
          {t("Paste")}
        </RBig>
        <RCol>
          <RB icon="scissors" onClick={() => copyCut(view, true)} title="Ctrl X">
            {t("Cut")}
          </RB>
          <RB icon="copy" onClick={() => copyCut(view, false)} title="Ctrl C">
            {t("Copy")}
          </RB>
        </RCol>
      </RGroup>
      <Sep />
      <RGroup label={t("Text")}>
        <RCol>
          <RB icon="speech" pressed={type === "speech"} title={t("Speech · type the name and press Tab")} onClick={() => block && ui.setSpeakerPicker({ pos: block.pos, mode: type === "speech" ? "change" : "convert" })}>
            {t("Speech")}
          </RB>
          <RB icon="italic" pressed={type === "direction"} title={t("Stage direction · Ctrl D")} onClick={() => setBlockType(view, "direction")}>
            {t("Direction")}
          </RB>
          <RB icon="parens" title={t("Inline direction · type a bracket")} disabled={type !== "speech"} onClick={() => inlineDirection(view)}>
            {t("Inline")}
          </RB>
        </RCol>
      </RGroup>
      <Sep />
      <RGroup label={t("Division")}>
        <RCol>
          <RB icon="curtain" title="Ctrl Shift 1" onClick={() => insertPart(view, "act")}>
            {t("Act")}
          </RB>
          <RB icon="frame" title="Ctrl Shift 2" onClick={() => insertPart(view, "tableau")}>
            {t("Tableau")}
          </RB>
          <RB icon="door" title="Ctrl Shift 3" onClick={() => insertPart(view, "scene")}>
            {t("Scene")}
          </RB>
        </RCol>
      </RGroup>
      <Sep />
      <RGroup label={t("Categories")}>
        <RCol>
          {builtin.slice(0, 3).map((c, i) => (
            <RB key={c.id} icon={CAT_ICONS[c.icon]} title={`${c.name} · Ctrl ${i + 1}`} onClick={() => markWithCategory(view, t, c.id)}>
              {c.name}
            </RB>
          ))}
        </RCol>
        <RCol>
          {builtin.slice(3, 6).map((c, i) => (
            <RB key={c.id} icon={CAT_ICONS[c.icon]} title={`${c.name} · Ctrl ${i + 4}`} onClick={() => markWithCategory(view, t, c.id)}>
              {c.name}
            </RB>
          ))}
        </RCol>
        <RCol>
          <MenuButton icon="tags" label={t("More")}>
            {(close) => (
              <>
                {others.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    className="bd-menu__item"
                    onClick={() => {
                      close();
                      markWithCategory(view, t, c.id);
                    }}
                  >
                    <Icon name={CAT_ICONS[c.icon]} size={15} />
                    {c.name}
                    {i + 7 <= 9 ? <kbd className="ts-kbd">Ctrl {i + 7}</kbd> : null}
                  </button>
                ))}
                {extras.length ? <div className="bd-menu__label">{t("Add a category")}</div> : null}
                {extras.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="bd-menu__item"
                    onClick={() => {
                      close();
                      updateData(view, (d) => ({ ...d, categories: [...d.categories, c] }));
                      markWithCategory(view, t, c.id);
                    }}
                  >
                    <Icon name="plus" size={15} />
                    {c.name}
                  </button>
                ))}
                <div className="bd-menu__sep" />
                <button
                  type="button"
                  className="bd-menu__item"
                  onClick={() => {
                    close();
                    ui.openDialog("categories");
                  }}
                >
                  <Icon name="settings" size={15} />
                  {t("Manage categories…")}
                </button>
              </>
            )}
          </MenuButton>
        </RCol>
      </RGroup>
      <Sep />
      <RGroup label={t("Insert")}>
        <RCol>
          <RB icon="list" onClick={() => ui.openDialog("autolist", undefined, "list")}>
            {t("List")}
          </RB>
          <RB icon="table" onClick={() => ui.openDialog("autolist", undefined, "presence")}>
            {t("Table")}
          </RB>
          <RB icon="listNum" onClick={() => ui.openDialog("autolist", undefined, "index")}>
            {t("Index")}
          </RB>
        </RCol>
        <RCol>
          <RB icon="image" disabled title={t("Coming in the next version")}>
            {t("Image")}
          </RB>
          <RB icon="omega" onClick={() => ui.openDialog("symbols")}>
            {t("Symbol")}
          </RB>
        </RCol>
      </RGroup>
      <Sep />
      <RGroup label={t("Notes")}>
        <RCol>
          <RB icon="note" title="Ctrl Shift N" onClick={() => newNote(view, t)}>
            {t("Note")}
          </RB>
          <RB icon="footnote" disabled title={t("Coming in the next version")}>
            {t("Footnote")}
          </RB>
        </RCol>
      </RGroup>
      <Sep />
      <RGroup label={t("Review")}>
        <RCol>
          <RB icon="version" title={t("Text version: proposed automatically, you can change it")} onClick={() => ui.openDialog("version")}>
            {t("Version")}
            <span className="bd-badge">{data.version}</span>
          </RB>
          <RB icon="suggest" disabled title={t("Coming in the next version")}>
            {t("Suggestions")}
          </RB>
          <RB icon="spell" pressed={spell} onClick={() => useSettings.getState().update({ spellcheck: !spell })}>
            {t("Spelling")}
          </RB>
        </RCol>
      </RGroup>
      <div style={{ flex: 1, minWidth: 8 }} />
      <Sep />
      <RGroup label={t("Exceptions")}>
        <RBig icon="case" wide pressed={false} onClick={() => ui.setRibbon("manual")}>
          {t("Manual formatting")}
        </RBig>
      </RGroup>
    </div>
  );
}

const COLORS = ["#1b1c21", "#4a4e58", "#7a1f2b", "#1f3a68", "#2e6b3a", "#a9501f"];
const HIGHLIGHTS = ["#fff2a8", "#ffd8b8", "#d8f0d0", "#d6e6ff", "#f5d6ef"];

/** Manual formatting bar: for exceptions only (applies to the selected text). */
export function ManualRibbon() {
  const t = useT();
  const view = useDoc((s) => s.view);
  const state = useDoc((s) => s.state);
  const marksOn = useSettings((s) => s.settings.showMarks);
  if (!view || !state) return <div className="bd-ribbon" />;
  const m = schema.marks;
  const sel = state.selection;
  const active = (type: (typeof m)[keyof typeof m]) => (sel.empty ? !!type.isInSet(state.storedMarks ?? sel.$from.marks()) : state.doc.rangeHasMark(sel.from, sel.to, type));
  const para = sel.$from.parent.type === schema.nodes.paragraph ? sel.$from.parent : null;
  const sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
  return (
    <div className="bd-ribbon bd-ribbon--manual" role="toolbar" aria-label={t("Manual formatting")}>
      <RGroup label={t("Clipboard")}>
        <RBig icon="clipboard" onClick={() => paste(view, t, false)}>
          {t("Paste")}
        </RBig>
        <RCol>
          <RB icon="scissors" onClick={() => copyCut(view, true)}>
            {t("Cut")}
          </RB>
          <RB icon="copy" onClick={() => copyCut(view, false)}>
            {t("Copy")}
          </RB>
          <RB icon="eraser" onClick={() => clearManualFormatting(view)}>
            {t("Clear formatting")}
          </RB>
        </RCol>
      </RGroup>
      <Sep />
      <RGroup label={t("Font")} rows>
        <div className="bd-rgroup__row">
          <select className="bd-select" style={{ width: 150 }} aria-label={t("Typeface")} defaultValue="" onChange={(e) => e.currentTarget.value && toggleMarkType(view, m.font, { font: e.currentTarget.value })}>
            <option value="" disabled>
              {t("Typeface")}
            </option>
            <option value="serif">Source Serif 4</option>
            <option value="sans">Geist</option>
            <option value="mono">Courier Prime</option>
          </select>
          <select className="bd-select mono" style={{ width: 64 }} aria-label={t("Size")} defaultValue="" onChange={(e) => e.currentTarget.value && toggleMarkType(view, m.fontsize, { size: Number(e.currentTarget.value) })}>
            <option value="" disabled>
              pt
            </option>
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="bd-rgroup__row">
          <RB icon="bold" iconOnly label={t("Bold")} pressed={active(m.strong)} onClick={() => toggleMarkType(view, m.strong)} />
          <RB icon="italic" iconOnly label={t("Italic")} pressed={active(m.em)} onClick={() => toggleMarkType(view, m.em)} />
          <RB icon="underline" iconOnly label={t("Underline")} pressed={active(m.underline)} onClick={() => toggleMarkType(view, m.underline)} />
          <MenuButton icon="fontColor" label={t("Colour")}>
            {(close) => (
              <div style={{ display: "flex", gap: 6, padding: 6 }}>
                {COLORS.map((c) => (
                  <button key={c} type="button" aria-label={c} className="bd-swatch" style={{ background: c }} onClick={() => (close(), toggleMarkType(view, m.color, { color: c }))} />
                ))}
              </div>
            )}
          </MenuButton>
          <MenuButton icon="highlighter" label={t("Highlight")}>
            {(close) => (
              <div style={{ display: "flex", gap: 6, padding: 6 }}>
                {HIGHLIGHTS.map((c) => (
                  <button key={c} type="button" aria-label={c} className="bd-swatch" style={{ background: c }} onClick={() => (close(), toggleMarkType(view, m.highlight, { color: c }))} />
                ))}
              </div>
            )}
          </MenuButton>
        </div>
        <div className="bd-rgroup__row">
          <MenuButton icon="case" label={t("Capitals")}>
            {(close) => (
              <>
                {(["upper", "lower", "small"] as const).map((mode) => (
                  <button key={mode} type="button" className="bd-menu__item" onClick={() => (close(), toggleMarkType(view, m.caps, { mode }))}>
                    {mode === "upper" ? t("ALL CAPITALS") : mode === "lower" ? t("all lower case") : t("Small capitals")}
                  </button>
                ))}
              </>
            )}
          </MenuButton>
        </div>
      </RGroup>
      <Sep />
      <RGroup label={t("Paragraph")} rows>
        <div className="bd-rgroup__row">
          <RB icon="alignL" iconOnly label={t("Align left")} pressed={!!para && !para.attrs.align} disabled={!para} onClick={() => setParagraphAttr(view, "align", null)} />
          <RB icon="alignC" iconOnly label={t("Centre")} pressed={para?.attrs.align === "center"} disabled={!para} onClick={() => setParagraphAttr(view, "align", "center")} />
          <RB icon="alignR" iconOnly label={t("Align right")} pressed={para?.attrs.align === "right"} disabled={!para} onClick={() => setParagraphAttr(view, "align", "right")} />
          <RB icon="justify" iconOnly label={t("Justify")} pressed={para?.attrs.align === "justify"} disabled={!para} onClick={() => setParagraphAttr(view, "align", "justify")} />
          <RB icon="outdent" iconOnly label={t("Decrease indent")} disabled={!para} onClick={() => setParagraphAttr(view, "indent", -1)} />
          <RB icon="indent" iconOnly label={t("Increase indent")} disabled={!para} onClick={() => setParagraphAttr(view, "indent", 1)} />
        </div>
        <div className="bd-rgroup__row">
          <RB icon="list" pressed={para?.attrs.list === "bullet"} disabled={!para} onClick={() => setParagraphAttr(view, "list", "bullet")}>
            {t("Bullets")}
          </RB>
          <RB icon="listNum" pressed={para?.attrs.list === "number"} disabled={!para} onClick={() => setParagraphAttr(view, "list", "number")}>
            {t("Numbers")}
          </RB>
        </div>
        <div className="bd-rgroup__row">
          <RB icon="title" onClick={() => setBlockType(view, "paragraph")}>
            {t("Plain text")}
          </RB>
          <RB icon="type" onClick={() => setBlockType(view, "section")}>
            {t("Section title")}
          </RB>
        </div>
      </RGroup>
      <Sep />
      <RGroup label={t("Other")}>
        <RCol>
          <RB icon="pilcrow" pressed={marksOn} onClick={() => useSettings.getState().update({ showMarks: !marksOn })}>
            {t("Hidden signs")}
          </RB>
          <RB icon="pageBreak" onClick={() => insertPageBreak(view)}>
            {t("Page break")}
          </RB>
        </RCol>
      </RGroup>
      <div style={{ flex: 1, minWidth: 8 }} />
      <div className="bd-ribbon-note">
        <Icon name="info" size={15} style={{ marginTop: 1 }} />
        <span>{t("It applies only to the selected text. For the whole script use Format.")}</span>
      </div>
      <Sep />
      <RGroup label={t("Click to go back")}>
        <RBig icon="case" wide pressed onClick={() => useUi.getState().setRibbon("compose")}>
          {t("Manual formatting")}
        </RBig>
      </RGroup>
    </div>
  );
}

export function useBlockType() {
  const state = useDoc((s) => s.state);
  return state ? currentBlock(state)?.node.type.name ?? null : null;
}
