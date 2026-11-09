import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useT, type TFunc } from "@theatre-suite/core";
import { Button, Icon, StatusBar, type IconName } from "@theatre-suite/ui";
import { useDoc } from "../store/doc";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { useScript, Seg } from "../compose/dialogs/common";
import { api, isTauri } from "../lib/api";
import { APP_NAME } from "../lib/version";
import { serialize } from "../model/file";
import { pageOfPos } from "../editor/paginate";
import { getIndex } from "../editor/plugins";
import { CHARACTER_CAT, type DocData, type SendRecord } from "../model/types";
import { buildExport, type ExportOptions } from "./exportModel";
import { exportDocx } from "./exportDocx";
import { exportOdt } from "./exportOdt";
import { exportText } from "./exportText";
import { preparePrint, renderPages, type PrintOptions } from "./PrintView";

type FormatId = "pdf" | "docx" | "odt" | "txt" | "bardo";
type Audience = "all" | "actor" | "department";
type Mark = "none" | "draft" | "name" | "custom";
type Dest = "save" | "print";

const FORMATS: { id: FormatId; ext: string; name: string; note: string }[] = [
  { id: "pdf", ext: "PDF", name: "PDF", note: "Exactly as on screen. For actors and printing." },
  { id: "docx", ext: "DOCX", name: "Word", note: "To keep working on it in Word." },
  { id: "odt", ext: "ODT", name: "LibreOffice", note: "To keep working on it in LibreOffice Writer." },
  { id: "txt", ext: "TXT", name: "Text", note: "Plain text, readable anywhere." },
  { id: "bardo", ext: "BARDO", name: "Bardo", note: "A copy to open in Bardo, without old versions." },
];

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="bd-h2">
        <span className="bd-step">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function DestButton({ icon, title, sub, checked, disabled, onClick }: { icon: IconName; title: string; sub: string; checked: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="bd-dest" disabled={disabled} onClick={onClick}>
      <span className="bd-dest__icon">
        <Icon name={icon} size={16} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
        <span className="ts-muted" style={{ fontSize: 11.5 }}>
          {sub}
        </span>
      </span>
    </button>
  );
}

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

function defaultFileName(t: TFunc, data: DocData, audience: Audience, actor: string, dept: string): string {
  const title = data.meta.title.trim() || t("Script");
  let who = "";
  if (audience === "actor") who = data.characters.find((c) => c.id === actor)?.name ?? "";
  if (audience === "department") who = data.categories.find((c) => c.id === dept)?.name ?? "";
  return safeName(`${title} - ${t("script")} ${data.version}${who ? ` - ${who}` : ""}`);
}

/** Saves bytes chosen by the user (in a plain browser: downloads them). */
async function saveBytes(t: TFunc, name: string, ext: string, bytes: Uint8Array, filterName: string): Promise<string | null> {
  if (!isTauri) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return `${name}.${ext}`;
  }
  const chosen = await save({ defaultPath: `${name}.${ext}`, filters: [{ name: filterName, extensions: [ext] }], title: t("Save copy") });
  if (!chosen) return null;
  const path = chosen.toLowerCase().endsWith(`.${ext}`) ? chosen : `${chosen}.${ext}`;
  await api.writeBytes(path, bytes);
  return path;
}

