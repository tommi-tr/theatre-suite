import { useMemo, useState, type ReactNode } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Icon, confirmYesNo } from "@theatre-suite/ui";
import { deleteCharacter, deleteNodeAt, deleteNote, renameCharacter, renameItem, scrollToPos, setNodeAttrs, updateData, notePos } from "../../editor/commands";
import { getIndex } from "../../editor/plugins";
import { pageOfPos } from "../../editor/paginate";
import { DEFAULT_CAST_CONFIG, DEFAULT_CHARACTERS_CONFIG, DEFAULT_TITLE_CONFIG, defaultCastRoles, newId } from "../../model/defaults";
import { formatMinutes, WORDS_PER_MINUTE } from "../../model/derive";
import { shortRef } from "../../model/numbering";
import type { CastConfig, CharactersConfig, Character, TitleConfig } from "../../model/types";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";
import { CAT_ICONS } from "../Popups";
import { Check, CommitArea, CommitInput, Field, Seg, useScript } from "./common";

function confirmAsk(text: string, ok: string, cancel: string): Promise<boolean> {
  return confirmYesNo({ title: ok, message: text, cancel, confirm: ok, danger: true });
}

function close() {
  useUi.getState().closeDialog();
  useDoc.getState().view?.focus();
}

/* ------------------------------------------------------------------ */
/* Titolo                                                               */
/* ------------------------------------------------------------------ */

export function TitleDialog({ pos }: { pos?: number }) {
  const t = useT();
  const { view, state, data } = useScript();
  if (!view || !state || !data) return null;
  const node = pos !== undefined ? state.doc.nodeAt(pos) : null;
  const cfg: TitleConfig = { ...DEFAULT_TITLE_CONFIG, ...((node?.attrs.config ?? {}) as Partial<TitleConfig>) };
  const setCfg = (patch: Partial<TitleConfig>) => pos !== undefined && setNodeAttrs(view, pos, { config: { ...cfg, ...patch } });
  const setMeta = (k: keyof typeof data.meta, v: string) => updateData(view, (d) => ({ ...d, meta: { ...d.meta, [k]: v } }));
  return (
    <Dialog title={t("Title")} icon="title" description={t("What you write here appears on the title page, in the headers and in the file names.")} onClose={close} width={560} footer={<FooterDone t={t} />}>
      <div className="bd-form">
        <Field label={t("Title of the play")} htmlFor="m-title">
          <CommitInput id="m-title" value={data.meta.title} onCommit={(v) => setMeta("title", v)} autoFocus placeholder={t("Hamlet")} />
        </Field>
        <Field label={t("Subtitle")} htmlFor="m-sub">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <CommitInput id="m-sub" value={data.meta.subtitle} onCommit={(v) => setMeta("subtitle", v)} style={{ flex: 1 }} />
            {node ? <Check checked={cfg.showSubtitle} onChange={(v) => setCfg({ showSubtitle: v })}>{t("Show")}</Check> : null}
          </div>
        </Field>
        <Field label={t("Freely based on")} htmlFor="m-based">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <CommitInput id="m-based" value={data.meta.basedOn} onCommit={(v) => setMeta("basedOn", v)} style={{ flex: 1 }} placeholder={t("e.g. a novel, a myth, a true story")} />
            {node ? <Check checked={cfg.showBasedOn} onChange={(v) => setCfg({ showBasedOn: v })}>{t("Show")}</Check> : null}
          </div>
        </Field>
        <Field label={t("Author(s)")} htmlFor="m-auth">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <CommitInput id="m-auth" value={data.meta.authors} onCommit={(v) => setMeta("authors", v)} style={{ flex: 1 }} />
            {node ? <Check checked={cfg.showAuthors} onChange={(v) => setCfg({ showAuthors: v })}>{t("Show")}</Check> : null}
          </div>
        </Field>
        <Field label={t("Translation or adaptation")} htmlFor="m-tr">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <CommitInput id="m-tr" value={data.meta.translation} onCommit={(v) => setMeta("translation", v)} style={{ flex: 1 }} />
            {node ? <Check checked={cfg.showTranslation} onChange={(v) => setCfg({ showTranslation: v })}>{t("Show")}</Check> : null}
          </div>
        </Field>
        {node ? (
          <Check checked={cfg.showVersion} onChange={(v) => setCfg({ showVersion: v })}>
            {t("Show the version number ({v}) on the title page", { v: data.version })}
          </Check>
        ) : null}
      </div>
    </Dialog>
  );
}

