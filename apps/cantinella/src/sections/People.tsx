import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon, Kbd } from "@theatre-suite/ui";
import { nameKey, newPerson } from "../model/defaults";
import { PRESET_ROLES, type Person } from "../model/types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { isPreset, roleLabel, rolePlural } from "./roles";

type Filter = "all" | (typeof PRESET_ROLES)[number];

/** Search and role filter are shared by the list, the status bar and "Copy the list". */
let filterState: { query: string; role: Filter } = { query: "", role: "all" };
const listeners = new Set<() => void>();
function setFilter(patch: Partial<typeof filterState>) {
  filterState = { ...filterState, ...patch };
  listeners.forEach((l) => l());
}
function useFilter() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return filterState;
}

function matches(p: Person, query: string, role: Filter): boolean {
  if (role !== "all" && !p.roles.includes(role)) return false;
  const q = nameKey(query);
  if (!q) return true;
  const hay = nameKey([p.name, ...p.aliases, p.email, p.notes, ...p.roles].join(" ")) + " " + p.phone.replace(/\D+/g, "");
  return q.split(" ").every((w) => hay.includes(w));
}

/** People shown with the current search and filter (alphabetical). */
export function visiblePeople(people: Person[]): Person[] {
  const { query, role } = filterState;
  return people.filter((p) => matches(p, query, role)).sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
}

export function addPerson() {
  const p = newPerson("");
  useDoc.getState().change((d) => ({ ...d, people: [...d.people, p] }));
  setFilter({ query: "", role: "all" });
  useUi.getState().selectPerson(p.id);
  // The name field of the panel takes the focus when it appears.
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#cn-person-name")?.focus());
}

export function PeopleActions() {
  const t = useT();
  const count = useDoc((s) => s.data.people.length);
  return (
    <>
      <Button variant="ghost" icon="upload" className="cn-bl" title={t("Import from vCard or CSV")} onClick={() => useUi.getState().openDialog("import")}>
        <span>{t("Import…")}</span>
      </Button>
      <Button variant="ghost" icon="copy" className="cn-bl" disabled={!count} title={t("Copy the list")} onClick={() => useUi.getState().openDialog("copyList")}>
        <span>{t("Copy the list")}</span>
      </Button>
      <Button variant="primary" icon="plus" title={`${t("Add a person")} · Ctrl Shift N`} onClick={addPerson}>
        {t("Add a person")}
      </Button>
    </>
  );
}

export function PeopleStatus() {
  const t = useT();
  const people = useDoc((s) => s.data.people);
  const actors = people.filter((p) => p.roles.includes("actor")).length;
  return (
    <>
      <span>{people.length === 1 ? t("1 person") : t("{n} people", { n: people.length })}</span>
      {people.length ? <span>{actors === 1 ? t("1 actor") : t("{n} actors", { n: actors })}</span> : null}
      <span className="ts-spacer" />
      <span>
        <Kbd>Ctrl Shift N</Kbd> {t("add a person")}
      </span>
      <span>
        <Kbd>Ctrl F</Kbd> {t("search")}
      </span>
    </>
  );
}

