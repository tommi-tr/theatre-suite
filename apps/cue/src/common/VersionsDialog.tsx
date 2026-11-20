import { useCallback, useEffect, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Dialog, Icon } from "@theatre-suite/ui";
import { api, type VersionEntry } from "../lib/api";
import { confirmDeleteVersion, confirmRestoreVersion, fileErrorText, restoreVersion, saveDoc, saveNamedVersion, versionsDirOf } from "../lib/files";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

/** Stable reference: Dialog refocuses its first button whenever `onClose` changes. */
const close = () => useUi.getState().closeDialog();

/** Versions of the file: whole copies kept next to it (`Serata.versions`). Save one with a note, go back to one, delete one. */
export function VersionsDialog() {
  const t = useT();
  const lang = useLang();
  const filePath = useDoc((s) => s.filePath);
  const [note, setNote] = useState("");
  const [list, setList] = useState<VersionEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!filePath) return setList([]);
    try {
      setList(await api.versionsList(filePath));
      setError(null);
    } catch (e) {
      setList([]);
      setError(fileErrorText(t, e));
    }
  }, [filePath, t]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const fmt = (ms: number) => new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  const saveVersion = async () => {
    setBusy(true);
    if (await saveNamedVersion(t, note)) {
      setNote("");
      useUi.getState().showToast(t("Saved, and kept as a version."));
    }
    await reload();
    setBusy(false);
  };

  const goBack = async (v: VersionEntry) => {
    if (!(await confirmRestoreVersion(t))) return;
    setBusy(true);
    const ok = await restoreVersion(t, v);
    setBusy(false);
    if (ok) {
      useUi.getState().showToast(t("Back to the version of {when}.", { when: fmt(v.modifiedMs) }));
      close();
    } else await reload();
  };

  const remove = async (v: VersionEntry) => {
    if (!(await confirmDeleteVersion(t))) return;
    await api.versionDelete(v.path).catch((e) => setError(fileErrorText(t, e)));
    await reload();
  };

  return (
    <Dialog
      title={t("Versions")}
      icon="history"
      width={720}
      onClose={close}
      closeLabel={t("Close")}
      description={t("Whole copies of this file, script included, kept next to it. Going back to one never loses what you have now.")}
      footer={
        <>
          {filePath ? (
            <span className="ts-muted ts-ellipsis" style={{ fontSize: 11.5, minWidth: 0 }} title={versionsDirOf(filePath)}>
              {versionsDirOf(filePath)}
            </span>
          ) : null}
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={close}>
            {t("Done")}
          </Button>
        </>
      }
    >
      {!filePath ? (
        <div className="cue-versions__empty">
          <p>{t("Save the show first: its versions are kept in a folder next to the file.")}</p>
          <Button variant="primary" icon="save" onClick={() => void saveDoc(t)}>
            {t("Save")}
          </Button>
        </div>
      ) : (
        <>
          <div className="cue-versions__new">
            <input
              className="ts-input"
              style={{ flex: 1 }}
              value={note}
              placeholder={t("A note for this version (for example: after the technical rehearsal)")}
              aria-label={t("A note for this version")}
              maxLength={120}
              onChange={(e) => setNote(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void saveVersion()}
            />
            <Button variant="primary" icon="save" disabled={busy} onClick={() => void saveVersion()}>
              {t("Save as a version")}
            </Button>
          </div>
          {error ? <div className="ts-banner cue-banner--stop">{error}</div> : null}
          {list === null ? (
            <div className="cue-versions__empty">{t("Reading the versions…")}</div>
          ) : list.length === 0 ? (
            <div className="cue-versions__empty">{t("No versions yet. Write a note above and press “Save as a version”.")}</div>
          ) : (
            <ul className="cue-versions" aria-label={t("Versions")}>
              {list.map((v) => (
                <li key={v.path} className="cue-version">
                  <div className="cue-version__main">
                    <span className="cue-version__when">{fmt(v.modifiedMs)}</span>
                    <span className={v.kind === "named" ? "ts-pill ts-pill--sb" : "ts-pill"}>{v.kind === "named" ? t("Version") : t("Automatic")}</span>
                    <span className="cue-version__note ts-ellipsis">{v.damaged ? t("Damaged: it cannot be opened") : v.note || (v.kind === "named" ? t("No note") : "")}</span>
                  </div>
                  <span className="cue-version__meta">
                    {size(v.bytes)}
                    {v.appVersion ? ` · Cue ${v.appVersion}` : ""}
                  </span>
                  <Button variant="sm" icon="reset" disabled={busy || v.damaged} onClick={() => void goBack(v)} title={t("Put this version in place of the file")}>
                    {t("Go back to this")}
                  </Button>
                  <Button variant="sm" iconOnly icon="trash" aria-label={t("Delete this version")} title={t("Delete this version")} disabled={busy} onClick={() => void remove(v)} />
                </li>
              ))}
            </ul>
          )}
          <p className="ts-muted cue-versions__info">
            <Icon name="info" size={12} />{" "}
            {t("Automatic versions are made before the first save of a session and before going back; the newest 30 are kept. Your own versions are never removed.")}
          </p>
        </>
      )}
    </Dialog>
  );
}
