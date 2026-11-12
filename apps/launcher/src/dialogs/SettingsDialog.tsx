import { useEffect, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Segmented, Switch } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { pickFolder } from "../lib/pick";
import type { Settings } from "../lib/types";
import { useStore } from "../state/store";

export function SettingsDialog() {
  const t = useT();
  const settings = useStore((s) => s.settings)!;
  const save = useStore.getState().saveSettings;
  const [version, setVersion] = useState("");
  useEffect(() => {
    void api.appInfo().then((i) => setVersion(i.version)).catch(() => {});
  }, []);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => void save({ [k]: v } as Partial<Settings>);

  return (
    <Dialog title={t("Settings")} icon="settings" width={540} onClose={() => useStore.getState().setDialog(null)} footer={<Button variant="primary" onClick={() => useStore.getState().setDialog(null)}>{t("Done")}</Button>}>
      <div className="ln-form">
        <div className="ln-setting">
          <div><strong>{t("Language")}</strong></div>
          <Segmented<Settings["language"]> ariaLabel={t("Language")} value={settings.language} onChange={(v) => set("language", v)} options={[{ value: "it", label: "Italiano" }, { value: "en", label: "English" }]} />
        </div>
        <div className="ln-setting">
          <div><strong>{t("Appearance")}</strong></div>
          <Segmented<Settings["theme"]>
            ariaLabel={t("Appearance")}
            value={settings.theme}
            onChange={(v) => set("theme", v)}
            options={[
              { value: "system", label: t("Like the system"), icon: "monitor" },
              { value: "light", label: t("Light"), icon: "sun" },
              { value: "dark", label: t("Dark"), icon: "moon" },
            ]}
          />
        </div>
        <div className="ln-setting">
          <div>
            <strong>{t("Check for new versions once a week")}</strong>
            <small>{t("It only looks for news. It never downloads or installs anything by itself.")}</small>
          </div>
          <Switch checked={settings.weeklyCheck} onChange={(v) => void save({ weeklyCheck: v, updateNoticeSeen: true })} label={t("Check for new versions once a week")} />
        </div>
        <div className="ln-setting">
          <div>
            <strong>{t("Folder for new shows")}</strong>
            <small>{settings.showsDir ?? t("Documents / Theatre Suite")}</small>
          </div>
          <Button onClick={() => void pickFolder(t("Folder for new shows"), settings.showsDir ?? undefined).then((d) => d && set("showsDir", d))}>{t("Change…")}</Button>
        </div>
        <p className="ln-privacy">{t("Your shows stay on this computer. Nothing is sent anywhere unless you ask for it.")}</p>
        {version ? <p className="ln-dim">{t("Theatre Suite version {v}", { v: version })}</p> : null}
      </div>
    </Dialog>
  );
}
