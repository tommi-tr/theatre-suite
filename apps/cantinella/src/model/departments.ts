import { uid } from "@theatre-suite/core";
import { addDays, weekdayOf } from "./rehearsals";

/* Departments and rehearsal reports (section 3). Notifications stay inside the app. */

export type Light = "ok" | "warn" | "stop" | "info";
export const LIGHTS: Light[] = ["ok", "warn", "stop", "info"];

export interface Todo {
  id: string;
  text: string;
  personId: string;
  /** `YYYY-MM-DD` or empty. */
  due: string;
  done: boolean;
  /** Report it came from, if any. */
  reportId: string;
}

export interface DeptLink {
  id: string;
  label: string;
  /** A web address or the path of a file. */
  url: string;
}

export interface DeptComment {
  id: string;
  /** Local time `YYYY-MM-DDTHH:MM`. */
  at: string;
  text: string;
}

export interface Department {
  id: string;
  /** Preset key (`direction`, `set`…) or empty for one added by hand. */
  key: string;
  name: string;
  light: Light;
  ownerId: string;
  todos: Todo[];
  links: DeptLink[];
  comments: DeptComment[];
}

export interface ReportNote {
  id: string;
  deptId: string;
  text: string;
  /** The thing to do it became, if any. */
  todoId: string;
}

export interface Report {
  id: string;
  /** `YYYY-MM-DD` */
  day: string;
  /** Rehearsal date of the plan it refers to, if any. */
  dateId: string;
  general: string;
  notes: ReportNote[];
}

export interface Departments {
  list: Department[];
  reports: Report[];
}

/** Preset departments: key → Italian name (09_cantinella.md). */
export const PRESET_DEPARTMENTS: Array<[string, string]> = [
  ["direction", "Regia e prove"],
  ["set", "Scenografia"],
  ["lights", "Luci"],
  ["costumes", "Costumi"],
  ["makeup", "Trucco"],
  ["sound", "Musiche e suono"],
  ["promo", "Promozione"],
  ["admin", "Amministrazione"],
  ["tour", "Tournée"],
];

export function newDepartment(partial: Partial<Department> = {}): Department {
  return { id: uid(), key: "", name: "", light: "info", ownerId: "", todos: [], links: [], comments: [], ...partial };
}

export function presetDepartments(): Department[] {
  return PRESET_DEPARTMENTS.map(([key, name]) => newDepartment({ key, name }));
}

export function newDepartments(): Departments {
  return { list: [], reports: [] };
}

export function newTodo(partial: Partial<Todo> = {}): Todo {
  return { id: uid(), text: "", personId: "", due: "", done: false, reportId: "", ...partial };
}

/* ---------------- Reading (format 1) ---------------- */

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => x as Record<string, unknown>) : []);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function normalizeDepartments(raw: unknown, personIds: Set<string>, dateIds: Set<string>): Departments {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = newDepartments();
  const seen = new Set<string>();
  const id = (v: unknown) => {
    const s = str(v, 100);
    const x = s && !seen.has(s) ? s : uid();
    seen.add(x);
    return x;
  };
  const day = (v: unknown) => (DAY_RE.test(str(v, 10)) ? str(v, 10) : "");
  const person = (v: unknown) => (personIds.has(str(v, 100)) ? str(v, 100) : "");
  for (const d of list(r.list)) {
    const name = str(d.name).trim();
    if (!name) continue;
    out.list.push({
      id: id(d.id),
      key: str(d.key, 40),
      name,
      light: LIGHTS.includes(d.light as Light) ? (d.light as Light) : "info",
      ownerId: person(d.ownerId),
      todos: list(d.todos)
        .filter((t) => str(t.text, 2000).trim())
        .map((t) => ({ id: id(t.id), text: str(t.text, 2000).trim(), personId: person(t.personId), due: day(t.due), done: t.done === true, reportId: str(t.reportId, 100) })),
      links: list(d.links)
        .filter((l) => str(l.url, 2000).trim())
        .map((l) => ({ id: id(l.id), label: str(l.label).trim(), url: str(l.url, 2000).trim() })),
      comments: list(d.comments)
        .filter((c) => str(c.text, 5000).trim())
        .map((c) => ({ id: id(c.id), at: AT_RE.test(str(c.at, 16)) ? str(c.at, 16) : "", text: str(c.text, 5000).trim() })),
    });
  }
  const deptIds = new Set(out.list.map((d) => d.id));
  const todoIds = new Set(out.list.flatMap((d) => d.todos.map((t) => t.id)));
  for (const rep of list(r.reports)) {
    const dd = day(rep.day);
    if (!dd) continue;
    out.reports.push({
      id: id(rep.id),
      day: dd,
      dateId: dateIds.has(str(rep.dateId, 100)) ? str(rep.dateId, 100) : "",
      general: str(rep.general, 20000),
      notes: list(rep.notes)
        .filter((n) => deptIds.has(str(n.deptId, 100)) && str(n.text, 5000).trim())
        .map((n) => ({ id: id(n.id), deptId: str(n.deptId, 100), text: str(n.text, 5000).trim(), todoId: todoIds.has(str(n.todoId, 100)) ? str(n.todoId, 100) : "" })),
    });
  }
  // A thing to do points to its report only if the report is there.
  const reportIds = new Set(out.reports.map((x) => x.id));
  for (const d of out.list) for (const t of d.todos) if (t.reportId && !reportIds.has(t.reportId)) t.reportId = "";
  return out;
}

