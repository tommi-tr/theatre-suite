import { useCallback, useEffect, useState } from "react";
import { useT } from "@theatre-suite/core";
import { AlertBand, Button, NumberField, OutputPill, SettingsRow as Row, SettingsSection, Switch } from "@theatre-suite/ui";
import { audioApi } from "../lib/audio";
import { dmxApi, dmxLinkText, dmxProblemText, type DmxDevice } from "../lib/dmx";
import { fmtSec } from "../prepare/format";
import { useDoc } from "../store/doc";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { useAudioStatus, useDmxStatus } from "./outputStatus";
import "./settings.css";

/** Settings → Uscite: sound card, DMX cable, the Preset memory, Fade to black, and whether the script follows the standby. */
export function OutputsPane() {
  return (
    <>
      <SoundSection />
      <DmxSection />
      <ShowSection />
    </>
  );
}

function SoundSection() {
  const t = useT();
  const device = useSettings((s) => s.settings.audioDevice);
  const { simulated, engine } = useAudioStatus();
  const [devices, setDevices] = useState<string[] | null>(null);
  const refresh = useCallback(() => {
    void audioApi().then((a) => a.listDevices().then(setDevices, () => setDevices([])));
  }, []);
  useEffect(refresh, [refresh]);
  const choose = async (name: string | null) => {
    useSettings.getState().update({ audioDevice: name });
    try {
      await (await audioApi()).setDevice(name);
    } catch (e) {
      useUi.getState().showToast(t("The sound output could not be changed: {error}", { error: String(e) }), "error");
    }
  };
  const pill = engine?.error
    ? ({ state: "stop", label: t("Sound output: problem") } as const)
    : simulated
      ? ({ state: "idle", label: t("Simulated output") } as const)
      : engine?.ready
        ? ({ state: "ok", label: engine.device ? t("Connected · {device}", { device: engine.device }) : t("Ready") } as const)
        : ({ state: "idle", label: t("Starts with the first sound") } as const);
  // A device chosen earlier and now unplugged stays in the list, marked.
  const known = devices ?? [];
  const missing = device !== null && devices !== null && !known.includes(device);
  return (
    <SettingsSection title={t("Sound")}>
      <Row label={t("Sound output")} hint={t("The sound card the Diaframma tracks play on. The system default is the one chosen in Windows.")}>
        <span className="cue-out__ctl">
          <select className="ts-select" aria-label={t("Sound output")} value={device ?? ""} onChange={(e) => void choose(e.currentTarget.value || null)}>
            <option value="">{t("System default")}</option>
            {missing ? <option value={device!}>{`${device} (${t("not found")})`}</option> : null}
            {known.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <Button variant="ghost" iconOnly icon="sync" title={t("Look for the outputs again")} aria-label={t("Look for the outputs again")} onClick={refresh} />
        </span>
      </Row>
      <Row label={t("State")} hint={engine?.error ? engine.error : t("To hear a track before the show, play it in Diaframma (Cue does not make a test sound yet).")}>
        <OutputPill state={pill.state} label={pill.label} detail={engine?.ready && engine.sampleRate ? `${Math.round(engine.sampleRate / 100) / 10} kHz` : undefined} />
      </Row>
    </SettingsSection>
  );
}

function DmxSection() {
  const t = useT();
  const port = useSettings((s) => s.settings.dmxPort);
  const { simulated, status } = useDmxStatus();
  const [devices, setDevices] = useState<DmxDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    void dmxApi().then((a) => a.listDevices().then(setDevices, () => setDevices([])));
  }, []);
  useEffect(refresh, [refresh]);
  const link = status?.link ?? { state: "idle" as const };
  const connected = link.state === "connected" || link.state === "simulated" || link.state === "lost";
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      useUi.getState().showToast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const connect = () => run(async () => (await dmxApi()).connect(simulated ? { mode: "simulated" } : { mode: "auto", prefer: port }));
  const disconnect = () => run(async () => (await dmxApi()).disconnect());
  const pill =
    link.state === "connected" || link.state === "simulated"
      ? ({ state: link.state === "simulated" ? "idle" : "ok" } as const)
      : link.state === "connecting"
        ? ({ state: "warn" } as const)
        : link.state === "lost" || link.state === "error"
          ? ({ state: "stop" } as const)
          : ({ state: "idle" } as const);
  const list = devices ?? [];
  const missing = port !== null && devices !== null && !list.some((d) => d.port === port);
  const problem = link.state === "error" ? dmxProblemText(t, link.code) : null;
  return (
    <SettingsSection title={t("Lights (DMX)")}>
      <Row label={t("USB-DMX cable")} hint={t("Automatic finds the cable by itself. Only one program at a time can use it: close Granvelo before connecting.")}>
        <span className="cue-out__ctl">
          <select
            className="ts-select"
            aria-label={t("USB-DMX cable")}
            value={port ?? ""}
            onChange={(e) => useSettings.getState().update({ dmxPort: e.currentTarget.value || null })}
          >
            <option value="">{t("Automatic")}</option>
            {missing ? <option value={port!}>{`${port} (${t("not found")})`}</option> : null}
            {list.map((d) => (
              <option key={d.port} value={d.port}>
                {d.name || d.port}
                {d.name && d.name !== d.port ? ` · ${d.port}` : ""}
              </option>
            ))}
          </select>
          <Button variant="ghost" iconOnly icon="sync" title={t("Look for the cables again")} aria-label={t("Look for the cables again")} onClick={refresh} />
        </span>
      </Row>
      <Row label={t("State")} hint={t("Connected, simulated or with a problem, in words. If Granvelo holds the cable, it says so here.")}>
        <span className="cue-out__ctl">
          <OutputPill state={pill.state} label={dmxLinkText(t, link)} busy={link.state === "connecting" || busy} />
          {connected ? (
            <Button variant="sm" icon="x" disabled={busy} onClick={() => void disconnect()}>
              {t("Disconnect")}
            </Button>
          ) : (
            <Button variant="sm" icon="plug" disabled={busy || link.state === "connecting"} onClick={() => void connect()}>
              {t("Connect")}
            </Button>
          )}
        </span>
      </Row>
      {problem ? (
        <AlertBand tone={link.state === "error" && link.code === "busy" ? "warn" : "stop"} title={problem.title} className="cue-out__band">
          {problem.text}
        </AlertBand>
      ) : null}
    </SettingsSection>
  );
}

