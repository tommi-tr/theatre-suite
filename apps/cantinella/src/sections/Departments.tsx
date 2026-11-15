import { useMemo, useState } from "react";
import { uid, useT, type TFunc } from "@theatre-suite/core";
import { Button, Icon, StatusLight, StatusLightPicker } from "@theatre-suite/ui";
import { api, isTauri } from "../lib/api";
import { deleteDepartment, dueTodos, newDepartment, newTodo, presetDepartments, type Department, type Departments as Depts, type Todo } from "../model/departments";
import { atLabel, dayShort, nowKey, todayKey } from "../model/rehearsals";
import { shortNames } from "../model/scenes";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

export const changeD = (fn: (d: Depts) => Depts, key?: string) => useDoc.getState().change((x) => ({ ...x, departments: fn(x.departments) }), key);
const patchDept = (id: string, patch: Partial<Department>, key: string) => changeD((d) => ({ ...d, list: d.list.map((x) => (x.id === id ? { ...x, ...patch } : x)) }), `${id}.${key}`);
const patchTodo = (deptId: string, todoId: string, patch: Partial<Todo>, key: string) =>
  changeD((d) => ({ ...d, list: d.list.map((x) => (x.id === deptId ? { ...x, todos: x.todos.map((y) => (y.id === todoId ? { ...y, ...patch } : y)) } : x)) }), `${todoId}.${key}`);

export const lightLabels = (t: TFunc) => ({ ok: t("All right"), warn: t("In progress"), stop: t("Blocked"), info: t("For information") });

function addDepartment(t: TFunc) {
  const d = newDepartment({ name: t("New department") });
  changeD((x) => ({ ...x, list: [...x.list, d] }));
  useUi.getState().select("dept", d.id);
  requestAnimationFrame(() => document.getElementById("cn-dept-name")?.focus());
}

export function DepartmentsActions() {
  const t = useT();
  const has = useDoc((s) => s.data.departments.list.length > 0);
  return has ? (
    <Button variant="primary" icon="plus" onClick={() => addDepartment(t)}>
      {t("Add a department")}
    </Button>
  ) : null;
}

export function DepartmentsStatus() {
  const t = useT();
  const d = useDoc((s) => s.data.departments);
  const due = useMemo(() => dueTodos(d, todayKey()), [d]);
  const open = d.list.reduce((a, x) => a + x.todos.filter((y) => !y.done).length, 0);
  return (
    <>
      <span>{t("{n} departments", { n: d.list.length })}</span>
      <span>{t("{n} things to do", { n: open })}</span>
      {due.overdue.length ? <span className="cn-status-stop">{due.overdue.length === 1 ? t("1 overdue") : t("{n} overdue", { n: due.overdue.length })}</span> : null}
      <span className="ts-spacer" />
      <span>{t("Reminders stay inside Cantinella")}</span>
    </>
  );
}

function dueLabel(t: TFunc, due: string, today: string): { text: string; tone: "stop" | "warn" | "" } {
  if (!due) return { text: "", tone: "" };
  if (due < today) return { text: t("overdue · {d}", { d: dayShort(due) }), tone: "stop" };
  if (due === today) return { text: t("today"), tone: "warn" };
  return { text: dayShort(due), tone: "" };
}

