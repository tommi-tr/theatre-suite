import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, CopyPreview, Dialog, Icon, MoneyField, Segmented, Steps } from "@theatre-suite/ui";
import { copyText } from "../lib/api";
import { printDoc } from "../lib/exports";
import { dayLabel, dayShort, todayKey } from "../model/rehearsals";
import { shortNames } from "../model/scenes";
import { callSheet, checkSheet, DEALS, meters, SCHEDULE_KEYS, venueCosts, venueIncome, VENUE_STATES, type Have, type Venue } from "../model/tour";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { euro } from "./budgetCommon";
import { addVenue, changeT, cmToText, currentVenue, DEAL_LABELS, patchVenue, SCHEDULE_LABELS, sortVenues, textToCm, VENUE_PILL, VENUE_STATE_LABELS, VENUE_TONES } from "./tourCommon";

export function VenuesActions() {
  const t = useT();
  const [sheet, setSheet] = useState(false);
  const has = useDoc((s) => s.data.tour.venues.length > 0);
  return (
    <>
      <Button variant="ghost" icon="copy" className="cn-bl" disabled={!has} title={t("Copy the call sheet of the day")} onClick={() => setSheet(true)}>
        <span>{t("Copy the call sheet")}</span>
      </Button>
      <Button variant="primary" icon="plus" onClick={() => addVenue(t)}>
        {t("Add a venue")}
      </Button>
      {sheet ? <CallSheetDialog onClose={() => setSheet(false)} /> : null}
    </>
  );
}

function CallSheetDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const venues = useDoc((s) => s.data.tour.venues);
  const people = useDoc((s) => s.data.people);
  const selId = useUi((s) => s.sel.venue ?? null);
  const v = currentVenue(venues, selId, todayKey());
  if (!v) return null;
  const names = shortNames(people);
  const text = callSheet(v, (ids) => ids.map((i) => names.get(i)).join(", "), dayLabel);
  return (
    <Dialog title={t("Call sheet")} icon="copy" description={t("The times of the day at {theatre}, for the company.", { theatre: v.theatre })} onClose={onClose} width={560}>
      <CopyPreview
        text={text}
        copy={(s) => void copyText(s)}
        labels={{ copy: t("Copy"), copied: t("Copied") }}
        extra={
          <Button
            variant="sm"
            icon="printer"
            onClick={() => printDoc({ title: t("Call sheet"), subtitle: `${v.theatre}${v.day ? ` · ${dayLabel(v.day)}` : ""}`, blocks: [{ lines: text.split("\n").slice(1) }] })}
          >
            {t("Print")}
          </Button>
        }
      />
    </Dialog>
  );
}

export function VenuesStatus() {
  const t = useT();
  const vs = useDoc((s) => s.data.tour.venues);
  const confirmed = vs.filter((v) => v.state === "confirmed" || v.state === "done").length;
  return (
    <>
      <span>{t("{n} venues", { n: vs.length })}</span>
      <span>{t("{n} confirmed", { n: confirmed })}</span>
      <span className="ts-spacer" />
      <span>{t("The technical sheet of the show is compared with each theatre")}</span>
    </>
  );
}

export function Venues() {
  const t = useT();
  const tour = useDoc((s) => s.data.tour);
  const selId = useUi((s) => s.sel.venue ?? null);
  const today = todayKey();
  const v = currentVenue(tour.venues, selId, today);
  if (!tour.venues.length) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="truck" size={26} />
        </span>
        <h2>{t("No venues yet")}</h2>
        <p>{t("Add every date of the tour: theatre, contact, state of the negotiation and the deal. Then the day at the venue, travel and gear.")}</p>
        <div className="cn-empty__actions">
          <Button variant="primary" icon="plus" onClick={() => addVenue(t)}>
            {t("Add a venue")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="cx-split">
      <aside className="cx-side cx-side--narrow cx-side--venues">
        <span className="ts-label">{t("Venues")}</span>
        {sortVenues(tour.venues).map((x) => (
          <button key={x.id} type="button" className={`cx-listbtn cx-listbtn--venue${v?.id === x.id ? " is-on" : ""}${x.day && x.day < today ? " is-past" : ""}`} onClick={() => useUi.getState().select("venue", x.id)}>
            <span className="cx-stack">
              <span className="ts-ellipsis">{x.theatre || t("Venue")}</span>
              <span className="cx-sub">
                {x.day ? dayShort(x.day) : t("no date")}
                {x.city ? ` · ${x.city}` : ""}
              </span>
            </span>
            <span className={`cx-pill cx-pill--${VENUE_PILL[x.state]}`}>{t(VENUE_STATE_LABELS[x.state])}</span>
          </button>
        ))}
      </aside>
      {v ? <VenueEditor key={v.id} v={v} /> : null}
    </div>
  );
}

