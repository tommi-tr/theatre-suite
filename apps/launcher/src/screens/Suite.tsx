import { useLang, useT } from "@theatre-suite/core";
import { Button, Icon, Switch } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { APPS, appDef } from "../lib/apps";
import { fmtDate } from "../lib/format";
import { openLink, pickProgram } from "../lib/pick";
import { explain } from "../lib/text";
import type { AppStatus } from "../lib/types";
import { useStore } from "../state/store";
import { AppIcon, LauncherMark } from "../components/AppLogos";

export function SuiteScreen() {
  const t = useT();
  const lang = useLang();
  const apps = useStore((s) => s.apps);
  const checking = useStore((s) => s.checking);
  const settings = useStore((s) => s.settings)!;
  const { go, checkUpdates, saveSettings } = useStore.getState();

  return (
    <div className="ln-suitepage">
      <header className="ln-pagehead">
        <button type="button" className="ln-back ln-back--plain" onClick={() => go({ name: "home" })}>
          <Icon name="arrowLeft" size={15} />
          {t("Back")}
        </button>
        <h1>{t("Installations and versions")}</h1>
        <p>{t("Here you see which apps of the suite are on this computer and which versions exist. You decide when to update and what to install.")}</p>
      </header>

      <section className="ln-checkbar">
        <div className="ln-checkbar__text">
          <strong>
            {apps?.error
              ? t("The check could not be done")
              : settings.lastCheck
                ? t("Last check: {date}", { date: fmtDate(settings.lastCheck, lang) })
                : t("Never checked")}
          </strong>
          {apps?.error ? <span className="ln-dim">{apps.error}</span> : <span className="ln-dim">{t("Checking only looks for news: nothing is downloaded or installed.")}</span>}
        </div>
        <label className="ln-checkbar__weekly">
          <Switch checked={settings.weeklyCheck} onChange={(v) => void saveSettings({ weeklyCheck: v, updateNoticeSeen: true })} label={t("Check once a week")} />
          <span>{t("Check once a week")}</span>
        </label>
        <Button icon="download" disabled={checking} onClick={() => void checkUpdates()}>
          {checking ? t("Checking…") : t("Check now")}
        </Button>
      </section>

      <div className="ln-approws">
        {apps ? <AppRow status={apps.launcher} launcher /> : null}
        {APPS.map((def) => {
          const st = apps?.apps.find((a) => a.id === def.id);
          return st ? <AppRow key={def.id} status={st} /> : null;
        })}
      </div>
    </div>
  );
}

function AppRow({ status, launcher }: { status: AppStatus; launcher?: boolean }) {
  const t = useT();
  const def = appDef(status.id);
  const { showToast, refreshApps } = useStore.getState();
  const installed = status.installed;
  const st = status.status;

  const choose = async () => {
    const file = await pickProgram(t("Choose the program of {name}", { name: status.name }));
    if (!file) return;
    try {
      await api.appPathSet(status.id, file);
      await refreshApps();
    } catch (e) {
      showToast(explain(t, e), "error");
    }
  };
  const forget = async () => {
    try {
      await api.appPathSet(status.id, null);
      await refreshApps();
    } catch (e) {
      showToast(explain(t, e), "error");
    }
  };

  return (
    <article className="ln-approw" style={def ? { ["--app" as string]: def.accent.dark } : undefined}>
      {launcher ? <LauncherMark size={38} /> : <AppIcon id={status.id} size={38} />}
      <div className="ln-approw__main">
        <div className="ln-approw__name">
          {status.name}
          {launcher ? <span className="ln-dim"> · {t("this program")}</span> : null}
        </div>
        <div className="ln-approw__line">
          {installed ? (
            <>
              <span>{installed.version ? t("Version {v}", { v: installed.version }) : t("Version unknown")}</span>
              {installed.path ? <span className="ln-dim ln-approw__path" title={installed.path}>{installed.path}</span> : null}
            </>
          ) : def?.soon ? (
            <span className="ln-dim">{t("Coming soon")}</span>
          ) : (
            <span className="ln-dim">{t("Not installed on this computer")}</span>
          )}
        </div>
        {st.state === "available" && status.latest?.notes ? <div className="ln-approw__notes">{status.latest.notes}</div> : null}
      </div>
      <div className="ln-approw__status">
        {st.state === "available" ? (
          <>
            <span className="ln-chip ln-chip--update">{t("New version {v}", { v: st.latest })}</span>
            <Button variant="sm" icon="download" onClick={() => void openLink(st.url)}>{t("See the download")}</Button>
          </>
        ) : st.state === "upToDate" ? (
          <span className="ln-chip ln-chip--ok"><Icon name="check" size={12} strokeWidth={2.6} />{t("Up to date")}</span>
        ) : null}
        {!launcher && !def?.soon ? (
          <>
            <Button variant="sm" onClick={() => void choose()}>{installed ? t("Change location…") : t("It is installed: find it…")}</Button>
            {installed && status.id in (useStore.getState().settings?.appPaths ?? {}) ? (
              <Button variant="sm" onClick={() => void forget()}>{t("Detect automatically")}</Button>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}