/* ---------------- Due dates ---------------- */

/** Last day of the week of `today` (Sunday). */
export function endOfWeek(today: string): string {
  const wd = weekdayOf(today);
  return addDays(today, wd === 0 ? 0 : 7 - wd);
}

export interface Due {
  dept: Department;
  todo: Todo;
}

/** Things to do that are overdue, and due in the next 7 days (not done). */
export function dueTodos(d: Departments, today: string): { overdue: Due[]; week: Due[] } {
  const end = addDays(today, 7);
  const overdue: Due[] = [];
  const week: Due[] = [];
  for (const dept of d.list)
    for (const todo of dept.todos) {
      if (todo.done || !todo.due) continue;
      if (todo.due < today) overdue.push({ dept, todo });
      else if (todo.due <= end) week.push({ dept, todo });
    }
  const by = (a: Due, b: Due) => a.todo.due.localeCompare(b.todo.due);
  return { overdue: overdue.sort(by), week: week.sort(by) };
}

/** Makes a note of a report a thing to do of its department (once). */
export function noteToTodo(d: Departments, reportId: string, noteId: string, due = ""): Departments {
  const rep = d.reports.find((r) => r.id === reportId);
  const note = rep?.notes.find((n) => n.id === noteId);
  if (!rep || !note || note.todoId) return d;
  const todo = newTodo({ text: note.text, due, reportId });
  return {
    list: d.list.map((x) => (x.id === note.deptId ? { ...x, todos: [...x.todos, todo] } : x)),
    reports: d.reports.map((r) => (r.id === reportId ? { ...r, notes: r.notes.map((n) => (n.id === noteId ? { ...n, todoId: todo.id } : n)) } : r)),
  };
}

/** Removes a person from owners and things to do (when deleted from the contacts). */
export function forgetPersonInDepartments(d: Departments, personId: string): Departments {
  return { ...d, list: d.list.map((x) => ({ ...x, ownerId: x.ownerId === personId ? "" : x.ownerId, todos: x.todos.map((t) => (t.personId === personId ? { ...t, personId: "" } : t)) })) };
}

/** Removes a department, its notes in the reports (things to do go with the department). */
export function deleteDepartment(d: Departments, id: string): Departments {
  return { list: d.list.filter((x) => x.id !== id), reports: d.reports.map((r) => ({ ...r, notes: r.notes.filter((n) => n.deptId !== id) })) };
}

/** The report as text, to copy for the company or the crew. Always in Italian. */
export function reportText(rep: Report, depts: Department[], dayLabel: (day: string) => string): string {
  const lines = [`Report della prova di ${dayLabel(rep.day)}`];
  if (rep.general.trim()) lines.push("", rep.general.trim());
  for (const dept of depts) {
    const notes = rep.notes.filter((n) => n.deptId === dept.id);
    if (!notes.length) continue;
    lines.push("", `${dept.name.toUpperCase()}`);
    for (const n of notes) lines.push(`- ${n.text}`);
  }
  return lines.join("\n");
}
