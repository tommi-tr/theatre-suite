import { useMemo } from "react";
import { useLang, useT, type TFunc } from "@theatre-suite/core";
import { Icon } from "@theatre-suite/ui";
import { ComingSoon } from "../common/ComingSoon";
import { FixtureSymbol, type SymbolState } from "../common/FixtureSymbol";
import { addressProblems, lastChannel, occupiedChannels, type AddressProblems } from "../model/addresses";
import { CHANNEL_INFO, channelColor, channelLabel, fixtureType } from "../model/fixtureTypes";
import { fixturesByPlace, trussOrdinal, trussesInOrder, type PlaceKey } from "../model/ops";
import type { Fixture, GranveloDoc } from "../model/types";
import { fmtAddress, fmtNum } from "../lib/format";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

/** Name of a truss: the user's, or the automatic one from its order front to back. */
export function trussName(t: TFunc, doc: GranveloDoc, trussId: string): string {
  const tr = doc.trusses.find((x) => x.id === trussId);
  if (tr?.name) return tr.name;
  return t("Truss {n}", { n: trussOrdinal(doc, trussId) });
}

function placeTitle(t: TFunc, doc: GranveloDoc, key: PlaceKey): string {
  switch (key.kind) {
    case "house":
      return t("In the house");
    case "truss":
      return trussName(t, doc, key.trussId);
    case "floatingStage":
      return t("Floating over the stage");
    default:
      return t("On the floor");
  }
}

export function symbolState(f: Fixture, problems: AddressProblems, selected: boolean): SymbolState {
  if (selected) return "selected";
  if (f.unused) return "unused";
  if (problems.conflicts.has(f.id) || problems.outOfRange.has(f.id)) return "conflict";
  return "normal";
}

/** Hung lights face down (the symbol is drawn upside down), lights on the floor face up. */
const rotationOf = (f: Fixture) => (f.mount.kind === "floor" ? 0 : 180);

/**
 * Allestimento, phase 0: the list of the lights by position, and the properties of the selected light (read
 * only). The 3D stage and the editing tools arrive with Granvelo 0.3.
 */
