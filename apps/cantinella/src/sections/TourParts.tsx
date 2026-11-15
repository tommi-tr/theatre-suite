import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon, MoneyField } from "@theatre-suite/ui";
import { printDoc } from "../lib/exports";
import { dayLabel, dayShort, durationLabel, todayKey } from "../model/rehearsals";
import { shortNames } from "../model/scenes";
import { GEAR_GROUPS, meters, tourSummary, venueCosts, venueIncome, type GearGroup, type TechSheet, type Trip, type Venue } from "../model/tour";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { euro } from "./budgetCommon";
import { addVenue, changeT, cmToText, currentVenue, GEAR_LABELS, patchVenue, sortVenues, textToCm, uid, VENUE_PILL, VENUE_STATE_LABELS } from "./tourCommon";

const patchSheet = (patch: Partial<TechSheet>, key: string) => changeT((x) => ({ ...x, sheet: { ...x.sheet, ...patch } }), `sheet.${key}`);

function VenuePicker({ value, onChange, only }: { value: string; onChange: (id: string) => void; only?: (v: Venue) => boolean }) {
  const t = useT();
  const vs = useDoc((s) => s.data.tour.venues);
  return (
    <select className="ts-select cx-perfsel" value={value} aria-label={t("Venue")} onChange={(e) => onChange(e.currentTarget.value)}>
      {sortVenues(vs)
        .filter((v) => !only || only(v))
        .map((v) => (
          <option key={v.id} value={v.id}>
            {v.day ? dayShort(v.day) : t("no date")} · {v.theatre || t("Venue")}
            {v.city ? `, ${v.city}` : ""}
          </option>
        ))}
    </select>
  );
}

