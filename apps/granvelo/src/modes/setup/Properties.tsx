import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon, Segmented, Switch, confirmYesNo } from "@theatre-suite/ui";
import { FixtureSymbol } from "../../common/FixtureSymbol";
import { addressProblems, nextFreeAddress, numberInRow } from "../../model/addresses";
import { FIXTURE_TYPES, fixtureType } from "../../model/fixtureTypes";
import {
  addTruss,
  changeFixtureTypes,
  channelsCustomised,
  giveFirstFreeAddress,
  nextTrussSpot,
  resetAim,
  setAim,
  setBeamAngle,
  setFixtureAddress,
  setFixtureNumber,
  setMount,
  setPosition,
  setUnused,
  trussesInOrder,
  updateFixtures,
} from "../../model/ops";
import type { Fixture, FixtureTypeId, GranveloDoc, Id } from "../../model/types";
import { fmtAddress } from "../../lib/format";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";
import { deleteLights, duplicateLights, warnNewProblems } from "./actions";
import { ChannelsEditor } from "./ChannelsEditor";
import { FieldNumber, Section, channelRange, common, conflictSentences, lightName, symbolRotation, trussName, useSelectedIds } from "./common";

/** Edits the document and says in a toast if the change made lights collide. */
function useEdit() {
  const t = useT();
  return (recipe: (d: GranveloDoc) => GranveloDoc, key?: string) => {
    const before = useDoc.getState().doc!;
    useDoc.getState().change(recipe, key);
    const after = useDoc.getState().doc!;
    if (after !== before) warnNewProblems(t, before, after);
  };
}

export function Properties() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const ids = useSelectedIds();
  const scroller = useRef<HTMLElement>(null);
  const idKey = ids.join(",");
  // A new selection starts from the top of the panel.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [idKey]);
  const fixtures = useMemo(() => ids.map((id) => doc.fixtures.find((f) => f.id === id)).filter((f): f is Fixture => !!f), [doc, ids]);
  return (
    <aside ref={scroller} className="gv-props gv-su-props" aria-label={t("Properties of the light")}>
      {fixtures.length === 0 ? <NoSelection count={doc.fixtures.length} /> : <Body key={fixtures.length === 1 ? fixtures[0].id : "many"} fixtures={fixtures} doc={doc} />}
    </aside>
  );
}

function NoSelection({ count }: { count: number }) {
  const t = useT();
  return (
    <div className="gv-su-none">
      <span className="gv-su-none__icon" aria-hidden="true">
        <Icon name="sliders" size={22} />
      </span>
      <h3 className="gv-su-none__title">{count === 0 ? t("Nothing to edit yet") : t("Select a light")}</h3>
      <p className="gv-su-none__text">{count === 0 ? t("When you add lights, their type, address, position and channels appear here.") : t("Click a light in the list to edit its type, address, position and channels. Select several (Ctrl or Shift click) to change them together.")}</p>
      {count > 0 ? (
        <ul className="gv-su-keys">
          <li>
            <kbd className="ts-kbd">Ctrl A</kbd> {t("select all")}
          </li>
          <li>
            <kbd className="ts-kbd">F2</kbd> {t("rename")}
          </li>
          <li>
            <kbd className="ts-kbd">Ctrl D</kbd> {t("duplicate")}
          </li>
          <li>
            <kbd className="ts-kbd">Del</kbd> {t("delete")}
          </li>
        </ul>
      ) : null}
    </div>
  );
}

