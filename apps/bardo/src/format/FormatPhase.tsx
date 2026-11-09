import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useT, type TFunc } from "@theatre-suite/core";
import { Button, Icon, StatusBar, type IconName } from "@theatre-suite/ui";
import type { EditorView } from "prosemirror-view";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { useSettings } from "../store/settings";
import { useScript, Check, Seg } from "../compose/dialogs/common";
import { RB, RGroup, Sep } from "../compose/Ribbon";
import { CAT_ICONS } from "../compose/Popups";
import type { DocData, Numbering } from "../model/types";
import { PAGE_SIZES, PRESETS, type Align, type Caps, type FontKey, type FormatModel, type HeaderField, type PageSize, type StyleKey, type TextStyle } from "./model";
import { setCatStyle, setStyle, updateFormat } from "./formatActions";

/* ------------------------------------------------------------------ */
/* Elements                                                             */
/* ------------------------------------------------------------------ */

const ELEMENT_GROUPS: { label: string; items: { key: StyleKey; label: string; icon: IconName }[] }[] = [
  {
    label: "Speeches",
    items: [
      { key: "speaker", label: "Character name", icon: "user" },
      { key: "speech", label: "Speech", icon: "speech" },
      { key: "inline", label: "Direction in a speech", icon: "parens" },
      { key: "direction", label: "Stage direction", icon: "italic" },
      { key: "number", label: "Line numbers", icon: "listNum" },
    ],
  },
  {
    label: "Structure",
    items: [
      { key: "act", label: "Act", icon: "frame" },
      { key: "tableau", label: "Tableau", icon: "frame" },
      { key: "scene", label: "Scene", icon: "door" },
      { key: "place", label: "Place and time", icon: "set" },
    ],
  },
  {
    label: "Title page and lists",
    items: [
      { key: "title", label: "Title", icon: "title" },
      { key: "subtitle", label: "Subtitle", icon: "type" },
      { key: "credits", label: "Credits", icon: "users" },
      { key: "section", label: "Section title", icon: "header" },
      { key: "list", label: "Lists and indexes", icon: "list" },
      { key: "body", label: "Free text", icon: "pilcrow" },
      { key: "header", label: "Header and footer", icon: "header" },
    ],
  },
];

const ALL_ELEMENTS = ELEMENT_GROUPS.flatMap((g) => g.items);

function elementLabel(t: TFunc, key: string, data: DocData): string {
  if (key.startsWith("cat:")) {
    const c = data.categories.find((x) => x.id === key.slice(4));
    return c ? c.name : key.slice(4);
  }
  const e = ALL_ELEMENTS.find((x) => x.key === key);
  return e ? t(e.label) : key;
}

const SWATCHES = ["#1b1c21", "#33363d", "#4a4e58", "#6f737d", "#7a2e12", "#1f3a5f", "#2f5233"];

const HEADER_FIELDS: { value: HeaderField; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "title", label: "Title" },
  { value: "actScene", label: "Act and scene" },
  { value: "page", label: "Page number" },
  { value: "pageOfTotal", label: "Page of total" },
  { value: "version", label: "Version" },
  { value: "characters", label: "Characters on the page" },
];

/* ------------------------------------------------------------------ */
/* Small controls                                                       */
/* ------------------------------------------------------------------ */

