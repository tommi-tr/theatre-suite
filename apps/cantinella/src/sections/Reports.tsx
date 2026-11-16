import { useMemo, useState } from "react";
import { uid, useT } from "@theatre-suite/core";
import { Button, CopyPreview, Dialog, Icon } from "@theatre-suite/ui";
import { copyText } from "../lib/api";
import { noteToTodo, presetDepartments, reportText, type Report } from "../model/departments";
import { dayLabel, dayShort, sortDates, todayKey } from "../model/rehearsals";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { changeD } from "./Departments";

const patchReport = (id: string, patch: Partial<Report>, key: string) => changeD((d) => ({ ...d, reports: d.reports.map((r) => (r.id === id ? { ...r, ...patch } : r)) }), `${id}.${key}`);

/** A new report for today (or the last rehearsal before today), at the top of the list. */
export function newReport() {
  const st = useDoc.getState().data;
  const today = todayKey();
  const last = sortDates(st.rehearsals.dates)
    .filter((d) => d.day <= today)
    .pop();
  const r: Report = { id: uid(), day: last?.day ?? today, dateId: last?.id ?? "", general: "", notes: [] };
  useDoc.getState().change((x) => ({
    ...x,
    departments: { list: x.departments.list.length ? x.departments.list : presetDepartments(), reports: [r, ...x.departments.reports] },
  }));
  useUi.getState().select("report", r.id);
}

export function ReportsActions() {
  const t = useT();
  const sel = useUi((s) => s.sel.report ?? null);
  const has = useDoc((s) => s.data.departments.reports.some((r) => r.id === sel));
  const [copy, setCopy] = useState(false);
  return (
    <>
      <Button variant="ghost" icon="copy" className="cn-bl" disabled={!has} onClick={() => setCopy(true)}>
        <span>{t("Copy the report")}</span>
      </Button>
      <Button variant="primary" icon="plus" onClick={newReport}>
        {t("New report")}
      </Button>
      {copy && sel ? <CopyReport id={sel} onClose={() => setCopy(false)} /> : null}
    </>
  );
}

