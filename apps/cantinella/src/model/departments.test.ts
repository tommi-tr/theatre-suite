import { describe, expect, it } from "vitest";
import { deleteDepartment, dueTodos, endOfWeek, newDepartment, newTodo, normalizeDepartments, noteToTodo, reportText, type Departments } from "./departments";

const today = "2026-11-18"; // Wednesday

function sample(): Departments {
  const luci = newDepartment({ id: "luci", name: "Luci", todos: [newTodo({ id: "t1", text: "Gelatine", due: "2026-11-16" }), newTodo({ id: "t2", text: "Puntamento", due: "2026-11-22" }), newTodo({ id: "t3", text: "Fatta", due: "2026-11-10", done: true }), newTodo({ id: "t4", text: "Dopo", due: "2026-11-23" })] });
  const costumi = newDepartment({ id: "costumi", name: "Costumi" });
  return { list: [luci, costumi], reports: [{ id: "r1", day: "2026-11-17", dateId: "", general: "Bene il primo atto.", notes: [{ id: "n1", deptId: "luci", text: "Più luce a sinistra", todoId: "" }, { id: "n2", deptId: "costumi", text: "Orlo di Ortensia", todoId: "" }] }] };
}

describe("departments", () => {
  it("knows what is overdue and what is due in the next 7 days", () => {
    expect(endOfWeek(today)).toBe("2026-11-22");
    expect(endOfWeek("2026-11-22")).toBe("2026-11-22");
    const due = dueTodos(sample(), today);
    expect(due.overdue.map((x) => x.todo.id)).toEqual(["t1"]);
    expect(due.week.map((x) => x.todo.id)).toEqual(["t2", "t4"]);
  });

  it("turns a report note into a thing to do of its department, only once", () => {
    let d = noteToTodo(sample(), "r1", "n1", "2026-11-20");
    const todo = d.list[0].todos.at(-1)!;
    expect(todo).toMatchObject({ text: "Più luce a sinistra", due: "2026-11-20", reportId: "r1" });
    expect(d.reports[0].notes[0].todoId).toBe(todo.id);
    d = noteToTodo(d, "r1", "n1");
    expect(d.list[0].todos).toHaveLength(5);
  });

  it("writes the report for the company", () => {
    const d = sample();
    expect(reportText(d.reports[0], d.list, (x) => x)).toBe("Report della prova di 2026-11-17\n\nBene il primo atto.\n\nLUCI\n- Più luce a sinistra\n\nCOSTUMI\n- Orlo di Ortensia");
  });

  it("deleting a department removes its notes in the reports", () => {
    const d = deleteDepartment(sample(), "luci");
    expect(d.list.map((x) => x.id)).toEqual(["costumi"]);
    expect(d.reports[0].notes.map((n) => n.id)).toEqual(["n2"]);
  });

  it("reads back what it wrote and drops what points nowhere", () => {
    const d = sample();
    d.list[0].ownerId = "p1";
    d.list[0].todos[0].personId = "ghost";
    const back = normalizeDepartments(JSON.parse(JSON.stringify(d)), new Set(["p1"]), new Set());
    expect(back.list[0].ownerId).toBe("p1");
    expect(back.list[0].todos[0].personId).toBe("");
    expect(back.reports[0].notes).toHaveLength(2);
    const bad = normalizeDepartments({ list: [{ name: "" }, { name: "X", light: "purple", todos: [{ text: "" }, { text: "a", due: "domani" }] }], reports: [{ day: "x" }] }, new Set(), new Set());
    expect(bad.list).toEqual([expect.objectContaining({ name: "X", light: "info", todos: [expect.objectContaining({ text: "a", due: "" })] })]);
    expect(bad.reports).toEqual([]);
  });
});