export function DepartmentsPart() {
  const t = useT();
  const d = useDoc((s) => s.data.departments);
  const people = useDoc((s) => s.data.people);
  const selId = useUi((s) => s.sel.dept ?? null);
  const today = todayKey();
  const due = useMemo(() => dueTodos(d, today), [d, today]);
  const names = useMemo(() => shortNames(people), [people]);
  const dept = d.list.find((x) => x.id === selId) ?? null;

  if (!d.list.length) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="trafficLight" size={26} />
        </span>
        <h2>{t("No departments yet")}</h2>
        <p>{t("Every department has a light (all right, in progress, blocked), a person in charge and its things to do with a deadline. Cantinella reminds you what is due, inside the app.")}</p>
        <div className="cn-empty__actions">
          <Button icon="plus" onClick={() => addDepartment(t)}>
            {t("Add a department")}
          </Button>
          <Button variant="primary" icon="list" onClick={() => changeD((x) => ({ ...x, list: presetDepartments() }))}>
            {t("Start from the usual departments")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="cx-split">
      <section className="cx-page">
        <div className="cn-head">
          <h2>{t("Departments")}</h2>
        </div>
        {due.overdue.length || due.week.length ? (
          <div className="cx-twocards">
            {(
              [
                ["stop", t("Overdue"), due.overdue],
                ["warn", t("Due in the next 7 days"), due.week],
              ] as const
            ).map(([tone, label, items]) =>
              items.length ? (
                <div key={tone} className={`cx-duebox cx-duebox--${tone}`}>
                  <span className="cx-duebox__title">
                    <Icon name={tone === "stop" ? "alert" : "calendar"} size={14} /> {label} · {items.length}
                  </span>
                  {items.slice(0, 5).map(({ dept: x, todo }) => (
                    <button key={todo.id} type="button" className="cx-duebox__row" onClick={() => useUi.getState().select("dept", x.id)}>
                      <span className="mono">{dayShort(todo.due)}</span>
                      <span className="ts-ellipsis">{todo.text}</span>
                      <span className="ts-muted ts-ellipsis">{x.name}</span>
                    </button>
                  ))}
                  {items.length > 5 ? <span className="cx-sub">{t("and {n} more", { n: items.length - 5 })}</span> : null}
                </div>
              ) : null,
            )}
          </div>
        ) : null}
        <div className="cx-rows" role="table" aria-label={t("Departments")}>
          <div className="cx-row cx-row--head cx-dept" role="row">
            <span role="columnheader">{t("Department")}</span>
            <span role="columnheader">{t("Traffic light")}</span>
            <span role="columnheader">{t("In charge")}</span>
            <span role="columnheader">{t("To do")}</span>
            <span role="columnheader">{t("Next deadline")}</span>
          </div>
          {d.list.map((x) => {
            const open = x.todos.filter((y) => !y.done);
            const next = open.filter((y) => y.due).sort((a, b) => a.due.localeCompare(b.due))[0];
            const dl = next ? dueLabel(t, next.due, today) : null;
            return (
              <div
                key={x.id}
                role="row"
                tabIndex={0}
                className={`cx-row cx-dept cx-row--click${selId === x.id ? " is-sel" : ""}`}
                onClick={() => useUi.getState().select("dept", x.id)}
                onKeyDown={(e) => e.key === "Enter" && useUi.getState().select("dept", x.id)}
              >
                <span role="cell" className="cx-name ts-ellipsis">
                  {x.name}
                </span>
                <span role="cell">
                  <StatusLight state={x.light} label={lightLabels(t)[x.light]} />
                </span>
                <span role="cell" className="ts-ellipsis">
                  {x.ownerId ? names.get(x.ownerId) : <span className="ts-muted">–</span>}
                </span>
                <span role="cell" className="mono">
                  {x.todos.length ? (
                    <>
                      {open.length}
                      <span className="ts-muted"> / {x.todos.length}</span>
                    </>
                  ) : (
                    <span className="ts-muted">–</span>
                  )}
                </span>
                <span role="cell" className={`ts-ellipsis${dl?.tone ? ` cx-tone--${dl.tone}` : ""}`}>
                  {next ? `${dl?.text} · ${next.text}` : <span className="ts-muted">–</span>}
                </span>
              </div>
            );
          })}
          <div className="cx-add">
            <Button variant="sm" icon="plus" onClick={() => addDepartment(t)}>
              {t("Add a department")}
            </Button>
          </div>
        </div>
      </section>
      {dept ? <DeptPanel key={dept.id} dept={dept} /> : null}
    </div>
  );
}

