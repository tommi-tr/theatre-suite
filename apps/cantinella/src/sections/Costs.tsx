import { Fragment, useMemo } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon, NetGrossField, Segmented, Steps } from "@theatre-suite/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { api, isTauri } from "../lib/api";
import {
  COST_STATES,
  costSummary,
  costTotals,
  grossOfCost,
  netOfCost,
  newCost,
  PRESET_CATEGORIES,
  scenarioTickets,
  showsOf,
  suggestedCosts,
  VAT_RATES,
  type Cost,
  type CostKind,
} from "../model/budget";
import { useDoc } from "../store/doc";
import { tourCosts } from "../model/tour";
import { useUi } from "../store/ui";
import { categoryLabel, changeB, euro, KIND_LABELS, pct, ruleText, STATE_LABELS, STATE_PILL, STATE_TONES } from "./budgetCommon";

const patchCost = (id: string, patch: Partial<Cost>, key: string) => changeB((b) => ({ ...b, costs: b.costs.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), `${id}.${key}`);

export function addCost() {
  const c = newCost({ name: "" });
  changeB((b) => ({ ...b, costs: [...b.costs, c] }));
  useUi.getState().select("cost", c.id);
  requestAnimationFrame(() => document.getElementById("cn-cost-name")?.focus());
}

export function CostsActions() {
  const t = useT();
  const has = useDoc((s) => s.data.budget.costs.length > 0);
  return (
    <>
      {has ? null : (
        <Button variant="ghost" icon="list" className="cn-bl" title={t("Start from the suggested items")} onClick={() => changeB((b) => ({ ...b, costs: [...b.costs, ...suggestedCosts()] }))}>
          <span>{t("Suggested items")}</span>
        </Button>
      )}
      <Button variant="primary" icon="plus" onClick={addCost}>
        {t("Add an item")}
      </Button>
    </>
  );
}

export function CostsStatus() {
  const t = useT();
  const b = useDoc((s) => s.data.budget);
  const shows = showsOf(b);
  const real = b.scenarios[1] ?? b.scenarios[0];
  const tourExtra = useDoc((s) => tourCosts(s.data.tour));
  const tot = useMemo(() => costTotals(b, shows, real ? scenarioTickets(b, real, shows) : {}, tourExtra), [b, shows, real, tourExtra]);
  return (
    <>
      <span>{t("{n} items", { n: b.costs.length })}</span>
      <span>{t("Total {a} for {n} performances", { a: euro(tot.total, false), n: shows })}</span>
      <span className="ts-spacer" />
      <span>{t("Amounts in gross: what you pay")}</span>
    </>
  );
}

export function Costs() {
  const t = useT();
  const b = useDoc((s) => s.data.budget);
  const selId = useUi((s) => s.sel.cost ?? null);
  const shows = showsOf(b);
  const sum = useMemo(() => costSummary(b, shows), [b, shows]);
  const real = b.scenarios.find((s) => s.id === "realistic") ?? b.scenarios[0];
  const tourExtra = useDoc((s) => tourCosts(s.data.tour));
  const tot = useMemo(() => costTotals(b, shows, real ? scenarioTickets(b, real, shows) : {}, tourExtra), [b, shows, real, tourExtra]);

  if (!b.costs.length) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="euro" size={26} />
        </span>
        <h2>{t("No costs yet")}</h2>
        <p>{t("Start from the usual items of a production (SIAE, rent, service, sets…) and delete the ones you do not need, or add your own.")}</p>
        <div className="cn-empty__actions">
          <Button icon="plus" onClick={addCost}>
            {t("Add an item")}
          </Button>
          <Button variant="primary" icon="list" onClick={() => changeB((x) => ({ ...x, costs: suggestedCosts() }))}>
            {t("Start from the suggested items")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="cx-page">
      <div className="cn-head">
        <h2>{t("Costs")}</h2>
        <ShowsField />
      </div>
      <div className="cx-tiles">
        <div className="cx-tile">
          <span className="cx-tile__label">{t("Fixed")}</span>
          <span className="cx-tile__value">{euro(sum.fixed, false)}</span>
          <span className="cx-tile__hint">{t("once, however many performances")}</span>
        </div>
        <div className="cx-tile">
          <span className="cx-tile__label">{t("Per performance")}</span>
          <span className="cx-tile__value">{euro(sum.perShow, false)}</span>
          <span className="cx-tile__hint">{t("× {n} = {a}", { n: shows, a: euro(sum.perShow * shows, false) })}</span>
        </div>
        <div className="cx-tile">
          <span className="cx-tile__label">{t("Depending on the audience")}</span>
          <span className="cx-tile__value">{t("{n} items", { n: sum.onTakings })}</span>
          <span className="cx-tile__hint">{sum.minimums ? t("minimums {a}", { a: euro(sum.minimums, false) }) : t("percentages and per spectator")}</span>
        </div>
        <div className={`cx-tile${sum.paid ? " cx-tile--ok" : ""}`}>
          <span className="cx-tile__label">{t("Already paid")}</span>
          <span className="cx-tile__value">{euro(sum.paid, false)}</span>
          <span className="cx-tile__hint">{t("of {a} expected", { a: euro(tot.total, false) })}</span>
        </div>
      </div>
      <div className="cx-rows" role="table" aria-label={t("Costs")}>
        <div className="cx-row cx-row--head cx-cost" role="row">
          <span role="columnheader">{t("Item")}</span>
          <span role="columnheader">{t("Kind")}</span>
          <span role="columnheader" className="cx-right">
            {t("Net")}
          </span>
          <span role="columnheader" className="cx-right">
            {t("VAT")}
          </span>
          <span role="columnheader" className="cx-right">
            {t("Gross")}
          </span>
          <span role="columnheader">{t("State")}</span>
          <span />
        </div>
        {b.costs.map((c) => {
          const open = c.id === selId;
          const onTakings = c.kind === "percent";
          return (
            <Fragment key={c.id}>
              <div
                role="row"
                tabIndex={0}
                className={`cx-row cx-cost cx-row--click${open ? " is-sel" : ""}`}
                onClick={() => useUi.getState().select("cost", open ? null : c.id)}
                onKeyDown={(e) => e.key === "Enter" && useUi.getState().select("cost", open ? null : c.id)}
              >
                <span role="cell" className="cx-stack">
                  <span className="cx-name ts-ellipsis">{c.name || <em className="ts-muted">{t("No name")}</em>}</span>
                  <span className="cx-sub ts-ellipsis">{[categoryLabel(t, c.category) === c.name ? "" : categoryLabel(t, c.category), c.supplier].filter(Boolean).join(" · ") || " "}</span>
                </span>
                <span role="cell" className="cx-stack">
                  <span className="ts-ellipsis">{t(KIND_LABELS[c.kind])}</span>
                  <span className="cx-sub ts-ellipsis">{ruleText(t, c, b)}</span>
                </span>
                <span role="cell" className="mono cx-right">
                  {onTakings ? "–" : euro(netOfCost(c))}
                </span>
                <span role="cell" className="mono cx-right cx-sub">
                  {onTakings ? pct(c.percent) : c.vat ? `${c.vat}%` : t("exempt")}
                </span>
                <span role="cell" className="mono cx-right cx-sum">
                  {onTakings ? "–" : euro(grossOfCost(c))}
                </span>
                <span role="cell">
                  <span className={`cx-pill cx-pill--${STATE_PILL[c.state]}`}>
                    {c.state === "paid" ? <Icon name="check" size={11} /> : null}
                    {t(STATE_LABELS[c.state])}
                  </span>
                </span>
                <span role="cell" className="cx-right">
                  {c.link ? <Icon name="link" size={13} /> : null}
                  <Icon name={open ? "chevUp" : "chevDown"} size={14} />
                </span>
              </div>
              {open ? <CostEditor c={c} /> : null}
            </Fragment>
          );
        })}
        {tourExtra ? (
          <div className="cx-row cx-cost cx-row--auto" role="row" title={t("Travel and lodging of the confirmed tour dates: change them in Tour")}>
            <span role="cell" className="cx-stack">
              <span className="cx-name ts-ellipsis">{t("Tour: travel and lodging")}</span>
              <span className="cx-sub ts-ellipsis">{t("From Tour")}</span>
            </span>
            <span role="cell" className="cx-sub">{t("confirmed dates")}</span>
            <span role="cell" className="mono cx-right">–</span>
            <span role="cell" className="mono cx-right">–</span>
            <span role="cell" className="mono cx-right cx-sum">{euro(tourExtra)}</span>
            <span role="cell">
              <button type="button" className="cn-linkbtn" onClick={() => useUi.getState().go("tour", "travel")}>
                {t("Open")}
              </button>
            </span>
            <span />
          </div>
        ) : null}
        <div className="cx-add">
          <Button variant="sm" icon="plus" onClick={addCost}>
            {t("Add an item")}
          </Button>
        </div>
      </div>
      <div className="cx-totals">
        <span className="ts-label">{t("Expected total ({scenario}, {n} performances)", { scenario: real?.name ?? "", n: shows })}</span>
        <div className="cx-totals__row">
          {COST_STATES.map((s) => (
            <span key={s} className="cx-totals__item">
              <span className={`cx-pill cx-pill--${STATE_PILL[s]}`}>{t(STATE_LABELS[s])}</span>
              <span className="mono">{euro(tot.byState[s], false)}</span>
            </span>
          ))}
          <span className="ts-spacer" />
          <span className="cx-totals__item cx-sum">
            {t("Total")} <span className="mono">{euro(tot.total, false)}</span>
          </span>
        </div>
      </div>
    </section>
  );
}

/** How many performances, when they are not listed one by one in Theatre and seats. */
export function ShowsField() {
  const t = useT();
  const b = useDoc((s) => s.data.budget);
  if (b.performances.length)
    return (
      <button type="button" className="cn-linkbtn" title={t("The performances listed in Theatre and seats")} onClick={() => useUi.getState().go("budget", "seats")}>
        {t("{n} performances", { n: b.performances.length })}
      </button>
    );
  return (
    <label className="cx-inline">
      <span className="ts-muted">{t("Performances")}</span>
      <input
        className="ts-input mono cx-num"
        type="number"
        min={1}
        max={500}
        value={b.showCount}
        onChange={(e) => {
          const v = Math.round(Number(e.currentTarget.value));
          if (v >= 1 && v <= 500) changeB((x) => ({ ...x, showCount: v }), "showCount");
        }}
      />
    </label>
  );
}

function CostEditor({ c }: { c: Cost }) {
  const t = useT();
  const b = useDoc((s) => s.data.budget);
  const set = (patch: Partial<Cost>, key: string) => patchCost(c.id, patch, key);
  const needsAmount = c.kind !== "percent";
  const needsPercent = c.kind === "percent" || c.kind === "mixed";
  const vatChoice = (VAT_RATES as readonly number[]).includes(c.vat) ? String(c.vat) : "other";
  return (
    <div className="cx-editor" role="group" aria-label={t("Edit {name}", { name: c.name })}>
      <div className="cx-editor__grid">
        <label className="ts-field">
          <span className="ts-label">{t("Item")}</span>
          <input id="cn-cost-name" className="ts-input" value={c.name} placeholder={t("For example: Service audio e luci")} onChange={(e) => set({ name: e.currentTarget.value }, "name")} onBlur={(e) => !e.currentTarget.value.trim() && set({ name: t("New item") }, "name")} />
        </label>
        <label className="ts-field">
          <span className="ts-label">{t("Category")}</span>
          <select className="ts-select" value={c.category} onChange={(e) => set({ category: e.currentTarget.value }, "category")}>
            <option value="">–</option>
            {PRESET_CATEGORIES.map((k) => (
              <option key={k} value={k}>
                {categoryLabel(t, k)}
              </option>
            ))}
            {c.category && !(PRESET_CATEGORIES as readonly string[]).includes(c.category) ? <option value={c.category}>{c.category}</option> : null}
          </select>
        </label>
        <label className="ts-field">
          <span className="ts-label">{t("Supplier")}</span>
          <input className="ts-input" value={c.supplier} onChange={(e) => set({ supplier: e.currentTarget.value }, "supplier")} />
        </label>
      </div>
      <div className="ts-field">
        <span className="ts-label">{t("Kind of cost")}</span>
        <Segmented<CostKind>
          ariaLabel={t("Kind of cost")}
          value={c.kind}
          onChange={(k) => set({ kind: k, percent: (k === "percent" || k === "mixed") && !c.percent ? 1000 : c.percent }, "kind")}
          options={(Object.keys(KIND_LABELS) as CostKind[]).map((k) => ({ value: k, label: t(KIND_LABELS[k]) }))}
        />
        <span className="ts-field__hint">{ruleText(t, c, b)}</span>
      </div>
      <div className="cx-editor__grid">
        {needsAmount ? (
          <div className="ts-field cx-span2">
            <NetGrossField
              amount={c.amount}
              entered={c.entered}
              vat={c.vat}
              onChange={(v) => set(v, "amount")}
              labels={{
                net: c.kind === "mixed" ? t("Minimum, net") : c.kind === "perSeat" ? t("Per spectator, net") : c.kind === "perShow" ? t("Per performance, net") : t("Net"),
                gross: t("Gross"),
              }}
            />
          </div>
        ) : null}
        {needsPercent ? (
          <label className="ts-field">
            <span className="ts-label">{t("Percentage of the takings")}</span>
            <span className="cx-inline">
              <input
                className="ts-input mono"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={c.percent / 100}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (v >= 0 && v <= 100) set({ percent: Math.round(v * 100) }, "percent");
                }}
              />
              %
            </span>
          </label>
        ) : null}
        {c.kind === "mixed" ? (
          <div className="ts-field">
            <span className="ts-label">{t("Rule")}</span>
            <Segmented<"max" | "plus">
              ariaLabel={t("Rule")}
              value={c.mix}
              onChange={(m) => set({ mix: m }, "mix")}
              options={[
                { value: "max", label: t("The larger") },
                { value: "plus", label: t("Both added") },
              ]}
            />
          </div>
        ) : null}
        {needsAmount ? (
          <div className="ts-field">
            <span className="ts-label">{t("VAT")}</span>
            <span className="cx-inline">
              <Segmented<string>
                ariaLabel={t("VAT")}
                value={vatChoice}
                onChange={(v) => set({ vat: v === "other" ? 5 : Number(v) }, "vat")}
                options={[...VAT_RATES.map((r) => ({ value: String(r), label: r ? `${r}%` : t("Exempt") })), { value: "other", label: t("Other") }]}
              />
              {vatChoice === "other" ? (
                <input className="ts-input mono cx-num" type="number" min={0} max={100} value={c.vat} onChange={(e) => { const v = Math.round(Number(e.currentTarget.value)); if (v >= 0 && v <= 100) set({ vat: v }, "vat"); }} />
              ) : null}
            </span>
          </div>
        ) : null}
        {c.kind === "perSeat" && b.sectors.length ? (
          <div className="ts-field cx-span2">
            <span className="ts-label">{t("Only for these sectors (none = all)")}</span>
            <div className="cn-chips">
              {b.sectors.map((s) => (
                <button key={s.id} type="button" className="cn-chip" aria-pressed={c.sectors.includes(s.id)} onClick={() => set({ sectors: c.sectors.includes(s.id) ? c.sectors.filter((x) => x !== s.id) : [...c.sectors, s.id] }, "sectors")}>
                  {c.sectors.includes(s.id) ? <Icon name="check" size={12} /> : null}
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="cx-editor__grid">
        <div className="ts-field">
          <span className="ts-label">{t("State")}</span>
          <Steps steps={STATE_TONES.map((tone, i) => ({ label: t(STATE_LABELS[COST_STATES[i]]), tone }))} value={COST_STATES.indexOf(c.state)} onChange={(i) => set({ state: COST_STATES[i] }, "state")} ariaLabel={t("State")} />
        </div>
        <div className="ts-field cx-span2">
          <span className="ts-label">{t("Quote or receipt")}</span>
          <span className="cx-inline">
            <input className="ts-input" value={c.link} placeholder={t("A file or a web address")} onChange={(e) => set({ link: e.currentTarget.value }, "link")} />
            {isTauri ? (
              <Button
                variant="sm"
                icon="folderOpen"
                onClick={async () => {
                  const f = await open({ multiple: false, directory: false, title: t("Choose the quote") });
                  if (f && !Array.isArray(f)) set({ link: f }, "link");
                }}
              >
                {t("Choose…")}
              </Button>
            ) : null}
            {c.link && isTauri && !/^https?:/i.test(c.link) ? (
              <Button variant="sm" icon="folder" onClick={() => void api.revealInFolder(c.link).catch(() => useUi.getState().showToast(t("The file is not there any more."), "error"))}>
                {t("Show")}
              </Button>
            ) : null}
          </span>
        </div>
      </div>
      <label className="ts-field">
        <span className="ts-label">{t("Notes")}</span>
        <textarea className="ts-input cn-textarea" rows={2} value={c.notes} onChange={(e) => set({ notes: e.currentTarget.value }, "notes")} />
      </label>
      <div className="cx-editor__foot">
        <Button
          variant="danger"
          icon="trash"
          onClick={() =>
            useUi.getState().ask({
              title: t("Delete {name}?", { name: c.name }),
              text: t("The item is removed from the budget."),
              action: t("Delete"),
              run: () => {
                changeB((x) => ({ ...x, costs: x.costs.filter((y) => y.id !== c.id) }));
                useUi.getState().showToast(t("{name} deleted. Ctrl Z brings it back.", { name: c.name }));
              },
            })
          }
        >
          {t("Delete")}
        </Button>
        <span className="ts-spacer" />
        <Button onClick={() => useUi.getState().select("cost", null)}>{t("Done")}</Button>
      </div>
    </div>
  );
}