function Body({ fixtures, doc }: { fixtures: Fixture[]; doc: GranveloDoc }) {
  const t = useT();
  const edit = useEdit();
  const ids = fixtures.map((f) => f.id);
  const one = fixtures.length === 1 ? fixtures[0] : null;
  const typeId = common(fixtures, (f) => f.typeId);
  const sym = fixtureType(typeId ?? fixtures[0].typeId);
  const problems = useMemo(() => addressProblems(doc), [doc]);
  const unusedAll = fixtures.every((f) => f.unused);
  const unusedSome = fixtures.some((f) => f.unused);

  const changeType = async (next: FixtureTypeId) => {
    const custom = fixtures.filter((f) => f.typeId !== next && channelsCustomised(f));
    if (custom.length > 0) {
      const ok = await confirmYesNo({
        title: t("Change the type?"),
        message: custom.length === 1 ? t("You changed the channels of this light. With another type they go back to the standard ones of that type.") : t("You changed the channels of {n} of these lights. With another type they go back to the standard ones of that type.", { n: custom.length }),
        confirm: t("Change the type"),
        cancel: t("Cancel"),
        close: t("Close"),
      });
      if (!ok) return;
    }
    edit((d) => changeFixtureTypes(d, ids, next));
  };

  return (
    <div className="gv-propsbox gv-su-box">
      <div className="gv-propsbox__head">
        <FixtureSymbol kind={sym.symbol} state={unusedAll ? "unused" : "normal"} rotate={one ? symbolRotation(one) : 180} size={36} fixture={one ?? undefined} />
        <div style={{ minWidth: 0 }}>
          <div className="gv-propsbox__title ts-ellipsis">{one ? `${one.number} · ${lightName(t, one)}` : t("{n} lights selected", { n: fixtures.length })}</div>
          <div className="ts-muted ts-ellipsis">{typeId ? t(fixtureType(typeId).name) : t("Different types")}</div>
        </div>
      </div>

      {unusedSome ? (
        <div className="gv-note">
          <Icon name="eyeOff" size={13} />
          {one ? t("Not used in this production: it stays in the drawing and keeps its address, but sends nothing.") : t("Some of these lights are not used in this production.")}
        </div>
      ) : null}
      {fixtures.some((f) => f.broken) ? (
        <div className="gv-note gv-note--stop">
          <Icon name="alert" size={13} /> <span className="gv-su-note__text">{t("Marked as not working by the light check.")}</span>
          <Button variant="sm" icon="check" onClick={() => edit((d) => updateFixtures(d, ids, { broken: false }))}>
            {fixtures.length === 1 ? t("Remove the mark") : t("Remove the marks")}
          </Button>
        </div>
      ) : null}

      <Section title={t("This light")}>
        <div className="gv-su-grid2">
          <label className="gv-su-f gv-su-f--wide">
            <span className="ts-label">{t("Name")}</span>
            <NameField fixtures={fixtures} onCommit={(name) => edit((d) => updateFixtures(d, ids, { name }), `name:${ids.join(",")}`)} />
          </label>
          {one ? (
            <label className="gv-su-f">
              <span className="ts-label">{t("Number")}</span>
              <FieldNumber
                value={one.number}
                min={1}
                max={99999}
                integer
                label={t("Number of the light")}
                onCommit={(n) => {
                  const next = setFixtureNumber(useDoc.getState().doc!, one.id, n);
                  if (!next) useUi.getState().showToast(t("Another light already has number {n}.", { n }), "error");
                  else useDoc.getState().change(() => next);
                }}
              />
            </label>
          ) : null}
        </div>
        <label className="gv-su-f">
          <span className="ts-label">{t("Type")}</span>
          <select className="ts-select" aria-label={t("Type of light")} value={typeId ?? ""} onChange={(e) => void changeType(e.currentTarget.value as FixtureTypeId)}>
            {typeId === null ? (
              <option value="" disabled>
                {t("Different types")}
              </option>
            ) : null}
            {FIXTURE_TYPES.map((ft) => (
              <option key={ft.id} value={ft.id}>
                {t(ft.name)}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title={t("DMX address")} hint={t("The DMX address is the number you set on the keypad behind the light.")}>
        {one ? <AddressOne f={one} doc={doc} edit={edit} /> : <AddressMany fixtures={fixtures} doc={doc} edit={edit} problemCount={fixtures.filter((f) => problems.conflicts.has(f.id) || problems.outOfRange.has(f.id)).length} />}
      </Section>

      <Section title={t("Position")}>
        <PositionFields fixtures={fixtures} doc={doc} edit={edit} />
      </Section>

      <Section title={t("Beam and aim")}>
        <div className="gv-su-beam">
          <span className="ts-label">{t("Beam")}</span>
          <FieldNumber value={common(fixtures, (f) => f.beam.angle)} min={0} max={180} decimals={1} unit="°" label={t("Beam angle in degrees")} onCommit={(a) => edit((d) => setBeamAngle(d, ids, a), `beam:${ids.join(",")}`)} />
          <span className="ts-field__hint">{t("How wide the light opens, in degrees.")}</span>
        </div>
        <div className="gv-su-aim">
          <span className="ts-label">{t("Points at")}</span>
          <div className="gv-su-xyz">
            {(["x", "y", "z"] as const).map((axis) => (
              <label key={axis} className="gv-su-xyz__f">
                <span className="gv-su-xyz__axis">{axis.toUpperCase()}</span>
                <FieldNumber value={common(fixtures, (f) => f.aim[axis])} min={-1000} max={1000} unit="m" label={`${t("Points at")} ${axis.toUpperCase()}`} onCommit={(v) => edit((d) => setAim(d, ids, { [axis]: v }), `aim:${ids.join(",")}:${axis}`)} />
              </label>
            ))}
          </div>
        </div>
        <div className="gv-su-aimfoot">
          <span className="ts-field__hint">{t("Or drag the handle on the stage with the Aim tool.")}</span>
          <Button variant="sm" icon="reset" title={t("Point again where a light in this place usually points")} onClick={() => edit((d) => resetAim(d, ids))}>
            {t("Default aim")}
          </Button>
        </div>
      </Section>

      <Section title={t("Channels")}>
        {one ? <ChannelsEditor f={one} /> : <p className="gv-su-hint">{t("Select a single light to see and change the order and function of its channels.")}</p>}
      </Section>

      <Section title={t("In this production")}>
        <div className="gv-su-switch">
          <Switch checked={unusedAll} label={t("Not used in this production")} onChange={(v) => edit((d) => setUnused(d, ids, v))} />
          <div>
            <div className="gv-su-switch__title">{t("Not used in this production")}</div>
            <div className="gv-su-switch__text">{t("It stays in the drawing, in grey, and keeps its addresses, but sends nothing.")}</div>
          </div>
        </div>
      </Section>

      <div className="gv-su-foot">
        <Button variant="sm" icon="duplicate" onClick={() => duplicateLights(t, ids)}>
          {t("Duplicate")}
        </Button>
        <Button variant="sm" icon="trash" onClick={() => void deleteLights(t, ids)}>
          {t("Delete")}
        </Button>
      </div>
    </div>
  );
}

function NameField({ fixtures, onCommit }: { fixtures: Fixture[]; onCommit: (name: string) => void }) {
  const t = useT();
  const shared = common(fixtures, (f) => f.name);
  const [text, setText] = useState(shared ?? "");
  const [seen, setSeen] = useState(shared);
  if (seen !== shared) {
    setSeen(shared);
    setText(shared ?? "");
  }
  return (
    <input
      className="ts-input"
      value={text}
      aria-label={t("Name of the light")}
      placeholder={shared === null ? t("different values") : t(fixtureType(fixtures[0].typeId).name)}
      onChange={(e) => {
        setText(e.currentTarget.value);
      }}
      onBlur={() => text !== (shared ?? "") && (shared !== null || text !== "") && onCommit(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        else if (e.key === "Escape") {
          setText(shared ?? "");
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

type Edit = ReturnType<typeof useEdit>;

function AddressOne({ f, doc, edit }: { f: Fixture; doc: GranveloDoc; edit: Edit }) {
  const t = useT();
  const sentences = conflictSentences(t, doc, f);
  const free = nextFreeAddress(doc, f.channels.length, 1, [f.id]);
  return (
    <>
      <div className="gv-su-addr">
        <FieldNumber value={f.address} min={1} max={512} integer pad placeholder={t("none")} label={t("DMX address")} className="gv-num--addr" onCommit={(a) => edit((d) => setFixtureAddress(d, f.id, a))} />
        <Button variant="sm" icon="search" disabled={free === null || free === f.address} title={free === null ? t("There is no free place for this light") : undefined} onClick={() => edit((d) => giveFirstFreeAddress(d, f.id))}>
          {t("First free address")}
        </Button>
        {f.address !== null ? (
          <Button variant="ghost" iconOnly icon="x" aria-label={t("Remove the address")} title={t("Remove the address")} onClick={() => edit((d) => setFixtureAddress(d, f.id, null))} />
        ) : null}
      </div>
      {f.address === null ? (
        <p className="gv-su-hint">{t("No address yet: the light does not receive anything.")}</p>
      ) : (
        <p className="gv-su-hint">
          {f.channels.length === 1 ? t("Channel occupied") : t("Channels occupied")} <b className="gv-su-mono">{channelRange(f)}</b> · {f.channels.length === 1 ? t("1 channel") : t("{n} channels", { n: f.channels.length })}
        </p>
      )}
      {sentences.length > 0 ? (
        <ul className="gv-su-warn" role="alert">
          {sentences.map((s) => (
            <li key={s}>
              <Icon name="alert" size={13} />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function AddressMany({ fixtures, doc, edit, problemCount }: { fixtures: Fixture[]; doc: GranveloDoc; edit: Edit; problemCount: number }) {
  const t = useT();
  const ids = fixtures.map((f) => f.id);
  const firstAddr = Math.min(...fixtures.map((f) => f.address ?? 9999));
  const [start, setStart] = useState(firstAddr <= 512 ? firstAddr : (nextFreeAddress(doc, 1) ?? 1));
  const r = useMemo(() => numberInRow(doc, ids, start), [doc, ids.join(","), start]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = r.doc.fixtures.filter((f) => ids.includes(f.id) && !r.notFitting.includes(f.id));
  const end = last.length ? Math.max(...last.map((f) => (f.address ?? 0) + f.channels.length - 1)) : start;
  return (
    <>
      <div className="gv-su-addr">
        <span className="ts-label gv-su-addr__lab">{t("Number in a row from")}</span>
        <FieldNumber value={start} min={1} max={512} integer pad label={t("First address")} className="gv-num--addr" onCommit={setStart} />
        <Button
          variant="sm"
          icon="listNum"
          onClick={() => {
            edit((d) => numberInRow(d, ids, start).doc);
            if (r.notFitting.length) useUi.getState().showToast(r.notFitting.length === 1 ? t("1 light did not fit before channel 512 and kept its address.") : t("{n} lights did not fit before channel 512 and kept their address.", { n: r.notFitting.length }), "error");
          }}
        >
          {t("Number")}
        </Button>
      </div>
      <p className="gv-su-hint">{t("In the order of the list, each light right after the channels of the previous one: channels {a}–{b}.", { a: fmtAddress(start), b: fmtAddress(Math.min(512, end)) })}</p>
      {r.notFitting.length > 0 ? (
        <p className="gv-su-warn gv-su-warn--p">
          <Icon name="alert" size={13} />
          <span>{r.notFitting.length === 1 ? t("1 light does not fit before channel 512.") : t("{n} lights do not fit before channel 512.", { n: r.notFitting.length })}</span>
        </p>
      ) : null}
      {problemCount > 0 ? (
        <p className="gv-su-warn gv-su-warn--p" role="alert">
          <Icon name="alert" size={13} />
          <span>{problemCount === 1 ? t("1 of these lights has an address problem.") : t("{n} of these lights have an address problem.", { n: problemCount })}</span>
        </p>
      ) : null}
    </>
  );
}

const AXES = ["x", "y", "z"] as const;

/** The axes in words (10_granvelo.md): X from left to right seen from the audience, Y depth, Z height. */
function axisWords(t: ReturnType<typeof useT>, axis: "x" | "y" | "z"): string {
  if (axis === "x") return t("from left to right, seen from the audience");
  if (axis === "y") return t("depth from the front edge of the stage");
  return t("height above the stage floor");
}

function PositionFields({ fixtures, doc, edit }: { fixtures: Fixture[]; doc: GranveloDoc; edit: Edit }) {
  const t = useT();
  const ids = fixtures.map((f) => f.id);
  const kind = common(fixtures, (f) => f.mount.kind);
  const trussId = common(fixtures, (f) => (f.mount.kind === "truss" ? f.mount.trussId : ""));
  const onTruss = fixtures.every((f) => f.mount.kind === "truss");
  const trusses = trussesInOrder(doc);

  const hang = (id: Id | "new") =>
    edit((d) => {
      let target = id;
      let out = d;
      if (id === "new") {
        const made = addTruss(d, nextTrussSpot(d));
        out = made.doc;
        target = made.id;
      }
      return setMount(out, ids, { kind: "truss", trussId: target });
    });

  return (
    <>
      <Segmented<"truss" | "floating" | "floor">
        ariaLabel={t("Where the light is")}
        small
        value={(kind ?? "") as "truss"}
        onChange={(k) => {
          if (k === "truss") hang(trusses.find((tr) => tr.id === trussId)?.id ?? trusses[0]?.id ?? "new");
          else edit((d) => setMount(d, ids, { kind: k }));
        }}
        options={[
          { value: "truss", label: t("On a truss") },
          { value: "floating", label: t("Floating") },
          { value: "floor", label: t("On the floor") },
        ]}
      />
      {onTruss ? (
        <select className="ts-select" aria-label={t("Which truss")} value={trussId ?? ""} onChange={(e) => hang(e.currentTarget.value)}>
          {trussId === null ? (
            <option value="" disabled>
              {t("Different trusses")}
            </option>
          ) : null}
          {trusses.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {trussName(t, doc, tr.id)}
            </option>
          ))}
          <option value="new">{t("A new truss")}</option>
        </select>
      ) : null}
      <div className="gv-su-pos">
        {AXES.map((axis) => {
          const label = axis.toUpperCase();
          const w = axisWords(t, axis);
          const locked = onTruss && axis !== "x";
          return (
            <div key={axis} className="gv-su-pos__row">
              <span className="gv-su-pos__axis">{label}</span>
              <FieldNumber
                value={common(fixtures, (f) => f.position[axis])}
                min={-1000}
                max={1000}
                unit="m"
                disabled={locked}
                title={locked ? t("It follows the truss: change it in the list of lights") : undefined}
                label={`${label} ${w}`}
                onCommit={(v) => edit((d) => setPosition(d, ids, { [axis]: v }), `pos:${ids.join(",")}:${axis}`)}
              />
              <span className="gv-su-pos__words">{w}</span>
            </div>
          );
        })}
      </div>
      {onTruss ? <p className="gv-su-hint">{t("On a truss, depth and height are those of the truss: change them in the list of lights (pencil next to the truss name).")}</p> : null}
    </>
  );
}