/** Live preview of the pages that will be sent. */
function Preview({ opts, actor }: { opts: PrintOptions; actor: string }) {
  const t = useT();
  const pages = useDoc((s) => s.pages);
  const state = useDoc((s) => s.state);
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [scale, setScale] = useState(0.5);
  const count = pages && !pages.continuous ? pages.pages.length : 0;

  // Copy for an actor: start from their first page.
  useEffect(() => {
    if (!actor || !state || !pages || pages.continuous) return;
    const idx = getIndex(state);
    const first = idx.speakers.get(actor)?.firstPos;
    if (first !== undefined) {
      const n = pageOfPos(pages, idx, first);
      if (n) setPage(Math.max(0, n - 1));
    }
    // Only when the actor changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner || !pages || pages.continuous) return;
    const p = Math.min(page, pages.pages.length - 1);
    const handle = window.setTimeout(() => {
      renderPages(inner, pages, opts, [p]);
      setScale(Math.min(1, (box.clientWidth - 8) / pages.geom.pageW, (box.clientHeight - 8) / pages.geom.pageH));
    }, 120);
    return () => window.clearTimeout(handle);
  }, [pages, state, opts, page]);

  if (!pages || pages.continuous) {
    return (
      <div className="bd-help" style={{ padding: 12 }}>
        {t("The preview appears when the script is shown in pages (Compose, status bar).")}
      </div>
    );
  }
  const g = pages.geom;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="bd-section-title" style={{ margin: 0 }}>
          {t("Preview")}
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" iconOnly icon="chevLeft" aria-label={t("Previous page")} disabled={page <= 0} onClick={() => setPage(page - 1)} />
        <span className="ts-muted" style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>
          {Math.min(page, count - 1) + 1} / {count}
        </span>
        <Button variant="ghost" iconOnly icon="chevRight" aria-label={t("Next page")} disabled={page >= count - 1} onClick={() => setPage(page + 1)} />
      </div>
      <div ref={boxRef} className="bd-send-preview">
        <div style={{ width: g.pageW * scale, height: g.pageH * scale, boxShadow: "var(--paper-shadow)", background: "#fff", overflow: "hidden" }}>
          <div ref={innerRef} className="bd-send-preview__scaler" style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: g.pageW }} />
        </div>
      </div>
    </>
  );
}