function NoVenues() {
  const t = useT();
  return (
    <div className="cn-empty">
      <span className="cn-empty__icon">
        <Icon name="truck" size={26} />
      </span>
      <h2>{t("No venues yet")}</h2>
      <p>{t("Add the dates of the tour in Venues first.")}</p>
      <div className="cn-empty__actions">
        <Button variant="primary" icon="plus" onClick={() => addVenue(t)}>
          {t("Add a venue")}
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Technical sheet ---------------- */

export function TechSheetActions() {
  const t = useT();
  const sheet = useDoc((s) => s.data.tour.sheet);
  const show = useDoc((s) => s.show);
  return (
    <Button
      variant="primary"
      icon="printer"
      onClick={() =>
        printDoc({
          title: t("Technical sheet"),
          subtitle: show?.title,
          blocks: [
            {
              heading: t("Stage"),
              lines: [
                `${t("Width")}: ${sheet.width ? meters(sheet.width) : "–"} · ${t("Depth")}: ${sheet.depth ? meters(sheet.depth) : "–"} · ${t("Height")}: ${sheet.height ? meters(sheet.height) : "–"}`,
                `${t("Set-up")}: ${durationLabel(sheet.setupMinutes)} · ${t("Strike")}: ${durationLabel(sheet.strikeMinutes)} · ${t("Crew needed")}: ${sheet.crew}`,
              ],
            },
            { heading: t("What the show needs"), lines: sheet.needs.map((n) => `• ${n.text}`) },
            ...(sheet.notes.trim() ? [{ heading: t("Notes"), lines: sheet.notes.split("\n") }] : []),
          ],
        })
      }
    >
      {t("Print or PDF")}
    </Button>
  );
}

export function TechSheetPart() {
  const t = useT();
  const sheet = useDoc((s) => s.data.tour.sheet);
  const [draft, setDraft] = useState("");
  const addNeed = () => {
    const text = draft.trim();
    if (!text) return;
    patchSheet({ needs: [...sheet.needs, { id: uid(), text }] }, "needs+");
    setDraft("");
  };
  const dim = (k: "width" | "depth" | "height", label: string) => (
    <label className="ts-field">
      <span className="ts-label">{label}</span>
      <span className="cx-inline">
        <input key={sheet[k]} className="ts-input mono" defaultValue={cmToText(sheet[k])} placeholder="0" onBlur={(e) => { const c = textToCm(e.currentTarget.value); if (c !== null) patchSheet({ [k]: c } as Partial<TechSheet>, k); }} />m
      </span>
    </label>
  );
  return (
    <section className="cx-page cx-page--narrow">
      <div className="cn-head">
        <h2>{t("Technical sheet")}</h2>
        <span className="ts-muted cn-head__hint">{t("One sheet for the show, compared with every theatre in Venues.")}</span>
      </div>
      <div className="cx-block">
        <span className="ts-label">{t("Minimum stage")}</span>
        <div className="cx-editor__grid">
          {dim("width", t("Width"))}
          {dim("depth", t("Depth"))}
          {dim("height", t("Height"))}
        </div>
      </div>
      <div className="cx-block">
        <span className="ts-label">{t("Times and people")}</span>
        <div className="cx-editor__grid">
          <label className="ts-field">
            <span className="ts-label">{t("Set-up (minutes)")}</span>
            <input className="ts-input mono" type="number" min={0} step={15} value={sheet.setupMinutes} onChange={(e) => patchSheet({ setupMinutes: Math.max(0, Math.round(Number(e.currentTarget.value) || 0)) }, "setup")} />
          </label>
          <label className="ts-field">
            <span className="ts-label">{t("Strike (minutes)")}</span>
            <input className="ts-input mono" type="number" min={0} step={15} value={sheet.strikeMinutes} onChange={(e) => patchSheet({ strikeMinutes: Math.max(0, Math.round(Number(e.currentTarget.value) || 0)) }, "strike")} />
          </label>
          <label className="ts-field">
            <span className="ts-label">{t("Crew needed")}</span>
            <input className="ts-input mono" type="number" min={0} value={sheet.crew} onChange={(e) => patchSheet({ crew: Math.max(0, Math.round(Number(e.currentTarget.value) || 0)) }, "crew")} />
          </label>
        </div>
      </div>
      <div className="cx-block">
        <span className="ts-label">{t("What the show needs (lights, sound, stage)")}</span>
        {sheet.needs.map((n) => (
          <div key={n.id} className="cx-note-row">
            <input className="ts-input" value={n.text} onChange={(e) => patchSheet({ needs: sheet.needs.map((x) => (x.id === n.id ? { ...x, text: e.currentTarget.value } : x)) }, `need-${n.id}`)} />
            <button type="button" className="cx-mini" title={t("Delete")} onClick={() => patchSheet({ needs: sheet.needs.filter((x) => x.id !== n.id) }, "needs-")}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        <input className="ts-input cx-note-new" value={draft} placeholder={t("For example: 12 PC 1 kW, mixer 8 channels, black masking (Enter)")} onChange={(e) => setDraft(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && addNeed()} onBlur={addNeed} />
      </div>
      <label className="ts-field">
        <span className="ts-label">{t("Notes")}</span>
        <textarea className="ts-input cn-textarea" rows={4} value={sheet.notes} onChange={(e) => patchSheet({ notes: e.currentTarget.value }, "notes")} />
      </label>
    </section>
  );
}

/* ---------------- Travel ---------------- */

export function TravelPart() {
  const t = useT();
  const vs = useDoc((s) => s.data.tour.venues);
  const people = useDoc((s) => s.data.people);
  const selId = useUi((s) => s.sel.venue ?? null);
  const v = currentVenue(vs, selId, todayKey());
  if (!v) return <NoVenues />;
  const names = shortNames(people);
  const patchTrip = (id: string, patch: Partial<Trip>, key: string) => patchVenue(v.id, { trips: v.trips.map((x) => (x.id === id ? { ...x, ...patch } : x)) }, `trip-${id}-${key}`);
  const travelling = new Set(v.trips.flatMap((x) => x.people));
  return (
    <section className="cx-page">
      <div className="cn-head">
        <h2>{t("Travel")}</h2>
        <VenuePicker value={v.id} onChange={(id) => useUi.getState().select("venue", id)} />
      </div>
      <div className="cx-rows">
        <div className="cx-row cx-row--head cx-trip">
          <span>{t("Vehicle")}</span>
          <span>{t("Who travels")}</span>
          <span className="cx-right">{t("Km")}</span>
          <span className="cx-right">{t("Fuel")}</span>
          <span className="cx-right">{t("Tolls")}</span>
          <span />
        </div>
        {v.trips.map((tr) => (
          <div key={tr.id} className="cx-row cx-trip">
            <input className="ts-input" value={tr.vehicle} placeholder={t("Car, van, train…")} onChange={(e) => patchTrip(tr.id, { vehicle: e.currentTarget.value }, "vehicle")} />
            <span className="cx-chips-inline">
              {tr.people.map((p) => (
                <button key={p} type="button" className="cn-chip" aria-pressed="true" title={t("Remove")} onClick={() => patchTrip(tr.id, { people: tr.people.filter((x) => x !== p) }, "people")}>
                  {names.get(p)} <Icon name="x" size={10} />
                </button>
              ))}
              <select className="ts-select cx-addsel" value="" aria-label={t("Add someone…")} onChange={(e) => e.currentTarget.value && patchTrip(tr.id, { people: [...tr.people, e.currentTarget.value] }, "people")}>
                <option value="">+</option>
                {people
                  .filter((p) => !travelling.has(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </span>
            <input className="ts-input mono cx-right" type="number" min={0} value={tr.km || ""} onChange={(e) => patchTrip(tr.id, { km: Math.max(0, Math.round(Number(e.currentTarget.value) || 0)) }, "km")} />
            <MoneyField value={tr.fuel} label={t("Fuel")} onChange={(c) => patchTrip(tr.id, { fuel: c }, "fuel")} />
            <MoneyField value={tr.tolls} label={t("Tolls")} onChange={(c) => patchTrip(tr.id, { tolls: c }, "tolls")} />
            <button type="button" className="cx-mini" title={t("Delete")} onClick={() => patchVenue(v.id, { trips: v.trips.filter((x) => x.id !== tr.id) }, "trips-")}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        <div className="cx-add">
          <Button variant="sm" icon="plus" onClick={() => patchVenue(v.id, { trips: [...v.trips, { id: uid(), vehicle: "", people: [], km: 0, fuel: 0, tolls: 0 }] }, "trips+")}>
            {t("Add a vehicle")}
          </Button>
          {people.length > travelling.size ? <span className="ts-field__hint">{t("{n} people of the contacts are not travelling", { n: people.length - travelling.size })}</span> : null}
        </div>
      </div>
      <div className="cx-block">
        <span className="ts-label">{t("Lodging")}</span>
        <div className="cx-inline">
          <input className="ts-input mono cx-num" type="number" min={0} value={v.rooms} aria-label={t("Rooms")} onChange={(e) => patchVenue(v.id, { rooms: Math.max(0, Math.round(Number(e.currentTarget.value) || 0)) }, "rooms")} />
          <span>{t("rooms at")}</span>
          <span className="cx-w140">
            <MoneyField value={v.roomCost} label={t("Cost of a room")} onChange={(c) => patchVenue(v.id, { roomCost: c }, "roomCost")} />
          </span>
          <span>{t("each")}</span>
        </div>
      </div>
      <div className="cx-totals">
        <div className="cx-totals__row">
          <span className="cx-totals__item">
            {t("Km")} <span className="mono">{v.trips.reduce((a, x) => a + x.km, 0)}</span>
          </span>
          <span className="ts-spacer" />
          <span className="cx-totals__item cx-sum">
            {t("Travel and lodging")} <span className="mono">{euro(venueCosts(v))}</span>
          </span>
        </div>
        <span className="cx-sub">{v.state === "confirmed" || v.state === "done" ? t("The date is confirmed: these costs are in the Budget.") : t("They go into the Budget when the date is confirmed.")}</span>
      </div>
    </section>
  );
}

/* ---------------- Gear ---------------- */

export function GearPart() {
  const t = useT();
  const tour = useDoc((s) => s.data.tour);
  const selId = useUi((s) => s.sel.venue ?? null);
  const v = currentVenue(tour.venues, selId, todayKey());
  const [draft, setDraft] = useState<Record<GearGroup, string>>({ set: "", costumes: "", props: "", tech: "" });
  const add = (g: GearGroup) => {
    const name = draft[g].trim();
    if (!name) return;
    changeT((x) => ({ ...x, gear: [...x.gear, { id: uid(), name, group: g, qty: 1 }] }));
    setDraft((d) => ({ ...d, [g]: "" }));
  };
  const out = v ? tour.gear.filter((g) => v.gear[g.id]?.out).length : 0;
  const back = v ? tour.gear.filter((g) => v.gear[g.id]?.back).length : 0;
  const tick = (id: string, k: "out" | "back", val: boolean) => v && patchVenue(v.id, { gear: { ...v.gear, [id]: { ...{ out: false, back: false }, ...v.gear[id], [k]: val } } }, `gear-${id}-${k}`);
  return (
    <section className="cx-page">
      <div className="cn-head">
        <h2>{t("Gear")}</h2>
        {v ? <VenuePicker value={v.id} onChange={(id) => useUi.getState().select("venue", id)} /> : null}
      </div>
      {v && tour.gear.length ? (
        <div className="cx-inline cx-sub">
          <span className={out === tour.gear.length ? "cx-tone--ok" : ""}>{t("Loaded {n} of {m}", { n: out, m: tour.gear.length })}</span>
          <span>·</span>
          <span className={back === tour.gear.length ? "cx-tone--ok" : ""}>{t("Back {n} of {m}", { n: back, m: tour.gear.length })}</span>
          <span className="ts-spacer" />
          <button type="button" className="cn-linkbtn" onClick={() => patchVenue(v.id, { gear: {} }, "gear-reset")}>
            {t("Clear the ticks")}
          </button>
        </div>
      ) : null}
      <div className="cx-reportgrid">
        {GEAR_GROUPS.map((g) => {
          const items = tour.gear.filter((x) => x.group === g);
          return (
            <div key={g} className="cx-reportcard">
              <span className="cx-reportcard__title">{t(GEAR_LABELS[g])}</span>
              {items.length && v ? (
                <div className="cx-gearhead cx-sub">
                  <span />
                  <span>{t("Qty")}</span>
                  <span title={t("Loaded")}>{t("Out")}</span>
                  <span title={t("Unloaded back")}>{t("Back")}</span>
                  <span />
                </div>
              ) : null}
              {items.map((it) => (
                <div key={it.id} className="cx-gearrow">
                  <input className="ts-input" value={it.name} onChange={(e) => changeT((x) => ({ ...x, gear: x.gear.map((y) => (y.id === it.id ? { ...y, name: e.currentTarget.value } : y)) }), `g-${it.id}`)} />
                  <input className="ts-input mono" type="number" min={1} value={it.qty} onChange={(e) => changeT((x) => ({ ...x, gear: x.gear.map((y) => (y.id === it.id ? { ...y, qty: Math.max(1, Math.round(Number(e.currentTarget.value) || 1)) } : y)) }), `q-${it.id}`)} />
                  {v ? (
                    <>
                      <input type="checkbox" aria-label={t("Loaded")} checked={!!v.gear[it.id]?.out} onChange={(e) => tick(it.id, "out", e.currentTarget.checked)} />
                      <input type="checkbox" aria-label={t("Unloaded back")} checked={!!v.gear[it.id]?.back} onChange={(e) => tick(it.id, "back", e.currentTarget.checked)} />
                    </>
                  ) : (
                    <>
                      <span />
                      <span />
                    </>
                  )}
                  <button type="button" className="cx-mini" title={t("Delete")} onClick={() => changeT((x) => ({ ...x, gear: x.gear.filter((y) => y.id !== it.id) }))}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
              <input
                className="ts-input cx-note-new"
                value={draft[g]}
                placeholder={t("Add (Enter)")}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setDraft((d) => ({ ...d, [g]: val }));
                }}
                onKeyDown={(e) => e.key === "Enter" && add(g)}
                onBlur={() => add(g)}
              />
            </div>
          );
        })}
      </div>
      {!v ? <p className="cx-note">{t("Add a venue to tick what is loaded and unloaded for each date.")}</p> : null}
    </section>
  );
}

/* ---------------- Summary ---------------- */

export function TourSummaryPart() {
  const t = useT();
  const tour = useDoc((s) => s.data.tour);
  if (!tour.venues.length) return <NoVenues />;
  const s = tourSummary(tour);
  const audience = tour.venues.reduce((a, v) => a + v.audience, 0);
  return (
    <section className="cx-page">
      <div className="cn-head">
        <h2>{t("Summary of the tour")}</h2>
      </div>
      <div className="cx-tiles">
        <div className="cx-tile">
          <span className="cx-tile__label">{t("Confirmed dates")}</span>
          <span className="cx-tile__value">{s.confirmed + s.done}</span>
          <span className="cx-tile__hint">{t("{n} already done", { n: s.done })}</span>
        </div>
        <div className="cx-tile">
          <span className="cx-tile__label">{t("Fees and takings")}</span>
          <span className="cx-tile__value">{euro(s.income, false)}</span>
          <span className="cx-tile__hint">{audience ? t("{n} spectators", { n: audience }) : " "}</span>
        </div>
        <div className="cx-tile">
          <span className="cx-tile__label">{t("Travel and lodging")}</span>
          <span className="cx-tile__value">{euro(s.costs, false)}</span>
          <span className="cx-tile__hint">{t("{n} km", { n: s.km })}</span>
        </div>
        <div className={`cx-tile ${s.balance >= 0 ? "cx-tile--ok" : "cx-tile--stop"}`}>
          <span className="cx-tile__label">{t("Balance")}</span>
          <span className="cx-tile__value">
            {s.balance < 0 ? "−" : ""}
            {euro(Math.abs(s.balance), false)}
          </span>
          <span className="cx-tile__hint">{t("without the costs of the production (see Budget)")}</span>
        </div>
      </div>
      <div className="cx-rows">
        <div className="cx-row cx-row--head cx-tourrow">
          <span>{t("Day")}</span>
          <span>{t("Theatre")}</span>
          <span>{t("State")}</span>
          <span className="cx-right">{t("For the company")}</span>
          <span className="cx-right">{t("Travel and lodging")}</span>
          <span className="cx-right">{t("Balance")}</span>
        </div>
        {sortVenues(tour.venues).map((v) => {
          const inc = venueIncome(v);
          const cost = venueCosts(v);
          const counts = v.state === "confirmed" || v.state === "done";
          return (
            <div key={v.id} className={`cx-row cx-tourrow cx-row--click${counts ? "" : " cx-row--dim"}`} onClick={() => (useUi.getState().select("venue", v.id), useUi.getState().go("tour", "venues"))}>
              <span className="mono">{v.day ? dayShort(v.day) : "–"}</span>
              <span className="cx-stack">
                <span className="cx-name ts-ellipsis">{v.theatre}</span>
                <span className="cx-sub">{v.city}</span>
              </span>
              <span>
                <span className={`cx-pill cx-pill--${VENUE_PILL[v.state]}`}>{t(VENUE_STATE_LABELS[v.state])}</span>
              </span>
              <span className="mono cx-right">{euro(inc, false)}</span>
              <span className="mono cx-right">{euro(cost, false)}</span>
              <span className={`mono cx-right cx-sum ${inc - cost >= 0 ? "cx-tone--ok" : "cx-tone--stop"}`}>{euro(inc - cost, false)}</span>
            </div>
          );
        })}
      </div>
      <p className="cx-note">{t("Only confirmed and done dates count in the totals.")}</p>
    </section>
  );
}

export function TourStatus() {
  const t = useT();
  const tour = useDoc((s) => s.data.tour);
  const s = tourSummary(tour);
  const next = sortVenues(tour.venues).find((v) => v.day >= todayKey() && (v.state === "confirmed" || v.state === "done"));
  return (
    <>
      <span>{t("{n} confirmed", { n: s.confirmed + s.done })}</span>
      {next ? <span>{t("Next: {day}", { day: `${dayLabel(next.day)} · ${next.theatre}` })}</span> : null}
      <span className="ts-spacer" />
      <span>{t("Balance {a}", { a: euro(s.balance, false) })}</span>
    </>
  );
}
