import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { FixtureSymbol, type SymbolState } from "../../common/FixtureSymbol";
import { addressProblems, type AddressProblems } from "../../model/addresses";
import { fixtureType } from "../../model/fixtureTypes";
import { listGroups, listOrder, lightsOnTruss, moveTruss, renameTruss, type PlaceGroup } from "../../model/ops";
import type { Fixture, GranveloDoc, Id } from "../../model/types";
import { fmtAddress, fmtNum } from "../../lib/format";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";
import { deleteLights, deleteTruss, duplicateLights } from "./actions";
import { FieldNumber, conflictSentences, lightName, placeTitle, symbolRotation, useSelectedIds } from "./common";
import { clickLight, startNumbering } from "./numbering";
import { beginNumbering, commitNumbering, useSetup } from "./store";

export function symbolStateOf(f: Fixture, problems: AddressProblems, selected: boolean): SymbolState {
  if (f.unused) return selected ? "selected" : "unused";
  if (selected) return "selected";
  if (problems.conflicts.has(f.id) || problems.outOfRange.has(f.id)) return "conflict";
  return "normal";
}

/** The list of lights, by position, with multi-selection, keyboard, inline rename, trusses and the numbering tool. */
export function LightsList() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const selection = useSelectedIds();
  const cursor = useUi((s) => s.fixtureId);
  const numbering = useSetup((s) => s.numbering);
  const problems = useMemo(() => addressProblems(doc), [doc]);
  const groups = useMemo(() => listGroups(doc), [doc]);
  const order = useMemo(() => listOrder(doc), [doc]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the light with the cursor in view.
  useEffect(() => {
    if (!cursor) return;
    listRef.current?.querySelector(`[data-light="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, order.length]);

  const select = (e: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">, id: Id) => {
    const ui = useUi.getState();
    if (e.shiftKey && ui.anchorId && order.includes(ui.anchorId)) {
      const a = order.indexOf(ui.anchorId);
      const b = order.indexOf(id);
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      ui.setSelection(range, id, ui.anchorId);
    } else if (e.ctrlKey || e.metaKey) {
      ui.setSelection(selected.has(id) ? selection.filter((x) => x !== id) : [...selection, id], id, id);
    } else ui.setSelection([id], id, id);
  };

  const onRowClick = (e: MouseEvent, id: Id) => {
    listRef.current?.focus({ preventScroll: true });
    if (numbering) {
      numberClick(t, id);
      return;
    }
    select(e, id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input, select, textarea")) return;
    const ui = useUi.getState();
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const move = (to: number) => {
      if (order.length === 0) return;
      const i = Math.max(0, Math.min(order.length - 1, to));
      const id = order[i];
      if (e.shiftKey && ui.anchorId && order.includes(ui.anchorId)) {
        const a = order.indexOf(ui.anchorId);
        ui.setSelection(order.slice(Math.min(a, i), Math.max(a, i) + 1), id, ui.anchorId);
      } else ui.setSelection([id], id, id);
    };
    const at = ui.fixtureId ? order.indexOf(ui.fixtureId) : -1;
    if (k === "ArrowDown") {
      e.preventDefault();
      move(at < 0 ? 0 : at + 1);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      move(at < 0 ? order.length - 1 : at - 1);
    } else if (k === "Home") {
      e.preventDefault();
      move(0);
    } else if (k === "End") {
      e.preventDefault();
      move(order.length - 1);
    } else if (mod && k.toLowerCase() === "a") {
      e.preventDefault();
      ui.setSelection(order, ui.fixtureId ?? order[order.length - 1] ?? null, order[0] ?? null);
    } else if (mod && k.toLowerCase() === "d") {
      e.preventDefault();
      duplicateLights(t, selection);
    } else if (k === "Delete") {
      e.preventDefault();
      void deleteLights(t, selection);
    } else if (k === "F2") {
      e.preventDefault();
      if (ui.fixtureId) useSetup.getState().setRenaming(ui.fixtureId);
    } else if (k === "Escape") {
      if (numbering) useSetup.getState().setNumbering(null);
      else if (selection.length) ui.setSelection([]);
    }
  };

  return (
    <aside className="gv-lights gv-su-lights" aria-label={t("Lights")}>
      <div className="gv-panel__head">
        <span className="gv-panel__title">{t("Lights")}</span>
        <span className="gv-count">{doc.fixtures.length}</span>
      </div>
      {doc.fixtures.length === 0 ? (
        <EmptyList />
      ) : (
        <>
          <ListToolbar selection={selection} />
          <div
            ref={listRef}
            className="gv-lights__scroll gv-su-scroll"
            role="listbox"
            aria-multiselectable="true"
            aria-label={t("Lights")}
            aria-activedescendant={cursor ? `gv-light-${cursor}` : undefined}
            tabIndex={0}
            onKeyDown={(e) => {
              e.currentTarget.removeAttribute("data-mouse");
              onKeyDown(e);
            }}
            onMouseDown={(e) => e.currentTarget.setAttribute("data-mouse", "")}
            data-numbering={numbering ? "" : undefined}
          >
            {groups.map((g) => (
              <PlaceSection key={g.key.kind === "truss" ? g.key.trussId : g.key.kind} group={g} doc={doc} problems={problems} selected={selected} cursor={cursor} onRowClick={onRowClick} />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

/** One click of "Numera a clic" on the list. */
export function numberClick(t: ReturnType<typeof useT>, id: Id) {
  const setup = useSetup.getState();
  const state = setup.numbering;
  if (!state) return;
  const before = useDoc.getState().doc!;
  const r = clickLight(before, state, id);
  if (r.result.kind === "noRoom") {
    useUi.getState().showToast(t("There is no room left for this light before channel 512."), "error");
    return;
  }
  if (r.result.kind === "already") {
    useUi.getState().showToast(t("This light already has its address in this run."));
    return;
  }
  if (r.result.kind !== "assigned") return;
  commitNumbering(r.doc, r.state);
  useUi.getState().setSelection([id], id, id);
}

function EmptyList() {
  const t = useT();
  return (
    <div className="gv-su-empty">
      <span className="gv-su-empty__icon" aria-hidden="true">
        <Icon name="bulb" size={26} />
      </span>
      <h3 className="gv-su-empty__title">{t("No lights yet")}</h3>
      <p className="gv-su-empty__text">{t("Add the lights of your show here: type, how many and where they hang. Granvelo gives them numbers and DMX addresses.")}</p>
      <Button variant="primary" icon="plus" onClick={() => useSetup.getState().setAddOpen(true)}>
        {t("Add the first light")}
      </Button>
    </div>
  );
}

function ListToolbar({ selection }: { selection: Id[] }) {
  const t = useT();
  const numbering = useSetup((s) => s.numbering);
  const ask = useSetup((s) => s.numberingAsk);
  const [start, setStart] = useState(1);
  const none = selection.length === 0;
  const openAsk = () => {
    setStart(1);
    useSetup.getState().setNumberingAsk(true);
  };
  return (
    <div className="gv-su-tools">
      <Button variant="primary" icon="plus" className="gv-su-addbtn" onClick={() => useSetup.getState().setAddOpen(true)}>
        {t("Add light")}
      </Button>
      <div className="gv-su-tools__row">
        <Button
          variant="sm"
          icon="listNum"
          on={!!numbering || ask}
          title={t("Click the lights in order to give them consecutive addresses")}
          onClick={() => (numbering ? useSetup.getState().setNumbering(null) : ask ? useSetup.getState().setNumberingAsk(false) : openAsk())}
        >
          <span className="gv-su-tools__label">{t("Number by clicking")}</span>
        </Button>
        <Button
          variant="sm"
          icon="bulb"
          className="gv-su-checkbtn"
          disabled={!!numbering}
          aria-label={t("Light check")}
          title={t("Light check: turn on the lights one at a time and note the ones that do not work")}
          onClick={() => useUi.getState().openDialog("check")}
        >
          <span className="gv-su-tools__label">{t("Light check")}</span>
        </Button>
        <span className="ts-spacer" />
        <Button variant="ghost" iconOnly icon="duplicate" disabled={none} aria-label={t("Duplicate")} title={`${t("Duplicate")} · Ctrl D`} onClick={() => duplicateLights(t, selection)} />
        <Button variant="ghost" iconOnly icon="trash" disabled={none} aria-label={t("Delete")} title={`${t("Delete")} · Del`} onClick={() => void deleteLights(t, selection)} />
      </div>
      {ask && !numbering ? (
        <form
          className="gv-su-ask"
          onSubmit={(e) => {
            e.preventDefault();
            beginNumbering(startNumbering(start));
          }}
        >
          <span className="gv-su-ask__label">{t("First address")}</span>
          <FieldNumber value={start} onCommit={setStart} label={t("First address")} min={1} max={512} integer pad />
          <Button variant="sm" type="submit" className="gv-su-ask__go">
            {t("Start")}
          </Button>
          <p className="gv-su-ask__help">{t("Then click the lights, in the list or on the stage, one after the other: each gets the next address.")}</p>
        </form>
      ) : null}
    </div>
  );
}

function PlaceSection({
  group,
  doc,
  problems,
  selected,
  cursor,
  onRowClick,
}: {
  group: PlaceGroup;
  doc: GranveloDoc;
  problems: AddressProblems;
  selected: Set<Id>;
  cursor: Id | null;
  onRowClick: (e: MouseEvent, id: Id) => void;
}) {
  const t = useT();
  const key = group.key;
  const trussId = key.kind === "truss" ? key.trussId : null;
  const editing = useSetup((s) => s.editingTrussId) === trussId && trussId !== null;
  const ref = useRef<HTMLElement>(null);
  // A truss clicked on the stage opens its editor here: bring it into view.
  useEffect(() => {
    if (editing) ref.current?.scrollIntoView({ block: "nearest" });
  }, [editing]);
  return (
    <section ref={ref} className="gv-place gv-su-place">
      <h3 className="gv-place__title gv-su-place__title">
        <span className="ts-ellipsis">{placeTitle(t, doc, key)}</span>
        <span className="gv-count">{group.fixtures.length}</span>
        {trussId ? <TrussSummary doc={doc} trussId={trussId} editing={editing} /> : null}
      </h3>
      {trussId && editing ? <TrussEditor doc={doc} trussId={trussId} /> : null}
      {group.fixtures.length === 0 ? (
        <p className="gv-su-place__none">{t("No lights on this truss yet.")}</p>
      ) : (
        <ul className="gv-lightlist">
          {group.fixtures.map((f) => (
            <LightRow key={f.id} f={f} doc={doc} problems={problems} selected={selected.has(f.id)} cursor={cursor === f.id} onClick={onRowClick} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TrussSummary({ doc, trussId, editing }: { doc: GranveloDoc; trussId: Id; editing: boolean }) {
  const t = useT();
  const lang = useLang();
  const tr = doc.trusses.find((x) => x.id === trussId)!;
  return (
    <>
      <span className="gv-su-place__pos ts-ellipsis" title={t("Depth from the proscenium and height above the stage")}>
        Y {fmtNum(tr.y, lang)} · Z {fmtNum(tr.z, lang)} m
      </span>
      <Button
        variant="ghost"
        iconOnly
        icon="pencil"
        on={editing}
        aria-label={t("Edit the truss")}
        title={t("Edit the truss")}
        className="gv-su-place__edit"
        onClick={() => useSetup.getState().setEditingTruss(editing ? null : trussId)}
      />
    </>
  );
}

function TrussEditor({ doc, trussId }: { doc: GranveloDoc; trussId: Id }) {
  const t = useT();
  const tr = doc.trusses.find((x) => x.id === trussId)!;
  const [name, setName] = useState(tr.name ?? "");
  useEffect(() => setName(tr.name ?? ""), [tr.name]);
  const count = lightsOnTruss(doc, trussId).length;
  const commitName = () => {
    if (name.trim() !== (tr.name ?? "")) useDoc.getState().change((d) => renameTruss(d, trussId, name));
  };
  return (
    <div className="gv-su-truss">
      <label className="gv-su-truss__f gv-su-truss__f--name">
        <span className="ts-label">{t("Name")}</span>
        <input
          className="ts-input"
          value={name}
          placeholder={t("Automatic name")}
          aria-label={t("Name of the truss")}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            else if (e.key === "Escape") {
              setName(tr.name ?? "");
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
      </label>
      <label className="gv-su-truss__f">
        <span className="ts-label">{t("Depth Y")}</span>
        <FieldNumber value={tr.y} min={-50} max={200} unit="m" label={t("Depth of the truss")} onCommit={(y) => useDoc.getState().change((d) => moveTruss(d, trussId, { y }), `truss:${trussId}`)} />
      </label>
      <label className="gv-su-truss__f">
        <span className="ts-label">{t("Height Z")}</span>
        <FieldNumber value={tr.z} min={0} max={100} unit="m" label={t("Height of the truss")} onCommit={(z) => useDoc.getState().change((d) => moveTruss(d, trussId, { z }), `truss:${trussId}`)} />
      </label>
      <div className="gv-su-truss__foot">
        <span className="ts-muted">{count === 0 ? t("No lights hang here.") : count === 1 ? t("1 light hangs here.") : t("{n} lights hang here.", { n: count })}</span>
        <span className="ts-spacer" />
        <Button
          variant="sm"
          icon="trash"
          onClick={async () => {
            if (await deleteTruss(t, trussId)) useSetup.getState().setEditingTruss(null);
          }}
        >
          {t("Delete the truss")}
        </Button>
      </div>
    </div>
  );
}

function LightRow({ f, doc, problems, selected, cursor, onClick }: { f: Fixture; doc: GranveloDoc; problems: AddressProblems; selected: boolean; cursor: boolean; onClick: (e: MouseEvent, id: Id) => void }) {
  const t = useT();
  const type = fixtureType(f.typeId);
  const renaming = useSetup((s) => s.renamingId) === f.id;
  const run = useSetup((s) => s.numbering?.steps.some((x) => x.id === f.id) ?? false);
  const bad = !f.unused && (problems.conflicts.has(f.id) || problems.outOfRange.has(f.id));
  const why = bad ? [t("Address conflict"), ...conflictSentences(t, doc, f)].join("\n") : f.unused ? t("Not used in this production") : undefined;
  return (
    <li role="presentation">
      <div
        id={`gv-light-${f.id}`}
        data-light={f.id}
        role="option"
        aria-selected={selected}
        className="gv-light gv-su-row"
        data-selected={selected || undefined}
        data-cursor={cursor || undefined}
        data-unused={f.unused || undefined}
        data-run={run || undefined}
        title={why}
        onClick={(e) => onClick(e, f.id)}
        onDoubleClick={() => !useSetup.getState().numbering && useSetup.getState().setRenaming(f.id)}
      >
        <span className="gv-light__num">{f.number}</span>
        <FixtureSymbol kind={type.symbol} state={symbolStateOf(f, problems, selected)} rotate={symbolRotation(f)} size={24} fixture={f} />
        <span className="gv-light__text">
          {renaming ? <RenameField f={f} /> : <span className="gv-light__name ts-ellipsis">{lightName(t, f)}</span>}
          <span className="gv-light__type ts-ellipsis">{t(type.name)}</span>
        </span>
        <span className={`gv-light__addr${bad ? " gv-light__addr--conflict" : ""}`}>
          {bad ? <Icon name="alert" size={12} /> : null}
          {f.address === null ? "—" : fmtAddress(f.address)}
          {f.broken ? (
            <span className="gv-light__broken" role="img" aria-label={t("Marked as not working by the light check.")} title={t("Marked as not working by the light check.")}>
              <Icon name="x" size={9} strokeWidth={3.2} />
            </span>
          ) : null}
        </span>

      </div>
    </li>
  );
}

function RenameField({ f }: { f: Fixture }) {
  const t = useT();
  const [text, setText] = useState(f.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && text !== f.name) useDoc.getState().change((d) => ({ ...d, fixtures: d.fixtures.map((x) => (x.id === f.id ? { ...x, name: text } : x)) }), `name:${f.id}`);
    useSetup.getState().setRenaming(null);
    // give the keyboard back to the list
    window.setTimeout(() => document.querySelector<HTMLElement>(".gv-su-scroll")?.focus({ preventScroll: true }), 0);
  };
  return (
    <input
      ref={ref}
      className="ts-input gv-su-rename"
      aria-label={t("Name of the light")}
      placeholder={t(fixtureType(f.typeId).name)}
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
    />
  );
}
