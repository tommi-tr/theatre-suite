import { useState } from "react";
import { useLang, useT, type TFunc, type Lang } from "@theatre-suite/core";
import { Button, StatusLight, type LightState } from "@theatre-suite/ui";
import { fmtNum } from "../lib/format";
import type { ReliabilityFinding, ReliabilityReport } from "../model/reliability";
import { useDoc } from "../store/doc";
import "../modes/show/show.css";

/** Settings → Test: plays the sequence without any output and writes a report in plain words. */

const LIGHT: Record<ReliabilityFinding["level"], LightState> = { stop: "stop", warn: "warn" };

function findingText(t: TFunc, lang: Lang, f: ReliabilityFinding): string {
  const s = (v: number) => fmtNum(v, lang, 1);
  switch (f.kind) {
    case "emptySequence":
      return t("The sequence is empty: there is nothing to play. Add memories with the Sequence button of the Show.");
    case "badValues":
      return t("Memory {n} has {c} values outside 0–255: save it again from the Banco.", { n: f.number, c: f.count });
    case "timing":
      return Number.isFinite(f.measured)
        ? t("The transition to memory {n} took {m} s instead of {e} s.", { n: f.number, m: s(f.measured), e: s(f.expected) })
        : t("The transition to memory {n} did not end.", { n: f.number });
    case "wrongEnd":
      return t("After the transition to memory {n}, {c} channels did not reach their value.", { n: f.number, c: f.channels });
    case "conflicts":
      return f.lights === 1 ? t("1 light shares its channels with another one (address conflict): see the address map in Setup.") : t("{n} lights share channels with other lights (address conflict): see the address map in Setup.", { n: f.lights });
    case "outOfRange":
      return t("{n} lights do not fit in the 512 channels: their last channels are not sent.", { n: f.lights });
    case "noAddress":
      return t("{n} lights have no DMX address: they never light up.", { n: f.lights });
    case "emptyMemory":
      return t("Memory {n} has no light on (all dark). Fine if it is meant to be a blackout.", { n: f.number });
    case "autoFollowLast":
      return t("Memory {n} “starts the next one by itself”, but it is the last one: nothing follows.", { n: f.number });
    case "longTransition":
      return t("The transition to memory {n} lasts {s} s: check it is what you want.", { n: f.number, s: s(f.seconds) });
    case "slowFrames":
      return t("This computer took up to {ms} ms to compute a frame (a frame leaves every 25 ms): close other programs during the show.", { ms: s(f.maxMs) });
  }
}

export function ReliabilityPane() {
  const t = useT();
  const lang = useLang();
  const doc = useDoc((s) => s.doc);
  const [report, setReport] = useState<ReliabilityReport | null>(null);
  const [running, setRunning] = useState(false);
  const start = () => {
    if (!doc) return;
    setRunning(true);
    setReport(null);
    // Loaded when asked (it carries the engine simulator); the button shows "Testing…" before the work starts.
    void import("../model/reliability")
      .then(({ reliabilityTest }) => new Promise<ReliabilityReport>((ok) => setTimeout(() => ok(reliabilityTest(doc)), 30)))
      .then(setReport)
      .catch((e) => console.error("[test]", e))
      .finally(() => setRunning(false));
  };
  return (
    <div className="gv-set-note gv-reltest">
      <h3>{t("Reliability test")}</h3>
      <p>{t("The test plays the whole sequence of memories, GO after GO, without sending anything to the lights, and then writes a short report: whether every transition took its time and ended on the right values, and what is worth checking. Useful before the first performance and on an old computer.")}</p>
      {!doc ? <p className="ts-muted">{t("Open a show to test it.")}</p> : null}
      <Button variant="primary" icon="check" disabled={!doc || running} onClick={start}>
        {running ? t("Testing…") : report ? t("Test again") : t("Start the test")}
      </Button>
      {report ? (
        <div className="gv-reltest__report" role="status">
          <StatusLight
            strong
            state={report.level === "ok" ? "ok" : report.level}
            label={report.level === "ok" ? t("Everything works") : report.level === "warn" ? t("It works, with something to check") : t("Something does not work")}
          />
          <p>
            {t("{m} memories and {n} transitions played: {s} s of show in {f} frames. A frame took {avg} ms on average, {max} ms at most.", {
              m: report.memories,
              n: report.transitions,
              s: fmtNum(report.showSeconds, lang, 1),
              f: report.frames,
              avg: fmtNum(report.avgFrameMs, lang, 2),
              max: fmtNum(report.maxFrameMs, lang, 2),
            })}
          </p>
          {report.findings.length ? (
            <ul className="gv-reltest__list">
              {report.findings.map((f, i) => (
                <li key={i}>
                  <StatusLight state={LIGHT[f.level]} label={findingText(t, lang, f)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="ts-muted">{t("No anomalies: every transition took its time and ended on the right values.")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
