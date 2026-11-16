import { useMemo } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { exportBase, saveTextFile } from "../lib/exports";
import { calendarEvents, forPerson, monthGrid, shiftMonth, toIcs, weekStart, type CalEvent, type EventKind } from "../model/calendar";
import { icsCalendar } from "../model/ics";
import { addDays, dayLabel, dayShort, MONTHS, parseDay, todayKey, WEEKDAYS, weekdayOf } from "../model/rehearsals";
import type { PartId } from "../shell/sections";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

const KIND_LABEL: Record<EventKind, string> = { rehearsal: "Rehearsals", show: "Performances", venue: "Tour", due: "Deadlines" };

function useEvents() {
  const data = useDoc((s) => s.data);
  const person = useUi((s) => s.sel.calPerson ?? null);
  const today = todayKey();
  const all = useMemo(() => calendarEvents(data, today), [data, today]);
  return { events: forPerson(all, person), all, person, today };
}

function openEvent(e: CalEvent) {
  const ui = useUi.getState();
  if (e.open.sel) ui.select(e.open.sel[0], e.open.sel[1]);
  ui.go(e.open.section, e.open.part as PartId);
}

const cursor = () => useUi.getState().view.calMonth ?? todayKey().slice(0, 7);

export function CalendarActions() {
  const t = useT();
  const { events, person } = useEvents();
  const people = useDoc((s) => s.data.people);
  const show = useDoc((s) => s.show);
  const name = person ? people.find((p) => p.id === person)?.name : null;
  return (
    <>
      <select className="ts-select cx-perfsel" value={person ?? ""} aria-label={t("Person")} onChange={(e) => useUi.getState().select("calPerson", e.currentTarget.value || null)}>
        <option value="">{t("Everyone")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Button
        variant="primary"
        icon="download"
        disabled={!events.length}
        title={t("Calendar file (.ics) for phones and computers")}
        onClick={() => void saveTextFile(t, exportBase(name ? `${t("calendar")} ${name}` : t("calendar")), "ics", "text/calendar", icsCalendar(show?.title ?? t("Calendar"), toIcs(events)))}
      >
        {t("Export .ics")}
      </Button>
    </>
  );
}

export function CalendarStatus() {
  const t = useT();
  const { events, today } = useEvents();
  const next = events.filter((e) => e.day >= today && e.kind !== "due").slice(0, 1)[0];
  return (
    <>
      <span>{t("{n} things in the calendar", { n: events.length })}</span>
      {next ? <span>{t("Next: {day}", { day: `${dayShort(next.day)}${next.time ? ` ${next.time}` : ""} · ${next.title}` })}</span> : null}
      <span className="ts-spacer" />
      <span>{t("Read only: everything is entered in its section")}</span>
    </>
  );
}

function Legend() {
  const t = useT();
  return (
    <span className="cx-legend">
      {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
        <span key={k} className="cx-legend__item">
          <span className={`cx-ev-dot cx-ev--${k}`} />
          {t(KIND_LABEL[k])}
        </span>
      ))}
    </span>
  );
}

function EventChip({ e, compact }: { e: CalEvent; compact?: boolean }) {
  return (
    <button type="button" className={`cx-ev cx-ev--${e.kind}${e.overdue ? " is-overdue" : ""}`} title={`${e.time ? `${e.time} · ` : ""}${e.title}${e.detail ? ` — ${e.detail}` : ""}`} onClick={() => openEvent(e)}>
      {e.time && !compact ? <span className="mono">{e.time}</span> : null}
      <span className="ts-ellipsis">{e.title}</span>
    </button>
  );
}

