import { useMemo, useState } from "react";
import { uid, useT, type TFunc } from "@theatre-suite/core";
import { Button, Icon, Switch } from "@theatre-suite/ui";
import { exportBase, printDoc, saveTextFile } from "../lib/exports";
import { icsCalendar } from "../model/ics";
import { convened, fitOn, planContext, planEvents, planWarnings, proposePlan, sceneProgress, type PlanWarning } from "../model/plan";
import { dateLine, dayLabel, durationLabel, MONTHS, parseDay, stateOf, todayKey, WEEKDAYS, weekdayOf } from "../model/rehearsals";
import { shortNames } from "../model/scenes";
import type { PlanItem, RehearsalDate, Rehearsals } from "../model/types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

const changeR = (fn: (r: Rehearsals) => Rehearsals) => useDoc.getState().change((d) => ({ ...d, rehearsals: fn(d.rehearsals) }));

export function recalculate(t: TFunc) {
  const before = useDoc.getState().data.rehearsals.plan.length;
  changeR((r) => ({ ...r, plan: proposePlan(r) }));
  useUi.getState().showToast(before ? t("Plan recalculated: locked scenes and past rehearsals stayed. Ctrl Z undoes it.") : t("Plan proposed. Change it as you like: what you move gets locked."));
}

function moveItem(itemId: string, dateId: string) {
  changeR((r) => {
    const it = r.plan.find((p) => p.id === itemId);
    if (!it || (it.dateId === dateId && it.locked)) return r;
    if (it.dateId !== dateId && r.plan.some((p) => p.dateId === dateId && p.sceneId === it.sceneId)) return r;
    return { ...r, plan: r.plan.map((p) => (p.id === itemId ? { ...p, dateId, locked: true } : p)) };
  });
}

function addItem(dateId: string, sceneId: string) {
  changeR((r) => (r.plan.some((p) => p.dateId === dateId && p.sceneId === sceneId) ? r : { ...r, plan: [...r.plan, { id: uid(), dateId, sceneId, locked: true }] }));
}

export function PlanActions() {
  const t = useT();
  const r = useDoc((s) => s.data.rehearsals);
  const people = useDoc((s) => s.data.people);
  const show = useDoc((s) => s.show);
  const has = r.plan.length > 0;
  return (
    <>
      <Button variant="ghost" icon="sync" className="cn-bl" disabled={!r.scenes.length || !r.dates.length} title={t("Fill again what is not locked")} onClick={() => recalculate(t)}>
        <span>{has ? t("Recalculate the rest") : t("Propose the plan")}</span>
      </Button>
      <Button
        variant="ghost"
        icon="calendar"
        className="cn-bl"
        disabled={!has}
        title={t("Calendar file (.ics) for phones and computers")}
        onClick={() => void saveTextFile(t, exportBase(t("rehearsals")), "ics", "text/calendar", icsCalendar(show?.title ?? t("Rehearsals"), planEvents(r, people, null, show?.title ?? "")))}
      >
        <span>{t("Calendar")}</span>
      </Button>
      <Button variant="ghost" icon="printer" className="cn-bl" disabled={!has} title={t("Print, or save as PDF")} onClick={() => printPlan(t, r, people.map((p) => p))}>
        <span>{t("Print")}</span>
      </Button>
      <Button variant="primary" icon="copy" disabled={!has} onClick={() => useUi.getState().openCopyMessage("plan")}>
        {t("Copy the plan")}
      </Button>
    </>
  );
}

function printPlan(t: TFunc, r: Rehearsals, people: Parameters<typeof shortNames>[0]) {
  const names = shortNames(people);
  const scenes = new Map(r.scenes.map((s) => [s.id, s]));
  const today = todayKey();
  const rows = planContext(r, today)
    .dates.filter((d) => d.day >= today)
    .map((d) => {
      const items = r.plan.filter((p) => p.dateId === d.id);
      if (!items.length) return null;
      const who = convened(items, r);
      return [`${dateLine(d)}${d.place ? `\n${d.place}` : ""}`, items.map((p) => scenes.get(p.sceneId)?.name ?? "").join("\n"), who.required.map((p) => names.get(p)).join(", ") + (who.optional.length ? ` (+ ${who.optional.map((p) => names.get(p)).join(", ")})` : "")];
    })
    .filter((x): x is string[] => !!x);
  const show = useDoc.getState().show;
  printDoc({ title: t("Rehearsal plan"), subtitle: show?.title, blocks: [{ head: [t("When"), t("Scenes"), t("Convened")], rows }] });
}

export function PlanStatus() {
  const t = useT();
  const r = useDoc((s) => s.data.rehearsals);
  const people = useDoc((s) => s.data.people);
  const w = useMemo(() => planWarnings(r, people), [r, people]);
  const stop = w.filter((x) => x.level === "stop").length;
  return (
    <>
      <span>{t("{n} scenes in the plan", { n: r.plan.length })}</span>
      {stop ? <span className="cn-status-warn">{t("{n} problems", { n: stop })}</span> : r.plan.length ? <span className="cn-status-ok">{t("No problems")}</span> : null}
      <span className="ts-spacer" />
      <span>{t("Drag a scene to another date: it gets locked")}</span>
    </>
  );
}

