import { type ReactNode, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Icon, Switch } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { APPS, type AppDef, appDef } from "../lib/apps";
import { fmtDate } from "../lib/format";
import { explain, plural } from "../lib/text";
import type { AppStatus, InstallProgress, VersionInfo } from "../lib/types";
import { useStore } from "../state/store";
import { AppIcon, LauncherMark } from "../components/AppLogos";

/** Who made the suite. Plain text: change it here. */
const CREDITS = "Designed by Tommaso Ruscitti, built together with Claude (Anthropic).";

const LAUNCHER_DEF: AppDef = {
  id: "launcher",
  name: "Theatre Suite",
  role: "Shows and apps",
  about: "The program you are using now: it keeps your shows together and starts the other apps.",
  soon: false,
  canCreate: false,
  accent: { dark: "#a7aab3", light: "#4a4e58" },
  logo: { a: "", b: "", accentColor: "#6b5bef" },
};

/** "2026-11-12T…" → seconds, for fmtDate. */
const isoSecs = (iso: string) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0);

export function SuiteScreen() {
  const t = useT();
  const lang = useLang();
  const apps = useStore((s) => s.apps);
  const checking = useStore((s) => s.checking);
  const settings = useStore((s) => s.settings)!;
  const { go, checkUpdates, saveSettings, setDialog } = useStore.getState();
  const everyApp = apps ? [apps.launcher, ...apps.apps] : [];
  const waiting = everyApp.filter((a) => a.status.state === "available").length;
  const me = apps?.launcher.installed?.version ?? "";
  const self = useAppControls(LAUNCHER_DEF, apps?.launcher ?? null);

  return (
    <div className="ln-suitepage">
      <button type="button" className="ln-back ln-back--plain" onClick={() => go({ name: "home" })}>
        <Icon name="arrowLeft" size={15} />
        {t("Back")}
      </button>

      <header className="ln-store-hero">
        <LauncherMark size={64} />
        <div className="ln-store-hero__titles">
          <h1>Theatre Suite</h1>
          <p>{t("Apps for the theatre: sound, scripts and more. Install them, update them, or go back to an earlier version when you need it.")}</p>
          {apps ? (
            <div className="ln-hero-self">
              {self.installed ? (
                <span className="ln-hero-self__ver">
                  {t("Installed")} <strong>{self.installed.version ?? "?"}</strong>
                </span>
              ) : null}
              {self.chip}
              {self.action}
            </div>
          ) : null}
        </div>
        <div className="ln-store-hero__check">
          <div className={`ln-checkstate${apps?.error ? " ln-checkstate--err" : waiting > 0 ? " ln-checkstate--new" : ""}`}>
            <strong>
              {apps?.error
                ? t("The check could not be done")
                : waiting > 0
                  ? plural(t, waiting, "1 update available", "{n} updates available")
                  : settings.lastCheck
                    ? t("Everything is up to date")
                    : t("Never checked")}
            </strong>
            <span>
              {apps?.error
                ? explain(t, apps.error)
                : settings.lastCheck
                  ? t("Last check: {date}", { date: fmtDate(settings.lastCheck, lang) })
                  : t("Press “Check now” to see the versions available.")}
            </span>
          </div>
          <div className="ln-store-hero__actions">
            <Button variant="primary" icon="download" disabled={checking} onClick={() => void checkUpdates()}>
              {checking ? t("Checking…") : t("Check now")}
            </Button>
            <label className="ln-weekly">
              <Switch checked={settings.weeklyCheck} onChange={(v) => void saveSettings({ weeklyCheck: v, updateNoticeSeen: true })} label={t("Check automatically once a week")} />
              <span>{t("Check automatically once a week")}</span>
            </label>
          </div>
        </div>
        {apps ? (
          <div className="ln-store-hero__more">
            <VersionsPanel def={LAUNCHER_DEF} status={apps.launcher} ctl={self} />
          </div>
        ) : null}
      </header>

      <div className="ln-store-grid">
        {APPS.map((def) => {
          const st: AppStatus = apps?.apps.find((a) => a.id === def.id) ?? { id: def.id, name: def.name, installed: null, status: { state: "notInstalled" }, latest: null, versions: [], held: null };
          return <AppCard key={def.id} def={def} status={st} />;
        })}
        <article className="ln-appcard ln-appcard--more">
          <h3>{t("More apps coming soon")}</h3>
          <p>{t("The suite grows: tell us what you would need.")}</p>
          <button type="button" className="ln-textlink" onClick={() => setDialog({ kind: "feedback" })}>{t("Tell us")}</button>
        </article>
      </div>

      <footer className="ln-suitefoot">
        <p>
          <Icon name="lock" size={13} />
          {t("Works without internet. Your shows stay on your computer and do not train AI.")}
        </p>
        <p>
          {t(CREDITS)} <span className="ln-dim">© 2026 Theatre Suite{me ? ` · ${t("version {v}", { v: me })}` : ""}</span>
        </p>
        <p>
          {t("Found a problem, or have an idea?")}{" "}
          <button type="button" className="ln-textlink" onClick={() => setDialog({ kind: "feedback" })}>
            {t("Tell us")}
          </button>
        </p>
      </footer>
    </div>
  );
}

