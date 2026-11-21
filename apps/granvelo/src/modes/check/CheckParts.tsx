import type { ReactNode } from "react";
import { useT, type TFunc } from "@theatre-suite/core";
import { Button, Icon, Segmented } from "@theatre-suite/ui";
import { FixtureSymbol } from "../../common/FixtureSymbol";
import { linkLabel, problemText } from "../../common/OutputChip";
import { fmtAddress, fmtLevel } from "../../lib/format";
import { CHECK_COLORS, canMixColors, checkValues, makesLight, sharedWith, type CheckColor, type CheckPlan, type CheckRun, type RunAction, type RunSummary, type SkipReason, type Verdict } from "../../model/check";
import { occupiedChannels } from "../../model/addresses";
import { LIGHT_COLORS, channelColor, channelLabel, fixtureType } from "../../model/fixtureTypes";
import { placeOf } from "../../model/ops";
import type { Fixture, GranveloDoc, Id } from "../../model/types";
import { useDoc } from "../../store/doc";
import { isSending, useOutput } from "../../store/output";
import { useSettings } from "../../store/settings";
import { useUi } from "../../store/ui";
import { channelRange, lightName, lightRef, placeTitle, symbolRotation } from "../setup/common";
import type { CheckLevel } from "./CheckDialog";

const COLOR_LABEL: Record<CheckColor, string> = { white: "White", red: "Red", green: "Green", blue: "Blue" };
const COLOR_SWATCH: Record<CheckColor, string> = { white: LIGHT_COLORS.white, red: LIGHT_COLORS.red, green: LIGHT_COLORS.green, blue: LIGHT_COLORS.blue };

function reasonText(t: TFunc, r: SkipReason): string {
  if (r === "unused") return t("Not used in this production");
  if (r === "noAddress") return t("No DMX address yet");
  return t("Its channels go past 512");
}

/* ---------------- Output not ready ---------------- */

