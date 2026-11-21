import { useEffect, useState } from "react";
import { useT, type TFunc } from "@theatre-suite/core";
import { AlertBand, Button, OutputPill, SettingsRow as Row, SettingsSection, Switch } from "@theatre-suite/ui";
import { api, isTauri, type MonitorInfo } from "../lib/api";
import { chooseMonitor, closeOutput, openOutput, projErrorText, refreshMonitors, toggleTest, useProj } from "../lib/projection";
import { chooseBlankImage, clearBlankImage } from "../lib/projImport";
import { pptConnect, pptDisconnect, pptDo, pptErrorText, pptSupported, usePpt } from "../lib/ppt";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import "./settings.css";

/** Settings → Proiezioni: the output screen and its test pattern, the blank image, and PowerPoint. */
export function ProjectionPane() {
  return (
    <>
      <ScreenSection />
      <BlankSection />
      <PowerPointSection />
    </>
  );
}

const sizeText = (m: MonitorInfo) => `${m.width} × ${m.height}`;

function ScreenSection() {
  const t = useT();
  const monitors = useProj((s) => s.monitors);
  const windowOpen = useProj((s) => s.windowOpen);
  const testing = useProj((s) => s.testing);
  const saved = useDoc((s) => s.show?.projection.screen ?? null);
  const change = useDoc((s) => s.change);
  const [windowed, setWindowed] = useState(false);
  useEffect(() => void refreshMonitors(), []);
  const chosen = chooseMonitor(monitors, saved);
  const single = monitors.length <= 1;
  const fail = (e: unknown) => useUi.getState().showToast(projErrorText(t, e), "error");

  const pick = (m: MonitorInfo) => {
    change((s) => ({ ...s, projection: { ...s.projection, screen: m.name } }));
    // The window moves to the new screen: close and open again.
    if (windowOpen) void closeOutput().then(() => openOutput().catch(fail));
  };
  const turn = async () => {
    if (windowOpen) return closeOutput();
    await openOutput({ windowed: single || windowed }).catch(fail);
  };
  const test = async () => {
    if (!useProj.getState().windowOpen) await openOutput({ windowed: single || windowed }).catch(fail);
    if (useProj.getState().windowOpen) await toggleTest();
  };

  return (
    <SettingsSection title={t("Output screen")}>
      {single ? (
        <AlertBand tone="info" title={t("There is only one screen")}>
          {t("Connect the projector or the second screen and press “Look again”. Meanwhile you can try the output in a window on this screen.")}
        </AlertBand>
      ) : (
        <Row label={t("Screen")} hint={t("The output covers the whole screen, without borders. Cue stays on the screen where it is.")}>
          <span className="cue-proj-set__list" role="radiogroup" aria-label={t("Screen")}>
            {monitors.map((m) => (
              <label key={m.index} className="cue-proj-set__mon" data-on={chosen?.index === m.index || undefined}>
                <input type="radio" name="proj-monitor" checked={chosen?.index === m.index} disabled={m.current} onChange={() => pick(m)} />
                <span>
                  <b>{t("Screen {n}", { n: m.index + 1 })}</b> · {sizeText(m)}
                  <small>
                    {m.name}
                    {m.primary ? ` · ${t("main")}` : ""}
                    {m.current ? ` · ${t("Cue is here")}` : ""}
                  </small>
                </span>
              </label>
            ))}
          </span>
        </Row>
      )}
      <Row label={t("Output")} hint={t("The output window opens only when you turn it on.")}>
        <span className="cue-out__ctl">
          <OutputPill state={windowOpen ? "ok" : "idle"} label={windowOpen ? (chosen && !windowed && !single ? `${t("On")} · ${t("Screen {n}", { n: chosen.index + 1 })}` : t("On · preview window")) : t("Off")} />
          <Button variant="sm" onClick={() => void turn()}>
            {windowOpen ? t("Turn off") : t("Turn on")}
          </Button>
          <Button variant="sm" onClick={() => void refreshMonitors()}>
            {t("Look again")}
          </Button>
        </span>
      </Row>
      {!single ? (
        <Row label={t("Preview window")} hint={t("Opens the output in a normal window instead of full screen, to try it without a projector.")}>
          <Switch checked={windowed} onChange={setWindowed} label={t("Preview window")} />
        </Row>
      ) : null}
      <Row label={t("Test pattern")} hint={t("Colour bars and a frame on the output, to line up the projector. Press again to remove it.")}>
        <Button variant="sm" on={testing} onClick={() => void test()}>
          {testing ? t("Remove the test pattern") : t("Test pattern")}
        </Button>
      </Row>
    </SettingsSection>
  );
}

