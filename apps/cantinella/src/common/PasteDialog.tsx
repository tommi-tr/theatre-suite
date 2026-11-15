import { useEffect, useMemo, useRef, useState } from "react";
import { useT, type TFunc } from "@theatre-suite/core";
import { Button, Dialog, Icon, StatusLight } from "@theatre-suite/ui";
import { DEFAULT_WORDS, aliasesToLearn, classifyRows, needsCheck, parseReplies, rowsToAnswers, type PersonHow, type Reply, type ReplyRow, type RowStatus } from "../model/replies";
import { dayShort, nowKey } from "../model/rehearsals";
import type { CustomWords, Person, RehearsalDate } from "../model/types";
import { stateWord } from "../sections/Availability";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

/** What the director changed by hand on a row. A key that is present is a decision, even `null`. */
interface Edit {
  personId?: string | null;
  dateId?: string | null;
  state?: Reply | null;
}

function applyEdit(r: ReplyRow, e?: Edit): ReplyRow {
  if (!e) return r;
  const out: ReplyRow = { ...r, check: { ...r.check } };
  if (e.personId !== undefined) {
    out.personId = e.personId;
    out.check.person = e.personId === null;
  }
  if (e.dateId !== undefined) {
    out.dateId = e.dateId;
    out.check.date = e.dateId === null;
  }
  if (e.state !== undefined) {
    out.state = e.state;
    out.check.answer = e.state === null;
  }
  return out;
}

const complete = (r: ReplyRow) => !!(r.personId && r.dateId && r.state);

function howLabel(t: TFunc, how: PersonHow): string {
  switch (how) {
    case "name":
      return t("by name");
    case "alias":
      return t("by short name");
    case "phone":
      return t("by number");
    case "part":
      return t("by part of the name");
    case "ambiguous":
      return t("more than one person");
    default:
      return t("sender not known");
  }
}

const dateOption = (d: RehearsalDate) => `${dayShort(d.day)} · ${d.time}`;

