import { useMemo, useRef, useState } from "react";
import { uid, useT, type TFunc } from "@theatre-suite/core";
import { Button, Icon, MoneyField } from "@theatre-suite/ui";
import {
  averageTicket,
  capacityOf,
  rowName,
  seatCounts,
  seatKey,
  seatState,
  sectorPrice,
  soldBySector,
  takingsOf,
  type Budget,
  type PriceRule,
  type Reduction,
  type SeatState,
  type Sector,
} from "../model/budget";
import { dayShort, sortDates, todayKey } from "../model/rehearsals";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { changeB, euro } from "./budgetCommon";

type Brush = SeatState | "free";

const STATE_LABEL: Record<Brush, string> = { free: "Free", sold: "Sold", reserved: "Reserved", comp: "Complimentary", blocked: "Blocked", limited: "Reduced view" };
/** Letter on the seat: the first letter of the word, × for blocked, nothing for free and sold. */
function seatLetter(t: TFunc, s: SeatState | null): string {
  if (!s || s === "sold") return "";
  if (s === "blocked") return "×";
  return t(STATE_LABEL[s]).charAt(0).toUpperCase();
}

const patchSector = (id: string, patch: Partial<Sector>, key: string) => changeB((b) => ({ ...b, sectors: b.sectors.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), `${id}.${key}`);
const patchReduction = (id: string, patch: Partial<Reduction>, key: string) => changeB((b) => ({ ...b, reductions: b.reductions.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), `${id}.${key}`);

export function addSector() {
  const b = useDoc.getState().data.budget;
  const first = b.sectors.length === 0;
  const s: Sector = { id: uid(), name: first ? "Platea" : `Settore ${b.sectors.length + 1}`, rows: first ? 12 : 4, perRow: first ? 20 : 16, seats: 0, level: first ? "stalls" : "upper", price: { mode: "base", value: 0 } };
  changeB((x) => ({ ...x, sectors: [...x.sectors, s] }));
}

export function SeatsActions() {
  const t = useT();
  return (
    <>
      <Button variant="ghost" icon="calendar" className="cn-bl" title={t("Add a performance")} onClick={addPerformance}>
        <span>{t("Add a performance")}</span>
      </Button>
      <Button variant="primary" icon="plus" onClick={addSector}>
        {t("Add a sector")}
      </Button>
    </>
  );
}

function addPerformance() {
  const b = useDoc.getState().data.budget;
  const last = sortDates(b.performances.map((p) => ({ ...p, minutes: 0, place: "" }))).pop();
  const day = last ? last.day : todayKey();
  const p = { id: uid(), day: last ? nextDay(day) : day, time: last?.time ?? "21:00", label: "" };
  changeB((x) => ({ ...x, performances: [...x.performances, p] }));
  useUi.getState().select("perf", p.id);
}
function nextDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

export function SeatsStatus() {
  const t = useT();
  const b = useDoc((s) => s.data.budget);
  const perf = useUi((s) => s.sel.perf ?? null);
  const cap = b.sectors.reduce((a, s) => a + capacityOf(s), 0);
  const c = seatCounts(b, perf);
  return (
    <>
      <span>{t("{n} seats", { n: cap })}</span>
      {perf ? <span>{t("{n} sold", { n: c.sold })}</span> : null}
      <span className="ts-spacer" />
      <span>{t("Click or drag over the seats to paint them")}</span>
    </>
  );
}

export function Seats() {
  const t = useT();
  const b = useDoc((s) => s.data.budget);
  const perfSel = useUi((s) => s.sel.perf ?? null);
  const perf = b.performances.some((p) => p.id === perfSel) ? perfSel : null;
  const [brush, setBrush] = useState<Brush>("sold");
  const brushes: Brush[] = perf ? ["sold", "reserved", "comp", "free"] : ["blocked", "limited", "free"];
  const active = brushes.includes(brush) ? brush : brushes[0];

  if (!b.sectors.length) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="grid" size={26} />
        </span>
        <h2>{t("No theatre yet")}</h2>
        <p>{t("Describe the theatre in sectors (stalls, gallery…): rows and seats per row draw the map by themselves; or just the number of seats. Then the prices.")}</p>
        <div className="cn-empty__actions">
          <Button variant="primary" icon="plus" onClick={addSector}>
            {t("Add a sector")}
          </Button>
        </div>
      </div>
    );
  }

  const counts = seatCounts(b, perf);
  const sold = perf ? soldBySector(b, perf) : {};
  return (
    <div className="cx-split">
      <aside className="cx-side">
        <label className="ts-field">
          <span className="ts-label">{t("Full ticket")}</span>
          <MoneyField value={b.basePrice} label={t("Full ticket")} onChange={(c) => changeB((x) => ({ ...x, basePrice: c }), "basePrice")} />
        </label>
        <div className="ts-field">
          <span className="ts-label">{t("Sectors")}</span>
          {b.sectors.map((s) => (
            <SectorEditor key={s.id} s={s} b={b} />
          ))}
          <Button variant="sm" icon="plus" onClick={addSector}>
            {t("Add a sector")}
          </Button>
        </div>
        <div className="ts-field">
          <span className="ts-label">{t("Reduced tickets")}</span>
          {b.reductions.map((r) => (
            <div key={r.id} className="cx-box">
              <div className="cx-inline">
                <input className="ts-input" value={r.name} aria-label={t("Name")} onChange={(e) => patchReduction(r.id, { name: e.currentTarget.value }, "name")} />
                <Button variant="ghost" iconOnly icon="trash" aria-label={t("Delete")} onClick={() => changeB((x) => ({ ...x, reductions: x.reductions.filter((y) => y.id !== r.id) }))} />
              </div>
              <RuleEditor rule={r.rule} allowBase={false} onChange={(rule) => patchReduction(r.id, { rule }, "rule")} />
              <label className="cx-inline cx-sub">
                {t("Expected share of the audience")}
                <input className="ts-input mono cx-num" type="number" min={0} max={100} value={r.share / 100} onChange={(e) => { const v = Number(e.currentTarget.value); if (v >= 0 && v <= 100) patchReduction(r.id, { share: Math.round(v * 100) }, "share"); }} />%
              </label>
            </div>
          ))}
          <Button variant="sm" icon="plus" onClick={() => changeB((x) => ({ ...x, reductions: [...x.reductions, { id: uid(), name: "Under 26", rule: { mode: "percent", value: 2000 }, share: 1000 }] }))}>
            {t("Add a reduction")}
          </Button>
        </div>
        <div className="ts-field">
          <span className="ts-label">{t("Performances")}</span>
          {sortDates(b.performances.map((p) => ({ ...p, minutes: 0, place: "" }))).map((p) => (
            <div key={p.id} className="cx-inline">
              <input type="date" className="ts-input" value={p.day} aria-label={t("Day")} onChange={(e) => e.currentTarget.value && changeB((x) => ({ ...x, performances: x.performances.map((q) => (q.id === p.id ? { ...q, day: e.currentTarget.value } : q)) }), `${p.id}.day`)} />
              <input type="time" className="ts-input mono" value={p.time} aria-label={t("Time")} onChange={(e) => /^\d\d:\d\d$/.test(e.currentTarget.value) && changeB((x) => ({ ...x, performances: x.performances.map((q) => (q.id === p.id ? { ...q, time: e.currentTarget.value } : q)) }), `${p.id}.time`)} />
              <Button
                variant="ghost"
                iconOnly
                icon="trash"
                aria-label={t("Delete")}
                onClick={() =>
                  useUi.getState().ask({
                    title: t("Delete the performance of {day}?", { day: dayShort(p.day) }),
                    text: t("Its seat map goes with it."),
                    action: t("Delete"),
                    run: () =>
                      changeB((x) => {
                        const seats = { ...x.seats };
                        delete seats[p.id];
                        return { ...x, performances: x.performances.filter((q) => q.id !== p.id), seats };
                      }),
                  })
                }
              />
            </div>
          ))}
          <Button variant="sm" icon="plus" onClick={addPerformance}>
            {t("Add a performance")}
          </Button>
        </div>
      </aside>
      <section className="cx-page">
        <div className="cn-head">
          <h2>{t("Theatre and seats")}</h2>
          <select className="ts-select cx-perfsel" value={perf ?? ""} aria-label={t("Performance")} onChange={(e) => useUi.getState().select("perf", e.currentTarget.value || null)}>
            <option value="">{t("Every night (blocked seats, reduced view)")}</option>
            {sortDates(b.performances.map((p) => ({ ...p, minutes: 0, place: "" }))).map((p) => (
              <option key={p.id} value={p.id}>
                {dayShort(p.day)} · {p.time}
              </option>
            ))}
          </select>
        </div>
        <div className="cx-brushes" role="radiogroup" aria-label={t("Paint the seats as")}>
          {brushes.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={active === s} className={`cx-brush${active === s ? " is-on" : ""}`} onClick={() => setBrush(s)}>
              <span className={`cx-seat cx-seat--${s}`}>{seatLetter(t, s === "free" ? null : s)}</span>
              {t(STATE_LABEL[s])}
              <span className="mono ts-muted">{counts[s]}</span>
            </button>
          ))}
          <span className="ts-spacer" />
          {perf ? (
            <span className="cx-takings">
              {t("Takings on the map")} <strong className="mono">{euro(takingsOf(b, sold), false)}</strong>
            </span>
          ) : (
            <span className="ts-muted cx-sub">{t("Choose a performance to mark sold, reserved and complimentary seats.")}</span>
          )}
        </div>
        <SeatMap b={b} perf={perf} brush={active} />
      </section>
    </div>
  );
}

