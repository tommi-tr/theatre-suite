import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { LANGS, useT, type Lang, type ThemePref } from "@theatre-suite/core";
import { Button, Dialog, Icon, Kbd, Segmented, Switch } from "@theatre-suite/ui";
import { deleteItem, insertTextAtCursor, renameItem, updateData } from "../../editor/commands";
import { getIndex } from "../../editor/plugins";
import { defaultCategories, newId } from "../../model/defaults";
import { formatMinutes, WORDS_PER_MINUTE } from "../../model/derive";
import { nextMajor, nextVersion } from "../../model/file";
import { shortRef } from "../../model/numbering";
import type { CatIcon, DocLang } from "../../model/types";
import { isTauri } from "../../lib/api";
import { restoreVersion, saveAsNewVersion, openSample } from "../../lib/files";
import { useDoc } from "../../store/doc";
import { useSettings } from "../../store/settings";
import { useUi } from "../../store/ui";
import { CAT_ICONS } from "../Popups";
import { CommitInput, Field, useScript } from "./common";

function close() {
  useUi.getState().closeDialog();
  useDoc.getState().view?.focus();
}

async function confirmAsk(text: string, ok: string, cancel: string): Promise<boolean> {
  if (isTauri) return ask(text, { title: "Bardo", kind: "warning", okLabel: ok, cancelLabel: cancel });
  return window.confirm(text);
}

/* ------------------------------------------------------------------ */
/* Categorie                                                            */
/* ------------------------------------------------------------------ */

const ICON_CHOICES: CatIcon[] = ["box", "set", "shirt", "bulb", "sound", "music", "sparkle", "brush", "video", "tag"];