function Nav({ label, onPrev, onNext, onToday }: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void }) {
  const t = useT();
  return (
    <div className="cx-calnav">
      <Button variant="ghost" iconOnly icon="chevLeft" aria-label={t("Previous")} onClick={onPrev} />
      <h2>{label}</h2>
      <Button variant="ghost" iconOnly icon="chevRight" aria-label={t("Next")} onClick={onNext} />
      <Button variant="sm" onClick={onToday}>
        {t("Today")}
      </Button>
      <span className="ts-spacer" />
      <Legend />
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function MonthView() {
  const t = useT();
  const { events, today } = useEvents();
  const ym = useUi((s) => s.view.calMonth ?? todayKey().slice(0, 7));
  const days = monthGrid(ym);
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  const [y, m] = ym.split("-").map(Number);
  const set = (v: string) => useUi.getState().setView("calMonth", v);
  return (
    <section className="cx-page">
      <Nav label={`${cap(MONTHS[m - 1])} ${y}`} onPrev={() => set(shiftMonth(cursor(), -1))} onNext={() => set(shiftMonth(cursor(), 1))} onToday={() => set(todayKey().slice(0, 7))} />
      <div className="cx-month">
        {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
          <div key={wd} className="cx-month__wd">
            {WEEKDAYS[wd].slice(0, 3)}
          </div>
        ))}
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const out = d.slice(0, 7) !== ym;
          return (
            <div key={d} className={`cx-day${out ? " is-out" : ""}${d === today ? " is-today" : ""}`}>
              <span className="cx-day__n">{parseDay(d).d}</span>
              {list.slice(0, 3).map((e) => (
                <EventChip key={e.id} e={e} />
              ))}
              {list.length > 3 ? (
                <button type="button" className="cx-day__more" onClick={() => (useUi.getState().setView("calWeek", weekStart(d)), useUi.getState().go("calendar", "week"))}>
                  {t("+{n} more", { n: list.length - 3 })}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function WeekView() {
  const { events, today } = useEvents();
  const start = useUi((s) => s.view.calWeek ?? weekStart(todayKey()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const set = (v: string) => useUi.getState().setView("calWeek", v);
  const a = parseDay(days[0]);
  const b = parseDay(days[6]);
  const label = a.m === b.m ? `${a.d}–${b.d} ${MONTHS[a.m - 1]} ${a.y}` : `${a.d} ${MONTHS[a.m - 1].slice(0, 3)} – ${b.d} ${MONTHS[b.m - 1].slice(0, 3)} ${b.y}`;
  return (
    <section className="cx-page">
      <Nav label={label} onPrev={() => set(addDays(useUi.getState().view.calWeek ?? start, -7))} onNext={() => set(addDays(useUi.getState().view.calWeek ?? start, 7))} onToday={() => set(weekStart(todayKey()))} />
      <div className="cx-week">
        {days.map((d) => {
          const list = events.filter((e) => e.day === d);
          return (
            <div key={d} className={`cx-weekday${d === today ? " is-today" : ""}`}>
              <div className="cx-weekday__head">
                <span className="cx-col__wd">{WEEKDAYS[weekdayOf(d)].slice(0, 3)}</span>
                <span className="cx-col__day">{parseDay(d).d}</span>
              </div>
              {list.map((e) => (
                <button key={e.id} type="button" className={`cx-weekev cx-ev--${e.kind}${e.overdue ? " is-overdue" : ""}`} onClick={() => openEvent(e)}>
                  {e.time ? <span className="mono">{e.time}</span> : null}
                  <span>{e.title}</span>
                  {e.detail || e.place ? <span className="cx-sub">{[e.detail, e.place].filter(Boolean).join(" · ")}</span> : null}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ListView() {
  const t = useT();
  const { events, today } = useEvents();
  const past = events.filter((e) => e.day < today && !e.overdue);
  const coming = events.filter((e) => e.day >= today || e.overdue);
  if (!events.length) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="calendar" size={26} />
        </span>
        <h2>{t("Nothing in the calendar yet")}</h2>
        <p>{t("The calendar gathers the rehearsals, the performances of the Budget, the confirmed tour dates and the deadlines of the departments.")}</p>
      </div>
    );
  }
  let last = "";
  return (
    <section className="cx-page cx-page--narrow">
      <div className="cn-head">
        <h2>{t("Coming up")}</h2>
        <Legend />
      </div>
      <div className="cx-agenda">
        {coming.map((e) => {
          const head = e.day !== last ? e.day : null;
          last = e.day;
          return (
            <div key={e.id}>
              {head ? <div className={`cx-agenda__day${head === today ? " is-today" : ""}`}>{cap(dayLabel(head))}</div> : null}
              <button type="button" className={`cx-agenda__row${e.overdue ? " is-overdue" : ""}`} onClick={() => openEvent(e)}>
                <span className={`cx-ev-dot cx-ev--${e.kind}`} />
                <span className="mono cx-agenda__time">{e.time || "–"}</span>
                <span className="ts-ellipsis">{e.title}</span>
                <span className="cx-sub ts-ellipsis">{[e.detail, e.place].filter(Boolean).join(" · ")}</span>
              </button>
            </div>
          );
        })}
      </div>
      {past.length ? <p className="cx-note">{t("{n} past things are in Month and Week.", { n: past.length })}</p> : null}
    </section>
  );
}