export function warningText(t: TFunc, w: PlanWarning): string {
  return t(w.text, w.vars);
}

export function Plan() {
  const t = useT();
  const r = useDoc((s) => s.data.rehearsals);
  const people = useDoc((s) => s.data.people);
  const [showPast, setShowPast] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const today = todayKey();
  const ctx = useMemo(() => planContext(r, today), [r, today]);
  const warnings = useMemo(() => planWarnings(r, people, today), [r, people, today]);
  const progress = useMemo(() => sceneProgress(r, today), [r, today]);
  const names = useMemo(() => shortNames(people), [people]);

  if (!r.dates.length || !r.scenes.length) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="calendar" size={26} />
        </span>
        <h2>{!r.dates.length ? t("Add the dates first") : t("Add the scenes first")}</h2>
        <p>{t("The plan puts the scenes on the dates where everyone needed can come. It needs the dates, the availability and the scenes with their cast.")}</p>
        <div className="cn-empty__actions">
          <Button variant="primary" icon={!r.dates.length ? "calendar" : "book"} onClick={() => useUi.getState().go("rehearsals", !r.dates.length ? "dates" : "scenes")}>
            {!r.dates.length ? t("Go to the dates") : t("Go to the scenes")}
          </Button>
        </div>
      </div>
    );
  }

  const dates = ctx.dates.filter((d) => showPast || d.day >= today);
  const pastCount = ctx.dates.filter((d) => d.day < today).length;

  return (
    <div className="cx-split">
      <section className="cx-page cx-page--wide">
        <div className="cn-head">
          <h2>{t("Plan")}</h2>
          <label className="cn-switchrow">
            <Switch checked={r.allowMaybe} onChange={(v) => changeR((x) => ({ ...x, allowMaybe: v }))} label={t("Allow the maybes")} />
            {t("Allow the maybes")}
          </label>
          {pastCount ? (
            <label className="cn-switchrow">
              <Switch checked={showPast} onChange={setShowPast} label={t("Show past rehearsals")} />
              {t("Show past rehearsals")}
            </label>
          ) : null}
        </div>
        {!r.plan.length ? (
          <div className="cx-callout">
            <Icon name="sparkle" size={16} />
            <span>{t("Cantinella can propose a plan from the availability and the scenes. You have the last word: drag, add, remove and lock.")}</span>
            <span className="ts-spacer" />
            <Button variant="primary" icon="sync" onClick={() => recalculate(t)}>
              {t("Propose the plan")}
            </Button>
          </div>
        ) : null}
        <div className="cx-board">
          {dates.map((d) => (
            <DateColumn key={d.id} d={d} r={r} names={names} past={d.day < today} dragging={dragging} setDragging={setDragging} map={ctx.map} />
          ))}
        </div>
      </section>
      <aside className="cn-panel" aria-label={t("Warnings")}>
        <div className="cn-panel__body">
          <div className="ts-field">
            <span className="ts-label">{t("Warnings")}</span>
            {warnings.length ? (
              <ul className="cx-warnings">
                {warnings.map((w, i) => (
                  <li key={i} className={`cx-w cx-w--${w.level}`}>
                    <Icon name={w.level === "stop" ? "alert" : "info"} size={13} />
                    <span>{warningText(t, w)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cx-ok">
                <Icon name="check" size={13} /> {r.plan.length ? t("Every scene has its rehearsals and everyone convened can come.") : t("No plan yet.")}
              </p>
            )}
          </div>
          <div className="ts-field">
            <span className="ts-label">{t("Rehearsals done / wanted")}</span>
            <div className="cx-progress">
              {progress.map(({ scene, done, planned }) => (
                <div key={scene.id} className="cx-progrow" title={t("{done} done, {planned} planned, {w} wanted", { done, planned, w: scene.weight })}>
                  <span className="ts-ellipsis">{scene.name}</span>
                  <span className="cx-bars">
                    {Array.from({ length: Math.max(scene.weight, done + planned) }, (_, i) => (
                      <span key={i} className={i < done ? "is-done" : i < done + planned ? "is-plan" : i < scene.weight ? "is-miss" : "is-extra"} />
                    ))}
                  </span>
                  <span className="mono">
                    {done + planned}/{scene.weight}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function DateColumn({
  d,
  r,
  names,
  past,
  dragging,
  setDragging,
  map,
}: {
  d: RehearsalDate;
  r: Rehearsals;
  names: Map<string, string>;
  past: boolean;
  dragging: string | null;
  setDragging: (id: string | null) => void;
  map: ReturnType<typeof planContext>["map"];
}) {
  const t = useT();
  const [over, setOver] = useState(false);
  const scenes = new Map(r.scenes.map((s) => [s.id, s]));
  const items = r.plan.filter((p) => p.dateId === d.id);
  const used = items.reduce((n, p) => n + (scenes.get(p.sceneId)?.minutes ?? 0), 0);
  const { m, d: dd } = parseDay(d.day);
  const free = r.scenes.filter((s) => !items.some((p) => p.sceneId === s.id));
  return (
    <div
      className={`cx-col${past ? " cx-col--past" : ""}${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        if (!dragging || past) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (dragging && !past) moveItem(dragging, d.id);
        setDragging(null);
      }}
    >
      <div className="cx-col__head" title={dayLabel(d.day)}>
        <span className="cx-col__wd">{WEEKDAYS[weekdayOf(d.day)].slice(0, 3)}</span>
        <span className="cx-col__day">
          {dd} {MONTHS[m - 1].slice(0, 3)}
        </span>
        <span className="mono cx-col__time">
          {d.time} · {durationLabel(d.minutes)}
        </span>
        {d.place ? <span className="cx-col__place ts-ellipsis">{d.place}</span> : null}
        <span className={`cx-timebar${used > d.minutes ? " is-over" : ""}`} title={t("{used} of {max} minutes", { used, max: d.minutes })}>
          <span style={{ width: `${Math.min(100, (used / d.minutes) * 100)}%` }} />
        </span>
      </div>
      <div className="cx-col__body">
        {items.map((p) => (
          <SceneCard key={p.id} p={p} r={r} names={names} past={past} map={map} onDrag={setDragging} />
        ))}
        {!items.length ? <span className="cx-col__none">{past ? t("Nothing was rehearsed") : t("Free day")}</span> : null}
      </div>
      {!past && free.length ? (
        <select className="ts-select cx-col__add" value="" aria-label={t("Add a scene to {day}", { day: dayLabel(d.day) })} onChange={(e) => e.currentTarget.value && addItem(d.id, e.currentTarget.value)}>
          <option value="">+ {t("Add a scene")}</option>
          {free.map((s) => {
            const f = fitOn(s, d.id, r.characters, map, r.allowMaybe);
            return (
              <option key={s.id} value={s.id}>
                {f.ok ? "✓ " : "✕ "}
                {s.name}
                {f.ok ? "" : ` — ${t("missing")}: ${f.missing.map((x) => names.get(x)).join(", ")}`}
              </option>
            );
          })}
        </select>
      ) : null}
    </div>
  );
}

function SceneCard({ p, r, names, past, map, onDrag }: { p: PlanItem; r: Rehearsals; names: Map<string, string>; past: boolean; map: ReturnType<typeof planContext>["map"]; onDrag: (id: string | null) => void }) {
  const t = useT();
  const s = r.scenes.find((x) => x.id === p.sceneId);
  if (!s) return null;
  const f = fitOn(s, p.dateId, r.characters, map, r.allowMaybe);
  const who = convened([p], r);
  const level = f.missing.some((x) => stateOf(map, x, p.dateId) === "no") ? "stop" : f.missing.length || f.maybe.length ? "warn" : "ok";
  return (
    <div className={`cx-card cx-card--${level}${p.locked ? " is-locked" : ""}`} draggable={!past} onDragStart={(e) => (e.dataTransfer.setData("text/plain", p.id), onDrag(p.id))} onDragEnd={() => onDrag(null)}>
      <div className="cx-card__top">
        <span className="cx-card__name ts-ellipsis" title={s.name}>
          {s.name}
        </span>
        {!past ? (
          <>
            <button
              type="button"
              className={`cx-mini${p.locked ? " is-on" : ""}`}
              title={p.locked ? t("Locked: «Recalculate» keeps it. Click to unlock") : t("Lock it on this date")}
              aria-pressed={p.locked}
              onClick={() => changeR((x) => ({ ...x, plan: x.plan.map((q) => (q.id === p.id ? { ...q, locked: !q.locked } : q)) }))}
            >
              <Icon name={p.locked ? "lock" : "unlock"} size={12} />
            </button>
            <button type="button" className="cx-mini" title={t("Remove from this date")} onClick={() => changeR((x) => ({ ...x, plan: x.plan.filter((q) => q.id !== p.id) }))}>
              <Icon name="x" size={12} />
            </button>
          </>
        ) : null}
      </div>
      <div className="cx-card__cast">
        {who.required.map((pid) => {
          const st = stateOf(map, pid, p.dateId);
          return (
            <span key={pid} className={`cx-who cx-who--${st}`} title={`${names.get(pid)}: ${st === "yes" ? t("yes") : st === "maybe" ? t("maybe") : st === "no" ? t("no") : t("no reply yet")}`}>
              {names.get(pid)}
            </span>
          );
        })}
        {who.optional.map((pid) => (
          <span key={pid} className="cx-who cx-who--opt" title={t("optional")}>
            {names.get(pid)}
          </span>
        ))}
      </div>
      <div className="cx-card__foot mono">
        {durationLabel(s.minutes)}
        {f.subs.length ? <span title={t("With an understudy")}> · {t("understudy")}</span> : null}
      </div>
    </div>
  );
}
