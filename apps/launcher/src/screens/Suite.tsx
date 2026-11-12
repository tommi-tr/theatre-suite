import { useLang, useT } from "@theatre-suite/core";
import { Button, Icon, Switch } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { APPS, appDef } from "../lib/apps";
import { fmtDate } from "../lib/format";
import { openLink, pickProgram } from "../lib/pick";
import { explain, plural } from "../lib/text";
import type { AppStatus } from "../lib/types";
import { useStore } from "../state/store";
import { AppIcon, LauncherMark } from "../components/AppLogos";

/** Who made the suite and what it stands on. Plain text: change it here. */
const CREDITS = {
  made: "Designed by tommi-tr, built together with Claude (Anthropic).",
  libraries: "Built with free software: Tauri, React, Rust, ProseMirror, cpal and symphonia.",
};

export function SuiteScreen() {
  const t = useT();
  const lang = useLang();
  const apps = useStore((s) => s.apps);
  const checking = useStore((s) => s.checking);
  const settings = useStore((s) => s.settings)!;
  const { go, checkUpdates, saveSettings, setDialog } = useStore.getState();
  const everyApp = apps ? [apps.launcher, ...APPS.map((d) => apps.apps.find((a) => a.id === d.id)).filter((a): a is AppStatus => !!a)] : [];
  const waiting = everyApp.filter((a) => a.status.state === "available").length;

  return (
    <div className="ln-suitepage">
      <header className="ln-pagehead">
        <button type="button" className="ln-back ln-back--plain" onClick={() => go({ name: "home" })}>
          <Icon name="arrowLeft" size={15} />
          {t("Back")}
        </button>
        <h1>{t("Explore, install and update")}</h1>
        <p>{t("Here you see what each app of the suite does, which ones are on this computer and which versions exist. You decide when to update and what to install.")}</p>
      </header>

      <section className="ln-checkbar" aria-label={t("Updates")}>
        <div className="ln-checkbar__text">
          <strong>
            {apps?.error
              ? t("The check could not be done")
              : waiting > 0
                ? plural(t, waiting, "1 update available", "{n} updates available")
                : settings.lastCheck
                  ? t("Everything is up to date")
                  : t("Never checked")}
          </strong>
          {apps?.error ? (
            <span className="ln-dim">{explain(t, apps.error)}</span>
          ) : (
            <span className="ln-dim">
              {settings.lastCheck ? `${t("Last check: {date}", { date: fmtDate(settings.lastCheck, lang) })} · ` : ""}
              {t("Checking only looks for news: nothing is downloaded or installed.")}
            </span>
          )}
        </div>
        <label className="ln-checkbar__weekly">
          <Switch checked={settings.weeklyCheck} onChange={(v) => void saveSettings({ weeklyCheck: v, updateNoticeSeen: true })} label={t("Check automatically once a week")} />
          <span>{t("Check automatically once a week")}</span>
        </label>
        <Button icon="download" disabled={checking} onClick={() => void checkUpdates()}>
          {checking ? t("Checking…") : t("Check now")}
        </Button>
      </section>

      <div className="ln-approws">
        {apps ? <AppRow status={apps.launcher} launcher checked={settings.lastCheck > 0 && !apps.error} /> : null}
        {apps
          ? APPS.map((def) => {
              // Apps still being designed are listed too, so the whole suite can be explored.
              const st = apps.apps.find((a) => a.id === def.id) ?? { id: def.id, name: def.name, installed: null, status: { state: "notInstalled" as const }, latest: null };
              return <AppRow key={def.id} status={st} checked={settings.lastCheck > 0 && !apps.error} />;
            })
          : null}
      </div>

      <div className="ln-aboutgrid">
        <section className="ln-aboutcard">
          <h3>
            <Icon name="message" size={15} />
            {t("Feedback")}
          </h3>
          <p>{t("Found a problem, or have an idea? Tell us: it is the best way to make the apps better.")}</p>
          <Button variant="primary" icon="message" onClick={() => setDialog({ kind: "feedback" })}>
            {t("Send feedback")}
          </Button>
        </section>
        <section className="ln-aboutcard">
          <h3>
            <Icon name="info" size={15} />
            {t("Credits")}
          </h3>
          <p>{t(CREDITS.made)}</p>
          <p className="ln-dim">{t(CREDITS.libraries)}</p>
          <p className="ln-dim">© 2026 Theatre Suite</p>
        </section>
      </div>

      <p className="ln-offline">
        <Icon name="lock" size={14} />
        {t("Works without internet. Your shows stay on your computer and do not train AI.")}
      </p>
    </div>
  );
}

const LAUNCHER_ABOUT = "The program you are using now: it keeps your shows together and starts the other apps.";

function AppRow({ status, launcher, checked }: { status: AppStatus; launcher?: boolean; checked: boolean }) {
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
      {launcher ? <LauncherMark size={44} /> : <AppIcon id={status.id} size={44} />}
      <div className="ln-approw__main">
        <div className="ln-approw__name">
          {status.name}
          {launcher ? <span className="ln-dim"> · {t("this program")}</span> : null}
        </div>
        <div className="ln-approw__about">{t(launcher ? LAUNCHER_ABOUT : (def?.about ?? ""))}</div>
        <div className="ln-approw__line">
          {installed ? (
            <>
              <span>{installed.version ? t("Installed version: {v}", { v: installed.version }) : t("Version unknown")}</span>
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
        ) : st.state === "unknown" && installed && checked ? (
          <span className="ln-chip ln-chip--off">{t("No version published")}</span>
        ) : null}
        {!installed && !def?.soon && status.latest?.url ? (
          <Button variant="sm" icon="download" onClick={() => void openLink(status.latest!.url)}>{t("Download")}</Button>
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
