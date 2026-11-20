import { LANGS, useT, type Lang, type ThemePref } from "@theatre-suite/core";
import {
  AppLogo,
  Button,
  Dialog,
  Range,
  Segmented,
  SettingsFooter,
  SettingsLayout,
  SettingsRow as Row,
  SettingsSection,
  type SettingsCategory,
} from "@theatre-suite/ui";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isTauri } from "../lib/api";
import { APP_NAME, APP_VERSION, LOGO } from "../lib/version";
import { useSettings, type ArrowKeys, type Paper } from "../store/settings";
import { useUi, type SettingsTab } from "../store/ui";
import { KeysPane } from "../settings/KeysPane";
import { LinkPane } from "../settings/LinkPane";
import { OutputsPane } from "../settings/OutputsPane";
import { SoonPill } from "./ComingSoon";

/** Stable reference: Dialog refocuses its first button whenever `onClose` changes. */
const close = () => useUi.getState().closeDialog();

const PROJECT_PAGE = "https://github.com/tommi-tr/theatre-suite";

const TABS: (SettingsCategory<SettingsTab> & { label: string })[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "script", label: "Script", icon: "pages" },
  { id: "keys", label: "Keys", icon: "keyboard" },
  { id: "link", label: "Link", icon: "link" },
  { id: "outputs", label: "Outputs", icon: "plug" },
  { id: "projections", label: "Projections", icon: "image" },
  { id: "test", label: "Test", icon: "check" },
  { id: "about", label: "About", icon: "info" },
];

/** Settings, with the categories of 13_cue.md on the left. Every change applies at once and is kept. */
export function SettingsDialog() {
  const t = useT();
  const tab = useUi((x) => x.settingsTab);
  return (
    <Dialog
      title={t("Settings")}
      icon="settings"
      onClose={close}
      closeLabel={t("Close")}
      width={820}
      footer={<SettingsFooter text={`Cue ${APP_VERSION} · Theatre Suite`} doneLabel={t("Done")} onDone={close} />}
    >
      <SettingsLayout
        categories={TABS.map((x) => ({ ...x, label: t(x.label) }))}
        active={tab}
        onSelect={(id) => useUi.getState().setSettingsTab(id)}
        label={t("Settings")}
        height={480}
      >
        {tab === "general" ? (
          <GeneralPane />
        ) : tab === "script" ? (
          <ScriptPane />
        ) : tab === "keys" ? (
          <KeysPane />
        ) : tab === "link" ? (
          <LinkPane />
        ) : tab === "outputs" ? (
          <OutputsPane />
        ) : tab === "projections" ? (
          <LaterPane
            version="0.5"
            title={t("Projections")}
            about={[
              t("The output screen (the second screen of this computer) and the blank image: black or one of your choice."),
              t("Images and videos (MP4 H.264) with transitions and colour."),
              t("PowerPoint: slides imported as images, or PowerPoint itself driven live."),
            ]}
          />
        ) : tab === "test" ? (
          <LaterPane
            version="0.6"
            title={t("Reliability tests")}
            about={[
              t("Tests of the outputs and of the link, with a report you can keep."),
              t("Dry run: the whole show in silence, nothing sent to lights, sound or screens."),
            ]}
          />
        ) : (
          <AboutPane />
        )}
      </SettingsLayout>
    </Dialog>
  );
}

function GeneralPane() {
  const t = useT();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <>
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
      <Row label={t("Language")}>
        <Segmented<Lang> small ariaLabel={t("Language")} value={s.language} onChange={(language) => update({ language })} options={LANGS} />
      </Row>
    </>
  );
}