function VenueEditor({ v }: { v: Venue }) {
  const t = useT();
  const people = useDoc((s) => s.data.people);
  const sheet = useDoc((s) => s.data.tour.sheet);
  const set = (patch: Partial<Venue>, key: string) => patchVenue(v.id, patch, key);
  const check = checkSheet(sheet, v);
  const problems = check.stage.length + check.missing.length;
  const past = v.day && v.day < todayKey();
  const DIM: Record<"width" | "depth" | "height", string> = { width: t("width"), depth: t("depth"), height: t("height") };
  return (
    <section className="cx-page">
      <div className="cn-head">
        <input id="cn-venue-name" className="ts-input cn-input--big cx-titleinput" value={v.theatre} aria-label={t("Theatre")} placeholder={t("Theatre")} onChange={(e) => set({ theatre: e.currentTarget.value }, "theatre")} />
        <Steps steps={VENUE_STATES.map((s, i) => ({ label: t(VENUE_STATE_LABELS[s]), tone: VENUE_TONES[i] }))} value={VENUE_STATES.indexOf(v.state)} onChange={(i) => set({ state: VENUE_STATES[i] }, "state")} ariaLabel={t("State of the negotiation")} />
        <Button
          variant="ghost"
          iconOnly
          icon="trash"
          aria-label={t("Delete")}
          title={t("Delete")}
          onClick={() =>
            useUi.getState().ask({
              title: t("Delete {name}?", { name: v.theatre || t("this venue") }),
              text: t("The date, its day, travel and notes go with it."),
              action: t("Delete"),
              run: () => {
                changeT((x) => ({ ...x, venues: x.venues.filter((y) => y.id !== v.id) }));
                useUi.getState().select("venue", null);
              },
            })
          }
        />
      </div>
      <div className="cx-editor__grid">
        <label className="ts-field">
          <span className="ts-label">{t("Day")}</span>
          <input type="date" className="ts-input" value={v.day} onChange={(e) => set({ day: e.currentTarget.value }, "day")} />
        </label>
        <label className="ts-field">
          <span className="ts-label">{t("City")}</span>
          <input className="ts-input" value={v.city} onChange={(e) => set({ city: e.currentTarget.value }, "city")} />
        </label>
        <label className="ts-field">
          <span className="ts-label">{t("Address")}</span>
          <input className="ts-input" value={v.address} onChange={(e) => set({ address: e.currentTarget.value }, "address")} />
        </label>
        <label className="ts-field">
          <span className="ts-label">{t("Contact person")}</span>
          <select
            className="ts-select"
            value={v.contactId}
            onChange={(e) => {
              const p = people.find((x) => x.id === e.currentTarget.value);
              set({ contactId: e.currentTarget.value, contact: p ? [p.name, p.phone].filter(Boolean).join(" · ") : v.contact }, "contactId");
            }}
          >
            <option value="">{t("Not in the contacts")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ts-field cx-span2">
          <span className="ts-label">{t("Name and phone of the contact")}</span>
          <input className="ts-input" value={v.contact} placeholder={t("For example: Laura, 333 …")} onChange={(e) => set({ contact: e.currentTarget.value }, "contact")} />
        </label>
      </div>

      <div className="cx-block">
        <span className="ts-label">{t("Deal")}</span>
        <Segmented ariaLabel={t("Deal")} value={v.deal} onChange={(d) => set({ deal: d }, "deal")} options={DEALS.map((d) => ({ value: d, label: t(DEAL_LABELS[d]) }))} />
        <div className="cx-editor__grid">
          {v.deal !== "takings" ? (
            <label className="ts-field">
              <span className="ts-label">{v.deal === "fee" ? t("Fee") : v.deal === "split" ? t("Guaranteed minimum") : t("Rent of the theatre")}</span>
              <MoneyField value={v.amount} onChange={(c) => set({ amount: c }, "amount")} />
            </label>
          ) : null}
          {v.deal === "split" ? (
            <label className="ts-field">
              <span className="ts-label">{t("Percentage of the takings")}</span>
              <span className="cx-inline">
                <input className="ts-input mono" type="number" min={0} max={100} value={v.percent / 100} onChange={(e) => { const x = Number(e.currentTarget.value); if (x >= 0 && x <= 100) set({ percent: Math.round(x * 100) }, "percent"); }} />%
              </span>
            </label>
          ) : null}
          <div className="ts-field">
            <span className="ts-label">{t("For the company")}</span>
            <span className="cx-tile__value cx-tile__value--sm">{euro(venueIncome(v), false)}</span>
            <span className="cx-sub">{v.deal === "fee" ? t("the fee") : v.takings ? t("with the takings written below") : t("certain part only, until the takings are written")}</span>
          </div>
        </div>
      </div>

      <div className="cx-block">
        <span className="ts-label">{t("The theatre compared with the technical sheet")}</span>
        {!sheet.needs.length && !sheet.width && !sheet.depth && !sheet.height ? (
          <p className="cx-note">
            {t("Write the technical sheet of the show first: what it needs is checked here for every theatre.")}{" "}
            <button type="button" className="cn-linkbtn" onClick={() => useUi.getState().go("tour", "techSheet")}>
              {t("Open the technical sheet")}
            </button>
          </p>
        ) : (
          <>
            <div className="cx-inline cx-wrap">
              {(["width", "depth", "height"] as const).map((k) => {
                const field = k === "width" ? "hostWidth" : k === "depth" ? "hostDepth" : "hostHeight";
                const need = sheet[k];
                return (
                  <label key={k} className="cx-inline cx-sub">
                    {t("Stage {dim}", { dim: DIM[k] })}
                    <input className="ts-input mono cx-num" defaultValue={cmToText(v[field])} placeholder="m" onBlur={(e) => { const c = textToCm(e.currentTarget.value); if (c !== null) set({ [field]: c } as Partial<Venue>, field); }} />
                    {need ? <span className="ts-muted">({t("needed {m}", { m: meters(need) })})</span> : null}
                  </label>
                );
              })}
            </div>
            {sheet.needs.length ? (
              <div className="cx-havelist">
                {sheet.needs.map((n) => {
                  const h = v.has[n.id];
                  return (
                    <div key={n.id} className="cx-haverow">
                      <span className="ts-ellipsis">{n.text}</span>
                      <Segmented<Have | "">
                        ariaLabel={n.text}
                        value={h ?? ""}
                        onChange={(x) => {
                          const has = { ...v.has };
                          if (x) has[n.id] = x;
                          else delete has[n.id];
                          set({ has }, `has-${n.id}`);
                        }}
                        options={[
                          { value: "", label: "?" },
                          { value: "yes", label: t("They have it") },
                          { value: "bring", label: t("We bring it") },
                          { value: "no", label: t("Missing") },
                        ]}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
            {problems || check.bring.length ? (
              <div className={`cx-callout${problems ? " cx-callout--warn" : ""}`}>
                <Icon name={problems ? "alert" : "truck"} size={16} />
                <span>
                  {[
                    ...check.stage.map(([k, need, there]) => t("Stage {dim}: {need} needed, {there} there", { dim: DIM[k], need: meters(need), there: meters(there) })),
                    check.missing.length ? t("Missing: {list}", { list: check.missing.join(", ") }) : "",
                    check.bring.length ? t("To bring: {list}", { list: check.bring.join(", ") }) : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            ) : check.unknown.length ? null : (
              <p className="cx-ok">
                <Icon name="check" size={13} /> {t("The theatre has everything the show needs.")}
              </p>
            )}
          </>
        )}
      </div>

      <div className="cx-block">
        <span className="ts-label">{t("The day at the venue")}</span>
        <div className="cx-schedule">
          {SCHEDULE_KEYS.map((k) => (
            <label key={k} className="cx-schedule__item">
              <span className="cx-sub">{t(SCHEDULE_LABELS[k])}</span>
              <input type="time" className="ts-input mono" value={v.schedule[k]} onChange={(e) => set({ schedule: { ...v.schedule, [k]: e.currentTarget.value } }, `sch-${k}`)} />
            </label>
          ))}
        </div>
        <p className="cx-note">
          {t("Travel and rooms are in Travel; costs so far {a}.", { a: euro(venueCosts(v), false) })}{" "}
          <button type="button" className="cn-linkbtn" onClick={() => useUi.getState().go("tour", "travel")}>
            {t("Open Travel")}
          </button>
        </p>
      </div>

      <div className={`cx-block${past || v.state === "done" ? "" : " cx-block--muted"}`}>
        <span className="ts-label">{t("After the date")}</span>
        <div className="cx-editor__grid">
          <label className="ts-field">
            <span className="ts-label">{t("Actual takings")}</span>
            <MoneyField value={v.takings} onChange={(c) => set({ takings: c }, "takings")} />
          </label>
          <label className="ts-field">
            <span className="ts-label">{t("Audience")}</span>
            <input className="ts-input mono" type="number" min={0} value={v.audience || ""} onChange={(e) => set({ audience: Math.max(0, Math.round(Number(e.currentTarget.value) || 0)) }, "audience")} />
          </label>
          <label className="ts-field">
            <span className="ts-label">{t("SIAE box-office report")}</span>
            <input className="ts-input" value={v.siae} placeholder={t("Number, notes…")} onChange={(e) => set({ siae: e.currentTarget.value }, "siae")} />
          </label>
        </div>
        <label className="ts-field">
          <span className="ts-label">{t("Notes for next time")}</span>
          <textarea className="ts-input cn-textarea" rows={2} value={v.notes} onChange={(e) => set({ notes: e.currentTarget.value }, "notes")} />
        </label>
      </div>
    </section>
  );
}
