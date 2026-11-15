import { useEffect, useMemo, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon, Kbd, Segmented } from "@theatre-suite/ui";
import { bardoChanged, importBardo } from "../lib/bardo";
import { durationLabel } from "../model/rehearsals";
import { deleteCharacter, deleteScene, MAX_WEIGHT, newCharacter, newScene, sceneNeed, shortNames, unlinkBardo } from "../model/scenes";
import type { Character, Person, Rehearsals, Scene } from "../model/types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

type View = "list" | "characters" | "matrix";
const SCENE_MINUTES = [10, 15, 20, 30, 40, 45, 60, 75, 90, 120, 150, 180];

const changeR = (fn: (r: Rehearsals) => Rehearsals, key?: string) => useDoc.getState().change((d) => ({ ...d, rehearsals: fn(d.rehearsals) }), key);
const patchScene = (id: string, patch: Partial<Scene>, key: string) => changeR((r) => ({ ...r, scenes: r.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), `${id}.${key}`);
const patchChar = (id: string, patch: Partial<Character>, key: string) => changeR((r) => ({ ...r, characters: r.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), `${id}.${key}`);

export function addScene() {
  const s = newScene({ name: "" });
  const r = useDoc.getState().data.rehearsals;
  s.name = `Scena ${r.scenes.length + 1}`;
  s.act = r.scenes[r.scenes.length - 1]?.act ?? "";
  changeR((x) => ({ ...x, scenes: [...x.scenes, s] }));
  useUi.getState().setView("scenes", "list");
  useUi.getState().select("scene", s.id);
  requestAnimationFrame(() => document.getElementById("cn-scene-name")?.focus());
}

export function addCharacter() {
  const c = newCharacter({ name: "" });
  changeR((x) => ({ ...x, characters: [...x.characters, c] }));
  useUi.getState().setView("scenes", "characters");
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-char-id="${c.id}"] input`)?.focus());
}

/** Actors first (people with the role Actor), then everyone else. */
function castable(people: Person[]): Person[] {
  return [...people].sort((a, b) => Number(b.roles.includes("actor")) - Number(a.roles.includes("actor")) || a.name.localeCompare(b.name));
}

export function ScenesActions() {
  const t = useT();
  const view = (useUi((s) => s.view.scenes) as View) ?? "list";
  return (
    <>
      <Button variant="ghost" icon="book" className="cn-bl" title={t("Read scenes and characters from a Bardo script")} onClick={() => importBardo(t)}>
        <span>{t("Read from Bardo")}</span>
      </Button>
      {view === "characters" ? (
        <Button variant="primary" icon="plus" onClick={addCharacter}>
          {t("Add a character")}
        </Button>
      ) : (
        <Button variant="primary" icon="plus" title={`${t("Add a scene")} · Ctrl Shift N`} onClick={addScene}>
          {t("Add a scene")}
        </Button>
      )}
    </>
  );
}

export function ScenesStatus() {
  const t = useT();
  const r = useDoc((s) => s.data.rehearsals);
  const minutes = r.scenes.reduce((n, s) => n + s.minutes * s.weight, 0);
  return (
    <>
      <span>{t("{n} scenes", { n: r.scenes.length })}</span>
      <span>{t("{n} characters", { n: r.characters.length })}</span>
      {minutes ? <span>{t("{d} of rehearsals wanted", { d: durationLabel(minutes) })}</span> : null}
      <span className="ts-spacer" />
      <span>
        <Kbd>Ctrl Shift N</Kbd> {t("add a scene")}
      </span>
    </>
  );
}

function BardoBar() {
  const t = useT();
  const link = useDoc((s) => s.data.rehearsals.bardo);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    let alive = true;
    void bardoChanged().then((c) => alive && setChanged(c));
    const id = window.setInterval(() => void bardoChanged().then((c) => alive && setChanged(c)), 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [link?.hash, link?.path]);
  if (!link) return null;
  return (
    <div className={`cn-bardobar${changed ? " cn-bardobar--changed" : ""}`}>
      <Icon name={changed ? "alert" : "book"} size={15} />
      <span className="ts-ellipsis">
        {changed ? t("The script «{title}» has changed.", { title: link.title }) : t("Scenes and characters read from «{title}» (Bardo). The script is only read.", { title: link.title })}
      </span>
      <span className="ts-spacer" />
      <Button variant={changed ? "primary" : "sm"} icon="sync" onClick={() => importBardo(t, link.path)}>
        {changed ? t("Update") : t("Read again")}
      </Button>
      <Button
        variant="sm"
        icon="link"
        title={t("Scenes and characters stay, as if entered by hand")}
        onClick={() => {
          changeR(unlinkBardo);
          useUi.getState().showToast(t("Link removed: scenes and characters stay. Ctrl Z brings the link back."));
        }}
      >
        {t("Remove the link")}
      </Button>
    </div>
  );
}

export function Scenes() {
  const t = useT();
  const r = useDoc((s) => s.data.rehearsals);
  const people = useDoc((s) => s.data.people);
  const view = ((useUi((s) => s.view.scenes) as View) ?? "list") as View;
  const selId = useUi((s) => s.sel.scene ?? null);
  const scene = r.scenes.find((s) => s.id === selId) ?? null;
  const names = useMemo(() => shortNames(people), [people]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().dialog) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        if (useUi.getState().view.scenes === "characters") addCharacter();
        else addScene();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (r.scenes.length === 0 && r.characters.length === 0) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="book" size={26} />
        </span>
        <h2>{t("No scenes yet")}</h2>
        <p>{t("Write the scenes and the characters by hand, or read them from a Bardo script: the script is only read, never changed. Then say who plays whom.")}</p>
        <div className="cn-empty__actions">
          <Button icon="book" onClick={() => importBardo(t)}>
            {t("Read from Bardo…")}
          </Button>
          <Button variant="primary" icon="plus" onClick={addScene}>
            {t("Add a scene")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="cx-split">
      <section className="cx-page">
        <div className="cn-head">
          <h2>{t("Scenes and roles")}</h2>
          <Segmented<View>
            ariaLabel={t("View")}
            value={view}
            onChange={(v) => useUi.getState().setView("scenes", v)}
            options={[
              { value: "list", label: t("Scenes"), icon: "list" },
              { value: "characters", label: t("Characters"), icon: "users" },
              { value: "matrix", label: t("Who is needed"), icon: "grid" },
            ]}
          />
        </div>
        <BardoBar />
        {view === "list" ? <SceneList r={r} names={names} selId={selId} /> : view === "characters" ? <CharacterList r={r} people={people} /> : <Matrix r={r} people={people} names={names} />}
      </section>
      {view === "list" && scene ? <ScenePanel key={scene.id} scene={scene} r={r} people={people} names={names} /> : null}
    </div>
  );
}

function SceneList({ r, names, selId }: { r: Rehearsals; names: Map<string, string>; selId: string | null }) {
  const t = useT();
  const chars = new Map(r.characters.map((c) => [c.id, c]));
  const move = (i: number, by: number) =>
    changeR((x) => {
      const list = [...x.scenes];
      const j = i + by;
      if (j < 0 || j >= list.length) return x;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...x, scenes: list };
    });
  let lastAct = "\u0000";
  return (
    <div className="cx-rows" role="table" aria-label={t("Scenes")}>
      <div className="cx-row cx-row--head cx-scene" role="row">
        <span />
        <span role="columnheader">{t("Scene")}</span>
        <span role="columnheader">{t("Characters")}</span>
        <span role="columnheader" title={t("How many times to rehearse it")}>
          {t("Rehearsals")}
        </span>
        <span role="columnheader">{t("Length")}</span>
        <span />
      </div>
      {r.scenes.map((s, i) => {
        const need = sceneNeed(s, r.characters);
        const head = s.act !== lastAct && s.act ? s.act : null;
        lastAct = s.act;
        return (
          <div key={s.id}>
            {head ? <div className="cx-group">{head}</div> : null}
            <div
              role="row"
              tabIndex={0}
              className={`cx-row cx-scene cx-row--click${selId === s.id ? " is-sel" : ""}`}
              onClick={() => useUi.getState().select("scene", s.id)}
              onKeyDown={(e) => e.key === "Enter" && useUi.getState().select("scene", s.id)}
            >
              <span className="cx-order">
                <button type="button" className="cx-mini" aria-label={t("Move up")} disabled={i === 0} onClick={(e) => (e.stopPropagation(), move(i, -1))}>
                  <Icon name="chevUp" size={12} />
                </button>
                <button type="button" className="cx-mini" aria-label={t("Move down")} disabled={i === r.scenes.length - 1} onClick={(e) => (e.stopPropagation(), move(i, 1))}>
                  <Icon name="chevDown" size={12} />
                </button>
              </span>
              <span role="cell" className="cx-name">
                <span className="ts-ellipsis">{s.name}</span>
                {s.bardoId ? <span className="cx-tag" title={t("From the Bardo script")}>Bardo</span> : null}
              </span>
              <span role="cell" className="cx-sub ts-ellipsis">
                {s.characterIds.length ? s.characterIds.map((c) => chars.get(c)?.name).filter(Boolean).join(", ") : <em className="ts-muted">{t("no characters")}</em>}
                {need.uncast.length ? <span className="cx-warnmark" title={t("{n} without an actor", { n: need.uncast.length })}> · {t("{n} without an actor", { n: need.uncast.length })}</span> : null}
                {need.required.length ? <span className="ts-muted"> — {need.required.map((p) => names.get(p)).join(", ")}</span> : null}
              </span>
              <span role="cell" onClick={(e) => e.stopPropagation()}>
                <input
                  className="ts-input mono cx-num"
                  type="number"
                  min={1}
                  max={MAX_WEIGHT}
                  value={s.weight}
                  aria-label={t("Rehearsals")}
                  onChange={(e) => {
                    const v = Math.round(Number(e.currentTarget.value));
                    if (v >= 1 && v <= MAX_WEIGHT) patchScene(s.id, { weight: v }, "weight");
                  }}
                />
              </span>
              <span role="cell" onClick={(e) => e.stopPropagation()}>
                <MinutesSelect value={s.minutes} onChange={(m) => patchScene(s.id, { minutes: m }, "minutes")} />
              </span>
              <span role="cell" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" iconOnly icon="trash" title={t("Delete")} aria-label={t("Delete {name}", { name: s.name })} onClick={() => askDeleteScene(t, s)} />
              </span>
            </div>
          </div>
        );
      })}
      <div className="cx-add">
        <Button variant="sm" icon="plus" onClick={addScene}>
          {t("Add a scene")}
        </Button>
        <span className="ts-field__hint">{t("Also things that are not scenes: a dance, the bows, a run-through.")}</span>
      </div>
    </div>
  );
}

function askDeleteScene(t: ReturnType<typeof useT>, s: Scene) {
  const inPlan = useDoc.getState().data.rehearsals.plan.filter((p) => p.sceneId === s.id).length;
  useUi.getState().ask({
    title: t("Delete {name}?", { name: s.name }),
    text: inPlan ? t("The scene is in the plan {n} times: it is removed from there too.", { n: inPlan }) : t("The scene is removed from this production."),
    action: t("Delete"),
    run: () => {
      changeR((r) => deleteScene(r, s.id));
      useUi.getState().select("scene", null);
      useUi.getState().showToast(t("{name} deleted. Ctrl Z brings it back.", { name: s.name }));
    },
  });
}

function MinutesSelect({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  const t = useT();
  const all = SCENE_MINUTES.includes(value) ? SCENE_MINUTES : [...SCENE_MINUTES, value].sort((a, b) => a - b);
  return (
    <select className="ts-select" value={value} aria-label={t("Length")} onChange={(e) => onChange(Number(e.currentTarget.value))}>
      {all.map((m) => (
        <option key={m} value={m}>
          {durationLabel(m)}
        </option>
      ))}
    </select>
  );
}

function ScenePanel({ scene, r, people, names }: { scene: Scene; r: Rehearsals; people: Person[]; names: Map<string, string> }) {
  const t = useT();
  const need = sceneNeed(scene, r.characters);
  const inCast = new Set(r.characters.filter((c) => scene.characterIds.includes(c.id)).flatMap((c) => c.actorIds.slice(0, 1)));
  const toggleChar = (id: string) =>
    patchScene(scene.id, { characterIds: scene.characterIds.includes(id) ? scene.characterIds.filter((x) => x !== id) : [...scene.characterIds, id] }, `chars-${id}`);
  const toggleOptional = (pid: string) => patchScene(scene.id, { optional: scene.optional.includes(pid) ? scene.optional.filter((x) => x !== pid) : [...scene.optional, pid] }, `opt-${pid}`);
  const others = people.filter((p) => !inCast.has(p.id));
  return (
    <aside className="cn-panel" aria-label={t("Scene")}>
      <div className="cn-panel__head">
        <span className="ts-label">{t("Scene")}</span>
        <span className="ts-spacer" />
        <Button variant="ghost" iconOnly icon="x" aria-label={t("Close")} onClick={() => useUi.getState().select("scene", null)} />
      </div>
      <div className="cn-panel__body">
        <label className="ts-field">
          <span className="ts-label">{t("Name")}</span>
          <input id="cn-scene-name" className="ts-input cn-input--big" value={scene.name} onChange={(e) => patchScene(scene.id, { name: e.currentTarget.value }, "name")} onBlur={(e) => !e.currentTarget.value.trim() && patchScene(scene.id, { name: t("Scene") }, "name")} />
          {scene.bardoId ? <span className="ts-field__hint">{t("From the Bardo script: «Update» brings back the name written there.")}</span> : null}
        </label>
        <label className="ts-field">
          <span className="ts-label">{t("Act or group")}</span>
          <input className="ts-input" value={scene.act} placeholder={t("For example: Atto I")} onChange={(e) => patchScene(scene.id, { act: e.currentTarget.value }, "act")} />
        </label>
        <div className="ts-field">
          <span className="ts-label">{t("Characters in the scene")}</span>
          {r.characters.length ? (
            <div className="cn-chips">
              {r.characters.map((c) => (
                <button key={c.id} type="button" className="cn-chip" aria-pressed={scene.characterIds.includes(c.id)} onClick={() => toggleChar(c.id)}>
                  {scene.characterIds.includes(c.id) ? <Icon name="check" size={12} /> : null}
                  {c.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="ts-field__hint">{t("No characters yet.")}</p>
          )}
          <Button variant="sm" icon="plus" onClick={addCharacter}>
            {t("Add a character")}
          </Button>
        </div>
        <div className="ts-field">
          <span className="ts-label">{t("Needed")}</span>
          {need.required.length || need.optional.length ? (
            <div className="cx-needlist">
              {[...need.required, ...need.optional].map((pid) => {
                const opt = scene.optional.includes(pid);
                return (
                  <label key={pid} className="cx-needrow">
                    <span className={`cx-dot${opt ? " cx-dot--opt" : ""}`} />
                    <span className="ts-ellipsis">{names.get(pid)}</span>
                    <span className="ts-spacer" />
                    <input type="checkbox" checked={opt} onChange={() => toggleOptional(pid)} />
                    <span className="ts-muted">{t("optional")}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="ts-field__hint">{t("Choose the characters and give them an actor in Characters.")}</p>
          )}
          {need.uncast.length ? <p className="cx-warntext">{t("Without an actor: {list}", { list: need.uncast.map((c) => c.name).join(", ") })}</p> : null}
        </div>
        {others.length ? (
          <label className="ts-field">
            <span className="ts-label">{t("Also welcome (optional)")}</span>
            <select className="ts-select" value="" onChange={(e) => e.currentTarget.value && toggleOptional(e.currentTarget.value)}>
              <option value="">{t("Add someone…")}</option>
              {others
                .filter((p) => !scene.optional.includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <span className="ts-field__hint">{t("Optional people are told about the rehearsal but never block it.")}</span>
          </label>
        ) : null}
        <div className="cx-two">
          <label className="ts-field">
            <span className="ts-label">{t("Rehearsals wanted")}</span>
            <input className="ts-input mono" type="number" min={1} max={MAX_WEIGHT} value={scene.weight} onChange={(e) => { const v = Math.round(Number(e.currentTarget.value)); if (v >= 1 && v <= MAX_WEIGHT) patchScene(scene.id, { weight: v }, "weight"); }} />
          </label>
          <label className="ts-field">
            <span className="ts-label">{t("Time it needs")}</span>
            <MinutesSelect value={scene.minutes} onChange={(m) => patchScene(scene.id, { minutes: m }, "minutes")} />
          </label>
        </div>
      </div>
      <div className="cn-panel__foot">
        <Button variant="danger" icon="trash" onClick={() => askDeleteScene(t, scene)}>
          {t("Delete")}
        </Button>
      </div>
    </aside>
  );
}

function CharacterList({ r, people }: { r: Rehearsals; people: Person[] }) {
  const t = useT();
  const options = castable(people);
  const sceneCount = (id: string) => r.scenes.filter((s) => s.characterIds.includes(id)).length;
  const setActor = (c: Character, i: number, pid: string) => {
    const list = [...c.actorIds];
    if (pid) list[i] = pid;
    else list.splice(i, 1);
    patchChar(c.id, { actorIds: [...new Set(list.filter(Boolean))] }, `actor${i}`);
  };
  return (
    <div className="cx-rows" role="table" aria-label={t("Characters")}>
      <div className="cx-row cx-row--head cx-char" role="row">
        <span role="columnheader">{t("Character")}</span>
        <span role="columnheader">{t("Played by")}</span>
        <span role="columnheader">{t("Understudy")}</span>
        <span role="columnheader">{t("Scenes")}</span>
        <span />
      </div>
      {r.characters.map((c) => (
        <div key={c.id} role="row" className="cx-row cx-char" data-char-id={c.id}>
          <span role="cell" className="cx-name">
            <input className="ts-input" value={c.name} placeholder={t("Name of the character")} onChange={(e) => patchChar(c.id, { name: e.currentTarget.value }, "name")} onBlur={(e) => !e.currentTarget.value.trim() && patchChar(c.id, { name: t("Character") }, "name")} />
            {c.bardoId ? <span className="cx-tag">Bardo</span> : null}
          </span>
          {[0, 1].map((i) => (
            <span role="cell" key={i}>
              <select className={`ts-select${i === 0 && !c.actorIds[0] ? " cx-select--warn" : ""}`} value={c.actorIds[i] ?? ""} aria-label={i === 0 ? t("Played by") : t("Understudy")} disabled={i === 1 && !c.actorIds[0]} onChange={(e) => setActor(c, i, e.currentTarget.value)}>
                <option value="">{i === 0 ? t("Nobody yet") : "–"}</option>
                {options
                  .filter((p) => i === 0 || p.id !== c.actorIds[0])
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </span>
          ))}
          <span role="cell" className="mono">
            {sceneCount(c.id)}
          </span>
          <span role="cell">
            <Button
              variant="ghost"
              iconOnly
              icon="trash"
              title={t("Delete")}
              aria-label={t("Delete {name}", { name: c.name })}
              onClick={() =>
                useUi.getState().ask({
                  title: t("Delete {name}?", { name: c.name }),
                  text: t("The character is removed from every scene."),
                  action: t("Delete"),
                  run: () => changeR((x) => deleteCharacter(x, c.id)),
                })
              }
            />
          </span>
        </div>
      ))}
      <div className="cx-add">
        <Button variant="sm" icon="plus" onClick={addCharacter}>
          {t("Add a character")}
        </Button>
        <span className="ts-field__hint">{t("Double roles: the same actor can play more characters. The understudy covers the character when the actor cannot come.")}</span>
      </div>
    </div>
  );
}

/** Scenes × people: who is needed in every scene (filled = required, ring = optional). */
function Matrix({ r, people, names }: { r: Rehearsals; people: Person[]; names: Map<string, string> }) {
  const t = useT();
  const needs = r.scenes.map((s) => sceneNeed(s, r.characters));
  const ids = new Set(needs.flatMap((n) => [...n.required, ...n.optional]));
  const cols = people.filter((p) => ids.has(p.id));
  if (!cols.length) return <p className="cx-note">{t("Give the characters an actor to see who is needed in every scene.")}</p>;
  return (
    <div className="cx-matrix-wrap">
      <table className="cx-matrix">
        <thead>
          <tr>
            <th />
            {cols.map((p) => (
              <th key={p.id} title={p.name}>
                <span>{names.get(p.id)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.scenes.map((s, i) => (
            <tr key={s.id}>
              <th className="ts-ellipsis" title={s.name}>
                {s.name}
              </th>
              {cols.map((p) => {
                const req = needs[i].required.includes(p.id);
                const opt = needs[i].optional.includes(p.id);
                return (
                  <td key={p.id}>
                    {req || opt ? (
                      <button
                        type="button"
                        className={`cx-dot${opt ? " cx-dot--opt" : ""}`}
                        title={opt ? t("{who}: optional. Click: required", { who: p.name }) : t("{who}: required. Click: optional", { who: p.name })}
                        onClick={() => patchScene(s.id, { optional: opt ? s.optional.filter((x) => x !== p.id) : [...s.optional, p.id] }, `opt-${p.id}`)}
                      />
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>{t("Scenes")}</th>
            {cols.map((p) => (
              <td key={p.id} className="mono">
                {needs.filter((n) => n.required.includes(p.id)).length}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <p className="cx-note">
        <span className="cx-dot" /> {t("required")} <span className="cx-dot cx-dot--opt" /> {t("optional (does not block the rehearsal)")}
      </p>
    </div>
  );
}