/** Number field that commits on blur or Enter; arrows change it by `step`. */
function Num({ value, onCommit, step = 0.5, min = 0, max = 400, unit, label, width = 64 }: { value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; label: string; width?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (text: string) => {
    const n = parseFloat(text.replace(",", "."));
    if (Number.isFinite(n)) {
      const v = Math.min(max, Math.max(min, Math.round(n * 100) / 100));
      if (v !== value) onCommit(v);
      setDraft(String(v));
    } else setDraft(String(value));
  };
  return (
    <span className="bd-num">
      <input
        className="ts-input"
        aria-label={label}
        title={label}
        style={{ width }}
        value={draft}
        inputMode="decimal"
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.currentTarget.value);
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const v = Math.min(max, Math.max(min, Math.round((value + (e.key === "ArrowUp" ? step : -step)) * 100) / 100));
            onCommit(v);
          }
        }}
      />
      {unit ? <span className="bd-num__unit">{unit}</span> : null}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bd-irow">
      <span className="bd-irow__label">{label}</span>
      <div className="bd-irow__ctl">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, icon, label }: { on: boolean; onChange: (v: boolean) => void; icon: IconName; label: string }) {
  return <Button iconOnly icon={icon} on={on} aria-pressed={on} aria-label={label} title={label} onClick={() => onChange(!on)} />;
}