function CopyReport({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const d = useDoc((s) => s.data.departments);
  const rep = d.reports.find((r) => r.id === id);
  const text = rep ? reportText(rep, d.list, dayLabel) : "";
  return (
    <Dialog title={t("Copy the report")} icon="copy" description={t("To paste in the group of the company or of the crew.")} onClose={onClose} width={600}>
      <CopyPreview text={text} copy={(s) => void copyText(s)} labels={{ copy: t("Copy"), copied: t("Copied") }} emptyText="" />
    </Dialog>
  );
}

export function ReportsStatus() {
  const t = useT();
  const n = useDoc((s) => s.data.departments.reports.length);
  return (
    <>
      <span>{t("{n} reports", { n })}</span>
      <span className="ts-spacer" />
      <span>{t("Every note can become a thing to do of its department")}</span>
    </>
  );
}

export function Reports() {
  const t = useT();
  const d = useDoc((s) => s.data.departments);
  const dates = useDoc((s) => s.data.rehearsals.dates);
  const selId = useUi((s) => s.sel.report ?? null);
  const sorted = useMemo(() => [...d.reports].sort((a, b) => b.day.localeCompare(a.day)), [d.reports]);
  const rep = d.reports.find((r) => r.id === selId) ?? sorted[0] ?? null;

  if (!d.reports.length) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="note" size={26} />
        </span>
        <h2>{t("No reports yet")}</h2>
        <p>{t("After a rehearsal write what each department has to know or do: lights, costumes, set… Every note can become a thing to do with a deadline.")}</p>
        <div className="cn-empty__actions">
          <Button variant="primary" icon="plus" onClick={newReport}>
            {t("New report")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="cx-split">
      <aside className="cx-side cx-side--narrow">
        <span className="ts-label">{t("Reports")}</span>
        {sorted.map((r) => {
          const n = r.notes.length;
          return (
            <button key={r.id} type="button" className={`cx-listbtn${rep?.id === r.id ? " is-on" : ""}`} onClick={() => useUi.getState().select("report", r.id)}>
              <span>{dayShort(r.day)}</span>
              <span className="ts-muted">{t("{n} notes", { n })}</span>
            </button>
          );
        })}
      </aside>
      {rep ? <ReportEditor key={rep.id} rep={rep} dates={dates} /> : null}
    </div>
  );
}

function ReportEditor({ rep, dates }: { rep: Report; dates: ReturnType<typeof useDoc.getState>["data"]["rehearsals"]["dates"] }) {
  const t = useT();
  const depts = useDoc((s) => s.data.departments.list);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const add = (deptId: string) => {
    const text = (draft[deptId] ?? "").trim();
    if (!text) return;
    patchReport(rep.id, { notes: [...rep.notes, { id: uid(), deptId, text, todoId: "" }] }, `note-${deptId}`);
    setDraft((x) => ({ ...x, [deptId]: "" }));
  };
  return (
    <section className="cx-page">
      <div className="cn-head">
        <h2>{t("Report of {day}", { day: dayLabel(rep.day) })}</h2>
        <Button
          variant="ghost"
          icon="trash"
          onClick={() =>
            useUi.getState().ask({
              title: t("Delete the report of {day}?", { day: dayShort(rep.day) }),
              text: t("The things to do it created stay in their departments."),
              action: t("Delete"),
              run: () => changeD((d) => ({ ...d, reports: d.reports.filter((r) => r.id !== rep.id), list: d.list.map((x) => ({ ...x, todos: x.todos.map((y) => (y.reportId === rep.id ? { ...y, reportId: "" } : y)) })) })),
            })
          }
        >
          {t("Delete")}
        </Button>
      </div>
      <div className="cx-inline">
        <label className="cx-inline">
          <span className="ts-muted">{t("Day")}</span>
          <input type="date" className="ts-input" value={rep.day} onChange={(e) => e.currentTarget.value && patchReport(rep.id, { day: e.currentTarget.value, dateId: dates.find((x) => x.day === e.currentTarget.value)?.id ?? "" }, "day")} />
        </label>
        {rep.dateId ? <span className="cx-tag">{t("Rehearsal of the plan")}</span> : null}
      </div>
      <label className="ts-field">
        <span className="ts-label">{t("General notes")}</span>
        <textarea className="ts-input cn-textarea" rows={3} value={rep.general} placeholder={t("How it went, what to remember for the next rehearsal…")} onChange={(e) => patchReport(rep.id, { general: e.currentTarget.value }, "general")} />
      </label>
      <div className="cx-reportgrid">
        {depts.map((dept) => {
          const notes = rep.notes.filter((n) => n.deptId === dept.id);
          return (
            <div key={dept.id} className="cx-reportcard">
              <span className="cx-reportcard__title">{dept.name}</span>
              {notes.map((n) => (
                <div key={n.id} className="cx-note-row">
                  <input className="ts-input" value={n.text} onChange={(e) => patchReport(rep.id, { notes: rep.notes.map((x) => (x.id === n.id ? { ...x, text: e.currentTarget.value } : x)) }, `n-${n.id}`)} />
                  {n.todoId ? (
                    <span className="cx-tag" title={t("It is a thing to do of {dept}", { dept: dept.name })}>
                      <Icon name="check" size={10} /> {t("to do")}
                    </span>
                  ) : (
                    <button type="button" className="cx-mini cx-mini--text" title={t("Make it a thing to do of {dept}", { dept: dept.name })} onClick={() => changeD((d) => noteToTodo(d, rep.id, n.id))}>
                      {t("→ to do")}
                    </button>
                  )}
                  <button type="button" className="cx-mini" title={t("Delete")} onClick={() => patchReport(rep.id, { notes: rep.notes.filter((x) => x.id !== n.id) }, "notes-")}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
              <input
                className="ts-input cx-note-new"
                value={draft[dept.id] ?? ""}
                placeholder={t("A note (Enter)")}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setDraft((x) => ({ ...x, [dept.id]: v }));
                }}
                onKeyDown={(e) => e.key === "Enter" && add(dept.id)}
                onBlur={() => add(dept.id)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
