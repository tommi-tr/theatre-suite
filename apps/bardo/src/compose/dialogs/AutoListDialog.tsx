import { useMemo, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Icon, type IconName } from "@theatre-suite/ui";
import { deleteNodeAt, insertAuto, setNodeAttrs } from "../../editor/commands";
import { renderAuto } from "../../editor/autoRender";
import { getIndex } from "../../editor/plugins";
import { pageOfPos } from "../../editor/paginate";
import { defaultListConfig } from "../../model/defaults";
import { CHARACTER_CAT, type ListConfig } from "../../model/types";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";
import { CAT_ICONS } from "../Popups";
import { Check, Field, Seg, useScript } from "./common";

type Preset = "list" | "index" | "toc" | "presence" | "lights";

function presetConfig(p: Preset, lang: "it" | "en"): ListConfig {
  const it = lang === "it";
  switch (p) {
    case "lights":
      return { ...defaultListConfig(lang, "list"), what: ["luce"], group: "scene", order: "entry", title: it ? "Luci per scena" : "Lights by scene" };
    case "list":
      return { ...defaultListConfig(lang, "list"), what: [CHARACTER_CAT], description: true, order: "entry", title: it ? "Elenco dei personaggi" : "List of characters" };
    default:
      return defaultListConfig(lang, p);
  }
}

/**
 * "Elenco automatico": one window for lists, indexes, tables of contents and
 * tables. An index is a list with references; a table of contents lists acts
 * and scenes with their pages; a table crosses entries and scenes.
 */