function ProgressLine({ p }: { p: InstallProgress }) {
  const t = useT();
  const pct = p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : null;
  const busy = p.step !== "download" || pct === null;
  return (
    <div className="ln-progress" role="status">
      <div className="ln-progress__bar">
        <span className={busy ? "ln-progress--busy" : ""} style={busy ? undefined : { width: `${pct}%` }} />
      </div>
      <span>
        {p.step === "download"
          ? pct !== null
            ? t("Downloading {v}… {p}%", { v: p.version, p: pct })
            : t("Downloading {v}…", { v: p.version })
          : t("Installing {v}…", { v: p.version })}
      </span>
    </div>
  );
}

/** What an app card (and the Theatre Suite header) shows and does: state chip, main action, "keep". */
function useAppControls(def: AppDef, status: AppStatus | null) {
  const t = useT();
  const installing = useStore((s) => s.installing);
  const checked = useStore((s) => (s.settings?.lastCheck ?? 0) > 0 && !s.apps?.error);
  const { setDialog, showToast } = useStore.getState();
  const isLauncher = def.id === "launcher";
  const installed = status?.installed ?? null;
  const st = status?.status ?? { state: "notInstalled" as const };
  const newest = status?.versions.find((v) => v.installable) ?? null;
  const busyHere = installing?.app === def.id;
  const busyElsewhere = !!installing && !busyHere;
  const soon = def.soon && !installed;
  const ask = (version: string) => setDialog({ kind: "install", app: def.id, version });

  let chip: ReactNode = null;
  if (soon) chip = <span className="ln-chip">{t("Coming soon")}</span>;
  else if (st.state === "available") chip = <span className="ln-chip ln-chip--update">{t("New version {v}", { v: st.latest })}</span>;
  else if (st.state === "held") chip = <span className="ln-chip ln-chip--held"><Icon name="lock" size={11} />{t("Kept on {v}", { v: installed?.version ?? "" })}</span>;
  else if (st.state === "upToDate") chip = <span className="ln-chip ln-chip--ok"><Icon name="check" size={11} strokeWidth={2.6} />{t("Up to date")}</span>;

  let action: ReactNode = null;
  if (busyHere && installing) action = <ProgressLine p={installing} />;
  else if (soon || !status) action = null;
  else if (st.state === "available" && status.versions.some((v) => v.version === st.latest && v.installable))
    action = <Button variant="primary" icon="download" disabled={busyElsewhere} onClick={() => ask(st.latest)}>{t("Update to {v}", { v: st.latest })}</Button>;
  else if (!installed && newest)
    action = <Button variant="primary" icon="download" disabled={busyElsewhere} onClick={() => ask(newest.version)}>{t("Install")}</Button>;
  else if (installed && !isLauncher)
    action = <Button icon="playF" onClick={() => void api.appLaunch(def.id).catch((e) => showToast(explain(t, e), "error"))}>{t("Open")}</Button>;
  else if (!installed && checked) action = <span className="ln-dim ln-small">{t("No version published yet")}</span>;

  return { installed, soon, chip, action, ask, canKeep: !!installed?.version && !soon };
}

type AppControls = ReturnType<typeof useAppControls>;

