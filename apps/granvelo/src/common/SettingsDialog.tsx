import { useEffect, useMemo, type ReactNode } from "react";
import { LANGS, useT, type Lang, type ThemePref } from "@theatre-suite/core";
import { AppLogo, Button, Dialog, Icon, Segmented, confirmYesNo, type IconName } from "@theatre-suite/ui";
import { APP_NAME, APP_VERSION, LOGO } from "../lib/version";
import { setMemoryBinding } from "../model/memories";
import type { MemoryBinding } from "../model/types";
import { useDoc } from "../store/doc";
import { useSettings, type DmxType, type PreviewDetail, type Units } from "../store/settings";
import { isSending, useOutput } from "../store/output";
import { copyText, devicesReport, type DmxDevice } from "../lib/dmx";
import { occupiedChannels } from "../model/addresses";
import { linkLabel, problemText } from "./OutputChip";
import { useUi, type SettingsTab } from "../store/ui";
import { useMeasure } from "../store/previewDetail";
import { picturesPerSecond } from "../stage/detail";
import { DecimalInput } from "./DecimalInput";
import { ReliabilityPane } from "./ReliabilityPane";

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="gv-set-row">
      <div className="gv-set-row__text">
        <div className="gv-set-row__label">{label}</div>
        {hint ? <div className="ts-field__hint">{hint}</div> : null}
      </div>
      {children ? <div className="gv-set-row__ctl">{children}</div> : null}
    </div>
  );
}

const TABS: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "dmx", label: "DMX output", icon: "plug" },
  { id: "preview", label: "Preview", icon: "eye" },
  { id: "memories", label: "Memories", icon: "bench" },
  { id: "test", label: "Test", icon: "check" },
  { id: "about", label: "About", icon: "info" },
];

