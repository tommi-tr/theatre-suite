import { useEffect, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Icon, Segmented } from "@theatre-suite/ui";
import { api, onEvent, type TestReport, type TestStep } from "../lib/api";
import { engineConfig, engineTracks } from "../lib/engineSync";
import { useDoc } from "../state/doc";

type T = (k: string, v?: Record<string, string | number>) => string;

/** One step of the test as a plain sentence. */
export function describeStep(t: T, s: TestStep): string {
  const track = s.number !== null ? `${s.number}${s.name ? ` «${s.name}»` : ""}` : "";
  const exit =
    s.exit === "crossfade" ? t("Crossfade") : s.exit === "next" ? t("Next") : s.exit === "fadeOut" ? t("Fade out") : t("No exit");
  const sec = s.seconds !== null ? Math.round(s.seconds * 10) / 10 : 0;
  switch (s.code) {
    case "file_ok":
      return t("Track {track}: the file is there and can be read.", { track });
    case "file_missing":
      return t("Track {track}: the audio file was not found. It would stay silent.", { track });
    case "file_broken":
      return t("Track {track}: the audio file cannot be read. It would stay silent.", { track });
    case "go_ok":
      return t("GO on track {track}: it starts.", { track });
    case "go_wrong":
      return t("GO on track {track}: it did not start as it should.", { track });
    case "left_ok":
      return t("The track before leaves as its exit says ({exit}).", { exit });
    case "left_wrong":
      return t("The track before did not leave as its exit says ({exit}).", { exit });
    case "auto_ok":
      return t("Track {track} starts by itself when the one before ends.", { track });
    case "auto_late":
      return t("Track {track} did not start by itself when the one before ended.", { track });
    case "alive_ok":
      return t("Track {track} plays until its end ({n} s).", { track, n: sec });
    case "alive_stuck":
      return t("Track {track} stopped before its end.", { track });
    case "ended_ok":
      return t("Track {track} ends and goes away ({n} s).", { track, n: sec });
    case "ended_stuck":
      return t("Track {track} did not end when it should.", { track });
    case "loop_ok":
      return t("Track {track} repeats until GO.", { track });
    case "loop_stuck":
      return t("Track {track} did not repeat as it should.", { track });
    case "stop_ok":
      return t("Stop all: everything stops.");
    case "stop_wrong":
      return t("Stop all: something kept playing.");
    case "empty":
      return t("There are no tracks to try.");
    case "slow":
      return t("The test took too long and was stopped.");
    default:
      return s.code;
  }
}

/** Runs the reliability test and shows the result in plain words. */
export function TestDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const hasTracks = useDoc((s) => s.tracks.some((x) => !x.hidden && x.file));
  const [runs, setRuns] = useState<"1" | "3" | "5">("3");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ run: number; runs: number } | null>(null);
  const [report, setReport] = useState<TestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const un = onEvent<{ run: number; runs: number; step: number }>("selftest-progress", (p) => setProgress({ run: p.run, runs: p.runs }));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const start = async () => {
    setBusy(true);
    setReport(null);
    setError(null);
    try {
      setReport(await api.selftestRun(engineTracks(), engineConfig(), Number(runs)));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const firstRun = report ? report.steps.filter((s) => s.run === 1) : [];
  const failedLater = report ? report.steps.filter((s) => s.run > 1 && !s.ok) : [];
  const copy = () => {
    if (!report) return;
    const lines = report.steps.map((s) => `${s.ok ? "OK " : "ERR"} · ${t("Run {n}", { n: s.run })} · ${describeStep(t, s)}`);
    navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
  };

  return (
    <Dialog
      title={t("Reliability test")}
      icon="check"
      width={680}
      onClose={onClose}
      description={t("Plays your cue list without sound, several times in a row and much faster, and checks that every GO does what you set up. Nothing that plays now is touched.")}
      footer={
        <>
          {report ? (
            <Button variant="sm" icon="copy" onClick={copy}>
              {t("Copy")}
            </Button>
          ) : null}
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={onClose}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div className="df-set-row">
        <div style={{ flex: 1 }}>
          <div className="df-set-row__label">{t("How many times")}</div>
          <div className="ts-field__hint">{t("Repeating it shows whether the same show always behaves the same way.")}</div>
        </div>
        <Segmented small ariaLabel={t("How many times")} value={runs} onChange={setRuns} options={[{ value: "1", label: "1" }, { value: "3", label: "3" }, { value: "5", label: "5" }]} />
        <Button variant="primary" icon="playF" disabled={busy || !hasTracks} onClick={start}>
          {busy ? (progress ? t("Run {n} of {m}…", { n: progress.run, m: progress.runs }) : t("Starting…")) : t("Run the test")}
        </Button>
      </div>
      {!hasTracks ? <p className="ts-muted">{t("Add some tracks to the cue list first.")}</p> : null}
      {error ? <p style={{ color: "var(--stop)" }}>{error}</p> : null}
      {report ? (
        <div style={{ marginTop: 12 }}>
          <div className={report.errors ? "df-test-sum df-test-sum--bad" : "df-test-sum df-test-sum--ok"}>
            <Icon name={report.errors ? "alert" : "check"} size={18} />
            <div>
              <b>{report.errors ? t("{n} things did not go as expected.", { n: report.errors }) : t("Everything went as expected.")}</b>
              <div style={{ fontSize: 12 }}>
                {report.identical ? t("All {n} runs behaved in the same way.", { n: report.runs }) : t("The runs did not all behave in the same way: do not trust this cue list yet.")}{" "}
                {t("It took {n} s.", { n: Math.round(report.seconds * 10) / 10 })}
              </div>
            </div>
          </div>
          <ul className="df-test-list">
            {firstRun.map((s, i) => (
              <li key={i} className={s.ok ? "" : "df-test-bad"}>
                <Icon name={s.ok ? "check" : "x"} size={13} color={s.ok ? "var(--go)" : "var(--stop)"} />
                <span>{describeStep(t, s)}</span>
              </li>
            ))}
            {failedLater.map((s, i) => (
              <li key={`l${i}`} className="df-test-bad">
                <Icon name="x" size={13} color="var(--stop)" />
                <span>
                  {t("Run {n}", { n: s.run })} · {describeStep(t, s)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}
