import { useEffect } from "react";
import { useT, type TFunc } from "@theatre-suite/core";
import { Button, Icon, Kbd, Segmented, StateCell, StatusLight, type CellState, type LightState } from "@theatre-suite/ui";
import { MONTHS, WEEKDAYS, atLabel, dayLabel, historyOf, isPast, nextState, parseDay, setCell, setCellNote, totalsFor, weekdayOf, cellOf } from "../model/rehearsals";
import type { AnswerState, Person, RehearsalDate } from "../model/types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { useAvailability } from "./useAvailability";
import { roleLabel } from "./roles";

const lightOf: Record<AnswerState, LightState> = { yes: "ok", maybe: "warn", no: "stop", none: "info" };

/** The word for a state, in the language of the interface. */
export function stateWord(t: TFunc, s: AnswerState): string {
  return s === "yes" ? t("yes") : s === "maybe" ? t("maybe") : s === "no" ? t("no") : t("no reply yet");
}

/** One letter for the cell: S / F / N in Italian, Y / M / N in English. */
const letterOf = (t: TFunc, s: AnswerState): string => (s === "none" ? "–" : stateWord(t, s).charAt(0).toUpperCase());

function setState(personId: string, dateId: string, state: AnswerState) {
  useDoc.getState().change((d) => {
    const r = setCell(d.rehearsals, personId, dateId, state);
    return r === d.rehearsals ? d : { ...d, rehearsals: r };
  });
}

export function AvailabilityActions() {
  const t = useT();
  const { miss, dates } = useAvailability();
  const none = miss.people.length === 0;
  return (
    <>
      <Button
        variant="ghost"
        icon="message"
        className="cn-bl"
        disabled={none}
        title={none ? t("Everyone has answered") : t("Copy the reminder for who has not answered")}
        onClick={() => useUi.getState().openCopyMessage("reminder")}
      >
        <span>{t("Copy the reminder")}</span>
      </Button>
      <Button
        variant="primary"
        icon="clipboard"
        disabled={!dates.length}
        title={`${t("Paste the replies")} · Ctrl V`}
        onClick={() => useUi.getState().openPaste()}
      >
        {t("Paste the replies")}
      </Button>
    </>
  );
}

export function AvailabilityStatus() {
  const t = useT();
  const { dates, table, miss } = useAvailability();
  return (
    <>
      <span>{table.length === 1 ? t("1 person") : t("{n} people", { n: table.length })}</span>
      <span>{dates.length === 1 ? t("1 date") : t("{n} dates", { n: dates.length })}</span>
      {miss.people.length ? (
        <span className="cn-status-warn">{miss.people.length === 1 ? t("1 has still to answer") : t("{n} have still to answer", { n: miss.people.length })}</span>
      ) : table.length && dates.length ? (
        <span className="cn-status-ok">{t("Everyone has answered")}</span>
      ) : null}
      <span className="ts-spacer" />
      <span>
        <Kbd>Ctrl V</Kbd> {t("paste the replies")}
      </span>
    </>
  );
}

function ColumnHead({ date, past }: { date: RehearsalDate; past: boolean }) {
  const { m, d } = parseDay(date.day);
  return (
    <div role="columnheader" className={`cn-avh${past ? " cn-avh--past" : ""}`} title={`${dayLabel(date.day)} · ${date.time}`}>
      <span className="cn-avh__wd">{WEEKDAYS[weekdayOf(date.day)].slice(0, 3)}</span>
      <span className="cn-avh__d">{d}</span>
      <span className="cn-avh__m">{MONTHS[m - 1].slice(0, 3)}</span>
      <span className="cn-avh__t mono">{date.time}</span>
    </div>
  );
}