function RuleEditor({ rule, allowBase, onChange }: { rule: PriceRule; allowBase: boolean; onChange: (r: PriceRule) => void }) {
  const t = useT();
  return (
    <span className="cx-inline">
      <select className="ts-select" value={rule.mode} aria-label={t("Price")} onChange={(e) => onChange({ mode: e.currentTarget.value as PriceRule["mode"], value: e.currentTarget.value === "percent" ? 1500 : rule.mode === "percent" ? 500 : rule.value })}>
        {allowBase ? <option value="base">{t("Full price")}</option> : null}
        <option value="percent">{t("− percent")}</option>
        <option value="minus">{t("− euro")}</option>
        <option value="fixed">{t("Fixed price")}</option>
      </select>
      {rule.mode === "percent" ? (
        <span className="cx-inline">
          <input className="ts-input mono cx-num" type="number" min={0} max={100} value={rule.value / 100} aria-label={t("Percent")} onChange={(e) => { const v = Number(e.currentTarget.value); if (v >= 0 && v <= 100) onChange({ ...rule, value: Math.round(v * 100) }); }} />%
        </span>
      ) : rule.mode !== "base" ? (
        <MoneyField value={rule.value} label={t("Amount")} onChange={(c) => onChange({ ...rule, value: c })} />
      ) : null}
    </span>
  );
}