function Select<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <select className="ts-input bd-select" aria-label={label} value={value} onChange={(e) => onChange(e.currentTarget.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Samples (Shakespeare, styled with the real stylesheet)               */
/* ------------------------------------------------------------------ */

const SAMPLE = {
  it: {
    act: "Atto primo",
    actTitle: "Elsinore",
    scene: "Scena seconda",
    place: "Una sala del castello",
    king: "Re",
    hamlet: "Amleto",
    queen: "Regina",
    dir1: "Squilli di tromba. Entrano il Re, la Regina, Amleto, Polonio e il seguito.",
    l1: "E ora, nipote Amleto, e figlio mio…",
    l2a: "Un po' più che nipote, e meno che figlio.",
    l2b: "a parte",
    l3a: "Buon Amleto, togliti di dosso quel colore di notte, e guarda la Danimarca con occhio amico. Non cercare per sempre, con le palpebre abbassate, il tuo nobile padre nella ",
    l3obj: "polvere",
    l3b: ".",
    title: "Amleto",
    subtitle: "principe di Danimarca",
    credits: "di William Shakespeare",
    section: "Personaggi",
    list: ["Claudio, re di Danimarca", "Amleto, figlio del defunto re"],
    tableau: "Quadro primo",
  },
  en: {
    act: "Act One",
    actTitle: "Elsinore",
    scene: "Scene Two",
    place: "A room of state in the castle",
    king: "King",
    hamlet: "Hamlet",
    queen: "Queen",
    dir1: "Flourish. Enter the King, the Queen, Hamlet, Polonius and attendants.",
    l1: "But now, my cousin Hamlet, and my son—",
    l2a: "A little more than kin, and less than kind.",
    l2b: "aside",
    l3a: "Good Hamlet, cast thy nighted colour off, and let thine eye look like a friend on Denmark. Do not for ever with thy vailed lids seek for thy noble father in the ",
    l3obj: "dust",
    l3b: ".",
    title: "Hamlet",
    subtitle: "Prince of Denmark",
    credits: "by William Shakespeare",
    section: "Characters",
    list: ["Claudius, King of Denmark", "Hamlet, son to the late King"],
    tableau: "Tableau One",
  },
};

/** Clicking an element of a sample selects it in the inspector. */
function useElementPicker() {
  const sel = useUi((s) => s.formatElement);
  const pick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest("[data-el]") as HTMLElement | null;
    if (el?.dataset.el) {
      e.stopPropagation();
      useUi.getState().setFormatElement(el.dataset.el);
    }
  };
  const on = (k: string) => (sel === k ? " is-on" : "");
  return { pick, on };
}

function SpeechSample({ data }: { data: DocData }) {
  const s = SAMPLE[data.lang];
  const { pick, on } = useElementPicker();
  const nums = data.format.options.lineNumbers;
  return (
    <div className="bd-sample b-doc" onClick={pick}>
      <div className="b-scene b-part">
        <div className={`b-scene-h${on("scene")}`} data-el="scene">
          {s.scene}
        </div>
        <div className={`b-place${on("place")}`} data-el="place">
          {s.place}
        </div>
      </div>
      <p className={`b-dir${on("direction")}`} data-el="direction">
        {s.dir1}
      </p>
      <div className="b-speech" data-num={nums ? "1" : undefined}>
        <span className={`b-speaker${on("speaker")}`} data-el="speaker">
          {s.king}
        </span>
        <div className={`b-speech-text${on("speech")}`} data-el="speech">
          {s.l1}
        </div>
      </div>
      <div className="b-speech" data-num={nums ? "2" : undefined}>
        <span className={`b-speaker${on("speaker")}`} data-el="speaker">
          {s.hamlet}
        </span>
        <div className={`b-speech-text${on("speech")}`} data-el="speech">
          <span className={`b-inl${on("inline")}`} data-el="inline">
            ({s.l2b})
          </span>{" "}
          {s.l2a}
        </div>
      </div>
      <div className="b-speech" data-num={nums ? "3" : undefined}>
        <span className={`b-speaker${on("speaker")}`} data-el="speaker">
          {s.queen}
        </span>
        <div className={`b-speech-text${on("speech")}`} data-el="speech">
          {s.l3a}
          <span className={`b-cat${on("cat:oggetto")}`} data-cat="oggetto" data-el="cat:oggetto">
            {s.l3obj}
          </span>
          {s.l3b}
        </div>
      </div>
    </div>
  );
}

function PartitionSample({ data }: { data: DocData }) {
  const s = SAMPLE[data.lang];
  const { pick, on } = useElementPicker();
  return (
    <div className="bd-sample b-doc" onClick={pick}>
      <div className="b-act b-part" style={{ marginTop: 0 }}>
        <div className={`b-act-h${on("act")}`} data-el="act">
          {s.act}
        </div>
        <div className="b-part-title">{s.actTitle}</div>
      </div>
      <div className="b-tableau b-part">
        <div className={`b-tableau-h${on("tableau")}`} data-el="tableau">
          {s.tableau}
        </div>
      </div>
      <div className="b-scene b-part" style={{ marginBottom: 0 }}>
        <div className={`b-scene-h${on("scene")}`} data-el="scene">
          {s.scene}
        </div>
        <div className={`b-place${on("place")}`} data-el="place">
          {s.place}
        </div>
      </div>
    </div>
  );
}

function TitleSample({ data }: { data: DocData }) {
  const s = SAMPLE[data.lang];
  const { pick, on } = useElementPicker();
  return (
    <div className="bd-sample b-doc" onClick={pick}>
      <div className={`b-t-title${on("title")}`} data-el="title">
        {data.meta.title || s.title}
      </div>
      <div className={`b-t-subtitle${on("subtitle")}`} data-el="subtitle">
        {data.meta.subtitle || s.subtitle}
      </div>
      <div className={`b-t-credits${on("credits")}`} data-el="credits">
        {data.meta.authors ? `${data.lang === "it" ? "di" : "by"} ${data.meta.authors}` : s.credits}
      </div>
      <h2 className={`b-auto-h${on("section")}`} data-el="section" style={{ marginTop: 18 }}>
        {s.section}
      </h2>
      {s.list.map((l) => (
        <p key={l} className={`b-li${on("list")}`} data-el="list">
          <span className="b-char">{l.split(",")[0]}</span>,{l.split(",")[1]}
        </p>
      ))}
    </div>
  );
}

/** Page with its two margin zones (documentation pages and script pages). */
function PageSample({ f }: { f: FormatModel }) {
  const size = PAGE_SIZES[f.page.size] ?? PAGE_SIZES.A4;
  const k = 120 / size.w;
  const box = (m: { top: number; bottom: number; inner: number; outer: number }, dashed: string) => (
    <div className="bd-mini-page__box" style={{ left: m.inner * k, right: m.outer * k, top: m.top * k, bottom: m.bottom * k, borderStyle: dashed }} />
  );
  return (
    <div className="bd-mini-page" style={{ height: size.h * k }}>
      {box(f.page.script, "solid")}
      {box(f.page.doc, "dashed")}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inspector                                                            */
/* ------------------------------------------------------------------ */

function Inspector({ view, data }: { view: EditorView; data: DocData }) {
  const t = useT();
  const key = useUi((s) => s.formatElement);
  const custom = t("Customised");
  const isCat = key.startsWith("cat:");
  const head = (
    <div className="bd-format__head" style={{ padding: "12px 14px 0" }}>
      {t("Style of")} · <span style={{ color: "var(--text)", textTransform: "none", letterSpacing: 0, fontSize: 13 }}>{elementLabel(t, key, data)}</span>
    </div>
  );
  if (isCat) {
    const id = key.slice(4);
    const c = data.format.cats[id] ?? { caps: "normal" as Caps, italic: false, bold: false };
    const set = (p: Partial<typeof c>) => setCatStyle(view, id, p, custom);
    return (
      <aside className="bd-inspector" aria-label={t("Style")}>
        {head}
        <div className="bd-inspector__body">
          <div className="bd-help" style={{ marginTop: 0 }}>
            {t("How the words marked with this category are printed in the text.")}
          </div>
          <Row label={t("Letters")}>
            <Seg<Caps> label={t("Letters")} value={c.caps} onChange={(v) => set({ caps: v })} options={[{ value: "normal", label: "Aa" }, { value: "small", label: t("Small caps") }, { value: "upper", label: "AA" }]} />
          </Row>
          <Row label={t("Emphasis")}>
            <div style={{ display: "flex", gap: 4 }}>
              <Toggle icon="bold" on={c.bold} onChange={(v) => set({ bold: v })} label={t("Bold")} />
              <Toggle icon="italic" on={c.italic} onChange={(v) => set({ italic: v })} label={t("Italic")} />
            </div>
          </Row>
        </div>
      </aside>
    );
  }
  const sk = key as StyleKey;
  const s: TextStyle = data.format.styles[sk] ?? data.format.styles.speech;
  const set = (p: Partial<TextStyle>) => setStyle(view, sk, p, custom);
  return (
    <aside className="bd-inspector" aria-label={t("Style")}>
      {head}
      <div className="bd-inspector__body">
        <Row label={t("Typeface")}>
          <Seg<FontKey> label={t("Typeface")} value={s.font} onChange={(v) => set({ font: v })} options={(["serif", "sans", "mono"] as FontKey[]).map((v) => ({ value: v, label: { serif: "Serif", sans: "Sans", mono: "Mono" }[v] }))} />
        </Row>
        <Row label={t("Size")}>
          <Num label={t("Size")} value={s.size} unit="pt" min={6} max={72} onCommit={(v) => set({ size: v })} />
          <span style={{ flex: 1 }} />
          <Toggle icon="bold" on={s.bold} onChange={(v) => set({ bold: v })} label={t("Bold")} />
          <Toggle icon="italic" on={s.italic} onChange={(v) => set({ italic: v })} label={t("Italic")} />
        </Row>
        <Row label={t("Letters")}>
          <Seg<Caps> label={t("Letters")} value={s.caps} onChange={(v) => set({ caps: v })} options={[{ value: "normal", label: "Aa" }, { value: "small", label: t("Small caps") }, { value: "upper", label: "AA" }]} />
        </Row>
        <Row label={t("Letter spacing")}>
          <Num label={t("Letter spacing")} value={s.tracking} step={10} min={-50} max={400} unit="‰" onCommit={(v) => set({ tracking: v })} />
        </Row>
        <Row label={t("Alignment")}>
          <div style={{ display: "flex", gap: 2 }}>
            {(
              [
                ["left", "alignL", "Left"],
                ["center", "alignC", "Centre"],
                ["right", "alignR", "Right"],
                ["justify", "justify", "Justified"],
              ] as [Align, IconName, string][]
            ).map(([v, icon, l]) => (
              <Toggle key={v} icon={icon} on={s.align === v} onChange={() => set({ align: v })} label={t(l)} />
            ))}
          </div>
        </Row>
        <Row label={t("Space before")}>
          <Num label={t("Space before")} value={s.before} unit="pt" step={1} max={120} onCommit={(v) => set({ before: v })} />
        </Row>
        <Row label={t("Space after")}>
          <Num label={t("Space after")} value={s.after} unit="pt" step={1} max={120} onCommit={(v) => set({ after: v })} />
        </Row>
        <Row label={t("Line spacing")}>
          <Num label={t("Line spacing")} value={s.lineHeight} step={0.05} min={0.8} max={3} onCommit={(v) => set({ lineHeight: v })} />
        </Row>
        <Row label={t("Colour")}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {SWATCHES.map((c) => (
              <button key={c} type="button" className="bd-swatch" aria-pressed={s.color.toLowerCase() === c} aria-label={c} title={c} style={{ background: c, width: 22, height: 22 }} onClick={() => set({ color: c })} />
            ))}
          </div>
        </Row>
        {sk === "speaker" ? (
          <>
            <div className="bd-section-title">{t("Character names")}</div>
            <Seg
              label={t("Name position")}
              value={data.format.speech.namePos}
              onChange={(v) => updateFormat(view, (f) => ({ ...f, speech: { ...f.speech, namePos: v } }), custom)}
              options={[
                { value: "left", label: t("Left") },
                { value: "above", label: t("Above") },
                { value: "inline", label: t("In the line") },
              ]}
            />
            {data.format.speech.namePos === "left" ? (
              <>
                <Row label={t("Text indent")}>
                  <Num label={t("Text indent")} value={data.format.speech.indent} unit="mm" step={1} min={10} max={90} onCommit={(v) => updateFormat(view, (f) => ({ ...f, speech: { ...f.speech, indent: v } }), custom)} />
                </Row>
                <Check checked={data.format.speech.autoIndent} onChange={(v) => updateFormat(view, (f) => ({ ...f, speech: { ...f.speech, autoIndent: v } }), custom)}>
                  {t("Widen to the longest name")}
                </Check>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Ribbon                                                               */
/* ------------------------------------------------------------------ */

function baseName(f: FormatModel): string {
  const userModels = useSettings.getState().settings.userModels;
  return PRESETS.find((p) => p.id === f.base)?.make().name ?? userModels.find((u) => u.base === f.base)?.name ?? f.name;
}

function FormatRibbon({ view, data }: { view: EditorView; data: DocData }) {
  const t = useT();
  const f = data.format;
  const custom = t("Customised");
  const up = (fn: (f: FormatModel) => FormatModel) => updateFormat(view, fn, custom);
  return (
    <div className="bd-ribbon" role="toolbar" aria-label={t("Format tools")}>
      <RGroup label={t("Model")}>
        <button type="button" className="bd-model-btn" onClick={() => useUi.getState().openDialog("models")} title={t("Choose a model, or save this format as a model")}>
          <Icon name="layers" size={22} />
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span className="bd-model-btn__name">{f.custom ? t("Customised") : f.name}</span>
            <span className="bd-model-btn__sub">{f.custom ? t("from {name}", { name: baseName(f) }) : t("Change model…")}</span>
          </span>
          <Icon name="chevDown" size={12} />
        </button>
      </RGroup>
      <Sep />
      <RGroup label={t("Page")} rows>
        <div className="bd-rgroup__row">
          {(Object.keys(PAGE_SIZES) as PageSize[]).map((p) => (
            <RB key={p} icon="file" pressed={f.page.size === p} onClick={() => up((x) => ({ ...x, page: { ...x.page, size: p } }))}>
              {p}
            </RB>
          ))}
        </div>
        <div className="bd-rgroup__row">
          <RB icon="margins" pressed={f.page.mirror} onClick={() => up((x) => ({ ...x, page: { ...x.page, mirror: !x.page.mirror } }))} title={t("Inner and outer margins swap on left-hand pages, for printing on both sides")}>
            {t("Mirrored margins")}
          </RB>
        </div>
      </RGroup>
      <Sep />
      <RGroup label={t("Names")} rows>
        <div className="bd-rgroup__row">
          <RB icon="alignL" pressed={f.speech.namePos === "left"} onClick={() => up((x) => ({ ...x, speech: { ...x.speech, namePos: "left" } }))}>
            {t("Left")}
          </RB>
          <RB icon="header" pressed={f.speech.namePos === "above"} onClick={() => up((x) => ({ ...x, speech: { ...x.speech, namePos: "above" } }))}>
            {t("Above")}
          </RB>
        </div>
        <div className="bd-rgroup__row">
          <RB icon="speech" pressed={f.speech.namePos === "inline"} onClick={() => up((x) => ({ ...x, speech: { ...x.speech, namePos: "inline" } }))}>
            {t("In the line")}
          </RB>
        </div>
      </RGroup>
      <Sep />
      <RGroup label={t("Numbering")} rows>
        <div className="bd-rgroup__row">
          {(
            [
              ["words", data.lang === "it" ? "primo" : "One"],
              ["roman", "I"],
              ["arabic", "1"],
            ] as [Numbering, string][]
          ).map(([v, l]) => (
            <RB key={v} icon="listNum" pressed={f.partition.numbering === v} onClick={() => up((x) => ({ ...x, partition: { ...x.partition, numbering: v } }))}>
              {l}
            </RB>
          ))}
        </div>
        <div className="bd-rgroup__row">
          <RB icon="listNum" pressed={f.options.lineNumbers} onClick={() => up((x) => ({ ...x, options: { ...x.options, lineNumbers: !x.options.lineNumbers } }))}>
            {t("Speech numbers")}
          </RB>
        </div>
      </RGroup>
      <Sep />
      <RGroup label={t("Pages")} rows>
        <div className="bd-rgroup__row">
          <RB icon="pageBreak" pressed={f.partition.actNewPage} onClick={() => up((x) => ({ ...x, partition: { ...x.partition, actNewPage: !x.partition.actNewPage } }))}>
            {t("Act on a new page")}
          </RB>
        </div>
        <div className="bd-rgroup__row">
          <RB icon="pageBreak" pressed={f.partition.sceneNewPage} onClick={() => up((x) => ({ ...x, partition: { ...x.partition, sceneNewPage: !x.partition.sceneNewPage } }))}>
            {t("Scene on a new page")}
          </RB>
        </div>
      </RGroup>
      <Sep />
      <RGroup label={t("Watermark")} rows>
        <div className="bd-rgroup__row">
          <input
            className="ts-input"
            style={{ width: 130, height: 26 }}
            placeholder={t("e.g. DRAFT")}
            defaultValue={f.watermark}
            key={f.watermark}
            aria-label={t("Watermark")}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (v !== f.watermark) {
                const d = view.state.doc.attrs.data as DocData;
                view.dispatch(view.state.tr.setDocAttribute("data", { ...d, format: { ...d.format, watermark: v } }));
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
        <div className="bd-rgroup__row">
          <span className="ts-muted" style={{ fontSize: 11 }}>
            {t("Written across every page")}
          </span>
        </div>
      </RGroup>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                                */
/* ------------------------------------------------------------------ */

function Card({ title, sub, icon, wide, children }: { title: string; sub?: string; icon: IconName; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`bd-card${wide ? " bd-card--wide" : ""}`}>
      <div className="bd-card__head">
        <span className="bd-card__title">
          <Icon name={icon} size={14} />
          {title}
        </span>
        {sub ? <span className="bd-card__sub">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

function MarginsEditor({ view, f, zone, label }: { view: EditorView; f: FormatModel; zone: "doc" | "script"; label: string }) {
  const t = useT();
  const m = f.page[zone];
  const set = (k: keyof typeof m, v: number) => updateFormat(view, (x) => ({ ...x, page: { ...x.page, [zone]: { ...x.page[zone], [k]: v } } }), t("Customised"));
  const inner = f.page.mirror ? t("Inner") : t("Left");
  const outer = f.page.mirror ? t("Outer") : t("Right");
  return (
    <div>
      <div className="bd-flabel">{label}</div>
      <div className="bd-margins">
        <Row label={t("Top")}>
          <Num label={t("Top")} value={m.top} unit="mm" step={1} max={80} width={52} onCommit={(v) => set("top", v)} />
        </Row>
        <Row label={t("Bottom")}>
          <Num label={t("Bottom")} value={m.bottom} unit="mm" step={1} max={80} width={52} onCommit={(v) => set("bottom", v)} />
        </Row>
        <Row label={inner}>
          <Num label={inner} value={m.inner} unit="mm" step={1} max={80} width={52} onCommit={(v) => set("inner", v)} />
        </Row>
        <Row label={outer}>
          <Num label={outer} value={m.outer} unit="mm" step={1} max={80} width={52} onCommit={(v) => set("outer", v)} />
        </Row>
      </div>
    </div>
  );
}

function HeaderEditor({ view, f, which }: { view: EditorView; f: FormatModel; which: "header" | "footer" }) {
  const t = useT();
  const hf = f[which];
  const opts = HEADER_FIELDS.map((o) => ({ value: o.value, label: t(o.label) }));
  const set = (k: "left" | "center" | "right", v: HeaderField) => updateFormat(view, (x) => ({ ...x, [which]: { ...x[which], [k]: v } }), t("Customised"));
  return (
    <div>
      <div className="bd-flabel">{which === "header" ? t("Header") : t("Footer")}</div>
      <div className="bd-hf-row">
        <Select label={t("Left")} value={hf.left} options={opts} onChange={(v) => set("left", v)} />
        <Select label={t("Centre")} value={hf.center} options={opts} onChange={(v) => set("center", v)} />
        <Select label={t("Right")} value={hf.right} options={opts} onChange={(v) => set("right", v)} />
      </div>
    </div>
  );
}

function RulesCard({ view, f }: { view: EditorView; f: FormatModel }) {
  const t = useT();
  const up = (fn: (f: FormatModel) => FormatModel) => updateFormat(view, fn, t("Customised"));
  const opt = (k: keyof FormatModel["options"], label: string) => (
    <Check checked={!!f.options[k]} onChange={(v) => up((x) => ({ ...x, options: { ...x.options, [k]: v } }))}>
      {label}
    </Check>
  );
  return (
    <div className="bd-rules">
      {opt("widows", t("No single lines at the top or bottom of a page"))}
      {opt("continued", t("A speech split over two pages repeats the name"))}
      {opt("keepDirection", t("A stage direction stays with the speech that follows"))}
      {opt("hyphenate", t("Hyphenate long words"))}
      {opt("smartPunctuation", t("Typographic quotes and dashes while typing"))}
      <Check checked={f.partition.sceneResetPerAct} onChange={(v) => up((x) => ({ ...x, partition: { ...x.partition, sceneResetPerAct: v } }))}>
        {t("Scenes start again from one in every act")}
      </Check>
      <Row label={t("Lines kept after a heading")}>
        <Num label={t("Lines kept after a heading")} value={f.partition.keepLines} step={1} min={1} max={8} width={48} onCommit={(v) => up((x) => ({ ...x, partition: { ...x.partition, keepLines: Math.round(v) } }))} />
      </Row>
      {f.options.lineNumbers ? (
        <Row label={t("Number every")}>
          <Seg
            label={t("Number every")}
            value={String(f.options.lineNumbersEvery) as "1" | "5" | "10"}
            onChange={(v) => up((x) => ({ ...x, options: { ...x.options, lineNumbersEvery: Number(v) as 1 | 5 | 10 } }))}
            options={[
              { value: "1", label: "1" },
              { value: "5", label: "5" },
              { value: "10", label: "10" },
            ]}
          />
        </Row>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Phase                                                                */
/* ------------------------------------------------------------------ */

export function FormatPhase() {
  const t = useT();
  const { view, data } = useScript();
  const sel = useUi((s) => s.formatElement);
  const pages = useDoc((s) => s.pages);
  if (!view || !data) return null;
  const f = data.format;
  const size = PAGE_SIZES[f.page.size] ?? PAGE_SIZES.A4;
  const catIcon = (icon: string): IconName => (CAT_ICONS as Record<string, IconName>)[icon] ?? "tags";
  return (
    <>
      <FormatRibbon view={view} data={data} />
      <div className="bd-format">
        <nav className="bd-format__elements" aria-label={t("Elements")}>
          {ELEMENT_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="bd-format__head">{t(g.label)}</div>
              {g.items.map((e) => (
                <button key={e.key} type="button" className="bd-tree-item" aria-current={sel === e.key} onClick={() => useUi.getState().setFormatElement(e.key)}>
                  <Icon name={e.icon} size={14} />
                  <span className="bd-tree-item__label">{t(e.label)}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="bd-format__head">{t("Categories in the text")}</div>
          {data.categories.map((c) => (
            <button key={c.id} type="button" className="bd-tree-item" aria-current={sel === `cat:${c.id}`} onClick={() => useUi.getState().setFormatElement(`cat:${c.id}`)}>
              <Icon name={catIcon(c.icon)} size={14} />
              <span className="bd-tree-item__label">{c.name}</span>
            </button>
          ))}
        </nav>
        <main className="bd-format__main">
          <div className="bd-format__grid">
            <Card wide icon="speech" title={t("Speeches")} sub={t("Click any part of the example to change its style")}>
              <SpeechSample data={data} />
            </Card>
            <Card icon="frame" title={t("Acts and scenes")}>
              <PartitionSample data={data} />
            </Card>
            <Card icon="title" title={t("Title page and lists")}>
              <TitleSample data={data} />
            </Card>
            <Card icon="margins" title={t("Page and margins")} sub={`${f.page.size} · ${size.w} × ${size.h} mm`}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <PageSample f={f} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 0 }}>
                  <MarginsEditor view={view} f={f} zone="script" label={t("Script pages")} />
                  <MarginsEditor view={view} f={f} zone="doc" label={t("Title page and lists (dashed)")} />
                </div>
              </div>
            </Card>
            <Card icon="header" title={t("Header and footer")} sub={pages && !pages.continuous ? t("{n} pages", { n: pages.pages.length }) : undefined}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <HeaderEditor view={view} f={f} which="header" />
                <Check checked={f.header.onDocPages} onChange={(v) => updateFormat(view, (x) => ({ ...x, header: { ...x.header, onDocPages: v } }), t("Customised"))}>
                  {t("Also on the title page and lists")}
                </Check>
                <HeaderEditor view={view} f={f} which="footer" />
                <Check checked={f.footer.onFirstPage} onChange={(v) => updateFormat(view, (x) => ({ ...x, footer: { ...x.footer, onFirstPage: v } }), t("Customised"))}>
                  {t("Also on the first page")}
                </Check>
              </div>
            </Card>
            <Card wide icon="sparkle" title={t("Typesetting rules")} sub={t("Bardo applies them while you write")}>
              <RulesCard view={view} f={f} />
            </Card>
          </div>
        </main>
        <Inspector view={view} data={data} />
      </div>
      <StatusBar>
        <div className="bd-status" style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <Icon name="layers" size={13} />
          <span>{f.custom ? `${t("Customised")} · ${t("from {name}", { name: baseName(f) })}` : f.name}</span>
          <span className="bd-status__sep" />
          <span>{pages && !pages.continuous ? t("{n} pages", { n: pages.pages.length }) : t("Continuous view")}</span>
          <span style={{ flex: 1 }} />
          <span className="ts-muted">{t("Changes apply to the whole script. Ctrl Z undoes them.")}</span>
        </div>
      </StatusBar>
    </>
  );
}