export function Availability() {
  const t = useT();
  const { dates, table, map, miss, today, answers } = useAvailability();
  const people = useDoc((s) => s.data.people);
  const loadRev = useDoc((s) => s.loadRev);
  const cell = useUi((s) => s.cell);
  const onlyMissing = useUi((s) => s.onlyMissing);

  useEffect(() => useUi.getState().selectCell(null), [loadRev]);
  // The selected cell can disappear (undo, a date deleted): close the panel.
  const shown = cell && table.some((p) => p.id === cell.personId) && dates.some((d) => d.id === cell.dateId) ? cell : null;
  useEffect(() => {
    if (cell && !shown) useUi.getState().selectCell(null);
  }, [cell, shown]);

  if (dates.length === 0) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="calendar" size={26} />
        </span>
        <h2>{t("Add the dates first")}</h2>
        <p>{t("The availability is a table of actors and dates. Enter the dates, send the message to the company, then paste their replies here.")}</p>
        <div className="cn-empty__actions">
          <Button variant="primary" icon="calendar" onClick={() => useUi.getState().go("rehearsals", "dates")}>
            {t("Go to the dates")}
          </Button>
        </div>
      </div>
    );
  }
  if (table.length === 0) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="addressBook" size={26} />
        </span>
        <h2>{t("Nobody in the table yet")}</h2>
        <p>
          {people.length
            ? t("The table shows the people with the role Actor. Give that role to the actors in the contacts, or paste the replies: whoever answers is added.")
            : t("Add the actors in the contacts: the table shows them, and their names and short names are used to recognise the replies.")}
        </p>
        <div className="cn-empty__actions">
          <Button variant="primary" icon="addressBook" onClick={() => useUi.getState().go("departments", "people")}>
            {t("Open the contacts")}
          </Button>
        </div>
      </div>
    );
  }

  const missingIds = new Set(miss.people.map((p) => p.id));
  const rows = onlyMissing ? table.filter((p) => missingIds.has(p.id)) : table;
  const cols = `minmax(170px, 220px) repeat(${dates.length}, minmax(76px, 132px))`;
  const tabStop = shown ?? (rows[0] ? { personId: rows[0].id, dateId: dates[0].id } : null);

  const select = (personId: string, dateId: string, focus = false) => {
    useUi.getState().selectCell({ personId, dateId });
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cell="${personId}|${dateId}"]`)?.focus());
  };

  const onKey = (e: React.KeyboardEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!el || e.ctrlKey || e.metaKey || e.altKey) return;
    const [pid, did] = el.dataset.cell!.split("|");
    const r = rows.findIndex((p) => p.id === pid);
    const c = dates.findIndex((d) => d.id === did);
    const move = (dr: number, dc: number) => {
      const nr = Math.min(rows.length - 1, Math.max(0, r + dr));
      const nc = Math.min(dates.length - 1, Math.max(0, c + dc));
      select(rows[nr].id, dates[nc].id, true);
    };
    const k = e.key;
    if (k === "ArrowDown") move(1, 0);
    else if (k === "ArrowUp") move(-1, 0);
    else if (k === "ArrowRight") move(0, 1);
    else if (k === "ArrowLeft") move(0, -1);
    else if (k === "Home") select(pid, dates[0].id, true);
    else if (k === "End") select(pid, dates[dates.length - 1].id, true);
    else if (k.toLowerCase() === "s") setState(pid, did, "yes");
    else if (k.toLowerCase() === "f") setState(pid, did, "maybe");
    else if (k.toLowerCase() === "n") setState(pid, did, "no");
    else if (k === "Delete" || k === "Backspace" || k === "0" || k === "-") setState(pid, did, "none");
    else return;
    e.preventDefault();
  };

  return (
    <div className="cn-av">
      <section className="cn-av__main" aria-label={t("Availability")}>
        <div className="cn-head">
          <h2>{t("Availability")}</h2>
          <button type="button" className="cn-chip" aria-pressed={onlyMissing} disabled={!miss.people.length && !onlyMissing} onClick={() => useUi.getState().setOnlyMissing(!onlyMissing)}>
            {onlyMissing ? <Icon name="check" size={12} /> : null}
            {t("Who has not answered yet")}
            <span className="cn-chip__n">{miss.people.length}</span>
          </button>
          <span className="ts-spacer" />
          <span className="cn-legend" aria-label={t("Legend")}>
            {(["yes", "maybe", "no", "none"] as const).map((s) => (
              <span key={s} className="cn-legend__item">
                <span className={`cn-legend__cell cn-legend__cell--${s}`}>{letterOf(t, s)}</span>
                {stateWord(t, s)}
              </span>
            ))}
          </span>
        </div>
        <div className="cn-av__scroll">
          <div className="cn-avgrid" role="grid" aria-label={t("Availability")} style={{ ["--cols" as string]: cols, ["--minw" as string]: `${178 + dates.length * 82}px` }} onKeyDown={onKey}>
            <div role="row" className="cn-avrow cn-avrow--head">
              <div role="columnheader" className="cn-avwho cn-avwho--head">
                {t("Who")}
              </div>
              {dates.map((d) => (
                <ColumnHead key={d.id} date={d} past={isPast(d, today)} />
              ))}
            </div>
            {rows.map((p) => (
              <Row key={p.id} person={p} dates={dates} map={map} today={today} tabStop={tabStop} selected={shown} onPick={(did) => select(p.id, did)} />
            ))}
            {rows.length === 0 ? <div className="cn-table__none">{t("Everyone has answered.")}</div> : null}
            <div role="row" className="cn-avrow cn-avrow--foot">
              <div role="rowheader" className="cn-avwho cn-avwho--foot">
                {t("Present")}
              </div>
              {dates.map((d) => {
                const tot = totalsFor(table, map, d.id);
                return (
                  <div key={d.id} role="gridcell" className="cn-avtot" title={t("{yes} yes, {maybe} maybe, {no} no, {none} without a reply", { yes: tot.yes, maybe: tot.maybe, no: tot.no, none: tot.none })}>
                    <strong className={tot.yes === tot.total ? "cn-avtot--all" : undefined}>
                      {tot.yes}/{tot.total}
                    </strong>
                    <small>{tot.maybe ? t("+{n} maybe", { n: tot.maybe }) : " "}</small>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <p className="ts-field__hint cn-av__hint">{t("Click a cell to change the answer: yes → maybe → no → empty. With the keyboard: arrows to move, S yes, F maybe, N no, Delete to clear.")}</p>
      </section>
      {shown ? <CellPanel personId={shown.personId} dateId={shown.dateId} /> : null}
      <span hidden>{answers.length}</span>
    </div>
  );
}

function Row({
  person,
  dates,
  map,
  today,
  tabStop,
  selected,
  onPick,
}: {
  person: Person;
  dates: RehearsalDate[];
  map: ReturnType<typeof useAvailability>["map"];
  today: string;
  tabStop: { personId: string; dateId: string } | null;
  selected: { personId: string; dateId: string } | null;
  onPick: (dateId: string) => void;
}) {
  const t = useT();
  const isActor = person.roles.includes("actor");
  return (
    <div role="row" className="cn-avrow">
      <div role="rowheader" className="cn-avwho">
        <span className="cn-avwho__name ts-ellipsis">{person.name}</span>
        {!isActor ? <span className="cn-avwho__role ts-ellipsis">{person.roles.map((r) => roleLabel(t, r)).join(", ")}</span> : null}
      </div>
      {dates.map((d) => {
        const a = cellOf(map, person.id, d.id);
        const state: CellState = a?.state ?? "none";
        const isSel = selected?.personId === person.id && selected.dateId === d.id;
        const isStop = tabStop?.personId === person.id && tabStop.dateId === d.id;
        return (
          <div key={d.id} role="gridcell" className={`cn-avcell${isPast(d, today) ? " cn-avcell--past" : ""}`}>
            <StateCell
              state={state}
              letter={letterOf(t, state)}
              label={`${person.name}, ${dayLabel(d.day)}: ${stateWord(t, state)}${a?.note ? ` (${a.note})` : ""}`}
              note={!!a?.note}
              selected={isSel}
              tabIndex={isStop ? 0 : -1}
              data-cell={`${person.id}|${d.id}`}
              onClick={() => {
                onPick(d.id);
                setState(person.id, d.id, nextState(state));
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function CellPanel({ personId, dateId }: { personId: string; dateId: string }) {
  const t = useT();
  const person = useDoc((s) => s.data.people.find((p) => p.id === personId));
  const date = useDoc((s) => s.data.rehearsals.dates.find((d) => d.id === dateId));
  const answers = useDoc((s) => s.data.rehearsals.answers);
  if (!person || !date) return null;
  const history = historyOf(answers, personId, dateId);
  const current = history[0];
  const state: AnswerState = current?.state ?? "none";
  const options: Array<{ value: AnswerState; label: string }> = [
    { value: "yes", label: t("Yes") },
    { value: "maybe", label: t("Maybe") },
    { value: "no", label: t("No") },
    { value: "none", label: t("None") },
  ];
  return (
    <aside className="cn-panel" aria-label={t("Reply")}>
      <div className="cn-panel__head">
        <span className="ts-label">{t("Reply")}</span>
        <span className="ts-spacer" />
        <Button variant="ghost" iconOnly icon="x" aria-label={t("Close")} onClick={() => useUi.getState().selectCell(null)} />
      </div>
      <div className="cn-panel__body">
        <div className="cn-cellwho">
          <strong>{person.name}</strong>
          <span>
            {dayLabel(date.day)} · <span className="mono">{date.time}</span>
          </span>
        </div>
        <div className="ts-field">
          <span className="ts-label">{t("Answer")}</span>
          <Segmented small ariaLabel={t("Answer")} value={state} options={options} onChange={(v) => setState(personId, dateId, v)} />
        </div>
        <label className="ts-field">
          <span className="ts-label">{t("Note of the actor")}</span>
          <input
            className="ts-input"
            value={current?.note ?? ""}
            disabled={state === "none"}
            placeholder={state === "none" ? t("Choose an answer first") : t("For example: leaves at 17")}
            onChange={(e) => {
              const note = e.currentTarget.value;
              useDoc.getState().change((d) => ({ ...d, rehearsals: setCellNote(d.rehearsals, personId, dateId, note) }), `note.${personId}.${dateId}`);
            }}
          />
        </label>
        <div className="ts-field">
          <span className="ts-label">{t("History")}</span>
          {history.length === 0 ? (
            <p className="ts-field__hint">{t("Nothing was answered for this date yet.")}</p>
          ) : (
            <ul className="cn-history">
              {history.map((h, i) => (
                <li key={h.id} className={i === 0 ? "cn-history__now" : undefined}>
                  <StatusLight state={lightOf[h.state]} label={h.state === "none" ? t("cleared") : stateWord(t, h.state)} strong={i === 0} />
                  <span className="cn-history__src">{h.source === "paste" ? t("from a message") : t("by hand")}</span>
                  <span className="mono cn-history__at">{atLabel(h.at)}</span>
                  {h.note ? <em className="cn-history__note">{h.note}</em> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
