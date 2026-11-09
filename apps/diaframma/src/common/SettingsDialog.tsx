import { useEffect, useState, type ReactNode } from "react";
import { LANGS, useT, type Lang } from "@theatre-suite/core";
import { Button, Dialog, Icon, Segmented, Switch, type IconName } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { APP_VERSION } from "../lib/version";
import { useSettings, DEFAULT_SETTINGS, type Settings } from "../state/settings";
import { matchVolumes, useDoc } from "../state/doc";
import { useUi } from "../state/ui";
import { restoreStandardPads } from "./Launchpad";
import { TestDialog } from "./TestDialog";
import type { OthersOnGo } from "../state/types";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="df-set-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="df-set-row__label">{label}</div>
        {hint ? <div className="ts-field__hint">{hint}</div> : null}
      </div>
      <div className="df-set-row__ctl">{children}</div>
    </div>
  );
}

function Seconds({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(String(value).replace(".", ","));
  useEffect(() => setText(String(value).replace(".", ",")), [value]);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input
        className="ts-input ts-number"
        aria-label={label}
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => {
          const v = Number(text.replace(",", "."));
          if (Number.isFinite(v) && v >= 0 && v <= 60) onChange(Math.round(v * 10) / 10);
          else setText(String(value).replace(".", ","));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
      <span className="ts-muted">s</span>
    </span>
  );
}

type Tab = "general" | "show" | "rehearsal" | "launchpad" | "connections" | "test" | "about";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "show", label: "Show", icon: "curtain" },
  { id: "rehearsal", label: "Rehearsal", icon: "headphones" },
  { id: "launchpad", label: "Launchpad", icon: "grid" },
  { id: "connections", label: "Connections", icon: "wifi" },
  { id: "test", label: "Test", icon: "check" },
  { id: "about", label: "About", icon: "info" },
];