function SectorEditor({ s, b }: { s: Sector; b: Budget }) {
  const t = useT();
  const price = sectorPrice(b.basePrice, s.price);
  const avg = averageTicket(b, s);
  const withMap = s.rows > 0;
  return (
    <div className="cx-box">
      <div className="cx-inline">
        <input className="ts-input cx-strong" value={s.name} aria-label={t("Sector")} onChange={(e) => patchSector(s.id, { name: e.currentTarget.value }, "name")} onBlur={(e) => !e.currentTarget.value.trim() && patchSector(s.id, { name: t("Sector") }, "name")} />
        <Button
          variant="ghost"
          iconOnly
          icon="trash"
          aria-label={t("Delete {name}", { name: s.name })}
          onClick={() =>
            useUi.getState().ask({
              title: t("Delete {name}?", { name: s.name }),
              text: t("Its seats and their states on every performance go with it."),
              action: t("Delete"),
              run: () =>
                changeB((x) => {
                  const seats: Budget["seats"] = {};
                  for (const [k, m] of Object.entries(x.seats)) seats[k] = Object.fromEntries(Object.entries(m).filter(([key]) => !key.startsWith(`${s.id}:`)));
                  return { ...x, sectors: x.sectors.filter((y) => y.id !== s.id), seats, costs: x.costs.map((c) => ({ ...c, sectors: c.sectors.filter((z) => z !== s.id) })) };
                }),
            })
          }
        />
      </div>
      <div className="cx-inline cx-sub">
        <select className="ts-select" value={s.level} aria-label={t("Level")} onChange={(e) => patchSector(s.id, { level: e.currentTarget.value as Sector["level"] }, "level")}>
          <option value="stalls">{t("Stalls level")}</option>
          <option value="upper">{t("Upper level")}</option>
        </select>
        <select className="ts-select" value={withMap ? "map" : "count"} aria-label={t("Seats")} onChange={(e) => patchSector(s.id, e.currentTarget.value === "map" ? { rows: Math.max(1, Math.ceil((s.seats || 40) / 20)), perRow: 20 } : { seats: capacityOf(s), rows: 0 }, "mode")}>
          <option value="map">{t("Rows and seats")}</option>
          <option value="count">{t("Only the number")}</option>
        </select>
      </div>
      <div className="cx-inline cx-sub">
        {withMap ? (
          <>
            <input className="ts-input mono cx-num" type="number" min={1} max={60} value={s.rows} aria-label={t("Rows")} onChange={(e) => { const v = Math.round(Number(e.currentTarget.value)); if (v >= 1 && v <= 60) patchSector(s.id, { rows: v }, "rows"); }} />
            {t("rows of")}
            <input className="ts-input mono cx-num" type="number" min={1} max={80} value={s.perRow} aria-label={t("Seats per row")} onChange={(e) => { const v = Math.round(Number(e.currentTarget.value)); if (v >= 1 && v <= 80) patchSector(s.id, { perRow: v }, "perRow"); }} />
            {t("seats")}
          </>
        ) : (
          <>
            <input className="ts-input mono cx-num" type="number" min={1} max={20000} value={s.seats} aria-label={t("Seats")} onChange={(e) => { const v = Math.round(Number(e.currentTarget.value)); if (v >= 0 && v <= 20000) patchSector(s.id, { seats: v }, "seats"); }} />
            {t("seats")}
          </>
        )}
        <span className="ts-spacer" />
        <span className="mono">{capacityOf(s)}</span>
      </div>
      <RuleEditor rule={s.price} allowBase onChange={(price) => patchSector(s.id, { price }, "price")} />
      <span className="cx-sub">
        {t("Ticket {p}", { p: euro(price) })}
        {avg !== price ? ` · ${t("average with reductions {p}", { p: euro(avg) })}` : ""}
      </span>
    </div>
  );
}