export function AutoListDialog({ pos, extra }: { pos?: number; extra?: string }) {
  const t = useT();
  const { view, state, data } = useScript();
  const pages = useDoc((s) => s.pages);
  const node = pos !== undefined && state ? state.doc.nodeAt(pos) : null;
  const editing = !!node && node.type.name === "auto" && node.attrs.kind === "list";
  const [cfg, setCfg] = useState<ListConfig>(() => {
    const lang = data?.lang ?? "it";
    if (editing) return { ...defaultListConfig(lang), ...(node!.attrs.config as Partial<ListConfig>) };
    return presetConfig((extra as Preset) || "list", lang);
  });
  const [preset, setPreset] = useState<Preset | null>(editing ? null : ((extra as Preset) || "list"));
  const html = useMemo(() => {
    if (!state || !data) return "";
    const index = getIndex(state);
    return renderAuto("list", cfg, data, index, (p) => pageOfPos(pages, index, p), true);
  }, [cfg, state, data, pages]);
  if (!view || !state || !data) return null;
  const close = () => {
    useUi.getState().closeDialog();
    view.focus();
  };
  const set = (patch: Partial<ListConfig>) => {
    setCfg((c) => ({ ...c, ...patch }));
    setPreset(null);
  };
  const scenes = cfg.what.includes("scenes");
  const toggleWhat = (id: string) => {
    if (id === "scenes") return set({ what: ["scenes"], form: "list", order: "entry", pages: true });
    const cur = cfg.what.filter((w) => w !== "scenes");
    const next = cur.includes(id) ? cur.filter((w) => w !== id) : [...cur, id];
    set({ what: next.length ? next : [id] });
  };
  const presets: { id: Preset; label: string; icon: IconName }[] = [
    { id: "list", label: t("List of characters"), icon: "users" },
    { id: "toc", label: t("Contents"), icon: "listNum" },
    { id: "index", label: t("Index of props"), icon: "box" },
    { id: "presence", label: t("Who is in each scene"), icon: "table" },
    { id: "lights", label: t("Lights by scene"), icon: "bulb" },
  ];
  const apply = () => {
    if (editing && pos !== undefined) setNodeAttrs(view, pos, { config: cfg });
    else insertAuto(view, "list", cfg);
    close();
  };
  return (
    <Dialog
      title={t("Automatic list")}
      icon="list"
      description={t("Lists, indexes, contents and tables are made here and update by themselves.")}
      onClose={close}
      width={940}
      footer={
        <>
          {editing && pos !== undefined ? (
            <Button
              icon="trash"
              iconColor="var(--stop)"
              onClick={() => {
                deleteNodeAt(view, pos);
                close();
              }}
            >
              {t("Delete list")}
            </Button>
          ) : (
            <span className="ts-muted" style={{ fontSize: 11.5 }}>
              {t("Click the list in the script to open this window again.")}
            </span>
          )}
          <span className="ts-spacer" />
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" icon={editing ? "check" : "plus"} onClick={apply}>
            {editing ? t("Apply") : t("Insert in the script")}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <span className="ts-muted" style={{ fontSize: 11.5, marginRight: 4 }}>
          {t("Start from")}
        </span>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="bd-pill"
            aria-pressed={preset === p.id}
            onClick={() => {
              setCfg(presetConfig(p.id, data.lang));
              setPreset(p.id);
            }}
          >
            <Icon name={p.icon} size={13} />
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "370px minmax(0,1fr)", gap: 16, minHeight: 380 }}>
        <div className="bd-form">
          <Field label={t("1 · What to list")}>
            <div className="bd-chips">
              {data.categories.map((c) => (
                <button key={c.id} type="button" className="bd-chip" aria-pressed={cfg.what.includes(c.id)} onClick={() => toggleWhat(c.id)}>
                  <Icon name={CAT_ICONS[c.icon]} size={12} />
                  {c.name}
                </button>
              ))}
              <button type="button" className="bd-chip" aria-pressed={scenes} onClick={() => toggleWhat("scenes")}>
                <Icon name="door" size={12} />
                {t("Acts and scenes")}
              </button>
            </div>
          </Field>
          {!scenes ? (
            <div className="bd-two">
              <Field label={t("2 · Form")}>
                <Seg label={t("Form")} value={cfg.form} onChange={(v) => set({ form: v })} options={[{ value: "list", label: t("List") }, { value: "table", label: t("Table") }]} />
              </Field>
              <Field label={t("3 · Order")}>
                <Seg label={t("Order")} value={cfg.order} onChange={(v) => set({ order: v })} options={[{ value: "alpha", label: "A–Z" }, { value: "entry", label: t("Entrance") }]} />
              </Field>
            </div>
          ) : null}
          {cfg.form === "table" && !scenes ? (
            <Field label={t("4 · Columns")}>
              <Seg label={t("Columns")} value={cfg.columns} onChange={(v) => set({ columns: v })} options={[{ value: "scene", label: t("One per scene") }, { value: "act", label: t("One per act") }]} />
            </Field>
          ) : (
            <Field label={t("4 · Group")}>
              <Seg label={t("Group")} value={cfg.group} onChange={(v) => set({ group: v })} options={[{ value: "none", label: t("No") }, { value: "act", label: t("By act") }, ...(scenes ? [] : [{ value: "scene" as const, label: t("By scene") }])]} />
            </Field>
          )}
          {cfg.form === "list" ? (
            <Field label={t("5 · Next to each entry")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Check checked={cfg.description} onChange={(v) => set({ description: v })}>
                  {scenes ? t("Description or place of the scene") : t("Short description")}
                </Check>
                {!scenes && cfg.group === "none" ? (
                  <>
                    <Check checked={cfg.where !== "none"} onChange={(v) => set({ where: v ? "every" : "none" })}>
                      {t("Where it appears (act and scene)")}
                    </Check>
                    {cfg.where !== "none" ? (
                      <div style={{ marginLeft: 24 }}>
                        <Seg label={t("Where it appears")} value={cfg.where} onChange={(v) => set({ where: v })} options={[{ value: "every", label: t("Every time") }, { value: "first", label: t("First only") }, { value: "firstLast", label: t("First and last") }]} />
                      </div>
                    ) : null}
                  </>
                ) : null}
                {cfg.group === "none" ? (
                  <Check checked={cfg.pages} onChange={(v) => set({ pages: v })}>
                    {t("Page number")}
                  </Check>
                ) : null}
                {scenes ? (
                  <Check checked={cfg.present} onChange={(v) => set({ present: v })}>
                    {t("Characters on stage")}
                  </Check>
                ) : null}
              </div>
            </Field>
          ) : null}
          <Field label={t("Printed title")} htmlFor="al-title">
            <input id="al-title" className="ts-input" value={cfg.title} onChange={(e) => set({ title: e.currentTarget.value })} />
          </Field>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, background: "var(--canvas)", borderRadius: 10, padding: 14 }}>
          <div className="ts-muted" style={{ fontSize: 11.5 }}>
            {t("Preview · as it will appear in the script")}
          </div>
          <div className="b-doc bd-preview-paper" style={{ flex: 1, maxHeight: 420 }} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </Dialog>
  );
}