/** Paste the messages of WhatsApp, see what is read, correct, confirm. Nothing enters before the confirmation. */
export function PasteDialog() {
  const t = useT();
  const people = useDoc((s) => s.data.people);
  const rehearsals = useDoc((s) => s.data.rehearsals);
  const [text, setText] = useState(() => useUi.getState().pasteText);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [remember, setRemember] = useState(true);
  const area = useRef<HTMLTextAreaElement>(null);
  const close = () => useUi.getState().closeDialog();

  useEffect(() => {
    if (!text) area.current?.focus();
    // Only when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = useMemo(() => parseReplies(text, { people, dates: rehearsals.dates, words: rehearsals.words }), [text, people, rehearsals.dates, rehearsals.words]);
  const rows = useMemo(() => parsed.rows.map((r) => applyEdit(r, edits[r.id])), [parsed, edits]);
  const status = useMemo(() => classifyRows(rows, rehearsals.answers), [rows, rehearsals.answers]);

  const isIn = (r: ReplyRow): boolean => {
    if (!complete(r) || status.get(r.id) === "already") return false;
    return included[r.id] ?? !needsCheck(r);
  };
  const chosen = rows.filter(isIn);
  const toCheck = rows.filter((r) => status.get(r.id) !== "already" && !isIn(r) && needsCheck(r)).length;
  const already = rows.filter((r) => status.get(r.id) === "already").length;
  const learn = useMemo(() => aliasesToLearn(chosen, people), [chosen, people]);
  const allSure = chosen.every((r) => !needsCheck(r));

  const edit = (id: string, patch: Edit) => {
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
    setIncluded(({ [id]: _drop, ...rest }) => rest);
  };

  const confirm = () => {
    const answers = rowsToAnswers(chosen, nowKey());
    if (!answers.length) return;
    const names = remember ? learn : new Map<string, string[]>();
    useDoc.getState().change((d) => ({
      ...d,
      people: names.size ? d.people.map((p) => (names.has(p.id) ? { ...p, aliases: [...p.aliases, ...names.get(p.id)!] } : p)) : d.people,
      rehearsals: { ...d.rehearsals, answers: [...d.rehearsals.answers, ...answers] },
    }));
    close();
    useUi.getState().go("rehearsals", "availability");
    useUi.getState().showToast(answers.length === 1 ? t("1 reply added. Ctrl Z undoes it.") : t("{n} replies added. Ctrl Z undoes them.", { n: answers.length }));
  };

  const label = !chosen.length
    ? t("Add replies")
    : allSure
      ? chosen.length === 1
        ? t("Add 1 sure reply")
        : t("Add {n} sure replies", { n: chosen.length })
      : chosen.length === 1
        ? t("Add 1 reply")
        : t("Add {n} replies", { n: chosen.length });

  return (
    <Dialog
      title={t("Paste the replies")}
      icon="clipboard"
      description={t("Paste the messages copied from WhatsApp. You see what Cantinella reads; nothing is added before you confirm.")}
      onClose={close}
      width={1180}
      footer={
        <>
          {learn.size ? (
            <label className="cn-switchrow cn-remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
              {t("Remember the names I assigned (as short names in the contacts)")}
            </label>
          ) : toCheck ? (
            <span className="cn-foothint">
              <Icon name="alert" size={14} color="var(--sb)" />
              {toCheck === 1 ? t("1 reply to check: not added unless you tick it") : t("{n} replies to check: not added unless you tick them", { n: toCheck })}
            </span>
          ) : null}
          <span className="ts-spacer" />
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" icon="check" disabled={!chosen.length} onClick={confirm}>
            {label}
          </Button>
        </>
      }
    >
      <div className="cn-paste">
        <div className="cn-paste__in">
          <label className="ts-field">
            <span className="ts-label">{t("Messages")}</span>
            <textarea
              ref={area}
              className="ts-input cn-paste__text mono"
              value={text}
              spellCheck={false}
              placeholder={t("Paste here (Ctrl V): one message, several, or the whole chat, with or without the times.")}
              onChange={(e) => {
                setText(e.currentTarget.value);
                setEdits({});
                setIncluded({});
              }}
            />
          </label>
          <Words words={rehearsals.words} />
        </div>
        <div className="cn-paste__out" aria-live="polite">
          {!text.trim() ? (
            <div className="cn-paste__empty">
              <Icon name="message" size={22} />
              <p>{t("Here you will see one line for every reply: who writes, which date and what they answer.")}</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="cn-paste__empty">
              <Icon name="alert" size={22} color="var(--sb)" />
              <p>{t("No reply found. A reply has a date and the answer next to it, like “16/11 sì” or “Lunedì 16 novembre ore 16:00 no”.")}</p>
            </div>
          ) : (
            <>
              <div className="cn-paste__sum">
                <strong>{rows.length === 1 ? t("1 reply read") : t("{n} replies read", { n: rows.length })}</strong>
                {toCheck ? <span className="cn-sum cn-sum--warn">{t("{n} to check", { n: toCheck })}</span> : null}
                {already ? <span className="cn-sum">{t("{n} already there", { n: already })}</span> : null}
              </div>
              <div className="cn-replies" role="list">
                {rows.map((r) => (
                  <PasteRow
                    key={r.id}
                    row={r}
                    status={status.get(r.id) ?? "new"}
                    on={isIn(r)}
                    edited={edits[r.id]}
                    people={people}
                    dates={rehearsals.dates}
                    onToggle={(v) => setIncluded((i) => ({ ...i, [r.id]: v }))}
                    onEdit={(patch) => edit(r.id, patch)}
                  />
                ))}
              </div>
            </>
          )}
          {parsed.ignored.length ? (
            <details className="cn-ignored">
              <summary>{parsed.ignored.length === 1 ? t("1 message without a date, not read") : t("{n} messages without a date, not read", { n: parsed.ignored.length })}</summary>
              <ul>
                {parsed.ignored.slice(0, 30).map((m, i) => (
                  <li key={i}>
                    <strong>{m.author || t("(no sender)")}</strong> <span className="ts-ellipsis">{m.text.replace(/\s+/g, " ").slice(0, 140)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function PasteRow({
  row,
  status,
  on,
  edited,
  people,
  dates,
  onToggle,
  onEdit,
}: {
  row: ReplyRow;
  status: RowStatus;
  on: boolean;
  edited?: Edit;
  people: Person[];
  dates: RehearsalDate[];
  onToggle: (v: boolean) => void;
  onEdit: (patch: Edit) => void;
}) {
  const t = useT();
  const person = people.find((p) => p.id === row.personId);
  const date = dates.find((d) => d.id === row.dateId);
  const done = status === "already";
  const doubtful = needsCheck(row) && !on && !done;
  const personFirst = [...row.personCandidates.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p), ...people.filter((p) => !row.personCandidates.includes(p.id))];
  const dateFirst = [...row.dateCandidates.map((id) => dates.find((d) => d.id === id)).filter((d): d is RehearsalDate => !!d), ...dates.filter((d) => !row.dateCandidates.includes(d.id))];
  const flags = [row.check.person && t("sender"), row.check.date && t("date"), row.check.answer && t("answer")].filter(Boolean) as string[];

  return (
    <div role="listitem" className={`cn-reply${doubtful ? " cn-reply--check" : ""}${done ? " cn-reply--done" : ""}`}>
      <input
        type="checkbox"
        className="cn-reply__on"
        checked={on}
        disabled={!complete(row) || done}
        aria-label={t("Add this reply")}
        onChange={(e) => onToggle(e.currentTarget.checked)}
      />
      <div className="cn-reply__who">
        {row.check.person || edited?.personId !== undefined ? (
          <select className={`ts-select cn-sel${row.check.person ? " cn-sel--warn" : ""}`} value={row.personId ?? ""} aria-label={t("Who wrote it")} onChange={(e) => onEdit({ personId: e.currentTarget.value || null })}>
            <option value="">{t("Assign to…")}</option>
            {personFirst.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="cn-reply__name ts-ellipsis">{person?.name}</span>
        )}
        <span className="cn-reply__sub ts-ellipsis">
          {row.author ? `${row.author} · ` : ""}
          {howLabel(t, row.personHow)}
        </span>
      </div>
      <div className="cn-reply__date">
        {row.check.date || edited?.dateId !== undefined ? (
          <select className={`ts-select cn-sel${row.check.date ? " cn-sel--warn" : ""}`} value={row.dateId ?? ""} aria-label={t("Which date")} onChange={(e) => onEdit({ dateId: e.currentTarget.value || null })}>
            <option value="">{t("Which date?")}</option>
            {dateFirst.map((d) => (
              <option key={d.id} value={d.id}>
                {dateOption(d)}
              </option>
            ))}
          </select>
        ) : (
          <span className="cn-reply__name ts-ellipsis">{date ? dateOption(date) : ""}</span>
        )}
        <span className="cn-reply__sub ts-ellipsis">
          {t("written")}: {row.dateText}
        </span>
      </div>
      <div className="cn-reply__pick" role="group" aria-label={t("Answer")}>
        {(["yes", "maybe", "no"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`cn-pick cn-pick--${s}${row.check.answer && row.state === s ? " cn-pick--guess" : ""}`}
            aria-pressed={row.state === s}
            aria-label={stateWord(t, s)}
            title={stateWord(t, s)}
            onClick={() => onEdit({ state: s })}
          >
            {stateWord(t, s).charAt(0).toUpperCase()}
          </button>
        ))}
      </div>
      <div className="cn-reply__text">
        <span className="ts-ellipsis mono" title={row.excerpt}>
          {row.excerpt}
        </span>
        {row.note && row.state ? <span className="cn-reply__note ts-ellipsis">{t("note")}: {row.note}</span> : null}
      </div>
      <div className="cn-reply__state">
        {done ? (
          <span className="cn-tag">{t("already there")}</span>
        ) : doubtful ? (
          <span className="cn-tag cn-tag--warn" title={t("Check: {what}", { what: flags.join(", ") })}>
            <Icon name="alert" size={12} /> {t("check")}: {flags.join(", ")}
          </span>
        ) : status === "superseded" ? (
          <span className="cn-tag" title={t("The same person wrote this date again later: the last reply counts, this one stays in the history.")}>
            {t("replaced later")}
          </span>
        ) : on ? (
          <StatusLight state="ok" label={needsCheck(row) ? t("confirmed") : t("sure")} />
        ) : null}
      </div>
    </div>
  );
}

/** The words that mean yes, maybe, no: what Cantinella knows and what the director adds. */
function Words({ words }: { words: CustomWords }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const groups = [
    { key: "yes" as const, state: "ok" as const, label: t("Yes") },
    { key: "maybe" as const, state: "warn" as const, label: t("Maybe") },
    { key: "no" as const, state: "stop" as const, label: t("No") },
  ];
  return (
    <div className="cn-words">
      <div className="cn-words__head">
        <span className="ts-label">{t("Words recognised")}</span>
        <span className="ts-spacer" />
        <button type="button" className="cn-linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t("Done") : t("Edit")}
        </button>
      </div>
      {groups.map((g) => (
        <div key={g.key} className="cn-words__line">
          <StatusLight state={g.state} label={g.label} />
          <span className="cn-words__list ts-ellipsis" title={[...DEFAULT_WORDS[g.key], ...words[g.key]].join(", ")}>
            {[...DEFAULT_WORDS[g.key].slice(0, 5), ...words[g.key]].join(", ")}…
          </span>
        </div>
      ))}
      {open ? (
        <div className="cn-words__edit">
          {groups.map((g) => (
            <WordsField key={g.key} label={t("Your words for “{what}”", { what: g.label })} list={words[g.key]} onCommit={(list) => setWords(g.key, list)} />
          ))}
          <p className="ts-field__hint">{t("Separated by commas, for example: ok, x, eccomi. Accents and capitals do not matter.")}</p>
        </div>
      ) : null}
    </div>
  );
}

function setWords(key: keyof CustomWords, list: string[]) {
  useDoc.getState().change((d) => ({ ...d, rehearsals: { ...d.rehearsals, words: { ...d.rehearsals.words, [key]: list } } }));
}

function WordsField({ label, list, onCommit }: { label: string; list: string[]; onCommit: (list: string[]) => void }) {
  const [value, setValue] = useState(list.join(", "));
  useEffect(() => setValue(list.join(", ")), [list]);
  const commit = () => {
    const next = [...new Set(value.split(",").map((w) => w.trim()).filter(Boolean))];
    if (next.join("\u0000") !== list.join("\u0000")) onCommit(next);
  };
  return (
    <label className="ts-field">
      <span className="ts-label">{label}</span>
      <input className="ts-input" value={value} onChange={(e) => setValue(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </label>
  );
}
