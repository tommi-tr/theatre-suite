import { useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, SettingsRow as Row, SettingsSection, StatusLight } from "@theatre-suite/ui";
import { msText, silentGoTest, MAX_LIMIT_MS, MEAN_LIMIT_MS, type ReliabilityResult } from "../lib/reliability";
import { logEvent } from "../store/evening";
import { useDoc } from "../store/doc";
import { useLibrary } from "../store/library";
import { useUi } from "../store/ui";
import "./settings.css";

const COUNT = 200;

/**
 * Settings → Test: 200 GOs in a row in silence, with the mean and the longest time of a GO. Nothing goes to lights,
 * sound or screens and the evening on screen does not move. The dry run of the show (every memory, track and image
 * still there) is in Controlli.
 */
export function TestPane() {
  const t = useT();
  const lang = useLang();
  const gos = useDoc((s) => s.show?.gos ?? null);
  const library = useLibrary((s) => s.library);
  const [done, setDone] = useState<number | null>(null);
  const [result, setResult] = useState<ReliabilityResult | null>(null);
  const running = done !== null;

  const start = async () => {
    if (!gos) return;
    setResult(null);
    setDone(0);
    try {
      const r = await silentGoTest(gos, library, { count: COUNT, onProgress: (n) => setDone(n) });
      setResult(r);
      logEvent("check", t("Reliability test: {n} GO, mean {mean} ms, longest {max} ms", { n: r.gos, mean: msText(r.meanMs, lang), max: msText(r.maxMs, lang) }));
    } catch (e) {
      useUi.getState().showToast(String(e), "error");
    } finally {
      setDone(null);
    }
  };

  const verdict = result
    ? result.ok
      ? { state: "ok" as const, label: t("Reliable: every GO well under what anyone can notice") }
      : result.errors
        ? { state: "stop" as const, label: t("{n} commands failed", { n: result.errors }) }
        : { state: "warn" as const, label: t("Slower than expected: close other programs and try again") }
    : null;

  return (
    <SettingsSection
      title={t("Reliability test")}
      description={t("Gives {n} GOs in a row in silence, with the same code as the show: nothing goes to lights, sound or screens, and the evening on screen does not move.", { n: COUNT })}
    >
      <Row label={t("{n} GO in silence", { n: COUNT })} hint={!gos?.length ? t("This show has no GOs yet: create them in Prepare.") : t("From the first GO; at the end of the show it starts again. About a second.")}>
        <Button variant="sm" icon="playF" disabled={running || !gos?.length} onClick={() => void start()}>
          {running ? t("{done} of {n}…", { done: done ?? 0, n: COUNT }) : result ? t("Run again") : t("Start the test")}
        </Button>
      </Row>
      {result && verdict ? (
        <div className="cue-test__result" role="status">
          <StatusLight state={verdict.state} label={verdict.label} strong />
          <dl className="cue-test__nums">
            <div>
              <dt>{t("Mean time of a GO")}</dt>
              <dd>{msText(result.meanMs, lang)} ms</dd>
            </div>
            <div>
              <dt>{t("Longest")}</dt>
              <dd>{msText(result.maxMs, lang)} ms</dd>
            </div>
            <div>
              <dt>{t("95 GOs out of 100 within")}</dt>
              <dd>{msText(result.p95Ms, lang)} ms</dd>
            </div>
            <div>
              <dt>{t("GOs given")}</dt>
              <dd>{result.gos}</dd>
            </div>
          </dl>
          <p className="cue-test__note">
            {result.laps ? `${result.laps === 1 ? t("The show once from the start") : t("The show {n} times from the start", { n: result.laps })}. ` : ""}
            {t("Expected: mean within {mean} ms and longest within {max} ms. The time goes from the key to the commands ready for the outputs; lights, sound and projector then take their own (DMX 30 times a second).", { mean: MEAN_LIMIT_MS, max: MAX_LIMIT_MS })}
            {result.skipped ? ` ${t("{n} actions skipped: their memory or track is missing (see the dry run in Controlli).", { n: result.skipped })}` : ""}
          </p>
        </div>
      ) : null}
    </SettingsSection>
  );
}
