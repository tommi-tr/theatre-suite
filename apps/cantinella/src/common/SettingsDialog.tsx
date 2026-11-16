import { LANGS, useT, type Lang, type ThemePref } from "@theatre-suite/core";
import { AppLogo, Button, Dialog, Segmented } from "@theatre-suite/ui";
import { APP_NAME, LOGO } from "../lib/version";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

export function SettingsDialog() {
  const t = useT();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <Dialog
      title={t("Settings")}
      icon="settings"
      onClose={() => useUi.getState().closeDialog()}
      width={520}
      footer={
        <>
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={() => useUi.getState().closeDialog()}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div className="cn-settings">
        <div className="cn-settings__row">
          <div>
            <div className="cn-settings__name">{t("Appearance")}</div>
            <div className="ts-field__hint">{t("Light is easier to read in the office; dark is better backstage.")}</div>
          </div>
          <Segmented<ThemePref>
            ariaLabel={t("Appearance")}
            small
            value={s.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: "light", label: t("Light"), icon: "sun" },
              { value: "dark", label: t("Dark"), icon: "moon" },
              { value: "system", label: t("Like the system"), icon: "monitor" },
            ]}
          />
        </div>
        <div className="cn-settings__row">
          <div className="cn-settings__name">{t("Language")}</div>
          <Segmented<Lang> ariaLabel={t("Language")} small value={s.language} onChange={(language) => update({ language })} options={LANGS} />
        </div>
        <div className="cn-settings__about">
          <AppLogo accentPath={LOGO.accent} inkPath={LOGO.ink} label="Cantinella" size={40} strokeWidth={5.5} />
          <div>
            <div className="cn-settings__name">{APP_NAME}</div>
            <div className="ts-field__hint">{t("Production of a show: rehearsals, budget, departments, tour. Part of the Theatre Suite.")}</div>
            <div className="ts-field__hint">{t("Everything stays on this computer: Cantinella does not use the internet and sends nothing.")}</div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
