import { useMemo } from "react";
import { uid, useT } from "@theatre-suite/core";
import { Button, Icon, Range, Segmented } from "@theatre-suite/ui";
import { breakEven, capacityOf, evaluate, scenarioTickets, showsOf, type Scenario } from "../model/budget";
import { useDoc } from "../store/doc";
import { tourCosts } from "../model/tour";
import { useUi } from "../store/ui";
import { changeB, euro } from "./budgetCommon";
import { ShowsField } from "./Costs";

const patchScenario = (id: string, patch: Partial<Scenario>, key: string) => changeB((b) => ({ ...b, scenarios: b.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), `${id}.${key}`);

export function BreakEvenActions() {
  const t = useT();
  return (
    <Button
      variant="primary"
      icon="plus"
      onClick={() => {
        const id = uid();
        changeB((b) => ({ ...b, scenarios: [...b.scenarios, { id, name: t("New scenario"), fill: 50, sectorFill: {} }] }));
        useUi.getState().select("scenario", id);
      }}
    >
      {t("Add a scenario")}
    </Button>
  );
}

export function BreakEvenStatus() {
  const t = useT();
  const b = useDoc((s) => s.data.budget);
  const extra = useDoc((s) => tourCosts(s.data.tour));
  const be = useMemo(() => breakEven(b, showsOf(b), extra), [b, extra]);
  return (
    <>
      <span>{be.tickets === null ? t("Even a full house does not cover the costs") : t("Break-even at {n} tickets", { n: be.tickets })}</span>
      <span className="ts-spacer" />
      <span>{t("Costs and prices come from Costs and Theatre and seats")}</span>
    </>
  );
}

export function BreakEven() {
  const t = useT();
  const b = useDoc((s) => s.data.budget);
  const selId = useUi((s) => s.sel.scenario ?? null);
  const shows = showsOf(b);
  const extra = useDoc((s) => tourCosts(s.data.tour));
  const be = useMemo(() => breakEven(b, shows, extra), [b, shows, extra]);
  const scenario = b.scenarios.find((s) => s.id === selId) ?? b.scenarios.find((s) => s.id === "realistic") ?? b.scenarios[0];
  const results = useMemo(() => b.scenarios.map((sc) => ({ sc, r: evaluate(b, shows, scenarioTickets(b, sc, shows), extra) })), [b, shows, extra]);

  if (!b.sectors.length || !b.basePrice) {
    return (
      <div className="cn-empty">
        <span className="cn-empty__icon">
          <Icon name="chart" size={26} />
        </span>
        <h2>{!b.sectors.length ? t("Describe the theatre first") : t("Set the ticket price first")}</h2>
        <p>{t("The break-even needs the costs, the seats and the ticket prices. Enter them in Costs and in Theatre and seats.")}</p>
        <div className="cn-empty__actions">
          <Button variant="primary" icon="grid" onClick={() => useUi.getState().go("budget", "seats")}>
            {t("Go to theatre and seats")}
          </Button>
        </div>
      </div>
    );
  }

  const cur = results.find((x) => x.sc.id === scenario?.id)?.r;
  const share = be.capacity ? ((be.tickets ?? be.capacity) / be.capacity) * 100 : 0;
  return (
    <section className="cx-page">
      <div className="cn-head">
        <h2>{t("Break-even")}</h2>
        <ShowsField />
      </div>
      <div className="cx-twocards">
        <div className="cx-card2">
          <span className="ts-label">{t("From costs to tickets")}</span>
          {be.tickets === null ? (
            <>
              <span className="cx-big cx-big--stop">{t("Not enough")}</span>
              <span className="cx-sub">{t("Even with every seat sold for {n} performances ({c} tickets) the balance is {a}.", { n: shows, c: be.capacity, a: euro(be.result.balance, false) })}</span>
            </>
          ) : (
            <>
              <span className="cx-big">
                {be.tickets} <span className="cx-big__unit">{t("tickets")}</span>
              </span>
              <span className="cx-sub">{t("{p}% of the {c} seats of {n} performances · about {s} per performance", { p: Math.round(share), c: be.capacity, n: shows, s: be.perShow ?? 0 })}</span>
            </>
          )}
          <span className={`cx-meter${be.tickets === null ? " is-stop" : share > 80 ? " is-warn" : ""}`}>
            <span style={{ width: `${Math.min(100, share)}%` }} />
          </span>
          <div className="cx-mini-table">
            {b.sectors.map((s) => (
              <div key={s.id} className="cx-mini-row">
                <span className="ts-ellipsis">{s.name}</span>
                <span className="mono">
                  {be.bySector[s.id] ?? 0} / {capacityOf(s) * shows}
                </span>
              </div>
            ))}
          </div>
        </div>
        {scenario && cur ? (
          <div className="cx-card2">
            <span className="ts-label">{t("From tickets to takings")}</span>
            <Segmented<string> ariaLabel={t("Scenario")} value={scenario.id} onChange={(id) => useUi.getState().select("scenario", id)} options={b.scenarios.map((s) => ({ value: s.id, label: s.name }))} />
            <div className="cx-fills">
              <label className="cx-fill">
                <span>{t("All sectors")}</span>
                <Range value={scenario.fill} min={0} max={100} step={5} onChange={(v) => patchScenario(scenario.id, { fill: v, sectorFill: {} }, "fill")} label={t("All sectors")} width={160} />
                <span className="mono">{scenario.fill}%</span>
              </label>
              {b.sectors.map((s) => {
                const v = scenario.sectorFill[s.id] ?? scenario.fill;
                return (
                  <label key={s.id} className="cx-fill cx-sub">
                    <span className="ts-ellipsis">{s.name}</span>
                    <Range value={v} min={0} max={100} step={5} onChange={(x) => patchScenario(scenario.id, { sectorFill: { ...scenario.sectorFill, [s.id]: x } }, `fill-${s.id}`)} label={s.name} width={160} />
                    <span className="mono">{v}%</span>
                  </label>
                );
              })}
            </div>
            <div className="cx-mini-table">
              <div className="cx-mini-row">
                <span>{t("Tickets")}</span>
                <span className="mono">{cur.tickets}</span>
              </div>
              <div className="cx-mini-row">
                <span>{t("Takings")}</span>
                <span className="mono">{euro(cur.takings, false)}</span>
              </div>
              <div className="cx-mini-row">
                <span>{t("Costs")}</span>
                <span className="mono">{euro(cur.costs, false)}</span>
              </div>
            </div>
            <div className={`cx-result ${cur.balance >= 0 ? "is-ok" : "is-stop"}`}>
              <Icon name={cur.balance >= 0 ? "check" : "alert"} size={16} />
              <span>{cur.balance >= 0 ? t("Profit") : t("Loss")}</span>
              <span className="mono">{euro(Math.abs(cur.balance), false)}</span>
            </div>
            <div className="cx-inline">
              <input className="ts-input" value={scenario.name} aria-label={t("Name of the scenario")} onChange={(e) => patchScenario(scenario.id, { name: e.currentTarget.value }, "name")} />
              {b.scenarios.length > 1 ? (
                <Button variant="ghost" iconOnly icon="trash" aria-label={t("Delete the scenario")} onClick={() => changeB((x) => ({ ...x, scenarios: x.scenarios.filter((s) => s.id !== scenario.id) }))} />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="ts-field">
        <span className="ts-label">{t("Scenarios side by side")}</span>
        <table className="cx-compare">
          <thead>
            <tr>
              <th />
              {results.map(({ sc }) => (
                <th key={sc.id}>{sc.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>{t("Average fill")}</th>
              {results.map(({ sc, r }) => (
                <td key={sc.id} className="mono">
                  {be.capacity ? Math.round((r.tickets / be.capacity) * 100) : 0}%
                </td>
              ))}
            </tr>
            <tr>
              <th>{t("Tickets")}</th>
              {results.map(({ sc, r }) => (
                <td key={sc.id} className="mono">
                  {r.tickets}
                </td>
              ))}
            </tr>
            <tr>
              <th>{t("Takings")}</th>
              {results.map(({ sc, r }) => (
                <td key={sc.id} className="mono">
                  {euro(r.takings, false)}
                </td>
              ))}
            </tr>
            <tr>
              <th>{t("Costs")}</th>
              {results.map(({ sc, r }) => (
                <td key={sc.id} className="mono">
                  {euro(r.costs, false)}
                </td>
              ))}
            </tr>
            <tr className="cx-compare__total">
              <th>{t("Balance")}</th>
              {results.map(({ sc, r }) => (
                <td key={sc.id} className={`mono ${r.balance >= 0 ? "is-ok" : "is-stop"}`}>
                  {r.balance >= 0 ? "+" : "−"}
                  {euro(Math.abs(r.balance), false)} <span className="cx-sub">{r.balance >= 0 ? t("profit") : t("loss")}</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
