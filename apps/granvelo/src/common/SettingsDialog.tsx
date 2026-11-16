import type { ReactNode } from "react";
import { LANGS, useT, type Lang, type ThemePref } from "@theatre-suite/core";
import { AppLogo, Button, Dialog, Icon, Segmented, confirmYesNo, type IconName } from "@theatre-suite/ui";
import { APP_NAME, APP_VERSION, LOGO } from "../lib/version";
import { setMemoryBinding } from "../model/memories";
import type { MemoryBinding } from "../model/types";
import { useDoc } from "../store/doc";
import { useSettings, type PreviewDetail, type Units } from "../store/settings";
import { useUi, type SettingsTab } from "../store/ui";
import { DecimalInput } from "./DecimalInput";

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
            <div className="gv-set-note">
              <h3>{t("Reliability test")}</h3>
              <p>{t("The test plays the whole sequence of memories without sending anything to the lights, and then writes a short report: how long each transition took and whether anything went wrong. Useful before the first performance and on an old computer.")}</p>
              <p className="ts-muted">{t("It arrives with Granvelo 0.5, together with the Show mode.")}</p>
            </div>
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

function DmxPane() {
  const t = useT();
  return (
    <div className="gv-set-note">
      <h3>{t("The cable to the lights")}</h3>
      <p>{t("Granvelo commands the lights through a USB-DMX cable. It will recognise the two common families by itself: “Pro” cables (Enttec DMX USB Pro, DMXking and their copies) and “Open DMX” cables (simple FTDI ones). You will be able to choose the type by hand here, and send a test to check that the lights answer.")}</p>
      <p>{t("Nothing is installed on Windows for this: the drivers of the cables come from Windows Update.")}</p>
      <p className="ts-muted">{t("The DMX output arrives with Granvelo 0.2. Until then Granvelo never sends anything to any device.")}</p>
    </div>
  );
}

function PreviewPane({ value, onChange }: { value: PreviewDetail; onChange: (v: PreviewDetail) => void }) {
  const t = useT();
  const options: { value: PreviewDetail; label: string; text: string }[] = [
    { value: "essential", label: t("Essential"), text: t("Pools of light as plain ellipses, no beams or shadows: for old or slow computers.") },
    { value: "medium", label: t("Medium"), text: t("Soft pools of light and see-through beams.") },
    { value: "high", label: t("High"), text: t("Shadows of the scenery, beams in the smoke, halogens warmer when dimmed.") },
    { value: "auto", label: t("Automatic"), text: t("Granvelo measures how smooth the preview is and proposes the level.") },
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
      <p className="ts-muted gv-set-foot">{t("The stage preview arrives with Granvelo 0.3; the levels High and Automatic with Granvelo 0.6.")}</p>
    </>
  );
}

function MemoriesPane() {
  const t = useT();
  const doc = useDoc((x) => x.doc);
  if (!doc) {
    return (
      <div className="gv-set-note">
        <h3>{t("Memories")}</h3>
        <p>{t("These settings belong to the show and are saved in its file. Create or open a show to change them.")}</p>
      </div>
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
    </>
  );
}