/** Settings → Copione: the paper (independent of the app theme) and what ← → do. */
function ScriptPane() {
  const t = useT();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <>
      <Row label={t("Paper of the script")} hint={t("Separate from the appearance of Cue: dark paper inverts the page, for a dark booth.")}>
        <Segmented<Paper>
          small
          ariaLabel={t("Paper of the script")}
          value={s.paper}
          onChange={(paper) => update({ paper })}
          options={[
            { value: "white", label: t("White paper"), icon: "sun" },
            { value: "dark", label: t("Dark paper"), icon: "moon" },
          ]}
        />
      </Row>
      <Row label={t("Brightness of the dark paper")} hint={t("Lower it if the script lights up the booth too much.")}>
        <span className="cue-set-range">
          <Range
            value={s.paperBrightness}
            min={40}
            max={100}
            step={5}
            width={150}
            disabled={s.paper !== "dark"}
            label={t("Brightness of the dark paper")}
            onChange={(paperBrightness) => update({ paperBrightness })}
          />
          <span className="cue-set-range__value">{s.paperBrightness}%</span>
        </span>
      </Row>
      <div className="cue-paper-preview" aria-hidden="true">
        <PaperSample paper="white" brightness={100} active={s.paper === "white"} label={t("White paper")} />
        <PaperSample paper="dark" brightness={s.paperBrightness} active={s.paper === "dark"} label={t("Dark paper")} />
      </div>
      <Row label={t("Arrows ← →")} hint={t("Also A and D. The script scrolls with the wheel, ↑ ↓ or W S.")}>
        <Segmented<ArrowKeys>
          small
          ariaLabel={t("Arrows ← →")}
          value={s.arrowKeys}
          onChange={(arrowKeys) => update({ arrowKeys })}
          options={[
            { value: "zoom", label: t("Zoom"), icon: "zoom" },
            { value: "page", label: t("Change page"), icon: "pages" },
          ]}
        />
      </Row>
    </>
  );
}

/** A small page of script on the chosen paper. */
function PaperSample({ paper, brightness, active, label }: { paper: Paper; brightness: number; active: boolean; label: string }) {
  return (
    <div className={`cue-paper${active ? " cue-paper--active" : ""}`}>
      <div className={`cue-paper__page cue-paper__page--${paper}`} style={paper === "dark" ? { filter: `brightness(${brightness / 100})` } : undefined}>
        <b>ATTO PRIMO</b>
        <i>Scena prima</i>
        <span>
          <b>MARCHESE</b> Fra voi e me vi è qualche differenza.
        </span>
        <span>
          <b>CONTE</b> Sulla locanda tanto vale il vostro denaro, quanto vale il mio.
        </span>
      </div>
      <span className="cue-paper__label">{label}</span>
    </div>
  );
}

/** A category whose settings arrive with a later version. */
function LaterPane({ version, title, about }: { version: string; title: string; about: string[] }) {
  return (
    <SettingsSection badge={<SoonPill version={version} />} title={title}>
      <ul>
        {about.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </SettingsSection>
  );
}

function AboutPane() {
  const t = useT();
  const instance = useUi((s) => s.instance);
  const copy = async () => {
    try {
      if (isTauri) await writeText(PROJECT_PAGE);
      else await navigator.clipboard.writeText(PROJECT_PAGE);
      useUi.getState().showToast(t("Address copied."));
    } catch (e) {
      useUi.getState().showToast(String(e), "error");
    }
  };
  return (
    <div className="cue-set-about">
      <AppLogo accentPath="" accentDots={LOGO.dots} inkPath={LOGO.ink} label="Cue" size={44} strokeWidth={LOGO.stroke(44)} />
      <div>
        <div className="ts-set-row__label">
          {APP_NAME}
          {instance > 1 ? (
            <span className="ts-pill" style={{ marginLeft: 8 }}>
              {t("Instance {n}", { n: instance })}
            </span>
          ) : null}
        </div>
        <div className="ts-field__hint">
          {t(
            "The stage manager's digital prompt book: the script with its GOs, and the command of lights, sound and images during the show. Part of the Theatre Suite.",
          )}
        </div>
        <div className="ts-field__hint">{t("Everything stays on this computer: Cue does not use the internet and sends nothing.")}</div>
        <div className="ts-field__hint">{t("While Cue is open, Windows does not go to sleep and the screen stays on.")}</div>
        <div className="cue-set-link">
          <span className="ts-muted">{t("Code and versions")}</span>
          <span className="cue-set-link__url">github.com/tommi-tr/theatre-suite</span>
          <Button variant="sm" icon="copy" onClick={() => void copy()}>
            {t("Copy the address")}
          </Button>
        </div>
      </div>
    </div>
  );
}