function BlankSection() {
  const t = useT();
  const blank = useDoc((s) => s.show?.projection.blank);
  return (
    <SettingsSection title={t("Blank image")}>
      <Row label={t("When the output is blanked (T)")} hint={t("Black, or an image of yours (a curtain, the title of the show). It is kept inside the show file.")}>
        <span className="cue-out__ctl">
          <span>{blank?.kind === "image" ? t("Your image") : t("Black")}</span>
          <Button variant="sm" onClick={() => void chooseBlankImage(t)}>
            {t("Choose image…")}
          </Button>
          {blank?.kind === "image" ? (
            <Button variant="sm" onClick={() => clearBlankImage()}>
              {t("Black")}
            </Button>
          ) : null}
        </span>
      </Row>
    </SettingsSection>
  );
}

function PowerPointSection() {
  const t = useT();
  const p = usePpt();
  const [supported, setSupported] = useState(false);
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    void pptSupported().then((ok) => {
      setSupported(ok);
      if (ok) void api.pptAvailable().then(setInstalled);
    });
  }, []);
  const say = (e: unknown) => useUi.getState().showToast(pptErrorText(t, e), "error");
  const pill = p.status === "on" ? ({ state: "ok", label: p.name ? `${t("Connected")} · ${p.name}` : t("Connected") } as const) : p.status === "connecting" ? ({ state: "idle", label: t("Connecting…") } as const) : p.status === "error" ? ({ state: "stop", label: t("Problem") } as const) : ({ state: "idle", label: t("Not connected") } as const);
  return (
    <SettingsSection title="PowerPoint">
      {!isTauri || !supported ? (
        <AlertBand tone="info" title={t("Only on Windows")}>
          {t("Controlling PowerPoint from Cue works only on Windows. Slides can still be added from a PDF, on every computer.")}
        </AlertBand>
      ) : installed === false ? (
        <AlertBand tone="warn" title={t("PowerPoint is not installed")}>
          {t("Cue did not find PowerPoint on this computer. You can still add slides from a PDF export of the presentation.")}
        </AlertBand>
      ) : null}
      <Row label={t("Live control")} hint={t("Cue can move an open PowerPoint slide show: next, previous, go to slide n, with a GO. Cue starts a small helper only when you connect, and changes nothing in PowerPoint or in Windows.")}>
        <span className="cue-out__ctl">
          <OutputPill state={pill.state} label={pill.label} />
          {p.status === "on" ? (
            <Button variant="sm" onClick={() => void pptDisconnect()}>
              {t("Disconnect")}
            </Button>
          ) : (
            <Button variant="sm" disabled={!supported || installed === false || p.status === "connecting"} onClick={() => void pptConnect()}>
              {t("Connect PowerPoint")}
            </Button>
          )}
        </span>
      </Row>
      {p.status === "on" ? (
        <Row label={t("Try it")} hint={p.slideshow ? t("Slide {n} of {total}", { n: p.slide, total: p.count }) : t("The slide show is not running: start it here or in PowerPoint (F5).")}>
          <span className="cue-out__ctl">
            <Button variant="sm" onClick={() => void pptDo("previous").catch(say)}>
              {t("Previous")}
            </Button>
            <Button variant="sm" onClick={() => void pptDo("next").catch(say)}>
              {t("Next")}
            </Button>
            <Button variant="sm" onClick={() => void pptDo("start").catch(say)}>
              {t("Start slide show")}
            </Button>
          </span>
        </Row>
      ) : null}
      {p.error && p.status !== "off" ? <AlertBand tone="warn" title={t("PowerPoint says")}>{pptErrorText(t, new Error(p.error))}</AlertBand> : null}
      <p className="cue-out__tip">{tipText(t)}</p>
    </SettingsSection>
  );
}

const tipText = (t: TFunc) => t("Tip: for a show on a different computer, the PDF export is the safest way: the slides become images inside the show file and need no PowerPoint at all.");