/** The seat map, drawn from the sectors: stage at the top, a central aisle, the upper level apart. */
function SeatMap({ b, perf, brush }: { b: Budget; perf: string | null; brush: Brush }) {
  const t = useT();
  const painting = useRef(false);
  const levels = useMemo(() => [b.sectors.filter((s) => s.level === "stalls"), b.sectors.filter((s) => s.level === "upper")], [b.sectors]);
  const target = perf ?? "all";
  const paint = (key: string) => {
    const cur = b.seats[target]?.[key] ?? null;
    const base = perf ? (b.seats.all?.[key] ?? null) : null;
    if (perf && base === "blocked") return; // a blocked seat is never sold
    const want = brush === "free" ? null : brush;
    if (cur === want) return;
    changeB((x) => {
      const m = { ...(x.seats[target] ?? {}) };
      if (want) m[key] = want;
      else delete m[key];
      return { ...x, seats: { ...x.seats, [target]: m } };
    }, `seats-${target}`);
  };
  const onSeat = (e: React.PointerEvent) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-seat]")?.dataset.seat;
    if (key) paint(key);
  };
  return (
    <div
      className="cx-map"
      onPointerDown={(e) => {
        painting.current = true;
        onSeat(e);
      }}
      onPointerOver={(e) => painting.current && e.buttons === 1 && onSeat(e)}
      onPointerUp={() => (painting.current = false)}
      onPointerLeave={() => (painting.current = false)}
    >
      <div className="cx-stage">{t("Stage")}</div>
      {levels.map((secs, li) =>
        secs.length ? (
          <div key={li} className={`cx-level${li ? " cx-level--upper" : ""}`}>
            {li ? <div className="cx-levelname">{t("Upper level")}</div> : null}
            {secs.map((s) => (
              <div key={s.id} className="cx-sector">
                <div className="cx-sector__name">
                  {s.name} <span className="ts-muted mono">{capacityOf(s)}</span>
                </div>
                {s.rows > 0 ? (
                  Array.from({ length: s.rows }, (_, r) => {
                    const half = Math.ceil(s.perRow / 2);
                    const seat = (n: number) => {
                      const key = seatKey(s.id, r, n);
                      const st = seatState(b, perf, key);
                      return (
                        <span key={n} data-seat={key} className={`cx-seat cx-seat--${st ?? "free"}`} title={`${s.name} ${rowName(r)}${n + 1}: ${t(STATE_LABEL[st ?? "free"])}`}>
                          {seatLetter(t, st)}
                        </span>
                      );
                    };
                    return (
                      <div key={r} className="cx-seatrow">
                        <span className="cx-rowname">{rowName(r)}</span>
                        <span className="cx-half">{Array.from({ length: half }, (_, n) => seat(n))}</span>
                        <span className="cx-aisle" />
                        <span className="cx-half">{Array.from({ length: s.perRow - half }, (_, n) => seat(half + n))}</span>
                        <span className="cx-rowname">{rowName(r)}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="cx-nomap">{t("{n} seats without a map", { n: s.seats })}</div>
                )}
              </div>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}