export function CategoriesDialog() {
  const t = useT();
  const { view, state, data } = useScript();
  const [cat, setCat] = useState("oggetto");
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState<CatIcon>("tag");
  if (!view || !state || !data) return null;
  const index = getIndex(state);
  const current = data.categories.find((c) => c.id === cat) ?? data.categories[1];
  const items = data.items.filter((i) => i.cat === current.id);
  const builtinIds = defaultCategories(data.lang).map((c) => c.id);
  const addCat = () => {
    const name = newName.trim();
    if (!name) return;
    const id = newId("cat");
    updateData(view, (d) => ({ ...d, categories: [...d.categories, { id, name, icon: newIcon, builtin: false }] }));
    setNewName("");
    setCat(id);
  };
  const removeCat = async () => {
    if (builtinIds.includes(current.id)) return;
    if (!(await confirmAsk(t("Delete the category “{name}”? Its marks are removed from the text (the words stay).", { name: current.name }), t("Delete"), t("Cancel")))) return;
    for (const i of items) deleteItem(view, i.id);
    updateData(view, (d) => ({ ...d, categories: d.categories.filter((c) => c.id !== current.id) }));
    setCat("oggetto");
  };
  return (
    <Dialog title={t("Categories")} icon="tags" description={t("Characters are managed in their own sheet. Here you see props, lights, sounds and every other category, with what the text mentions.")} onClose={close} width={720} footer={<><span className="ts-spacer" /><Button variant="primary" icon="check" onClick={close}>{t("Done")}</Button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0,1fr)", gap: 16, minHeight: 360 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {data.categories
            .filter((c) => c.id !== "personaggio")
            .map((c) => (
              <button key={c.id} type="button" className="bd-tree-item" aria-current={c.id === current.id} onClick={() => setCat(c.id)}>
                <Icon name={CAT_ICONS[c.icon]} size={14} />
                <span className="bd-tree-item__label">{c.name}</span>
                <span className="bd-tree-item__meta">{data.items.filter((i) => i.cat === c.id).length}</span>
              </button>
            ))}
          <div className="bd-section-title" style={{ marginTop: 14 }}>
            {t("New category")}
          </div>
          <input className="ts-input" placeholder={t("Name")} value={newName} onChange={(e) => setNewName(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} />
          <div className="bd-chips" style={{ marginTop: 6 }}>
            {ICON_CHOICES.map((ic) => (
              <button key={ic} type="button" className="bd-chip" aria-pressed={newIcon === ic} aria-label={ic} onClick={() => setNewIcon(ic)} style={{ padding: "0 6px" }}>
                <Icon name={CAT_ICONS[ic]} size={13} />
              </button>
            ))}
          </div>
          <Button icon="plus" onClick={addCat} disabled={!newName.trim()} style={{ marginTop: 6 }}>
            {t("Add category")}
          </Button>
        </div>
        <div className="bd-form">
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <Field label={t("Name of the category")} htmlFor="cat-name">
              <CommitInput id="cat-name" value={current.name} onCommit={(v) => v.trim() && updateData(view, (d) => ({ ...d, categories: d.categories.map((c) => (c.id === current.id ? { ...c, name: v.trim() } : c)) }))} />
            </Field>
            {!builtinIds.includes(current.id) ? (
              <Button icon="trash" iconColor="var(--stop)" onClick={removeCat}>
                {t("Delete")}
              </Button>
            ) : null}
          </div>
          <div className="bd-list-rows">
            {items.map((i) => {
              const occ = index.occurrences.get(i.id) ?? [];
              const first = occ[0] && occ[0].scene >= 0 ? index.scenes[occ[0].scene] : null;
              return (
                <div key={i.id} className="bd-row" style={{ gridTemplateColumns: "170px minmax(0,1fr) 90px 30px" }}>
                  <CommitInput value={i.name} onCommit={(v) => v.trim() && renameItem(view, i.id, v)} />
                  <CommitInput value={i.description} onCommit={(v) => updateData(view, (d) => ({ ...d, items: d.items.map((x) => (x.id === i.id ? { ...x, description: v } : x)) }))} placeholder={t("Description")} />
                  <span className="ts-muted mono" style={{ fontSize: 11 }}>
                    {occ.length ? `${occ.length}× · ${first ? shortRef(first.act, first.number) : ""}` : t("not in the text")}
                  </span>
                  <Button variant="ghost" iconOnly icon="trash" aria-label={t("Delete")} onClick={() => deleteItem(view, i.id)} />
                </div>
              );
            })}
            {!items.length ? <div className="ts-muted" style={{ padding: 8 }}>{t("Nothing yet. Select a word in the script and choose this category.")}</div> : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Versione                                                             */
/* ------------------------------------------------------------------ */

export function VersionDialog() {
  const t = useT();
  const { view, data } = useScript();
  const versions = useDoc((s) => s.versions);
  const [label, setLabel] = useState(data?.versionLabel ?? "");
  if (!view || !data) return null;
  const minor = nextVersion(data.version);
  const major = nextMajor(data.version);
  const keep = (next: string) => {
    saveAsNewVersion(next, label);
    useUi.getState().showToast(t("Version {v} kept inside the file. You are now writing version {n}.", { v: data.version, n: next }));
  };
  return (
    <Dialog title={t("Version of the text")} icon="version" description={t("Earlier versions stay inside the .bardo file, so you can look back. Word and PDF copies contain only the current text.")} onClose={close} width={600} footer={<><span className="ts-spacer" /><Button variant="primary" icon="check" onClick={close}>{t("Done")}</Button></>}>
      <div className="bd-form">
        <div className="bd-two">
          <Field label={t("Current version")} htmlFor="v-num" help={t("Bardo proposes the next number; you can write your own.")}>
            <CommitInput id="v-num" value={data.version} onCommit={(v) => v.trim() && updateData(view, (d) => ({ ...d, version: v.trim() }))} style={{ fontFamily: "var(--font-mono)" }} />
          </Field>
          <Field label={t("Label")} htmlFor="v-label">
            <input id="v-label" className="ts-input" value={label} placeholder={t("e.g. draft, rehearsal script, final")} onChange={(e) => setLabel(e.currentTarget.value)} onBlur={() => updateData(view, (d) => ({ ...d, versionLabel: label }))} />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button icon="plus" onClick={() => keep(minor)}>
            {t("Keep this version and go on with {v}", { v: minor })}
          </Button>
          <Button icon="plus" onClick={() => keep(major)}>
            {t("New major version {v}", { v: major })}
          </Button>
        </div>
        <div className="bd-section-title">{t("Earlier versions")}</div>
        {versions.length ? (
          <table className="bd-table">
            <thead>
              <tr>
                <th>{t("Version")}</th>
                <th>{t("Saved on")}</th>
                <th className="num">{t("Words")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...versions].reverse().map((v) => (
                <tr key={v.savedAt + v.number}>
                  <td>
                    <b className="mono">{v.number}</b> {v.label ? <span className="ts-muted">· {v.label}</span> : null}
                  </td>
                  <td>{new Date(v.savedAt).toLocaleString()}</td>
                  <td className="num">{v.words}</td>
                  <td style={{ textAlign: "right" }}>
                    <Button
                      variant="sm"
                      icon="reset"
                      onClick={async () => {
                        if (await confirmAsk(t("Bring back version {v}? The current text is kept as a version first.", { v: v.number }), t("Bring it back"), t("Cancel"))) {
                          restoreVersion(v);
                          close();
                        }
                      }}
                    >
                      {t("Bring back")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ts-muted">{t("No earlier versions yet.")}</div>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Statistiche                                                          */
/* ------------------------------------------------------------------ */

export function StatsDialog() {
  const t = useT();
  const { state, data } = useScript();
  const pages = useDoc((s) => s.pages);
  if (!state || !data) return null;
  const index = getIndex(state);
  const chars = [...data.characters].sort((a, b) => (index.speakers.get(b.id)?.words ?? 0) - (index.speakers.get(a.id)?.words ?? 0));
  return (
    <Dialog title={t("Statistics")} icon="chart" description={t("Estimated duration counts {n} spoken words per minute, pauses included.", { n: WORDS_PER_MINUTE })} onClose={close} width={640} footer={<><span className="ts-spacer" /><Button variant="primary" onClick={close}>{t("Close")}</Button></>}>
      <div className="bd-kv" style={{ marginBottom: 14 }}>
        <span>{t("Pages")}</span>
        <b>{pages && !pages.continuous ? pages.pages.length : "—"}</b>
        <span>{t("Words")}</span>
        <b>{index.totals.words}</b>
        <span>{t("Spoken words")}</span>
        <b>{index.totals.spokenWords}</b>
        <span>{t("Speeches")}</span>
        <b>{index.totals.speeches}</b>
        <span>{t("Stage directions")}</span>
        <b>{index.totals.directions}</b>
        <span>{t("Estimated duration")}</span>
        <b>{formatMinutes(index.totals.minutes)}</b>
      </div>
      <div className="bd-section-title">{t("Characters")}</div>
      <table className="bd-table">
        <thead>
          <tr>
            <th>{t("Character")}</th>
            <th className="num">{t("Speeches")}</th>
            <th className="num">{t("Words")}</th>
            <th className="num">{t("Scenes")}</th>
            <th className="num">{t("Time")}</th>
          </tr>
        </thead>
        <tbody>
          {chars.map((c) => {
            const s = index.speakers.get(c.id);
            return (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="num">{s?.speeches ?? 0}</td>
                <td className="num">{s?.words ?? 0}</td>
                <td className="num">{index.scenes.filter((x) => x.present.includes(c.id)).length}</td>
                <td className="num">{formatMinutes((s?.words ?? 0) / WORDS_PER_MINUTE)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="bd-section-title">{t("Scenes")}</div>
      <table className="bd-table">
        <tbody>
          {index.scenes.map((s) => (
            <tr key={s.id}>
              <td>
                <span className="mono">{shortRef(s.act, s.number)}</span> {s.title}
              </td>
              <td className="num">{s.speeches}</td>
              <td className="num">{formatMinutes(s.spokenWords / WORDS_PER_MINUTE)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Simboli                                                              */
/* ------------------------------------------------------------------ */

const SYMBOLS = "— – … « » “ ” ‘ ’ ° † ‡ § ¶ • · ★ ☆ ♪ ♫ ♥ → ← ↑ ↓ ✓ ✗ ½ ¼ ¾ × ± € £ © ® ™ ″ ′ ~ ‹ ›".split(" ");
const EMOJI = "🎭 🎬 💡 🔊 🔔 ⚡ 🌙 ☀️ 🌧️ 🗡️ 👑 💀 🌹 🕯️ 📜 ✉️ 🍷 ⚔️ 🏰 🎵 👻 🔥 🚪 🪑".split(" ");

export function SymbolsDialog() {
  const t = useT();
  const view = useDoc((s) => s.view);
  if (!view) return null;
  const put = (s: string) => {
    useUi.getState().closeDialog();
    insertTextAtCursor(view, s);
  };
  return (
    <Dialog title={t("Symbols and emoji")} icon="omega" onClose={close} width={480}>
      <div className="bd-section-title">{t("Symbols")}</div>
      <div className="bd-symbols">
        {SYMBOLS.map((s) => (
          <button key={s} type="button" onClick={() => put(s)} aria-label={s}>
            {s}
          </button>
        ))}
      </div>
      <div className="bd-section-title">Emoji</div>
      <div className="bd-symbols">
        {EMOJI.map((s) => (
          <button key={s} type="button" onClick={() => put(s)} aria-label={s}>
            {s}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Impostazioni                                                         */
/* ------------------------------------------------------------------ */

const SHORTCUTS: [string, string][] = [
  ["Tab", "Line → speech (after a name)"],
  ["Enter", "New line after a speech"],
  ["Shift Enter", "New line inside a speech (verse)"],
  ["Ctrl D", "Stage direction"],
  ["( … )", "Inline direction inside a speech"],
  ["Ctrl 1…6", "Mark as Character, Prop, Set, Costume, Light, Sound"],
  ["Ctrl 0", "Remove the mark"],
  ["Ctrl Shift 1 / 2 / 3", "New act / tableau / scene"],
  ["Ctrl Shift N", "Note"],
  ["Ctrl F / Ctrl H", "Find / Replace"],
  ["Ctrl S / Ctrl Shift S", "Save / Save as"],
  ["Ctrl O / Ctrl N", "Open / New"],
  ["Ctrl Z / Ctrl Y", "Undo / Redo"],
  ["F11", "Focus (hide panels)"],
  ["F1", "Guide"],
];

export function SettingsDialog() {
  const t = useT();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  const { view, data } = useScript();
  return (
    <Dialog title={t("Settings")} icon="settings" onClose={close} width={600} footer={<><span className="ts-spacer" /><Button variant="primary" onClick={close}>{t("Done")}</Button></>}>
      <div className="bd-section-title">{t("Bardo")}</div>
      <div className="bd-set-row">
        <span className="bd-set-row__label ts-spacer">{t("Language of the interface")}</span>
        <Segmented ariaLabel={t("Language")} small value={s.language} onChange={(v: Lang) => update({ language: v })} options={LANGS.slice().reverse().map((l) => ({ value: l.value, label: l.label }))} />
      </div>
      <div className="bd-set-row">
        <span className="bd-set-row__label ts-spacer">{t("Appearance")}</span>
        <Segmented
          ariaLabel={t("Appearance")}
          small
          value={s.theme}
          onChange={(v: ThemePref) => update({ theme: v })}
          options={[
            { value: "light", label: t("Light"), icon: "sun" },
            { value: "dark", label: t("Dark"), icon: "moon" },
            { value: "system", label: t("As the system"), icon: "monitor" },
          ]}
        />
      </div>
      <div className="bd-set-row">
        <span className="bd-set-row__label ts-spacer">
          {t("Your name")}
          <div className="bd-help">{t("Written on notes.")}</div>
        </span>
        <CommitInput value={s.author} onCommit={(v) => update({ author: v })} style={{ width: 220 }} />
      </div>
      <div className="bd-set-row">
        <span className="bd-set-row__label ts-spacer">{t("Check spelling while writing")}</span>
        <Switch checked={s.spellcheck} onChange={(v) => update({ spellcheck: v })} label={t("Spelling")} />
      </div>
      <div className="bd-set-row">
        <span className="bd-set-row__label ts-spacer">{t("Language of new scripts")}</span>
        <Segmented ariaLabel={t("Language of new scripts")} small value={s.docLang} onChange={(v: DocLang) => update({ docLang: v })} options={[{ value: "it", label: "Italiano" }, { value: "en", label: "English" }]} />
      </div>
      {view && data ? (
        <div className="bd-set-row">
          <span className="bd-set-row__label ts-spacer">
            {t("Language of this script")}
            <div className="bd-help">{t("Decides “Atto primo” or “Act One”, hyphenation and spelling.")}</div>
          </span>
          <Segmented ariaLabel={t("Language of this script")} small value={data.lang} onChange={(v: DocLang) => updateData(view, (d) => ({ ...d, lang: v }))} options={[{ value: "it", label: "Italiano" }, { value: "en", label: "English" }]} />
        </div>
      ) : null}
      <div className="bd-section-title" style={{ marginTop: 16 }}>
        {t("Keyboard shortcuts")}
      </div>
      <table className="bd-table">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td style={{ width: 170 }}>
                <Kbd>{k}</Kbd>
              </td>
              <td>{t(d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Guida                                                                */
/* ------------------------------------------------------------------ */

export function GuideDialog() {
  const t = useT();
  return (
    <Dialog
      title={t("Guide")}
      icon="book"
      description={t("Write the text: Bardo takes care of the layout.")}
      onClose={close}
      width={620}
      footer={
        <>
          <Button
            icon="book"
            onClick={() => {
              close();
              openSample(t);
            }}
          >
            {t("Open the example (Hamlet)")}
          </Button>
          <span className="ts-spacer" />
          <Button variant="primary" onClick={close}>
            {t("Start writing")}
          </Button>
        </>
      }
    >
      <div className="bd-guide">
        <h3>{t("1 · Write")}</h3>
        <ul>
          <li>{t("Type the name of a character at the start of a line and press Tab: the line becomes a speech. A new name creates the character.")}</li>
          <li>{t("Enter after a speech gives a new line: Bardo proposes who answers. Tab to accept, or type a stage direction.")}</li>
          <li>{t("Parentheses inside a speech become an inline direction. Shift+Enter starts a new verse line.")}</li>
          <li>{t("Act, Tableau and Scene add a numbered heading: numbers update by themselves when you move things.")}</li>
        </ul>
        <h3>{t("2 · Mark")}</h3>
        <ul>
          <li>{t("Select a word and choose a category (Character, Prop, Light…), or use Ctrl+1…6, or the right click. From the second letter, Bardo proposes what you already marked.")}</li>
          <li>{t("Remove a prop from the text and it disappears from the lists. Rename a character in its sheet and it changes everywhere.")}</li>
        </ul>
        <h3>{t("3 · Lists and sheets")}</h3>
        <ul>
          <li>{t("Title, Characters, Cast and crew and the lists are written by Bardo. Click them (or the bracket on the right of the page) to open their sheet.")}</li>
          <li>{t("Insert → List, Table or Index: one window makes lists, indexes, contents and tables of who is in each scene.")}</li>
        </ul>
        <h3>{t("4 · Format and send")}</h3>
        <ul>
          <li>{t("Format: choose a model and change the style of each element once, for the whole script.")}</li>
          <li>{t("Send: PDF, Word, text; a copy for one actor with their lines highlighted, or for a department.")}</li>
        </ul>
        <h3>{t("Safety")}</h3>
        <ul>
          <li>{t("Bardo saves a copy every few seconds: after a crash your work comes back. Nothing leaves the computer unless you choose to send it.")}</li>
        </ul>
      </div>
    </Dialog>
  );
}