/** "All versions" (with install of any of them) and "Keep this version". */
function VersionsPanel({ def, status, ctl }: { def: AppDef; status: AppStatus; ctl: AppControls }) {
  const t = useT();
  const lang = useLang();
  const installing = useStore((s) => s.installing);
  const { hold } = useStore.getState();
  const [open, setOpen] = useState(false);
  const { installed, soon, canKeep, ask } = ctl;
  if (soon || (status.versions.length === 0 && !canKeep)) return null;
  return (
    <>
      <div className="ln-appcard__more">
        <button type="button" className="ln-linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? "chevDown" : "chevRight"} size={12} />
          {status.versions.length > 0 ? plural(t, status.versions.length, "1 version", "All versions ({n})") : t("Versions")}
        </button>
        <span className="ln-grow" />
        {canKeep ? (
          <label className="ln-keep" title={t("Useful before a show: the version you have stays as it is, until you choose otherwise.")}>
            <Switch checked={!!status.held} onChange={(v) => void hold(def.id, v)} label={t("Keep this version")} />
            <span>{t("Keep this version")}</span>
          </label>
        ) : null}
      </div>
      {open ? (
        <div className="ln-versions">
          {status.versions.length === 0 ? (
            <p className="ln-dim ln-small">{t("Press “Check now” to see the versions available.")}</p>
          ) : (
            <ul>
              {status.versions.map((v) => (
                <VersionRow key={v.version} v={v} current={installed?.version === v.version} busy={!!installing} onInstall={() => ask(v.version)} lang={lang} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}

function AppCard({ def, status }: { def: AppDef; status: AppStatus }) {
  const t = useT();
  const ctl = useAppControls(def, status);
  const { installed, soon, chip, action } = ctl;

  return (
    <article className={`ln-appcard${soon ? " ln-appcard--soon" : ""}`} style={{ ["--app" as string]: def.accent.dark, ["--app-light" as string]: def.accent.light }}>
      <div className="ln-appcard__top">
        <AppIcon id={def.id} size={52} />
        <div className="ln-appcard__titles">
          <h3>{def.name}</h3>
          <span>{t(def.role)}</span>
        </div>
        {chip}
      </div>
      <p className="ln-appcard__about">{t(def.about)}</p>
      <div className="ln-appcard__foot">
        <div className="ln-appcard__ver">
          {installed ? (
            <>
              <span>{t("Installed")}</span>
              <strong>{installed.version ?? "?"}</strong>
            </>
          ) : soon ? null : (
            <span>{t("Not installed")}</span>
          )}
        </div>
        <span className="ln-grow" />
        {action}
      </div>
      <VersionsPanel def={def} status={status} ctl={ctl} />
    </article>
  );
}

function VersionRow({ v, current, busy, onInstall, lang }: { v: VersionInfo; current: boolean; busy: boolean; onInstall: () => void; lang: string }) {
  const t = useT();
  return (
    <li className={`ln-version${current ? " ln-version--current" : ""}`}>
      <div className="ln-version__main">
        <strong>{v.version}</strong>
        {v.published ? <span className="ln-dim">{fmtDate(isoSecs(v.published), lang)}</span> : null}
        {current ? <span className="ln-chip ln-chip--ok">{t("Installed")}</span> : null}
        {v.kept && !current ? (
          <span className="ln-chip ln-chip--off" title={t("The installer is on this computer: it can be installed without internet.")}>{t("Available offline")}</span>
        ) : null}
        <span className="ln-grow" />
        {v.installable ? (
          <Button variant="sm" icon="download" disabled={busy} onClick={onInstall}>{current ? t("Reinstall") : t("Install")}</Button>
        ) : (
          <span className="ln-dim ln-small">{t("No installer for Windows")}</span>
        )}
      </div>
      {v.notes ? <p className="ln-version__notes">{v.notes}</p> : null}
    </li>
  );
}

/** Confirmation before installing a version (newer, older, or the same again). */
export function InstallDialogBody({ app, version }: { app: string; version: string }) {
  const t = useT();
  const apps = useStore((s) => s.apps);
  const st = app === "launcher" ? apps?.launcher : apps?.apps.find((a) => a.id === app);
  const name = app === "launcher" ? "Theatre Suite" : (appDef(app)?.name ?? app);
  const cur = st?.installed?.version ?? null;
  const older = !!cur && cmp(version, cur) < 0;
  return (
    <div className="ln-form">
      <p>
        {cur
          ? t("You have {name} {cur}. It will be replaced by version {v}.", { name, cur, v: version })
          : t("{name} {v} will be installed for your user on this computer.", { name, v: version })}
      </p>
      {older ? (
        <p className="ln-note ln-note--warn">
          <Icon name="alert" size={14} />
          <span>{t("This is an older version. Files saved with a newer version may not open in it: make a copy of the show first.")}</span>
        </p>
      ) : null}
      <p className="ln-note">
        <Icon name="info" size={14} />
        <span>
          {app === "launcher"
            ? t("Theatre Suite will close, update and open again by itself in a moment. Your shows are not touched.")
            : t("If {name} is open it will be closed: save your work first. Your files and settings are not touched.", { name })}
        </span>
      </p>
    </div>
  );
}

/** Compares "1.2.3" versions (enough for the warning above). */
function cmp(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
