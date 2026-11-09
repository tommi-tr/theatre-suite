import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { basename, useT } from "@theatre-suite/core";
import { Button, Dialog, Icon } from "@theatre-suite/ui";
import { api, isTauri } from "../lib/api";
import { confirmDiscard } from "../lib/files";
import { importFile, type ImportResult } from "../lib/importer";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

/** Import from Word or text: choose a file, see what Bardo recognised, open it. */
export function ImportDialog() {
  const t = useT();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => useUi.getState().closeDialog();

  const read = (name: string, bytes: Uint8Array) => {
    try {
      setResult(importFile(name, bytes));
      setFileName(name);
      setError("");
    } catch (e) {
      setResult(null);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "unsupported" ? t("Bardo can import .docx and .txt files.") : msg === "not-docx" ? t("This Word file cannot be read.") : msg);
    }
  };

  const choose = async () => {
    if (!isTauri) {
      inputRef.current?.click();
      return;
    }
    const chosen = await open({ multiple: false, directory: false, filters: [{ name: t("Word or text"), extensions: ["docx", "txt", "fountain", "md"] }], title: t("Import a script") });
    if (typeof chosen !== "string") return;
    try {
      read(basename(chosen), await api.readBytes(chosen));
    } catch (e) {
      setError(String(e));
    }
  };

  const openIt = async () => {
    if (!result) return;
    if (!(await confirmDiscard(t))) return;
    useDoc.getState().load(result.doc, { filePath: null, dirty: true, versions: [] });
    close();
    useUi.getState().setPhase("compose");
    useUi.getState().showToast(t("Imported. Check the text, then save it as a Bardo script."));
  };

  const r = result?.report;
  const row = (label: string, n: number) => (
    <tr>
      <td>{label}</td>
      <td className="num">{n}</td>
    </tr>
  );
  return (
    <Dialog
      title={t("Import a script")}
      icon="upload"
      description={t("Bardo reads a script written in Word or as plain text and recognises acts, scenes, characters, speeches and stage directions. No artificial intelligence: only rules, on this computer.")}
      onClose={close}
      width={560}
      footer={
        <>
          <Button icon="folder" onClick={choose}>
            {result ? t("Choose another file…") : t("Choose a file…")}
          </Button>
          <span className="ts-spacer" />
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" icon="check" disabled={!result} onClick={openIt}>
            {t("Open in Bardo")}
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.txt,.fountain,.md"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.currentTarget.files?.[0];
          if (f) read(f.name, new Uint8Array(await f.arrayBuffer()));
        }}
      />
      {error ? (
        <div className="bd-help" style={{ color: "var(--danger, #c0392b)" }}>
          {error}
        </div>
      ) : null}
      {r ? (
        <>
          <div className="bd-section-title">
            <Icon name="file" size={12} /> {fileName}
          </div>
          <table className="bd-table">
            <tbody>
              <tr>
                <td>{t("Title")}</td>
                <td className="num" style={{ fontFamily: "inherit" }}>
                  {r.title || "—"}
                </td>
              </tr>
              {row(t("Characters"), r.characters)}
              {row(t("Acts"), r.acts)}
              {row(t("Scenes"), r.scenes)}
              {row(t("Speeches"), r.speeches)}
              {row(t("Stage directions"), r.directions)}
              {row(t("Other paragraphs"), r.paragraphs)}
            </tbody>
          </table>
          <div className="bd-help">
            {r.speeches === 0
              ? t("No speeches recognised. Bardo looks for names in capitals at the start of a line (“AMLETO: …”) or alone on a line before the speech.")
              : t("What was not recognised stays as normal text: you can turn a line into a speech with Tab.")}
          </div>
        </>
      ) : !error ? (
        <div className="bd-guide">
          <p>{t("Works best when every speech starts with the character's name:")}</p>
          <ul>
            <li>
              <code>AMLETO: Essere, o non essere…</code>
            </li>
            <li>
              <code>AMLETO</code> {t("on one line, the speech on the next")}
            </li>
            <li>{t("Stage directions in brackets or in italics; “ATTO PRIMO”, “Scena II” as headings.")}</li>
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}