function FooterDone({ t, left }: { t: (k: string) => string; left?: ReactNode }) {
  return (
    <>
      {left}
      <span className="ts-spacer" />
      <span className="ts-muted" style={{ fontSize: 11.5 }}>
        {t("Changes are applied at once · Ctrl Z undoes them")}
      </span>
      <Button variant="primary" icon="check" onClick={close}>
        {t("Done")}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Personaggi                                                           */
/* ------------------------------------------------------------------ */

export function CharactersDialog({ pos, extra }: { pos?: number; extra?: string }) {
  const t = useT();
  const { view, state, data } = useScript();
  const [selected, setSelected] = useState<string | null>(extra ?? null);
  if (!view || !state || !data) return null;
  const index = getIndex(state);
  // The "Personaggi" block this window belongs to (the one clicked, or the first one).
  let blockPos = pos;
  if (blockPos === undefined || state.doc.nodeAt(blockPos)?.attrs.kind !== "characters") {
    blockPos = index.autos.find((a) => a.kind === "characters")?.pos;
  }
  const node = blockPos !== undefined ? state.doc.nodeAt(blockPos) : null;
  const cfg: CharactersConfig = { ...DEFAULT_CHARACTERS_CONFIG(data.lang), ...((node?.attrs.config ?? {}) as Partial<CharactersConfig>) };
  const setCfg = (patch: Partial<CharactersConfig>) => blockPos !== undefined && node && setNodeAttrs(view, blockPos, { config: { ...cfg, ...patch } });
  const setChar = (id: string, patch: Partial<Character>) => updateData(view, (d) => ({ ...d, characters: d.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const move = (id: string, d: -1 | 1) =>
    updateData(view, (dd) => {
      const list = [...dd.characters];
      const i = list.findIndex((c) => c.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= list.length) return dd;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...dd, characters: list };
    });
  const add = () => {
    const c: Character = { id: newId("ch"), name: t("New character"), short: "", long: "", actor: "" };
    updateData(view, (d) => ({ ...d, characters: [...d.characters, c] }));
    setSelected(c.id);
  };
  const remove = async (c: Character) => {
    const n = index.speakers.get(c.id)?.speeches ?? 0;
    const text = n ? t("{name} has {n} speeches. If you delete the character they become stage directions. Delete?", { name: c.name, n }) : t("Delete {name}?", { name: c.name });
    if (await confirmAsk(text, t("Delete"), t("Cancel"))) {
      deleteCharacter(view, c.id);
      setSelected(null);
    }
  };
  return (
    <Dialog
      title={t("Characters")}
      icon="users"
      description={t("The list in the script is written from here. A name changed here changes in the whole script.")}
      onClose={close}
      width={640}
      footer={
        <FooterDone
          t={t}
          left={
            <Button icon="plus" onClick={add}>
              {t("Add character")}
            </Button>
          }
        />
      }
    >
      <div className="bd-form">
        {node ? (
          <div className="bd-two">
            <Field label={t("In the script show")}>
              <Seg label={t("In the script show")} value={cfg.show} onChange={(v) => setCfg({ show: v })} options={[{ value: "name", label: t("Name only") }, { value: "short", label: t("Short desc.") }, { value: "long", label: t("Long desc.") }]} />
            </Field>
            <Field label={t("Order")}>
              <Seg label={t("Order")} value={cfg.order} onChange={(v) => setCfg({ order: v })} options={[{ value: "manual", label: t("By hand") }, { value: "alpha", label: "A–Z" }, { value: "entry", label: t("Entrance") }]} />
            </Field>
          </div>
        ) : null}
        {node ? (
          <Field label={t("Title of the list")} htmlFor="c-title">
            <CommitInput id="c-title" value={cfg.title} onCommit={(v) => setCfg({ title: v })} />
          </Field>
        ) : null}
        <div className="bd-list-rows">
          {data.characters.map((c, i) => {
            const on = selected === c.id;
            const stats = index.speakers.get(c.id);
            const scenes = index.scenes.filter((s) => s.present.includes(c.id));
            const first = stats ? index.scenes[index.blockScene[index.blockPos.findIndex((p) => p === stats.firstPos)]] : null;
            return (
              <div key={c.id}>
                <div className={`bd-row${on ? " bd-row--on" : ""}`} style={{ gridTemplateColumns: "48px 150px minmax(0,1fr) auto" }} onClick={() => setSelected(on ? null : c.id)}>
                  <span style={{ display: "flex", gap: 0 }}>
                    <Button variant="ghost" iconOnly icon="arrowUp" aria-label={t("Move up")} disabled={i === 0} style={{ width: 22, height: 22 }} onClick={(e) => (e.stopPropagation(), move(c.id, -1))} />
                    <Button variant="ghost" iconOnly icon="arrowDown" aria-label={t("Move down")} disabled={i === data.characters.length - 1} style={{ width: 22, height: 22 }} onClick={(e) => (e.stopPropagation(), move(c.id, 1))} />
                  </span>
                  <span className="bd-row__name">{c.name}</span>
                  <span className="bd-row__desc">{c.short}</span>
                  <span className="ts-muted mono" style={{ fontSize: 11 }}>
                    {stats ? t("{n} sp.", { n: stats.speeches }) : ""}
                  </span>
                </div>
                {on ? (
                  <div className="bd-row-detail">
                    <div className="bd-two" style={{ gridTemplateColumns: "180px minmax(0,1fr)" }}>
                      <Field label={t("Name")} htmlFor="ch-name">
                        <CommitInput id="ch-name" value={c.name} onCommit={(v) => v.trim() && renameCharacter(view, c.id, v)} style={{ fontFamily: "'Source Serif 4', serif", fontVariantCaps: "small-caps", fontWeight: 600, letterSpacing: "0.05em", fontSize: 14 }} autoFocus />
                      </Field>
                      <Field label={t("Short description")} htmlFor="ch-short">
                        <CommitInput id="ch-short" value={c.short} onCommit={(v) => setChar(c.id, { short: v })} placeholder={t("e.g. king of Denmark")} />
                      </Field>
                    </div>
                    <Field label={t("Long description")} htmlFor="ch-long">
                      <CommitArea id="ch-long" value={c.long} onCommit={(v) => setChar(c.id, { long: v })} />
                    </Field>
                    <Field label={t("Played by")} htmlFor="ch-actor">
                      <CommitInput id="ch-actor" value={c.actor} onCommit={(v) => setChar(c.id, { actor: v })} placeholder={t("Name of the actor or actress")} />
                    </Field>
                    <div className="bd-info">
                      <Icon name="sync" size={13} style={{ marginTop: 1 }} />
                      <span>
                        {scenes.length ? t("On stage in {n} scenes", { n: scenes.length }) : t("Not on stage yet")}
                        {first ? ` · ${t("first line in {ref}", { ref: shortRef(first.act, first.number) })}` : ""}
                        {stats ? ` · ${t("{w} words", { w: stats.words })}` : ""}. {t("If you change the name here, it changes in the whole script.")}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {stats ? (
                        <Button variant="sm" icon="search" onClick={() => (close(), scrollToPos(view, stats.firstPos))}>
                          {t("Go to the first line")}
                        </Button>
                      ) : null}
                      <span className="ts-spacer" />
                      <Button variant="sm" icon="trash" iconColor="var(--stop)" onClick={() => remove(c)}>
                        {t("Delete")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {!data.characters.length ? <div className="ts-muted" style={{ padding: 10 }}>{t("No characters yet. Add them here, or type a name at the start of a line in the script and press Tab.")}</div> : null}
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Cast e troupe                                                        */
/* ------------------------------------------------------------------ */

export function CastDialog({ pos }: { pos?: number }) {
  const t = useT();
  const { view, state, data } = useScript();
  if (!view || !state || !data) return null;
  const node = pos !== undefined ? state.doc.nodeAt(pos) : null;
  const cfg: CastConfig = { ...DEFAULT_CAST_CONFIG(data.lang), ...((node?.attrs.config ?? {}) as Partial<CastConfig>) };
  const setCfg = (patch: Partial<CastConfig>) => pos !== undefined && node && setNodeAttrs(view, pos, { config: { ...cfg, ...patch } });
  const setRole = (id: string, patch: { role?: string; people?: string }) => updateData(view, (d) => ({ ...d, cast: d.cast.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const missing = defaultCastRoles(data.lang).filter((r) => !data.cast.some((c) => c.role.toLowerCase() === r.role.toLowerCase()));
  return (
    <Dialog title={t("Cast and crew")} icon="crew" description={t("Who makes the show. Actors are set next to their character.")} onClose={close} width={600} footer={<FooterDone t={t} />}>
      <div className="bd-form">
        {node ? (
          <Field label={t("Title of the list")} htmlFor="cast-title">
            <CommitInput id="cast-title" value={cfg.title} onCommit={(v) => setCfg({ title: v })} />
          </Field>
        ) : null}
        <div className="bd-list-rows">
          {data.cast.map((r) => (
            <div key={r.id} className="bd-row" style={{ gridTemplateColumns: "180px minmax(0,1fr) 30px" }}>
              <CommitInput value={r.role} onCommit={(v) => setRole(r.id, { role: v })} placeholder={t("Role")} />
              <CommitInput value={r.people} onCommit={(v) => setRole(r.id, { people: v })} placeholder={t("Names")} />
              <Button variant="ghost" iconOnly icon="trash" aria-label={t("Delete")} onClick={() => updateData(view, (d) => ({ ...d, cast: d.cast.filter((x) => x.id !== r.id) }))} />
            </div>
          ))}
        </div>
        <div className="bd-chips">
          {missing.map((r) => (
            <button key={r.role} type="button" className="bd-chip bd-chip--add" onClick={() => updateData(view, (d) => ({ ...d, cast: [...d.cast, { id: newId("role"), role: r.role, people: "" }] }))}>
              <Icon name="plus" size={11} />
              {r.role}
            </button>
          ))}
          <button type="button" className="bd-chip bd-chip--add" onClick={() => updateData(view, (d) => ({ ...d, cast: [...d.cast, { id: newId("role"), role: "", people: "" }] }))}>
            <Icon name="plus" size={11} />
            {t("Add a role")}
          </button>
        </div>
        <div className="bd-section-title">{t("Actors")}</div>
        <div className="bd-list-rows">
          {data.characters.map((c) => (
            <div key={c.id} className="bd-row" style={{ gridTemplateColumns: "180px minmax(0,1fr)" }}>
              <span className="bd-row__name">{c.name}</span>
              <CommitInput value={c.actor} onCommit={(v) => updateData(view, (d) => ({ ...d, characters: d.characters.map((x) => (x.id === c.id ? { ...x, actor: v } : x)) }))} placeholder={t("Played by")} />
            </div>
          ))}
        </div>
        {node ? (
          <Check checked={cfg.showActors} onChange={(v) => setCfg({ showActors: v })}>
            {t("Show the actors in the list")}
          </Check>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Scena, atto, quadro                                                  */
/* ------------------------------------------------------------------ */

export function SceneDialog({ pos }: { pos: number }) {
  const t = useT();
  const { view, state, data } = useScript();
  const pages = useDoc((s) => s.pages);
  if (!view || !state || !data) return null;
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "scene") return null;
  const index = getIndex(state);
  const info = index.scenes.find((s) => s.pos === pos);
  const name = (id: string) => data.characters.find((c) => c.id === id)?.name ?? "?";
  const silent: string[] = Array.isArray(node.attrs.silent) ? node.attrs.silent : [];
  const toggleSilent = (id: string) => setNodeAttrs(view, pos, { silent: silent.includes(id) ? silent.filter((x) => x !== id) : [...silent, id] });
  const p1 = pageOfPos(pages, index, pos);
  const p2 = info && info.endIdx > 0 ? pageOfPos(pages, index, index.blockPos[info.endIdx - 1] ?? pos) : null;
  const remove = async () => {
    if (await confirmAsk(t("Remove this scene heading? The text stays and joins the previous scene."), t("Remove"), t("Cancel"))) {
      deleteNodeAt(view, pos);
      close();
    }
  };
  return (
    <Dialog
      title={info ? `${info.label}${info.act ? ` · ${index.acts[info.actIndex]?.label ?? ""}` : ""}` : t("Scene")}
      icon="door"
      description={t("The heading and its number are written by Bardo. Here you set what goes with them.")}
      onClose={close}
      width={600}
      footer={
        <FooterDone
          t={t}
          left={
            <Button icon="trash" iconColor="var(--stop)" onClick={remove}>
              {t("Remove scene")}
            </Button>
          }
        />
      }
    >
      <div className="bd-form">
        <Field label={t("Short title")} htmlFor="sc-title" help={t("Shown in the structure, in lists and in headers.")}>
          <CommitInput id="sc-title" value={node.attrs.title} onCommit={(v) => setNodeAttrs(view, pos, { title: v })} autoFocus />
        </Field>
        <Field label={t("Place and time · printed")} htmlFor="sc-place">
          <CommitArea id="sc-place" value={node.attrs.place} onCommit={(v) => setNodeAttrs(view, pos, { place: v })} serif placeholder={t("e.g. Elsinore. A platform before the castle.")} />
        </Field>
        <Field label={t("Description · not printed")} htmlFor="sc-desc">
          <CommitArea id="sc-desc" value={node.attrs.desc} onCommit={(v) => setNodeAttrs(view, pos, { desc: v })} />
        </Field>
        {info ? (
          <div className="bd-auto-box">
            <div className="bd-auto-box__title">
              <Icon name="sync" size={13} />
              {t("From the text · updates by itself")}
            </div>
            <div className="bd-auto-row">
              <span>{t("Characters")}</span>
              <span className="bd-chips">
                {info.present.map((id) => (
                  <span key={id} className="bd-chip" title={silent.includes(id) ? t("On stage without lines") : undefined}>
                    {name(id)}
                    {silent.includes(id) ? (
                      <button type="button" aria-label={t("Remove")} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", color: "var(--text-3)" }} onClick={() => toggleSilent(id)}>
                        <Icon name="x" size={11} />
                      </button>
                    ) : null}
                  </span>
                ))}
                <select
                  className="bd-chip bd-chip--add"
                  value=""
                  aria-label={t("On stage without lines")}
                  onChange={(e) => e.currentTarget.value && toggleSilent(e.currentTarget.value)}
                >
                  <option value="">{t("+ on stage without lines")}</option>
                  {data.characters
                    .filter((c) => !info.present.includes(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </span>
            </div>
            {data.categories
              .filter((c) => c.id !== "personaggio" && info.items[c.id]?.length)
              .map((c) => (
                <div key={c.id} className="bd-auto-row">
                  <span>
                    <Icon name={CAT_ICONS[c.icon]} size={12} /> {c.name}
                  </span>
                  <span className="bd-chips">
                    {info.items[c.id].map((id) => (
                      <span key={id} className="bd-chip">
                        {data.items.find((i) => i.id === id)?.name ?? "?"}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            <div style={{ display: "flex", gap: 14, paddingTop: 7, borderTop: "1px dashed var(--border-strong)", fontSize: 11.5, color: "var(--text-2)" }}>
              {p1 !== null ? (
                <span>
                  {t("Pages")} <b className="mono">{p2 && p2 !== p1 ? `${p1}–${p2}` : p1}</b>
                </span>
              ) : null}
              <span>
                {t("Speeches")} <b className="mono">{info.speeches}</b>
              </span>
              <span>
                ≈ <b className="mono">{formatMinutes(info.spokenWords / WORDS_PER_MINUTE)}</b>
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

export function PartDialog({ pos }: { pos: number }) {
  const t = useT();
  const { view, state } = useScript();
  if (!view || !state) return null;
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  const index = getIndex(state);
  const info = index.parts.find((p) => p.pos === pos);
  const isAct = node.type.name === "act";
  const remove = async () => {
    if (await confirmAsk(isAct ? t("Remove this act heading? The text stays.") : t("Remove this tableau heading? The text stays."), t("Remove"), t("Cancel"))) {
      deleteNodeAt(view, pos);
      close();
    }
  };
  return (
    <Dialog
      title={info?.label ?? (isAct ? t("Act") : t("Tableau"))}
      icon={isAct ? "curtain" : "frame"}
      description={t("The number is written by Bardo and updates when you move or add parts.")}
      onClose={close}
      width={520}
      footer={
        <FooterDone
          t={t}
          left={
            <Button icon="trash" iconColor="var(--stop)" onClick={remove}>
              {t("Remove")}
            </Button>
          }
        />
      }
    >
      <div className="bd-form">
        <Field label={t("Title (optional, printed under the heading)")} htmlFor="p-title">
          <CommitInput id="p-title" value={node.attrs.title} onCommit={(v) => setNodeAttrs(view, pos, { title: v })} autoFocus />
        </Field>
        <Field label={t("Description · not printed")} htmlFor="p-desc">
          <CommitArea id="p-desc" value={node.attrs.desc} onCommit={(v) => setNodeAttrs(view, pos, { desc: v })} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Rinomina ovunque                                                     */
/* ------------------------------------------------------------------ */

export function RenameDialog({ id }: { id: string }) {
  const t = useT();
  const { view, data } = useScript();
  const char = data?.characters.find((c) => c.id === id);
  const item = data?.items.find((i) => i.id === id);
  const [name, setName] = useState(char?.name ?? item?.name ?? "");
  if (!view || !data || (!char && !item)) return null;
  const apply = () => {
    if (!name.trim()) return;
    if (char) renameCharacter(view, id, name);
    else renameItem(view, id, name);
    close();
  };
  return (
    <Dialog
      title={t("Rename everywhere")}
      icon="pencil"
      description={t("“{old}” becomes the new name in the whole script, in lists and in indexes.", { old: char?.name ?? item?.name ?? "" })}
      onClose={close}
      width={460}
      footer={
        <>
          <span className="ts-spacer" />
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" icon="check" onClick={apply}>
            {t("Rename")}
          </Button>
        </>
      }
    >
      <input className="ts-input" style={{ width: "100%" }} autoFocus value={name} onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Nota                                                                 */
/* ------------------------------------------------------------------ */

export function NoteDialog({ id }: { id: string }) {
  const t = useT();
  const { view, state, data } = useScript();
  const note = data?.notes.find((n) => n.id === id);
  const anchor = useMemo(() => (state && note ? notePos(state.doc, id) : -1), [state, note, id]);
  if (!view || !data || !note) return null;
  const set = (patch: { text?: string; author?: string }) => updateData(view, (d) => ({ ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  return (
    <Dialog
      title={t("Note")}
      icon="note"
      description={anchor >= 0 ? `«${state!.doc.textBetween(anchor, Math.min(anchor + 60, state!.doc.content.size), " ").split("\n")[0]}…»` : undefined}
      onClose={close}
      width={480}
      footer={
        <>
          <Button
            icon="trash"
            iconColor="var(--stop)"
            onClick={() => {
              deleteNote(view, id);
              close();
            }}
          >
            {t("Delete note")}
          </Button>
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={close}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div className="bd-form">
        <CommitArea value={note.text} onCommit={(v) => set({ text: v })} rows={5} placeholder={t("Write the note…")} />
        <Field label={t("Who wrote it")} htmlFor="n-auth">
          <CommitInput id="n-auth" value={note.author} onCommit={(v) => set({ author: v })} placeholder={t("e.g. Director, Lights")} />
        </Field>
        <div className="bd-help">{t("Working notes are not printed, unless you ask for them when exporting.")}</div>
      </div>
    </Dialog>
  );
}