export function People() {
  const t = useT();
  const people = useDoc((s) => s.data.people);
  const loadRev = useDoc((s) => s.loadRev);
  const selected = useUi((s) => s.personId);
  const { query, role } = useFilter();
  const searchRef = useRef<HTMLInputElement>(null);
  const list = useMemo(() => visiblePeople(people), [people, query, role]);
  const person = people.find((p) => p.id === selected) ?? null;

  useEffect(() => setFilter({ query: "", role: "all" }), [loadRev]);
  // A selected person removed by undo: close the panel.
  useEffect(() => {
    if (selected && !person) useUi.getState().selectPerson(null);
  }, [selected, person]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        addPerson();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (people.length === 0) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="addressBook" size={26} />
        </span>
        <h2>{t("The contacts are empty")}</h2>
        <p>{t("Add the people of the company: actors, direction, crew. Their names and short names will be used to recognise the replies to the rehearsal messages.")}</p>
        <div className="cn-empty__actions">
          <Button variant="primary" icon="plus" onClick={addPerson}>
            {t("Add a person")}
          </Button>
          <Button icon="upload" onClick={() => useUi.getState().openDialog("import")}>
            {t("Import from vCard or CSV")}
          </Button>
        </div>
      </div>
    );
  }

  const filters: Filter[] = ["all", ...PRESET_ROLES];
  return (
    <div className="cn-people">
      <section className="cn-people__list" aria-label={t("Contacts")}>
        <div className="cn-head">
          <h2>{t("Contacts")}</h2>
          <label className="cn-search">
            <Icon name="search" size={14} />
            <input
              ref={searchRef}
              value={query}
              placeholder={t("Search name, phone, note…")}
              aria-label={t("Search")}
              onChange={(e) => setFilter({ query: e.currentTarget.value })}
              onKeyDown={(e) => e.key === "Escape" && setFilter({ query: "" })}
            />
            {query ? (
              <button type="button" className="cn-search__clear" aria-label={t("Clear the search")} onClick={() => setFilter({ query: "" })}>
                <Icon name="x" size={12} />
              </button>
            ) : null}
          </label>
        </div>
        <div className="cn-chips" role="group" aria-label={t("Show")}>
          {filters.map((f) => {
            const n = f === "all" ? people.length : people.filter((p) => p.roles.includes(f)).length;
            return (
              <button key={f} type="button" className="cn-chip" aria-pressed={role === f} onClick={() => setFilter({ role: f })}>
                {f === "all" ? t("Everyone") : rolePlural(t, f)}
                <span className="cn-chip__n">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="cn-table" role="table" aria-label={t("Contacts")}>
          <div className="cn-row cn-row--head" role="row">
            <span role="columnheader">{t("Name")}</span>
            <span role="columnheader">{t("Roles")}</span>
            <span role="columnheader">{t("Phone")}</span>
            <span role="columnheader" className="cn-col-email">
              {t("Email")}
            </span>
          </div>
          {list.map((p) => (
            <div
              key={p.id}
              role="row"
              tabIndex={0}
              className="cn-row"
              aria-selected={p.id === selected}
              onClick={() => useUi.getState().selectPerson(p.id === selected ? null : p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  useUi.getState().selectPerson(p.id);
                } else if (e.key === "Delete") {
                  e.preventDefault();
                  useUi.getState().openDialog("deletePerson", p.id);
                } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const el = (e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null;
                  if (el?.getAttribute("tabindex") === "0") el.focus();
                }
              }}
            >
              <span role="cell" className="cn-row__name">
                <span className="ts-ellipsis">{p.name || <em className="ts-muted">{t("No name")}</em>}</span>
                {p.aliases.length ? <span className="cn-row__alias ts-ellipsis">{p.aliases.join(", ")}</span> : null}
              </span>
              <span role="cell" className="cn-row__roles">
                {p.roles.map((r) => (
                  <span key={r} className={isPreset(r) ? "cn-role" : "cn-role cn-role--free"}>
                    {roleLabel(t, r)}
                  </span>
                ))}
              </span>
              <span role="cell" className="mono ts-ellipsis">
                {p.phone}
              </span>
              <span role="cell" className="ts-ellipsis cn-col-email">
                {p.email}
              </span>
            </div>
          ))}
          {list.length === 0 ? <div className="cn-table__none">{t("Nobody matches the search.")}</div> : null}
        </div>
      </section>
      {person ? <PersonPanel key={person.id} person={person} /> : null}
    </div>
  );
}

function PersonPanel({ person }: { person: Person }) {
  const t = useT();
  const [newRole, setNewRole] = useState("");
  const [aliasText, setAliasText] = useState(person.aliases.join(", "));
  // Undo can change the person while the panel is open.
  useEffect(() => setAliasText(person.aliases.join(", ")), [person.aliases]);
  const set = (patch: Partial<Person>, key: string) =>
    useDoc.getState().change((d) => ({ ...d, people: d.people.map((p) => (p.id === person.id ? { ...p, ...patch } : p)) }), `${person.id}.${key}`);
  const toggleRole = (r: string) => set({ roles: person.roles.includes(r) ? person.roles.filter((x) => x !== r) : [...person.roles, r] }, "roles-" + r);
  const addRole = () => {
    const r = newRole.trim();
    if (r && !person.roles.includes(r)) set({ roles: [...person.roles, r] }, "roles+");
    setNewRole("");
  };
  const commitAliases = () => {
    const list = [...new Set(aliasText.split(",").map((a) => a.trim()).filter(Boolean))];
    if (list.join("\u0000") !== person.aliases.join("\u0000")) set({ aliases: list }, "aliases");
  };
  return (
    <aside className="cn-panel" aria-label={t("Person")}>
      <div className="cn-panel__head">
        <span className="ts-label">{t("Person")}</span>
        <span className="ts-spacer" />
        <Button variant="ghost" iconOnly icon="x" aria-label={t("Close")} onClick={() => useUi.getState().selectPerson(null)} />
      </div>
      <div className="cn-panel__body">
        <label className="ts-field">
          <span className="ts-label">{t("Name and surname")}</span>
          <input
            id="cn-person-name"
            className="ts-input cn-input--big"
            value={person.name}
            placeholder={t("For example: Giulia Ferri")}
            onChange={(e) => set({ name: e.currentTarget.value }, "name")}
            onBlur={(e) => !e.currentTarget.value.trim() && set({ name: t("New person") }, "name")}
          />
        </label>
        <div className="ts-field">
          <span className="ts-label">{t("Roles")}</span>
          <div className="cn-chips">
            {PRESET_ROLES.map((r) => (
              <button key={r} type="button" className="cn-chip" aria-pressed={person.roles.includes(r)} onClick={() => toggleRole(r)}>
                {person.roles.includes(r) ? <Icon name="check" size={12} /> : null}
                {roleLabel(t, r)}
              </button>
            ))}
            {person.roles
              .filter((r) => !isPreset(r))
              .map((r) => (
                <button key={r} type="button" className="cn-chip" aria-pressed="true" title={t("Remove")} onClick={() => toggleRole(r)}>
                  {r}
                  <Icon name="x" size={11} />
                </button>
              ))}
          </div>
          <input
            className="ts-input"
            value={newRole}
            placeholder={t("Another role (Enter to add): choreographer, costumes…")}
            onChange={(e) => setNewRole(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addRole()}
            onBlur={addRole}
          />
        </div>
        <label className="ts-field">
          <span className="ts-label">{t("Phone")}</span>
          <input className="ts-input mono" value={person.phone} inputMode="tel" placeholder="+39 …" onChange={(e) => set({ phone: e.currentTarget.value }, "phone")} />
        </label>
        <label className="ts-field">
          <span className="ts-label">{t("Email")}</span>
          <input className="ts-input" value={person.email} type="email" onChange={(e) => set({ email: e.currentTarget.value }, "email")} />
        </label>
        <label className="ts-field">
          <span className="ts-label">{t("Short names (aliases)")}</span>
          <input
            className="ts-input"
            value={aliasText}
            placeholder={t("Gio, Giovi, another number…")}
            onChange={(e) => setAliasText(e.currentTarget.value)}
            onBlur={commitAliases}
            onKeyDown={(e) => e.key === "Enter" && commitAliases()}
          />
          <span className="ts-field__hint">{t("How the person appears in WhatsApp messages, separated by commas. They help Cantinella recognise who writes.")}</span>
        </label>
        <label className="ts-field">
          <span className="ts-label">{t("Notes")}</span>
          <textarea className="ts-input cn-textarea" value={person.notes} rows={4} onChange={(e) => set({ notes: e.currentTarget.value }, "notes")} />
        </label>
        <p className="cn-panel__privacy">
          <Icon name="lock" size={12} />
          {t("These details stay in this file. Messages copied for the company contain only names.")}
        </p>
      </div>
      <div className="cn-panel__foot">
        <Button variant="danger" icon="trash" onClick={() => useUi.getState().openDialog("deletePerson", person.id)}>
          {t("Delete")}
        </Button>
      </div>
    </aside>
  );
}