function DeptPanel({ dept }: { dept: Department }) {
  const t = useT();
  const people = useDoc((s) => s.data.people);
  const reports = useDoc((s) => s.data.departments.reports);
  const [comment, setComment] = useState("");
  const [todoText, setTodoText] = useState("");
  const today = todayKey();
  const addTodo = () => {
    const text = todoText.trim();
    if (!text) return;
    changeD((d) => ({ ...d, list: d.list.map((x) => (x.id === dept.id ? { ...x, todos: [...x.todos, newTodo({ text, personId: dept.ownerId })] } : x)) }));
    setTodoText("");
  };
  const todos = [...dept.todos].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || "9999").localeCompare(b.due || "9999"));
  return (
    <aside className="cn-panel cx-panel--wide" aria-label={t("Department")}>
      <div className="cn-panel__head">
        <span className="ts-label">{t("Department")}</span>
        <span className="ts-spacer" />
        <Button variant="ghost" iconOnly icon="x" aria-label={t("Close")} onClick={() => useUi.getState().select("dept", null)} />
      </div>
      <div className="cn-panel__body">
        <input id="cn-dept-name" className="ts-input cn-input--big" value={dept.name} aria-label={t("Name")} onChange={(e) => patchDept(dept.id, { name: e.currentTarget.value }, "name")} onBlur={(e) => !e.currentTarget.value.trim() && patchDept(dept.id, { name: t("Department") }, "name")} />
        <div className="ts-field">
          <span className="ts-label">{t("Traffic light")}</span>
          <StatusLightPicker value={dept.light} onChange={(v) => patchDept(dept.id, { light: v }, "light")} labels={lightLabels(t)} ariaLabel={t("Traffic light")} />
        </div>
        <label className="ts-field">
          <span className="ts-label">{t("In charge")}</span>
          <select className="ts-select" value={dept.ownerId} onChange={(e) => patchDept(dept.id, { ownerId: e.currentTarget.value }, "owner")}>
            <option value="">–</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="ts-field">
          <span className="ts-label">{t("Things to do")}</span>
          <div className="cx-todos">
            {todos.map((x) => {
              const dl = dueLabel(t, x.due, today);
              const rep = x.reportId ? reports.find((r) => r.id === x.reportId) : null;
              return (
                <div key={x.id} className={`cx-todo${x.done ? " is-done" : ""}`}>
                  <input type="checkbox" checked={x.done} aria-label={t("Done")} onChange={(e) => patchTodo(dept.id, x.id, { done: e.currentTarget.checked }, "done")} />
                  <div className="cx-todo__main">
                    <input className="cx-todo__text" value={x.text} aria-label={t("Thing to do")} onChange={(e) => patchTodo(dept.id, x.id, { text: e.currentTarget.value }, "text")} />
                    <div className="cx-todo__meta">
                      <select className="cx-todo__sel" value={x.personId} aria-label={t("Who")} onChange={(e) => patchTodo(dept.id, x.id, { personId: e.currentTarget.value }, "person")}>
                        <option value="">{t("Nobody")}</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <input type="date" className={`cx-todo__date${!x.done && dl.tone ? ` cx-tone--${dl.tone}` : ""}`} value={x.due} aria-label={t("Deadline")} onChange={(e) => patchTodo(dept.id, x.id, { due: e.currentTarget.value }, "due")} />
                      {rep ? <span className="cx-tag">{t("from the report of {d}", { d: dayShort(rep.day) })}</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="cx-mini"
                    title={t("Delete")}
                    onClick={() => changeD((d) => ({ ...d, list: d.list.map((y) => (y.id === dept.id ? { ...y, todos: y.todos.filter((z) => z.id !== x.id) } : y)) }))}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <input className="ts-input" value={todoText} placeholder={t("New thing to do (Enter)")} onChange={(e) => setTodoText(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && addTodo()} onBlur={addTodo} />
        </div>
        <div className="ts-field">
          <span className="ts-label">{t("Links and files")}</span>
          {dept.links.map((l) => (
            <div key={l.id} className="cx-inline">
              <Icon name="link" size={13} />
              <input className="ts-input" value={l.label} placeholder={t("Name")} onChange={(e) => patchDept(dept.id, { links: dept.links.map((y) => (y.id === l.id ? { ...y, label: e.currentTarget.value } : y)) }, `link-${l.id}`)} />
              <input className="ts-input" value={l.url} placeholder={t("A file or a web address")} onChange={(e) => patchDept(dept.id, { links: dept.links.map((y) => (y.id === l.id ? { ...y, url: e.currentTarget.value } : y)) }, `url-${l.id}`)} />
              {isTauri && !/^https?:/i.test(l.url) && l.url ? (
                <button type="button" className="cx-mini" title={t("Show")} onClick={() => void api.revealInFolder(l.url).catch(() => useUi.getState().showToast(t("The file is not there any more."), "error"))}>
                  <Icon name="folder" size={12} />
                </button>
              ) : null}
              <button type="button" className="cx-mini" title={t("Delete")} onClick={() => patchDept(dept.id, { links: dept.links.filter((y) => y.id !== l.id) }, "links")}>
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          <Button variant="sm" icon="plus" onClick={() => patchDept(dept.id, { links: [...dept.links, { id: uid(), label: "", url: "" }] }, "links+")}>
            {t("Add a link or a file")}
          </Button>
        </div>
        <div className="ts-field">
          <span className="ts-label">{t("Comments")}</span>
          {dept.comments.map((c) => (
            <div key={c.id} className="cx-comment">
              <span className="cx-sub mono">{atLabel(c.at)}</span>
              <span>{c.text}</span>
            </div>
          ))}
          <textarea
            className="ts-input cn-textarea"
            rows={2}
            value={comment}
            placeholder={t("Write a comment (Ctrl Enter)")}
            onChange={(e) => setComment(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && comment.trim()) {
                patchDept(dept.id, { comments: [...dept.comments, { id: uid(), at: nowKey(), text: comment.trim() }] }, "comment");
                setComment("");
              }
            }}
          />
        </div>
      </div>
      <div className="cn-panel__foot">
        <Button
          variant="danger"
          icon="trash"
          onClick={() =>
            useUi.getState().ask({
              title: t("Delete {name}?", { name: dept.name }),
              text: t("Its things to do, links, comments and report notes go with it."),
              action: t("Delete"),
              run: () => {
                changeD((d) => deleteDepartment(d, dept.id));
                useUi.getState().select("dept", null);
              },
            })
          }
        >
          {t("Delete")}
        </Button>
      </div>
    </aside>
  );
}