/** Says plainly that nothing would light up, and offers the two ways out (the same actions as the chip of the top bar). */
export function OutputNotice() {
  const t = useT();
  const status = useOutput((s) => s.status);
  if (isSending(status)) return null;
  const link = status.link;
  const out = useOutput.getState();
  const run = (fn: () => Promise<void>) => () => fn().catch((e) => useUi.getState().showToast(String(e), "error"));
  const problem = link.state === "error" ? problemText(t, link.code) : null;
  return (
    <div className="gv-chk-notice" role="alert">
      <Icon name="plug" size={18} />
      <div className="gv-chk-notice__text">
        <strong>{t("The DMX output is not connected: no light would turn on.")}</strong>
        {problem ? (
          <span>
            {problem.title}. {problem.text}
          </span>
        ) : link.state === "idle" ? (
          <span>{t("Connect the USB-DMX cable, or try the check with the simulated output.")}</span>
        ) : (
          <span>{linkLabel(t, link)}</span>
        )}
      </div>
      <div className="gv-chk-notice__actions">
        {link.state !== "connecting" && link.state !== "lost" ? (
          <Button variant="primary" icon="plug" onClick={run(() => out.connect())}>
            {t("Connect")}
          </Button>
        ) : null}
        <Button icon="monitor" onClick={run(() => out.useSimulated())}>
          {t("Use the simulated output")}
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Before the first light ---------------- */

export function Intro({ plan, onStart, onClose }: { plan: CheckPlan; onStart: () => void; onClose: () => void }) {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const sending = useOutput((s) => isSending(s.status));
  const n = plan.steps.length;
  return (
    <>
      <div className="gv-chk__body">
        <div className="gv-chk-warn">
          <Icon name="alert" size={18} />
          <div>
            <p className="gv-chk-warn__main">{t("The check turns on one light at a time and turns the others off.")}</p>
            <p className="gv-chk-warn__sub">{t("The lights on stage will change. When you finish, they go back exactly as they were.")}</p>
          </div>
        </div>
        <OutputNotice />
        <p className="gv-chk-lead">{n === 0 ? t("There is no light to check.") : n === 1 ? t("1 light to check, in the order of their numbers.") : t("{n} lights to check, in the order of their numbers.", { n })}</p>
        <Skipped plan={plan} doc={doc} />
      </div>
      <footer className="ts-dialog__foot gv-chk__foot">
        <span className="ts-spacer" />
        <Button onClick={onClose}>{t("Close")}</Button>
        <Button variant="primary" icon="bulb" disabled={n === 0 || !sending} onClick={onStart} autoFocus>
          {t("Start the check")}
        </Button>
      </footer>
    </>
  );
}

function Skipped({ plan, doc }: { plan: CheckPlan; doc: GranveloDoc }) {
  const t = useT();
  if (plan.skipped.length === 0) return null;
  return (
    <section className="gv-chk-skipped" aria-label={t("Lights that cannot be checked")}>
      <h4 className="gv-chk-h">{plan.skipped.length === 1 ? t("1 light cannot be checked") : t("{n} lights cannot be checked", { n: plan.skipped.length })}</h4>
      <ul>
        {plan.skipped.map((s) => {
          const f = doc.fixtures.find((x) => x.id === s.id)!;
          return (
            <li key={s.id}>
              <span className="gv-chk-skipped__num">{f.number}</span>
              <span className="ts-ellipsis">{lightName(t, f)}</span>
              <span className="gv-chk-skipped__why">{reasonText(t, s.reason)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------- The strip of lights (position, jump) ---------------- */

export function Strip({ plan, run, fixtures, onGo, onSummary }: { plan: CheckPlan; run: CheckRun; fixtures: Fixture[]; onGo: (i: number) => void; onSummary: () => void }) {
  const t = useT();
  return (
    <nav className="gv-chk-strip" aria-label={t("Lights to check")}>
      <ol>
        {plan.steps.map((id, i) => {
          const f = fixtures.find((x) => x.id === id)!;
          const v = run.verdicts[id];
          const current = run.view === "light" && run.index === i;
          const label = `${f.number} · ${lightName(t, f)}${v === "ok" ? ` · ${t("Works")}` : v === "broken" ? ` · ${t("Not working")}` : ""}`;
          return (
            <li key={id}>
              <button type="button" className="gv-chk-cell" data-verdict={v} aria-current={current ? "step" : undefined} title={label} aria-label={label} onClick={() => onGo(i)}>
                <span>{f.number}</span>
                {v === "ok" ? <Icon name="check" size={9} strokeWidth={3} /> : v === "broken" ? <Icon name="x" size={9} strokeWidth={3} /> : null}
              </button>
            </li>
          );
        })}
      </ol>
      <Button variant="sm" icon="list" on={run.view === "summary"} onClick={onSummary} title={t("Which work, which do not, which were not checked")}>
        {t("Summary")}
      </Button>
    </nav>
  );
}

/* ---------------- One light ---------------- */

export function LightStep({
  doc,
  fixture: f,
  verdict,
  level,
  color,
  first,
  last,
  onLevel,
  onColor,
  onAct,
  onVerdict,
}: {
  doc: GranveloDoc;
  fixture: Fixture;
  verdict: Verdict | undefined;
  level: CheckLevel;
  color: CheckColor;
  first: boolean;
  last: boolean;
  onLevel: (l: CheckLevel) => void;
  onColor: (c: CheckColor) => void;
  onAct: (a: RunAction) => void;
  onVerdict: (v: Verdict) => void;
}) {
  const t = useT();
  const units = useSettings((s) => s.settings.units);
  const master = useOutput((s) => s.live.master);
  const type = fixtureType(f.typeId);
  const values = checkValues(f, level, color);
  const chans = occupiedChannels(f);
  const shares = sharedWith(doc, f.id).map((id) => doc.fixtures.find((x) => x.id === id)!).filter(Boolean);
  const light = makesLight(f);
  const mixes = canMixColors(f);
  const masterLow = master.blackout || master.ftbTarget < 1 || master.grandMaster < 255;
  return (
    <div className="gv-chk__body gv-chk__body--step">
      <OutputNotice />
      <section className="gv-chk-card" data-verdict={verdict} aria-label={`${f.number} · ${lightName(t, f)}`}>
        <div className="gv-chk-card__id">
          <span className="gv-chk-card__num" aria-label={t("Light number")}>
            {f.number}
          </span>
          <FixtureSymbol kind={type.symbol} rotate={symbolRotation(f)} size={64} fixture={f} />
        </div>
        <div className="gv-chk-card__info">
          <h3 className="gv-chk-card__name ts-ellipsis">{lightName(t, f)}</h3>
          <p className="gv-chk-card__sub">
            {t(type.name)} · {placeTitle(t, doc, placeOf(f, doc))}
          </p>
          <p className="gv-chk-card__addr">
            <span>
              <span className="ts-label">{t("DMX address")}</span> <b>{fmtAddress(f.address ?? 0)}</b>
            </span>
            <span>
              <span className="ts-label">{f.channels.length === 1 ? t("Channel occupied") : t("Channels occupied")}</span> <b>{channelRange(f)}</b> · {f.channels.length === 1 ? t("1 channel") : t("{n} channels", { n: f.channels.length })}
            </span>
          </p>
          <ul className="gv-chk-chans" aria-label={t("Channels")}>
            {chans.map((ch, i) => {
              const label = channelLabel(f.channels[i]);
              return (
                <li key={ch} data-on={values[i] > 0 || undefined}>
                  <span className="gv-chk-chans__sw" style={{ background: channelColor(f.channels[i].function, f.typeId) }} aria-hidden="true" />
                  <span className="gv-chk-chans__ch">{fmtAddress(ch)}</span>
                  <span className="gv-chk-chans__name">{label.custom ? label.text : t(label.text)}</span>
                  <span className="gv-chk-chans__val">{fmtLevel(values[i], units)}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {verdict ? (
          <span className="gv-chk-card__verdict" data-verdict={verdict}>
            <Icon name={verdict === "ok" ? "check" : "x"} size={13} strokeWidth={2.4} />
            {verdict === "ok" ? t("Works") : t("Not working")}
          </span>
        ) : f.broken ? (
          <span className="gv-chk-card__verdict" data-verdict="broken" title={t("Marked as not working by the light check.")}>
            <Icon name="x" size={13} strokeWidth={2.4} />
            {t("Already marked")}
          </span>
        ) : null}
      </section>

      {shares.length > 0 ? (
        <Note tone="warn" icon="alert">
          {t("It shares channels with {list}: they turn on together.", { list: shares.map((s) => lightRef(t, s)).join(", ") })}
        </Note>
      ) : null}
      {!light ? <Note icon="info">{t("This one makes no light: the check leaves it off. Go on with Next.")}</Note> : null}
      {masterLow && light ? <Note tone="warn" icon="alert">{t("Blackout, Fade to black or the Grand Master are lowering the output: the light may stay dark or dim.")}</Note> : null}

      {light ? (
        <div className="gv-chk-ctl">
          <div className="gv-chk-ctl__group">
            <span className="ts-label">{t("Level")}</span>
            <Segmented<"1" | "0.5">
              ariaLabel={t("Level")}
              small
              value={level === 1 ? "1" : "0.5"}
              onChange={(v) => onLevel(v === "1" ? 1 : 0.5)}
              options={[
                { value: "1", label: "100%" },
                { value: "0.5", label: "50%" },
              ]}
            />
            <span className="gv-chk-ctl__hint">{t("50% so as not to dazzle")}</span>
          </div>
          {mixes ? (
            <div className="gv-chk-ctl__group">
              <span className="ts-label">{t("Colour")}</span>
              <div className="gv-chk-colors" role="group" aria-label={t("Colour")}>
                {CHECK_COLORS.map((c) => (
                  <Button key={c} on={c === color} aria-pressed={c === color} onClick={() => onColor(c)}>
                    <span className="gv-chk-swatch" style={{ background: COLOR_SWATCH[c] }} aria-hidden="true" />
                    {t(COLOR_LABEL[c])}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="gv-chk-nav">
        <Button className="gv-chk-big" icon="arrowLeft" kbd="←" disabled={first} onClick={() => onAct({ type: "back" })}>
          {t("Back")}
        </Button>
        <Button className="gv-chk-big gv-chk-ok" icon="check" aria-pressed={verdict === "ok"} data-chosen={verdict === "ok" || undefined} onClick={() => onVerdict("ok")}>
          {t("Works")}
        </Button>
        <Button className="gv-chk-big gv-chk-bad" icon="x" aria-pressed={verdict === "broken"} data-chosen={verdict === "broken" || undefined} onClick={() => onVerdict("broken")}>
          {t("Not working")}
        </Button>
        <Button className="gv-chk-big" icon={last ? "list" : "chevRight"} kbd="Space" onClick={() => onAct({ type: "next" })}>
          {last ? t("Summary") : t("Next")}
        </Button>
      </div>
    </div>
  );
}

function Note({ children, icon, tone }: { children: ReactNode; icon: "alert" | "info"; tone?: "warn" }) {
  return (
    <p className="gv-chk-note" data-tone={tone}>
      <Icon name={icon} size={14} />
      <span>{children}</span>
    </p>
  );
}

/* ---------------- The end ---------------- */

export function Summary({ plan, summary, onGo, onRestart, onExit }: { plan: CheckPlan; summary: RunSummary; onGo: (index: number) => void; onRestart: () => void; onExit: () => void }) {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const col = (ids: Id[], kind: "broken" | "ok" | "unchecked", title: string, icon: "x" | "check" | "alert", empty: string) => (
    <section className="gv-chk-sum" data-kind={kind}>
      <h4 className="gv-chk-sum__title">
        <Icon name={icon} size={14} strokeWidth={2.4} />
        {title}
      </h4>
      {ids.length === 0 ? (
        <p className="gv-chk-sum__empty">{empty}</p>
      ) : (
        <ul>
          {ids.map((id) => {
            const f = doc.fixtures.find((x) => x.id === id)!;
            return (
              <li key={id}>
                <button type="button" onClick={() => onGo(plan.steps.indexOf(id))} title={t("Show this light again")}>
                  <span className="gv-chk-sum__num">{f.number}</span>
                  <span className="ts-ellipsis">{lightName(t, f)}</span>
                  {f.broken && kind !== "broken" ? <Icon name="x" size={11} strokeWidth={2.6} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
  const nBroken = summary.broken.length;
  const nOk = summary.ok.length;
  const nUnchecked = summary.unchecked.length;
  return (
    <>
      <div className="gv-chk__body">
        {plan.steps.length === 0 ? (
          <p className="gv-chk-lead">{t("There is no light to check.")}</p>
        ) : (
          <>
            <p className="gv-chk-lead">{t("All the lights are off now. Pick one to see it again.")}</p>
            <div className="gv-chk-sums">
              {col(summary.broken, "broken", nBroken === 1 ? t("1 does not work") : t("{n} do not work", { n: nBroken }), "x", t("None: all the lights you checked work."))}
              {col(summary.ok, "ok", nOk === 1 ? t("1 works") : t("{n} work", { n: nOk }), "check", t("None yet."))}
              {col(summary.unchecked, "unchecked", nUnchecked === 1 ? t("1 not checked") : t("{n} not checked", { n: nUnchecked }), "alert", t("None: you checked them all."))}
            </div>
            {summary.broken.length > 0 ? <p className="gv-chk-hint">{t("The lights that do not work stay marked in the list of Setup. To remove the mark, open the light’s properties.")}</p> : null}
          </>
        )}
        <Skipped plan={plan} doc={doc} />
      </div>
      <footer className="ts-dialog__foot gv-chk__foot">
        <Button icon="reset" disabled={plan.steps.length === 0} onClick={onRestart}>
          {t("Start again")}
        </Button>
        <span className="ts-spacer" />
        <Button variant="primary" icon="check" onClick={onExit}>
          {t("Finish")}
        </Button>
      </footer>
    </>
  );
}