export function SendPhase() {
  const t = useT();
  const { view, data } = useScript();
  const author = useSettings((s) => s.settings.author);
  const [format, setFormat] = useState<FormatId>("pdf");
  const [audience, setAudience] = useState<Audience>("all");
  const [actor, setActor] = useState("");
  const [dept, setDept] = useState("");
  const [mark, setMark] = useState<Mark>("none");
  const [customMark, setCustomMark] = useState("");
  const [dest, setDest] = useState<Dest>("save");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pdfDirect, setPdfDirect] = useState(false);

  useEffect(() => {
    if (isTauri) api.pdfDirectSupported().then(setPdfDirect, () => setPdfDirect(false));
  }, []);

  const departments = useMemo(() => (data ? data.categories.filter((c) => c.id !== CHARACTER_CAT) : []), [data?.categories]);
  useEffect(() => {
    if (!data) return;
    if (!actor && data.characters.length) setActor(data.characters[0].id);
    if (!dept && departments.length) setDept(departments[0].id);
  }, [data, actor, dept, departments]);

  useEffect(() => {
    if (data && !nameTouched) setName(defaultFileName(t, data, audience, actor, dept));
  }, [data?.meta.title, data?.version, audience, actor, dept, nameTouched, t]);

  const watermark = useMemo(() => {
    if (!data) return "";
    switch (mark) {
      case "draft":
        return data.lang === "it" ? "BOZZA" : "DRAFT";
      case "name":
        return audience === "actor" ? (data.characters.find((c) => c.id === actor)?.actor || data.characters.find((c) => c.id === actor)?.name || "") : audience === "department" ? (departments.find((c) => c.id === dept)?.name ?? "") : author;
      case "custom":
        return customMark.trim();
      default:
        return "";
    }
  }, [mark, customMark, audience, actor, dept, data, departments, author]);

  const printOpts: PrintOptions = useMemo(
    () => ({ actor: audience === "actor" ? actor : undefined, category: audience === "department" ? dept : undefined, watermark: mark === "none" ? undefined : watermark }),
    [audience, actor, dept, mark, watermark],
  );

  if (!view || !data) return null;
  const fmt = FORMATS.find((f) => f.id === format)!;
  const ext = format;
  const audienceText =
    audience === "actor" ? data.characters.find((c) => c.id === actor)?.name ?? "" : audience === "department" ? departments.find((c) => c.id === dept)?.name ?? "" : t("Everyone");

  const log = (formatLabel: string) => {
    const v = useDoc.getState().view;
    if (!v) return;
    const d = v.state.doc.attrs.data as DocData;
    const rec: SendRecord = { at: new Date().toISOString(), version: d.version, format: formatLabel, audience: audienceText };
    v.dispatch(v.state.tr.setDocAttribute("data", { ...d, sends: [...(d.sends ?? []), rec].slice(-50) }).setMeta("addToHistory", false));
  };

  const done = (path: string | null, label: string) => {
    if (!path) return;
    log(label);
    useUi.getState().showToast(
      t("Saved: {name}", { name: path.split(/[\\/]/).pop() ?? path }),
      "info",
      isTauri ? { label: t("Show in folder"), run: () => api.revealInFolder(path).catch(() => {}) } : undefined,
    );
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const fileName = safeName(name) || defaultFileName(t, data, audience, actor, dept);
      if (dest === "print" || (format === "pdf" && !pdfDirect)) {
        // Printer, or "Save as PDF" in the system print window.
        const job = await preparePrint(printOpts);
        try {
          const prevTitle = document.title;
          document.title = fileName;
          if (isTauri) await api.printPage();
          else window.print();
          document.title = prevTitle;
          log(dest === "print" ? t("Printed") : "PDF");
        } finally {
          // The system window reads the pages while it is open: clear them a little later.
          setTimeout(job.done, 4000);
        }
        return;
      }
      if (format === "pdf") {
        const chosen = await save({ defaultPath: `${fileName}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }], title: t("Save copy") });
        if (!chosen) return;
        const path = chosen.toLowerCase().endsWith(".pdf") ? chosen : `${chosen}.pdf`;
        const job = await preparePrint(printOpts);
        try {
          await api.printToPdf(path, job.size);
        } finally {
          job.done();
        }
        done(path, "PDF");
        return;
      }
      const doc = useDoc.getState().view!.state.doc;
      if (format === "bardo") {
        const bytes = new TextEncoder().encode(serialize(doc, [], APP_NAME));
        done(await saveBytes(t, fileName, "bardo", bytes, "Bardo"), "Bardo");
        return;
      }
      const st = useDoc.getState();
      const idx = st.state ? getIndex(st.state) : null;
      const xopts: ExportOptions = { actor: printOpts.actor, category: printOpts.category, watermark: printOpts.watermark };
      const x = buildExport(doc, xopts, (pos) => (idx ? pageOfPos(st.pages, idx, pos) : null));
      if (format === "docx") done(await saveBytes(t, fileName, "docx", await exportDocx(x), "Word"), "Word");
      else if (format === "odt") done(await saveBytes(t, fileName, "odt", exportOdt(x), "LibreOffice"), "LibreOffice");
      else done(await saveBytes(t, fileName, "txt", exportText(x), t("Text")), t("Text"));
    } catch (e) {
      useUi.getState().showToast(`${t("Could not create the file.")} ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const sends = [...(data.sends ?? [])].reverse().slice(0, 6);
  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(data.lang === "it" ? "it-IT" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  };
  const actionLabel = dest === "print" ? t("Print") : format === "pdf" && !pdfDirect ? t("Create PDF…") : t("Save {format}", { format: fmt.name });

  return (
    <>
      <div className="bd-send">
        <div className="bd-send__col">
          <Step n={1} title={t("Format")}>
            <div className="bd-formats" role="radiogroup" aria-label={t("Format")}>
              {FORMATS.map((f) => (
                <button key={f.id} type="button" role="radio" aria-checked={format === f.id} className="bd-format-card" onClick={() => setFormat(f.id)}>
                  <span className="bd-format-card__ext">{f.ext}</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</span>
                  <span className="bd-format-card__note">{t(f.note)}</span>
                </button>
              ))}
            </div>
            <div className="bd-help">
              {format === "pdf"
                ? t("The PDF has exactly the pages you see in Bardo.")
                : format === "bardo"
                  ? t("Only the current text: the old versions stay in your file.")
                  : t("Only the current text is exported, never the old versions. Word and LibreOffice use fonts installed on the computer, so pages may break differently.")}
            </div>
          </Step>
          <Step n={2} title={t("Content")}>
            <Seg<Audience>
              label={t("Who it is for")}
              value={audience}
              onChange={setAudience}
              options={[
                { value: "all", label: t("Whole script") },
                { value: "actor", label: t("Copy for an actor") },
                { value: "department", label: t("Copy for a department") },
              ]}
            />
            <div style={{ marginTop: 10, minHeight: 34 }}>
              {audience === "actor" ? (
                data.characters.length ? (
                  <label className="bd-inline-field">
                    <span>{t("Character")}</span>
                    <select className="ts-input bd-select" value={actor} onChange={(e) => setActor(e.currentTarget.value)}>
                      {data.characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.actor ? ` — ${c.actor}` : ""}
                        </option>
                      ))}
                    </select>
                    <span className="ts-muted">{t("Their speeches are highlighted.")}</span>
                  </label>
                ) : (
                  <span className="ts-muted">{t("There are no characters yet.")}</span>
                )
              ) : audience === "department" ? (
                <label className="bd-inline-field">
                  <span>{t("Department")}</span>
                  <select className="ts-input bd-select" value={dept} onChange={(e) => setDept(e.currentTarget.value)}>
                    {departments.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="ts-muted">{t("Words of this category are highlighted.")}</span>
                </label>
              ) : (
                <span className="ts-muted">{t("The script as it is, without highlights.")}</span>
              )}
            </div>
            <div className="bd-flabel" style={{ marginTop: 12 }}>
              {t("Watermark")}
            </div>
            <Seg<Mark>
              label={t("Watermark")}
              value={mark}
              onChange={setMark}
              options={[
                { value: "none", label: data.format.watermark ? t("As in the format") : t("None") },
                { value: "draft", label: data.lang === "it" ? "BOZZA" : "DRAFT" },
                { value: "name", label: t("Recipient's name") },
                { value: "custom", label: t("Other…") },
              ]}
            />
            {mark === "custom" ? <input className="ts-input" style={{ marginTop: 8, width: "100%" }} value={customMark} placeholder={t("Text across every page")} onChange={(e) => setCustomMark(e.currentTarget.value)} /> : null}
            {mark === "name" && !watermark ? <div className="bd-help">{t("Write the actor's name in the Cast and crew sheet, or your name in Settings.")}</div> : null}
          </Step>
        </div>
        <div className="bd-send__col bd-send__col--bar">
          <Step n={3} title={t("Name and destination")}>
            <label className="bd-flabel" htmlFor="bd-send-name">
              {t("File name")}
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                id="bd-send-name"
                className="ts-input"
                style={{ flex: 1, minWidth: 0 }}
                value={name}
                onChange={(e) => {
                  setName(e.currentTarget.value);
                  setNameTouched(true);
                }}
              />
              <span className="ts-muted" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                .{dest === "print" ? "—" : ext}
              </span>
            </div>
            <div className="bd-help">
              {t("Version {v} is in the name, so everyone knows which text they have.", { v: data.version })}
              {nameTouched ? (
                <>
                  {" "}
                  <button type="button" className="bd-link" onClick={() => setNameTouched(false)}>
                    {t("Restore")}
                  </button>
                </>
              ) : null}
            </div>
            <div role="radiogroup" aria-label={t("Destination")} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              <DestButton icon="folder" title={t("Save on this computer")} sub={t("Then attach it to an e-mail or a chat")} checked={dest === "save"} onClick={() => setDest("save")} />
              <DestButton icon="printer" title={t("Print")} sub={t("On paper, with the system print window")} checked={dest === "print"} onClick={() => setDest("print")} />
              <DestButton icon="share" title={t("Share")} sub={t("Coming later")} checked={false} disabled />
              <DestButton icon="upload" title={t("Cloud")} sub={t("Coming later")} checked={false} disabled />
            </div>
          </Step>
          <Button variant="primary" className="bd-big-primary" icon={dest === "print" ? "printer" : "send"} disabled={busy} onClick={run}>
            {busy ? t("Working…") : actionLabel}
          </Button>
          <section>
            <div className="bd-section-title">{t("Sent so far")}</div>
            {sends.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {sends.map((s, i) => (
                  <div key={i} className="bd-log">
                    <Icon name="stamp" size={13} />
                    <span style={{ fontFamily: "var(--font-mono)" }}>{s.version}</span>
                    <span>{s.format}</span>
                    <span className="ts-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {s.audience}
                    </span>
                    <span className="ts-muted">{fmtDate(s.at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ts-muted" style={{ fontSize: 12 }}>
                {t("Every copy you send is noted here, with its version.")}
              </div>
            )}
          </section>
        </div>
        <div className="bd-send__col bd-send__col--preview">
          <Preview opts={printOpts} actor={audience === "actor" ? actor : ""} />
        </div>
      </div>
      <StatusBar>
        <div className="bd-status" style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <Icon name="version" size={13} />
          <span>
            {t("Version")} {data.version}
            {data.versionLabel ? ` · ${data.versionLabel}` : ""}
          </span>
          <span className="bd-status__sep" />
          <span>{data.format.custom ? t("Customised") : data.format.name}</span>
          <span style={{ flex: 1 }} />
          <span className="ts-muted">{t("Nothing leaves this computer unless you choose to send it.")}</span>
        </div>
      </StatusBar>
    </>
  );
}
