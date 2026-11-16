import { useCallback, useEffect, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Icon } from "@theatre-suite/ui";
import { api } from "../lib/api";
import {
  confirmDeleteVersion,
  confirmRestoreVersion,
  listVersions,
  restoreVersion,
  saveDoc,
  saveNamedVersion,
  versionsDirOf,
  type VersionInfo,
} from "../lib/files";
import { useDoc } from "../state/doc";
import { useSettings } from "../state/settings";
import { useUi } from "../state/ui";

/** Versions of the cue list: copies kept next to the file (`Show.versions`). Save one with a note, go back to one, delete one. */
export function VersionsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const filePath = useDoc((s) => s.filePath);
  const lang = useSettings((s) => s.settings.language);
  const [note, setNote] = useState("");
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!filePath) return setList([]);
    try {
      setList(await listVersions(filePath));
      setError(null);
    } catch (e) {
      setList([]);
      setError(String(e));
    }
  }, [filePath]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const fmt = (ms: number) => new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));

  const saveVersion = async () => {
    setBusy(true);
    if (await saveNamedVersion(t, note)) {
      setNote("");
      useUi.getState().showToast(t("Saved, and kept as a version."));
    }
    await reload();
    setBusy(false);
  };

  const goBack = async (v: VersionInfo) => {
    if (!(await confirmRestoreVersion(t))) return;
    setBusy(true);
    const ok = await restoreVersion(t, v);
    setBusy(false);
    if (ok) {
      useUi.getState().showToast(t("Version loaded. Save to keep it."));
      onClose();
    } else await reload();
  };

  const remove = async (v: VersionInfo) => {
    if (!(await confirmDeleteVersion(t))) return;
    await api.versionDelete(v.path).catch((e) => setError(String(e)));
    await reload();
  };

  return (
    <Dialog
      title={t("Versions")}
      icon="history"
      width={720}
      onClose={onClose}
      description={t("Copies of this cue list kept next to its file. Going back to one never loses what you have now.")}
      footer={
        <>
          {filePath ? (
            <span className="ts-muted ts-ellipsis" style={{ fontSize: 11.5, minWidth: 0 }} title={versionsDirOf(filePath)}>
              {versionsDirOf(filePath)}
            </span>
          ) : null}
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={onClose}>
            {t("Done")}
          </Button>
        </>
      }
    >
      {!filePath ? (
        <div className="df-versions__empty">
          <p>{t("Save the cue list first: its versions are kept in a folder next to the file.")}</p>
          <Button variant="primary" icon="save" onClick={() => saveDoc(t)}>
            {t("Save")}
          </Button>
        </div>
      ) : (
        <>
          <div className="df-versions__new">
            <input
              className="ts-input"
              style={{ flex: 1 }}
              value={note}
              placeholder={t("A note for this version (for example: after the dress rehearsal)")}
              aria-label={t("A note for this version")}
              maxLength={120}
              onChange={(e) => setNote(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void saveVersion()}
            />
            <Button variant="primary" icon="save" disabled={busy} onClick={() => void saveVersion()}>
              {t("Save as a version")}
            </Button>
          </div>
          {error ? <div className="ts-banner" style={{ borderColor: "var(--stop)" }}>{error}</div> : null}
          {list === null ? (
            <div className="df-versions__empty">{t("Reading the versions…")}</div>
          ) : list.length === 0 ? (
            <div className="df-versions__empty">{t("No versions yet. Write a note above and press “Save as a version”.")}</div>
          ) : (
            <ul className="df-versions" aria-label={t("Versions")}>
              {list.map((v) => (
                <li key={v.path} className="df-version">
                  <div className="df-version__main">
                    <span className="df-version__when">{fmt(v.modifiedMs)}</span>
                    <span className={v.kind === "named" ? "ts-pill ts-pill--sb" : "ts-pill"}>{v.kind === "named" ? t("Version") : t("Automatic")}</span>
                    <span className="df-version__note ts-ellipsis">{v.note || (v.kind === "named" ? t("No note") : "")}</span>
                  </div>
                  <span className="df-version__meta">
                    {t("{n} tracks", { n: v.tracks })}
                    {v.appVersion ? ` · ${v.appVersion}` : ""}
                  </span>
                  <Button variant="sm" icon="reset" disabled={busy} onClick={() => void goBack(v)} title={t("Load this version as unsaved changes")}>
                    {t("Go back to this")}
                  </Button>
                  <Button variant="sm" iconOnly icon="trash" aria-label={t("Delete this version")} title={t("Delete this version")} disabled={busy} onClick={() => void remove(v)} />
                </li>
              ))}
            </ul>
          )}
          <p className="ts-muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            <Icon name="info" size={12} /> {t("Automatic versions are made before the first save of a session and before going back; the newest 30 are kept. Your own versions are never removed.")}
          </p>
        </>
      )}
    </Dialog>
  );
}
