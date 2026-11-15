import { useEffect, useMemo } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon, Kbd } from "@theatre-suite/ui";
import { durationOptions } from "./durations";
import { currentAnswers, dayLabel, dayShort, isPast, nextDateSuggestion, sortDates, tablePeople, todayKey, totalsFor, WEEKDAYS, weekdayOf } from "../model/rehearsals";
import type { RehearsalDate } from "../model/types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

const TIME_OK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Adds a date after the last one (same time, same length, same place) and puts the cursor on it. */
export function addDate() {
  const d = nextDateSuggestion(useDoc.getState().data.rehearsals.dates);
  useDoc.getState().change((doc) => ({ ...doc, rehearsals: { ...doc.rehearsals, dates: [...doc.rehearsals.dates, d] } }));
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-date-id="${d.id}"] input[type="date"]`)?.focus());
}

function patchDate(id: string, patch: Partial<RehearsalDate>, key: string) {
  useDoc.getState().change(
    (doc) => ({ ...doc, rehearsals: { ...doc.rehearsals, dates: doc.rehearsals.dates.map((x) => (x.id === id ? { ...x, ...patch } : x)) } }),
    `${id}.${key}`,
  );
}

export function DatesActions() {
  const t = useT();
  const count = useDoc((s) => s.data.rehearsals.dates.length);
  return (
    <>
      <Button variant="ghost" icon="plus" className="cn-bl" title={`${t("Add a date")} · Ctrl Shift N`} onClick={addDate}>
        <span>{t("Add a date")}</span>
      </Button>
      <Button variant="primary" icon="copy" disabled={!count} title={t("Copy the message with the dates")} onClick={() => useUi.getState().openCopyMessage("dates")}>
        {t("Copy the message")}
      </Button>
    </>
  );
}

export function DatesStatus() {
  const t = useT();
  const dates = useDoc((s) => s.data.rehearsals.dates);
  const next = sortDates(dates).find((d) => !isPast(d, todayKey()));
  return (
    <>
      <span>{dates.length === 1 ? t("1 date") : t("{n} dates", { n: dates.length })}</span>
      {next ? <span>{t("Next: {day}", { day: `${dayShort(next.day)} · ${next.time}` })}</span> : null}
      <span className="ts-spacer" />
      <span>
        <Kbd>Ctrl Shift N</Kbd> {t("add a date")}
      </span>
    </>
  );
}

export function Dates() {
  const t = useT();
  const dates = useDoc((s) => s.data.rehearsals.dates);
  const answers = useDoc((s) => s.data.rehearsals.answers);
  const people = useDoc((s) => s.data.people);
  const today = todayKey();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().dialog) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        addDate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const sorted = useMemo(() => sortDates(dates), [dates]);
  const table = useMemo(() => tablePeople(people, answers), [people, answers]);
  const map = useMemo(() => currentAnswers(answers), [answers]);

  if (dates.length === 0) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="calendar" size={26} />
        </span>
        <h2>{t("No dates yet")}</h2>
        <p>{t("Add the days you can rehearse: day, time, length and place. Then copy the message and send it to the company on WhatsApp in one go.")}</p>
        <div className="cn-empty__actions">
          <Button variant="primary" icon="plus" onClick={addDate}>
            {t("Add a date")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="cn-dates">
      <div className="cn-head">
        <h2>{t("Dates")}</h2>
        <span className="ts-muted cn-head__hint">{t("Copy the message when the list is ready: the replies are read from the same lines.")}</span>
      </div>
      <div className="cn-drows" role="table" aria-label={t("Dates")}>
        <div className="cn-drow cn-drow--head" role="row">
          <span role="columnheader">{t("Day")}</span>
          <span role="columnheader">{t("Time")}</span>
          <span role="columnheader">{t("Length")}</span>
          <span role="columnheader">{t("Place")}</span>
          <span role="columnheader">{t("Replies")}</span>
          <span />
        </div>
        {sorted.map((d) => {
          const totals = totalsFor(table, map, d.id);
          const past = isPast(d, today);
          return (
            <div key={d.id} role="row" data-date-id={d.id} className={`cn-drow${past ? " cn-drow--past" : ""}`}>
              <span role="cell" className="cn-drow__day">
                <input
                  type="date"
                  className="ts-input"
                  value={d.day}
                  aria-label={t("Day")}
                  onChange={(e) => e.currentTarget.value && patchDate(d.id, { day: e.currentTarget.value }, "day")}
                />
                <span className="cn-drow__wd">{WEEKDAYS[weekdayOf(d.day)]}</span>
              </span>
              <span role="cell">
                <input
                  type="time"
                  className="ts-input mono"
                  value={d.time}
                  aria-label={t("Time")}
                  onChange={(e) => TIME_OK.test(e.currentTarget.value) && patchDate(d.id, { time: e.currentTarget.value }, "time")}
                />
              </span>
              <span role="cell">
                <select className="ts-select" value={d.minutes} aria-label={t("Length")} onChange={(e) => patchDate(d.id, { minutes: Number(e.currentTarget.value) }, "minutes")}>
                  {durationOptions(d.minutes).map((o) => (
                    <option key={o.minutes} value={o.minutes}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </span>
              <span role="cell">
                <input
                  className="ts-input"
                  value={d.place}
                  placeholder={t("Where (optional)")}
                  aria-label={t("Place")}
                  onChange={(e) => patchDate(d.id, { place: e.currentTarget.value }, "place")}
                />
              </span>
              <span role="cell" className="cn-drow__replies">
                {past ? (
                  <span className="cn-past">{t("past")}</span>
                ) : totals.total === 0 ? (
                  <span className="ts-muted">–</span>
                ) : totals.none === totals.total ? (
                  <span className="ts-muted">{t("no replies yet")}</span>
                ) : (
                  <button type="button" className="cn-linkbtn" title={t("Open the availability")} onClick={() => useUi.getState().go("rehearsals", "availability")}>
                    <span className="cn-n cn-n--yes">{t("{n} yes", { n: totals.yes })}</span>
                    {totals.maybe ? <span className="cn-n cn-n--maybe">{t("{n} maybe", { n: totals.maybe })}</span> : null}
                    {totals.no ? <span className="cn-n cn-n--no">{t("{n} no", { n: totals.no })}</span> : null}
                  </button>
                )}
              </span>
              <span role="cell">
                <Button
                  variant="ghost"
                  iconOnly
                  icon="trash"
                  aria-label={t("Delete the date {day}", { day: dayLabel(d.day) })}
                  title={t("Delete")}
                  onClick={() => useUi.getState().openDialog("deleteDate", d.id)}
                />
              </span>
            </div>
          );
        })}
      </div>
      <div className="cn-dates__add">
        <Button variant="sm" icon="plus" onClick={addDate}>
          {t("Add a date")}
        </Button>
        <span className="ts-field__hint">{t("The new date copies the time, length and place of the last one.")}</span>
      </div>
    </div>
  );
}