export function SetupMode() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const selectedId = useUi((s) => s.fixtureId);
  const problems = useMemo(() => addressProblems(doc), [doc]);
  const groups = useMemo(() => fixturesByPlace(doc), [doc]);
  const selected = doc.fixtures.find((f) => f.id === selectedId) ?? null;
  return (
    <div className="gv-setup">
      <aside className="gv-lights" aria-label={t("Lights")}>
        <div className="gv-panel__head">
          <span className="gv-panel__title">{t("Lights")}</span>
          <span className="gv-count">{doc.fixtures.length}</span>
        </div>
        {doc.fixtures.length === 0 ? (
          <p className="gv-empty">{t("No lights yet. Adding lights on the stage arrives with Granvelo 0.3.")}</p>
        ) : (
          <div className="gv-lights__scroll">
            {groups.map((g) => (
              <section key={g.key.kind === "truss" ? g.key.trussId : g.key.kind} className="gv-place">
                <h3 className="gv-place__title">
                  {placeTitle(t, doc, g.key)}
                  <span className="gv-count">{g.fixtures.length}</span>
                </h3>
                <ul className="gv-lightlist">
                  {g.fixtures.map((f) => (
                    <LightRow key={f.id} f={f} problems={problems} selected={f.id === selectedId} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </aside>
      <main className="gv-setup__stage">
        <StageSummary doc={doc} />
        <ComingSoon
          icon="stage"
          version="0.3"
          title={t("The stage in 3D")}
          about={[
            t("The stage drawn in 3D with its trusses, viewed in perspective, from above or from the front."),
            t("Lights placed with the mouse: on a truss (it snaps on), floating, or on the floor; a new truss is born when a light is left at a new depth."),
            t("Beam and aim of every light, scenery pieces, and automatic addresses by clicking the lights in order."),
          ]}
        >
          {t("Meanwhile the list on the left shows the lights of the show with their addresses: amber means two lights share a channel.")}
        </ComingSoon>
      </main>
      <aside className="gv-props" aria-label={t("Properties of the light")}>
        {selected ? <LightProps f={selected} doc={doc} problems={problems} /> : <p className="gv-empty">{t("Select a light in the list to see its type, address and channels.")}</p>}
      </aside>
    </div>
  );
}

function LightRow({ f, problems, selected }: { f: Fixture; problems: AddressProblems; selected: boolean }) {
  const t = useT();
  const type = fixtureType(f.typeId);
  const conflict = problems.conflicts.has(f.id) || problems.outOfRange.has(f.id);
  const state = symbolState(f, problems, selected);
  const label = f.name || t(type.name);
  return (
    <li>
      <button
        type="button"
        className="gv-light"
        aria-pressed={selected}
        data-unused={f.unused || undefined}
        onClick={() => useUi.getState().selectFixture(selected ? null : f.id)}
        title={f.unused ? t("Not used in this production") : conflict ? t("Address conflict") : undefined}
      >
        <span className="gv-light__num">{f.number}</span>
        <FixtureSymbol kind={type.symbol} state={state} rotate={rotationOf(f)} size={24} />
        <span className="gv-light__text">
          <span className="gv-light__name ts-ellipsis">{label}</span>
          <span className="gv-light__type ts-ellipsis">{t(type.name)}</span>
        </span>
        <span className={`gv-light__addr${conflict && !f.unused ? " gv-light__addr--conflict" : ""}`}>
          {conflict && !f.unused ? <Icon name="alert" size={12} /> : null}
          {f.address === null ? "—" : fmtAddress(f.address)}
        </span>
      </button>
    </li>
  );
}

function LightProps({ f, doc, problems }: { f: Fixture; doc: GranveloDoc; problems: AddressProblems }) {
  const t = useT();
  const lang = useLang();
  const type = fixtureType(f.typeId);
  const chans = occupiedChannels(f);
  const last = lastChannel(f);
  const others = (problems.conflicts.get(f.id) ?? []).map((id) => doc.fixtures.find((x) => x.id === id)).filter((x): x is Fixture => !!x);
  const m = (v: number) => `${fmtNum(v, lang)} m`;
  const mount = f.mount.kind === "truss" ? trussName(t, doc, f.mount.trussId) : f.mount.kind === "floor" ? t("On the floor") : t("Floating");
  return (
    <div className="gv-propsbox">
      <div className="gv-propsbox__head">
        <FixtureSymbol kind={type.symbol} state={f.unused ? "unused" : "normal"} rotate={rotationOf(f)} size={36} />
        <div style={{ minWidth: 0 }}>
          <div className="gv-propsbox__title ts-ellipsis">
            {f.number} · {f.name || t(type.name)}
          </div>
          <div className="ts-muted ts-ellipsis">{t(type.name)}</div>
        </div>
      </div>
      {f.unused ? (
        <div className="gv-note">
          <Icon name="eyeOff" size={13} /> {t("Not used in this production: it stays in the drawing and keeps its address, but sends nothing.")}
        </div>
      ) : null}
      {f.broken ? (
        <div className="gv-note gv-note--stop">
          <Icon name="alert" size={13} /> {t("Marked as not working by the light check.")}
        </div>
      ) : null}
      <dl className="gv-dl">
        <dt>{t("Address")}</dt>
        <dd>
          {f.address === null ? (
            t("None yet")
          ) : (
            <span className={others.length || problems.outOfRange.has(f.id) ? "gv-warn" : undefined}>
              {fmtAddress(f.address)}
              {chans.length > 1 ? ` – ${fmtAddress(last!)}` : ""} · {f.channels.length === 1 ? t("1 channel") : t("{n} channels", { n: f.channels.length })}
            </span>
          )}
        </dd>
        {others.length ? (
          <>
            <dt>{t("Conflict")}</dt>
            <dd className="gv-warn">{t("Shares channels with {list}", { list: others.map((o) => `${o.number} · ${o.name || t(fixtureType(o.typeId).name)}`).join(", ") })}</dd>
          </>
        ) : null}
        {problems.outOfRange.has(f.id) ? (
          <>
            <dt>{t("Out of range")}</dt>
            <dd className="gv-warn">{t("Its last channel would be {n}, beyond 512.", { n: last ?? 0 })}</dd>
          </>
        ) : null}
        <dt>{t("Position")}</dt>
        <dd>
          <span className="gv-dl__line">{mount}</span>
          <Coords v={f.position} m={m} />
        </dd>
        <dt>{t("Beam")}</dt>
        <dd>{fmtNum(f.beam.angle, lang, 1)}°</dd>
        <dt>{t("Points at")}</dt>
        <dd>
          <Coords v={f.aim} m={m} />
        </dd>
      </dl>
      <div className="ts-label gv-propsbox__sub">{t("Channels")}</div>
      <ol className="gv-chanlist">
        {f.channels.map((c, i) => {
          const l = channelLabel(c);
          return (
            <li key={i}>
              <span className="gv-chanlist__dmx">{chans[i] !== undefined ? fmtAddress(chans[i]) : "—"}</span>
              <span className="gv-swatch" style={{ background: channelColor(c.function, f.typeId) }} aria-hidden="true" />
              <span className="ts-ellipsis">{l.custom ? l.text : t(l.text)}</span>
              {l.custom ? <span className="ts-muted ts-ellipsis">{t(CHANNEL_INFO[c.function].label)}</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** X, Y, Z in metres: each value stays on one line, the line breaks only between them. */
function Coords({ v, m }: { v: { x: number; y: number; z: number }; m: (n: number) => string }) {
  return (
    <span className="gv-dl__line gv-coords">
      <span>X {m(v.x)}</span> <span>Y {m(v.y)}</span> <span>Z {m(v.z)}</span>
    </span>
  );
}

function StageSummary({ doc }: { doc: GranveloDoc }) {
  const t = useT();
  const lang = useLang();
  const n = (v: number) => fmtNum(v, lang);
  return (
    <section className="gv-stagecard">
      <div className="gv-stagecard__item">
        <span className="ts-label">{t("Stage")}</span>
        <span className="gv-stagecard__big">
          {n(doc.stage.width)} × {n(doc.stage.depth)} × {n(doc.stage.height)} m
        </span>
        <span className="ts-field__hint">{t("width × depth × height")}</span>
      </div>
      <div className="gv-stagecard__item">
        <span className="ts-label">{t("Trusses")}</span>
        <span className="gv-stagecard__big">{doc.trusses.length}</span>
        <span className="ts-field__hint ts-ellipsis">
          {doc.trusses.length ? trussesInOrder(doc).map((tr) => trussName(t, doc, tr.id)).join(" · ") : t("None yet")}
        </span>
      </div>
      <div className="gv-stagecard__item">
        <span className="ts-label">{t("Scenery")}</span>
        <span className="gv-stagecard__big">{doc.scenery.length}</span>
        <span className="ts-field__hint ts-ellipsis">{doc.scenery.length ? doc.scenery.map((s) => s.name || t("Piece")).join(" · ") : t("None yet")}</span>
      </div>
    </section>
  );
}