function ShowSection() {
  const t = useT();
  const lang = useSettings((s) => s.settings.language);
  const follow = useSettings((s) => s.settings.followStandby);
  const hasShow = useDoc((s) => s.show !== null);
  const ftb = useDoc((s) => s.show?.settings.ftbSeconds ?? 5);
  const preset = useDoc((s) => s.show?.settings.presetRef ?? null);
  const library = useLibrary((s) => s.library);
  const lights = library.lights;
  const presetKnown = preset ? library.light(preset) !== null : true;
  const value = preset ? `${preset.sourceId}\u0000${preset.itemId}` : "";
  return (
    <SettingsSection title={t("During the show")}>
      <Row label={t("Quick preset memory")} hint={t("The memory the Preset key brings up (house lights, a safe look). It belongs to this show.")}>
        <select
          className="ts-select"
          aria-label={t("Quick preset memory")}
          disabled={!hasShow}
          value={value}
          onChange={(e) => {
            const v = e.currentTarget.value;
            useDoc.getState().change((s) => {
              const next = { ...s, settings: { ...s.settings } };
              if (!v) delete next.settings.presetRef;
              else {
                const [sourceId, itemId] = v.split("\u0000");
                next.settings.presetRef = { sourceId, itemId };
              }
              return next;
            });
          }}
        >
          <option value="">{t("None")}</option>
          {!presetKnown ? <option value={value}>{t("(memory not found)")}</option> : null}
          {lights.map((l) => (
            <option key={`${l.key.sourceId}\u0000${l.key.itemId}`} value={`${l.key.sourceId}\u0000${l.key.itemId}`}>
              {`${l.number} · ${l.name}`}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("Fade to black time")} hint={t("How long the lights take to go dark with the Fade to black key, and to come back.")}>
        <NumberField
          value={ftb}
          text={fmtSec(ftb, lang)}
          min={0}
          max={60}
          label={t("Fade to black time")}
          disabled={!hasShow}
          onCommit={(v) => useDoc.getState().change((s) => ({ ...s, settings: { ...s.settings, ftbSeconds: Math.round(v * 10) / 10 } }), "ftb")}
        />
      </Row>
      <Row label={t("The script follows the standby")} hint={t("In Show the script scrolls by itself to the next GO. Scrolling by hand pauses it until you press Follow.")}>
        <Switch checked={follow} onChange={(followStandby) => useSettings.getState().update({ followStandby })} label={t("The script follows the standby")} />
      </Row>
    </SettingsSection>
  );
}