const EXTENSION_PAGE = "https://github.com/tommi-tr/theatre-suite/releases/latest";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  const [tab, setTab] = useState<Tab>("general");
  const [testOpen, setTestOpen] = useState(false);
  const [devices, setDevices] = useState<string[]>([]);
  useEffect(() => {
    api.engineDevices().then(setDevices).catch(() => setDevices([]));
  }, []);
  const set = (p: Partial<Settings>) => update(p);
  const others: { value: OthersOnGo; label: string }[] = [
    { value: "fadeOut", label: t("Quick fade") },
    { value: "stop", label: t("Stop") },
    { value: "keep", label: t("Keep playing") },
  ];
  return (
    <>
      <Dialog
        title={t("Settings")}
        icon="settings"
        onClose={onClose}
        width={840}
        footer={
          <>
            <span className="ts-muted" style={{ fontSize: 11.5 }}>
              Diaframma {APP_VERSION} · Theatre Suite
            </span>
            <span className="ts-spacer" />
            <Button variant="primary" icon="check" onClick={onClose}>
              {t("Done")}
            </Button>
          </>
        }
      >
        <div className="df-settings">
          <div className="df-settabs" role="tablist" aria-label={t("Settings")}>
            {TABS.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className="df-settab" onClick={() => setTab(x.id)}>
                <Icon name={x.icon} size={14} />
                {t(x.label)}
              </button>
            ))}
          </div>
          <div className="df-setpane" role="tabpanel">
            {tab === "general" ? (
              <>
                <Row label={t("Language")}>
                  <Segmented small ariaLabel={t("Language")} value={s.language} onChange={(v: Lang) => set({ language: v })} options={LANGS.map((l) => ({ value: l.value, label: l.label }))} />
                </Row>
                <Row label={t("Theme")}>
                  <Segmented
                    small
                    ariaLabel={t("Theme")}
                    value={s.theme}
                    onChange={(v) => set({ theme: v })}
                    options={[
                      { value: "dark", label: t("Dark"), icon: "moon" },
                      { value: "light", label: t("Light"), icon: "sun" },
                      { value: "system", label: t("Like Windows"), icon: "monitor" },
                    ]}
                  />
                </Row>
                <Row label={t("Waveform")} hint={t("Mirror: above and below the line. Rectified: only above the baseline.")}>
                  <Segmented
                    small
                    ariaLabel={t("Waveform")}
                    value={s.waveStyle}
                    onChange={(v) => set({ waveStyle: v })}
                    options={[
                      { value: "mirror", label: t("Mirror") },
                      { value: "bottom", label: t("Rectified") },
                    ]}
                  />
                </Row>
              </>
            ) : null}

            {tab === "show" ? (
              <>
                <Row label={t("Audio output (Show mode)")} hint={t("Where the cue list plays.")}>
                  <select className="ts-select" style={{ width: 240 }} value={s.outputDevice ?? ""} onChange={(e) => set({ outputDevice: e.currentTarget.value || null })} aria-label={t("Audio output (Show mode)")}>
                    <option value="">{t("Windows default output")}</option>
                    {devices.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    {s.outputDevice && !devices.includes(s.outputDevice) ? <option value={s.outputDevice}>{s.outputDevice} ({t("not connected")})</option> : null}
                  </select>
                </Row>
                <Row label={t("After GO, attention moves to the next track")}>
                  <Switch checked={s.autoAdvance} onChange={(v) => set({ autoAdvance: v })} label={t("After GO, attention moves to the next track")} />
                </Row>
                <Row label={t("Numbering starts from")}>
                  <Segmented small ariaLabel={t("Numbering starts from")} value={String(s.numberFrom) as "0" | "1"} onChange={(v) => set({ numberFrom: v === "0" ? 0 : 1 })} options={[{ value: "0", label: "0" }, { value: "1", label: "1" }]} />
                </Row>
                <Row label={t("The track that plays is the first row on screen")} hint={t("Useful with long cue lists: the list scrolls by itself at every GO.")}>
                  <Switch checked={s.followPlaying} onChange={(v) => set({ followPlaying: v })} label={t("The track that plays is the first row on screen")} />
                </Row>
                <Row label={t("Automatic equalizer")} hint={t("Moves the volume fader of every track so they sound the same (it never makes a track clip). You can undo it with the undo shortcut.")}>
                  <Button
                    variant="sm"
                    icon="volume"
                    disabled={useDoc.getState().locked}
                    onClick={() => {
                      const r = matchVolumes();
                      useUi
                        .getState()
                        .showToast(
                          r.changed
                            ? t("Volumes matched: {n} tracks changed.", { n: r.changed })
                            : r.skipped
                              ? t("Wait until every track has been read, then try again.")
                              : t("The tracks are already equally loud."),
                        );
                    }}
                  >
                    {t("Match volumes")}
                  </Button>
                </Row>
                <Row label={t("At GO, a track on air that has no exit")} hint={t("GO always starts the attention track. A track on air with its own exit (Fade out, Crossfade, Next) follows it; the others do this.")}>
                  <Segmented small ariaLabel={t("At GO, a track on air that has no exit")} value={s.othersOnGo === "pause" ? "fadeOut" : s.othersOnGo} onChange={(v) => set({ othersOnGo: v })} options={others} />
                </Row>
                <Row label={t("Quick fade")} hint={t("The short fade of the tracks that leave at GO without an exit.")}>
                  <Seconds label={t("Quick fade")} value={s.quickFadeSec} onChange={(v) => set({ quickFadeSec: v })} />
                </Row>
                <Row label={t("Fade in")}>
                  <Seconds label={t("Fade in")} value={s.fadeInSec} onChange={(v) => set({ fadeInSec: v })} />
                </Row>
                <Row label={t("Fade out")}>
                  <Seconds label={t("Fade out")} value={s.fadeOutSec} onChange={(v) => set({ fadeOutSec: v })} />
                </Row>
                <Row label={t("Crossfade")}>
                  <Seconds label={t("Crossfade")} value={s.crossfadeSec} onChange={(v) => set({ crossfadeSec: v })} />
                </Row>
                <Row label={t("Stop all (Esc)")} hint={t("Esc fades out everything; Esc twice stops at once.")}>
                  <Seconds label={t("Stop all (Esc)")} value={s.stopAllSec} onChange={(v) => set({ stopAllSec: v })} />
                </Row>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                  <Button
                    variant="sm"
                    icon="reset"
                    onClick={() =>
                      set({
                        fadeInSec: DEFAULT_SETTINGS.fadeInSec,
                        fadeOutSec: DEFAULT_SETTINGS.fadeOutSec,
                        crossfadeSec: DEFAULT_SETTINGS.crossfadeSec,
                        quickFadeSec: DEFAULT_SETTINGS.quickFadeSec,
                        stopAllSec: DEFAULT_SETTINGS.stopAllSec,
                        othersOnGo: DEFAULT_SETTINGS.othersOnGo,
                        autoAdvance: DEFAULT_SETTINGS.autoAdvance,
                      })
                    }
                  >
                    {t("Default times")}
                  </Button>
                </div>
              </>
            ) : null}

            {tab === "rehearsal" ? (
              <Row label={t("Automatic output choice")} hint={t("Every program stays on the output chosen in Diaframma, even when Windows changes its default output. Everything goes back as it was when Diaframma closes.")}>
                <Switch checked={s.pinOutputs} onChange={(v) => set({ pinOutputs: v })} label={t("Automatic output choice")} />
              </Row>
            ) : null}

            {tab === "launchpad" ? (
              <>
                <Row label={t("Launchpad active")} hint={t("On: the keys of the launchpad also play in Show and Rehearsal mode.")}>
                  <Switch checked={s.launchpadOn} onChange={(v) => set({ launchpadOn: v })} label={t("Launchpad active")} />
                </Row>
                <Row label={t("Standard sounds")} hint={t("Puts back the sounds that come with Diaframma (your own sounds stay).")}>
                  <Button variant="sm" icon="reset" onClick={() => (restoreStandardPads(), useUi.getState().showToast(t("Standard sounds are back.")))}>
                    {t("Put them back")}
                  </Button>
                </Row>
              </>
            ) : null}

            {tab === "connections" ? (
              <>
                <Row label={t("Phone remote")} hint={t("A page on your Wi-Fi to press GO from your phone. Set it up from the Phone button.")}>
                  <Switch checked={s.phoneEnabled} onChange={(v) => set({ phoneEnabled: v })} label={t("Phone remote")} />
                </Row>
                <Row label={t("Chrome extension")} hint={t("Lets Diaframma control each Chrome tab separately in Rehearsal mode.")}>
                  <Switch checked={s.extensionBridgeEnabled} onChange={(v) => set({ extensionBridgeEnabled: v })} label={t("Chrome extension")} />
                </Row>
                <Row label={t("Download the Chrome extension")} hint={t("On the page that opens, download “Diaframma-Chrome-extension”, unzip it and load it in Chrome (chrome://extensions, Developer mode).")}>
                  <Button variant="sm" icon="download" onClick={() => api.openProjectPage(EXTENSION_PAGE).catch((e) => useUi.getState().showToast(String(e), "error"))}>
                    {t("Open the download page")}
                  </Button>
                </Row>
              </>
            ) : null}

            {tab === "test" ? (
              <Row label={t("Reliability test")} hint={t("Plays your cue list without sound, several times in a row, and tells you in plain words whether every GO does what you set up.")}>
                <Button icon="check" onClick={() => setTestOpen(true)}>
                  {t("Open the test")}
                </Button>
              </Row>
            ) : null}

            {tab === "about" ? (
              <>
                <Row label="Diaframma" hint={t("Part of the Theatre Suite.")}>
                  <span className="mono">{APP_VERSION}</span>
                </Row>
                <Row label={t("Your files")} hint={t("Cue lists are readable files that belong to you. Audio files are never changed: Diaframma only reads them.")}>
                  <span />
                </Row>
              </>
            ) : null}
          </div>
        </div>
      </Dialog>
      {testOpen ? <TestDialog onClose={() => setTestOpen(false)} /> : null}
    </>
  );
}