/** Settings, with the categories of 10_granvelo.md on the left. */
export function SettingsDialog() {
  const t = useT();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  const tab = useUi((x) => x.settingsTab);
  const close = () => useUi.getState().closeDialog();
  return (
    <Dialog
      title={t("Settings")}
      icon="settings"
      onClose={close}
      closeLabel={t("Close")}
      width={820}
      footer={
        <>
          <span className="ts-muted" style={{ fontSize: 11.5 }}>
            Granvelo {APP_VERSION} · Theatre Suite
          </span>
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={close}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div className="gv-settings">
        <div className="gv-settabs" role="tablist" aria-label={t("Settings")}>
          {TABS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className="gv-settab" onClick={() => useUi.getState().setSettingsTab(x.id)}>
              <Icon name={x.icon} size={14} />
              {t(x.label)}
            </button>
          ))}
        </div>
        <div className="gv-setpane" role="tabpanel">
          {tab === "general" ? (
            <>
              <Row label={t("Language")}>
                <Segmented<Lang> small ariaLabel={t("Language")} value={s.language} onChange={(language) => update({ language })} options={LANGS} />
              </Row>
              <Row label={t("Appearance")} hint={t("Dark is better backstage and does not light up the booth; light is easier to read in daylight.")}>
                <Segmented<ThemePref>
                  small
                  ariaLabel={t("Appearance")}
                  value={s.theme}
                  onChange={(theme) => update({ theme })}
                  options={[
                    { value: "light", label: t("Light"), icon: "sun" },
                    { value: "dark", label: t("Dark"), icon: "moon" },
                    { value: "system", label: t("Like the system"), icon: "monitor" },
                  ]}
                />
              </Row>
              <Row label={t("Intensity")} hint={t("How the levels of the faders are written: DMX steps from 0 to 255, as on a lighting desk, or in percent.")}>
                <Segmented<Units>
                  small
                  ariaLabel={t("Intensity")}
                  value={s.units}
                  onChange={(units) => update({ units })}
                  options={[
                    { value: "dmx", label: "0–255" },
                    { value: "percent", label: "%" },
                  ]}
                />
              </Row>
            </>
          ) : tab === "dmx" ? (
            <DmxPane />
          ) : tab === "preview" ? (
            <PreviewPane value={s.previewDetail} onChange={(previewDetail) => update({ previewDetail })} />
          ) : tab === "memories" ? (
            <MemoriesPane />
          ) : tab === "test" ? (
            <ReliabilityPane />
          ) : (
            <div className="gv-set-about">
              <AppLogo accentPath={LOGO.accent} inkPath={LOGO.ink} label="Granvelo" size={44} strokeWidth={LOGO.stroke(44)} />
              <div>
                <div className="gv-set-row__label">{APP_NAME}</div>
                <div className="ts-field__hint">{t("The lighting desk of a show: stage, lights, desk and memories. Part of the Theatre Suite.")}</div>
                <div className="ts-field__hint">{t("Everything stays on this computer: Granvelo does not use the internet and sends nothing.")}</div>
                <div className="ts-field__hint">{t("Granvelo sends nothing to the lights until you press “Connect”.")}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Settings → Uscita DMX: the cable, its type, the devices found, the test pattern. */
function DmxPane() {
  const t = useT();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  const status = useOutput((x) => x.status);
  const live = useOutput((x) => x.live);
  const devices = useOutput((x) => x.devices);
  const loading = useOutput((x) => x.devicesLoading);
  const browser = useOutput((x) => x.browser);
  const doc = useDoc((x) => x.doc);
  const link = status.link;
  const sending = isSending(status);
  const testing = live.test !== null;
  // The test runs over the channels the show uses (1 … the highest one), or the first 24 without a show.
  const testChannels = useMemo(() => {
    let max = 0;
    for (const f of doc?.fixtures ?? []) if (!f.unused) for (const ch of occupiedChannels(f)) max = Math.max(max, ch);
    return max || 24;
  }, [doc]);
  useEffect(() => {
    void useOutput.getState().init().then(() => useOutput.getState().refreshDevices());
  }, []);
  // Leaving the Settings stops the test: it never keeps running unseen.
  useEffect(() => () => void useOutput.getState().stopTest().catch(() => {}), []);
  const out = useOutput.getState();
  const fail = (e: unknown) => useUi.getState().showToast(String(e), "error");
  const guessText = (d: DmxDevice) =>
    d.guess === "pro"
      ? t("Looks like a Pro cable")
      : d.guess === "ftdi"
        ? t("FTDI chip: Open DMX, or a Pro that Granvelo recognises when connecting")
        : d.guess === "otherUsb"
          ? t("Generic USB adapter: not a known DMX cable")
          : t("Port of the computer: not a DMX cable");
  const hex = (n: number | null) => (n === null ? "" : n.toString(16).toUpperCase().padStart(4, "0"));
  const meta = (d: DmxDevice) =>
    [d.port, d.manufacturer, d.usb ? `USB ${hex(d.vid)}:${hex(d.pid)}` : null, d.serial ? t("serial {s}", { s: d.serial }) : null].filter(Boolean).join(" · ");
  const copy = async () => {
    try {
      await copyText(devicesReport(devices, status, `${APP_NAME} · ${typeof navigator !== "undefined" ? navigator.platform : ""}`));
      useUi.getState().showToast(t("Details copied: paste them in your message to the developers."));
    } catch (e) {
      fail(e);
    }
  };
  const choice = (port: string | null, name: string, sub: string | null, guess: string | null, key: string) => (
    <button key={key} type="button" role="radio" aria-checked={s.dmxDevice === port} className="gv-dmxset__dev" onClick={() => update({ dmxDevice: port })}>
      <span className="gv-dmxset__radio" />
      <span className="gv-dmxset__name">{name}</span>
      {guess ? <span className="gv-dmxset__guess">{guess}</span> : null}
      {sub ? <span className="gv-dmxset__meta">{sub}</span> : null}
    </button>
  );
  const known = s.dmxDevice === null || devices.some((d) => d.port === s.dmxDevice);
  return (
    <>
      <Row
        label={t("Output")}
        hint={
          <span className="gv-dmxset__state">
            <span className={`ts-dot ${link.state === "connected" ? "ts-dot--go" : link.state === "lost" || link.state === "error" ? "ts-dot--stop" : ""}`} />
            {link.state === "error" ? problemText(t, link.code).title : linkLabel(t, link)}
            {status.device ? ` · ${status.device.port}` : ""}
          </span>
        }
      >
        {link.state === "idle" || link.state === "error" ? (
          <Button variant="primary" icon="plug" onClick={() => out.connect().catch(fail)}>
            {t("Connect")}
          </Button>
        ) : (
          <Button icon="x" onClick={() => out.disconnect().catch(fail)}>
            {t("Disconnect")}
          </Button>
        )}
      </Row>
      <Row label={t("Type of cable")} hint={t("Auto recognises both families by itself. Choose by hand only if the lights do not answer.")}>
        <Segmented<DmxType>
          small
          ariaLabel={t("Type of cable")}
          value={s.dmxType}
          onChange={(dmxType) => update({ dmxType })}
          options={[
            { value: "auto", label: t("Auto") },
            { value: "pro", label: "Pro" },
            { value: "open", label: "Open DMX" },
          ]}
        />
      </Row>
      <ul className="gv-dmxset__kinds">
        <li>
          <strong>Pro</strong> · {t("the cable has its own small processor that makes the DMX signal (Enttec DMX USB Pro, DMXking and their copies): the most reliable.")}
        </li>
        <li>
          <strong>Open DMX</strong> · {t("a simple cable with an FTDI chip: the computer makes the signal itself, so keep it free of heavy work during the show.")}
        </li>
      </ul>
      <div className="gv-dmxset__head">
        <span className="gv-set-row__label">{t("Devices found")}</span>
        <span className="ts-spacer" />
        <Button variant="sm" icon="sync" disabled={loading} onClick={() => void out.refreshDevices()}>
          {t("Refresh list")}
        </Button>
        <Button variant="sm" icon="copy" onClick={() => void copy()}>
          {t("Copy the cable details")}
        </Button>
      </div>
      <div className="gv-dmxset__list" role="radiogroup" aria-label={t("Devices found")}>
        {choice(null, t("Automatic choice"), t("The first USB-DMX cable found"), null, "auto")}
        {devices.map((d) => choice(d.port, d.name, meta(d), guessText(d), d.port))}
        {!known && s.dmxDevice ? choice(s.dmxDevice, s.dmxDevice, t("Not connected now"), null, "missing") : null}
        {devices.length === 0 && !loading ? (
          <div className="gv-dmxset__empty">
            {browser
              ? t("In the browser preview there are no cables: use the simulated output.")
              : t("No serial port found. Plug in the cable: its driver comes from Windows Update, then press “Refresh list”.")}
          </div>
        ) : null}
      </div>
      <Row
        label={t("Test the output")}
        hint={
          <>
            {t("Turns on channels 1 to {n} one at a time, at half intensity, to see whether the lights answer.", { n: testChannels })}{" "}
            <span className="gv-dmxset__warn">{t("The connected lights will turn on, even with Blackout or the Grand Master down.")}</span>
          </>
        }
      >
        {testing && live.test ? (
          <span className="gv-dmxset__testing">
            <span className="ts-dot ts-dot--go" />
            {t("Channel {n} of {m}", { n: live.test.channel, m: live.test.of })}
          </span>
        ) : null}
        <Button
          variant={testing ? "danger" : "tool"}
          icon={testing ? "stopF" : "bulb"}
          disabled={!sending && !testing}
          title={sending ? undefined : t("Connect first")}
          onClick={() => (testing ? out.stopTest() : out.startTest(testChannels)).catch(fail)}
        >
          {testing ? t("Stop the test") : t("Start the test")}
        </Button>
      </Row>
      <p className="ts-muted gv-set-foot">
        {t("Nothing is installed on Windows for this: the drivers of the cables come from Windows Update.")}{" "}
        {t("Disconnecting or closing Granvelo leaves the lights as they are: no automatic blackout.")}
      </p>
    </>
  );
}

function PreviewPane({ value, onChange }: { value: PreviewDetail; onChange: (v: PreviewDetail) => void }) {
  const t = useT();
  const auto = useSettings((x) => x.settings.autoDetail);
  const measuring = useMeasure((x) => x.measuring);
  const failed = useMeasure((x) => x.failed);
  const levelName = (l: "essential" | "medium" | "high") => (l === "high" ? t("High") : l === "medium" ? t("Medium") : t("Essential"));
  const options: { value: PreviewDetail; label: string; text: string }[] = [
    { value: "essential", label: t("Essential"), text: t("Pools of light as plain ellipses, no beams or shadows: for old or slow computers.") },
    { value: "medium", label: t("Medium"), text: t("Soft pools of light and see-through beams.") },
    { value: "high", label: t("High"), text: t("Shadows of the scenery, beams in the smoke, halogens warmer when dimmed.") },
    { value: "auto", label: t("Automatic"), text: t("Granvelo measures how smooth the preview is on this computer and chooses the level by itself.") },
  ];
  return (
    <>
      <Row label={t("Detail of the preview")} hint={t("How rich the drawing of the stage is. Less detail keeps the computer free for the lights.")}>
        <Segmented<PreviewDetail> small ariaLabel={t("Detail of the preview")} value={value} onChange={onChange} options={options.map((o) => ({ value: o.value, label: o.label }))} />
      </Row>
      <ul className="gv-set-list">
        {options.map((o) => (
          <li key={o.value} aria-current={o.value === value ? "true" : undefined}>
            <strong>{o.label}</strong> · {o.text}
          </li>
        ))}
      </ul>
      {value === "auto" ? (
        <div className="gv-set-note" aria-live="polite">
          <h3>{t("Automatic: what was measured")}</h3>
          {measuring ? (
            <p>{t("Measuring… Granvelo is drawing a test stage for a couple of seconds. The screen may stutter for a moment.")}</p>
          ) : failed ? (
            <p>{t("This computer cannot draw the stage in 3D: the flat views from above and from the front are used, which are light.")}</p>
          ) : auto ? (
            auto.ms > 0 ? (
              <p>
                {t("On this computer the richest preview is drawn at about {n} pictures a second. Level in use: {level}.", { n: picturesPerSecond(auto.ms), level: levelName(auto.level) })}
              </p>
            ) : (
              <p>{t("This computer cannot draw the stage in 3D: the flat views from above and from the front are used, which are light.")}</p>
            )
          ) : (
            <p>{t("Not measured yet: the Medium level is used until the first measurement.")}</p>
          )}
          <p className="ts-muted">{t("The measurement lasts a few seconds, never repeats by itself and sends nothing anywhere. Measure again if you change the computer or its graphics card.")}</p>
          <div>
            <Button variant="sm" icon="reset" disabled={measuring} onClick={() => void useMeasure.getState().measure()}>
              {auto || failed ? t("Measure again") : t("Measure now")}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Fade to black: a setting of this computer (the operator's habit), shown with the memories. */
function FtbRow() {
  const t = useT();
  const ftbSeconds = useSettings((x) => x.settings.ftbSeconds);
  return (
    <Row label={t("Fade to black time")} hint={t("How long “Fade to black” (F in the Show) takes to go dark and to come back. Saved on this computer.")}>
      <DecimalInput value={ftbSeconds} min={0} max={60} decimals={1} label={t("Fade to black time")} unit="s" onChange={(ftbSeconds) => useSettings.getState().update({ ftbSeconds })} />
    </Row>
  );
}

function MemoriesPane() {
  const t = useT();
  const doc = useDoc((x) => x.doc);
  if (!doc) {
    return (
      <>
        <div className="gv-set-note">
          <h3>{t("Memories")}</h3>
          <p>{t("These settings belong to the show and are saved in its file. Create or open a show to change them.")}</p>
        </div>
        <FtbRow />
      </>
    );
  }
  const st = doc.settings;
  const change = (patch: Partial<typeof st>) => useDoc.getState().change((d) => ({ ...d, settings: { ...d.settings, ...patch } }), "settings");
  const switchBinding = async (to: MemoryBinding) => {
    if (to === st.memoryBinding) return;
    if (doc.memories.length > 0) {
      const ok = await confirmYesNo({
        title: t("Change how memories remember the lights?"),
        message:
          to === "fixture"
            ? t("The {n} memories are converted with the addresses the lights have now. Values on channels that no light uses are dropped. You can undo it with Ctrl Z.", { n: doc.memories.length })
            : t("The {n} memories are converted with the addresses the lights have now. Lights without an address lose their values. You can undo it with Ctrl Z.", { n: doc.memories.length }),
        cancel: t("Cancel"),
        confirm: t("Convert the memories"),
        close: t("Close"),
      });
      if (!ok) return;
    }
    useDoc.getState().change((d) => setMemoryBinding(d, to));
  };
  return (
    <>
      <p className="ts-muted gv-set-foot gv-set-foot--top">
        <Icon name="info" size={12} /> {t("These settings belong to the show: they are saved in its file.")}
      </p>
      <Row
        label={t("Memories remember")}
        hint={
          st.memoryBinding === "address"
            ? t("The DMX addresses, like a real desk: a memory is what goes out on the 512 channels. If you change the address of a light, the memories do not follow it.")
            : t("The lights: a memory remembers every light by itself. If you change the address of a light, the memories follow it and are not spoiled.")
        }
      >
        <Segmented<MemoryBinding>
          small
          ariaLabel={t("Memories remember")}
          value={st.memoryBinding}
          onChange={(v) => void switchBinding(v)}
          options={[
            { value: "address", label: t("DMX addresses") },
            { value: "fixture", label: t("The lights") },
          ]}
        />
      </Row>
      <Row label={t("Default crossfade")} hint={t("Time of the transition of a new memory. Every memory can then have its own times.")}>
        <DecimalInput value={st.defaultCrossfade} min={0} max={600} decimals={1} label={t("Default crossfade")} unit="s" onChange={(defaultCrossfade) => change({ defaultCrossfade })} />
      </Row>
      <Row label={t("Emergency memory")} hint={t("What “Emergency” (E E in the Show) brings on stage. All white at full lights the stage for everyone to see.")}>
        <select
          className="ts-select gv-select"
          aria-label={t("Emergency memory")}
          value={st.emergencyMemoryId ?? ""}
          onChange={(e) => change({ emergencyMemoryId: e.currentTarget.value || null })}
        >
          <option value="">{t("All lights white at full")}</option>
          {[...doc.memories]
            .sort((a, b) => a.number - b.number)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.number} · {m.label || t("Memory {n}", { n: m.number })}
              </option>
            ))}
        </select>
      </Row>
      <FtbRow />
    </>
  );
}
