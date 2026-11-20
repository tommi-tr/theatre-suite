import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon, Segmented } from "@theatre-suite/ui";
import { loadScript, replaceScript } from "../lib/script";
import { SCRIPT_WIDTH_MAX, SCRIPT_WIDTH_MIN } from "../model/show";
import { useDoc } from "../store/doc";
import { NotesColumn, addNote } from "./NotesColumn";
import { ScriptView } from "./ScriptView";
import { useScriptDoc } from "./store";
import { anchorHere } from "./view";

/** Script width when the file says nothing (fraction of script + columns), as in the design. */
export const DEFAULT_SCRIPT_WIDTH = 0.46;
/** Never narrower than these (px). */
const MIN_SCRIPT_PX = 240;
const MIN_COLUMNS_PX = 160;

/** "Nota" (K) in Prepara: a note at the pointer, or at the reading line. */
export async function addNoteHere(): Promise<void> {
  const a = await anchorHere();
  if (a) addNote(a);
}

/**
 * The layout shared by Show and Prepara (13_cue.md, design images):
 * [library (Prepara)] [notes?] [script] [divider] [columns] [right panel 200 px].
 */
export function ScriptStage({ mode }: { mode: "show" | "prepare" }) {
  const t = useT();
  const hasNotes = useDoc((s) => (s.show?.notes.length ?? 0) > 0);
  const status = useScriptDoc((s) => s.status);
  const saved = useDoc((s) => s.show?.layout.scriptWidth ?? null);
  const workRef = useRef<HTMLDivElement>(null);
  const [workW, setWorkW] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const frac = drag ?? saved ?? DEFAULT_SCRIPT_WIDTH;

  useLayoutEffect(() => {
    const el = workRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWorkW(el.clientWidth));
    ro.observe(el);
    setWorkW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const clampFrac = useCallback(
    (f: number) => {
      if (workW <= 0) return f;
      const lo = Math.max(SCRIPT_WIDTH_MIN, MIN_SCRIPT_PX / workW);
      const hi = Math.min(SCRIPT_WIDTH_MAX, 1 - MIN_COLUMNS_PX / workW);
      return Math.min(Math.max(lo, f), Math.max(lo, hi));
    },
    [workW],
  );
  const scriptPx = workW > 0 ? Math.round(clampFrac(frac) * workW) : undefined;

  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = workRef.current;
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const left = el.getBoundingClientRect().left;
    let last = frac;
    const move = (ev: PointerEvent) => {
      last = clampFrac((ev.clientX - left) / el.clientWidth);
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      const value = Math.round(last * 1000) / 1000;
      if (value !== saved) useDoc.getState().change((s) => ({ ...s, layout: { ...s.layout, scriptWidth: value } }), "layout");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const onDividerKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const value = Math.round(clampFrac(frac + (e.key === "ArrowLeft" ? -0.02 : 0.02)) * 1000) / 1000;
    useDoc.getState().change((s) => ({ ...s, layout: { ...s.layout, scriptWidth: value } }), "layout");
  };

  return (
    <div className="cue-stage" data-mode={mode}>
      {mode === "prepare" ? <LibraryPanel /> : null}
      <div className="cue-stage__main">
        {hasNotes && status === "ready" ? <NotesColumn editable={mode === "prepare"} /> : null}
        <div ref={workRef} className="cue-stage__work">
          <div className="cue-stage__script" style={{ width: scriptPx }}>
            {status === "ready" ? (
              <ScriptView onNoteKey={mode === "prepare" ? () => void addNoteHere() : undefined} />
            ) : status === "loading" ? (
              <div className="cue-script-empty">
                <span className="ts-muted">{t("Opening the script…")}</span>
              </div>
            ) : status === "error" ? (
              <ScriptProblem />
            ) : (
              <NoScript mode={mode} />
            )}
          </div>
          <div
            className={`cue-divider${drag !== null ? " cue-divider--drag" : ""}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("Width of the script")}
            title={t("Drag to change the width of the script")}
            tabIndex={0}
            onPointerDown={onDividerDown}
            onKeyDown={onDividerKey}
          />
          <ColumnsPlaceholder />
        </div>
      </div>
      {mode === "show" ? <LinkPanelPlaceholder /> : <SelectedGoPlaceholder />}
    </div>
  );
}

function NoScript({ mode }: { mode: "show" | "prepare" }) {
  const t = useT();
  return (
    <div className="cue-script-empty">
      <div className="cue-script-empty__card">
        <span className="cue-first__icon">
          <Icon name="pages" size={22} />
        </span>
        <h2>{t("Load the script")}</h2>
        <p>{t("One PDF: the script or the score. It goes inside the show file and Cue never changes it; underlines and comments already in the PDF stay visible.")}</p>
        <Button variant={mode === "prepare" ? "primary" : "tool"} icon="upload" onClick={() => void loadScript(t)}>
          {t("Load the script…")}
        </Button>
      </div>
    </div>
  );
}

function ScriptProblem() {
  const t = useT();
  const error = useScriptDoc((s) => s.error);
  return (
    <div className="cue-script-empty">
      <div className="cue-script-empty__card">
        <span className="cue-first__icon cue-first__icon--warn">
          <Icon name="alert" size={22} />
        </span>
        <h2>{t("The script cannot be shown")}</h2>
        <p>{error === "password" ? t("This PDF is protected by a password: Cue cannot open it.") : t("The PDF inside the show file cannot be read. Replace it with a good copy.")}</p>
        <Button icon="upload" onClick={() => void replaceScript(t)}>
          {t("Replace the script…")}
        </Button>
      </div>
    </div>
  );
}

/** The GO columns (Cue 0.3): for now only their titles and what they will hold. */
function ColumnsPlaceholder() {
  const t = useT();
  return (
    <div className="cue-columns">
      <div className="cue-columns__heads">
        <span className="cue-colhead cue-colhead--lights">{t("Lights")}</span>
        <span className="cue-colhead cue-colhead--audio">{t("Audio")}</span>
        <span className="cue-colhead cue-colhead--video">{t("Video")}</span>
      </div>
      <div className="cue-columns__empty">
        <p>{t("The Lights · Audio · Video columns come with Cue 0.3")}</p>
        <p className="ts-muted">{t("Each GO will sit on the script with a line to its memories, tracks and images, scrolling with the pages.")}</p>
      </div>
    </div>
  );
}

function LinkPanelPlaceholder() {
  const t = useT();
  return (
    <aside className="cue-panel" aria-label={t("Link")}>
      <div className="ts-label">{t("Second computer")}</div>
      <div className="cue-panel__state">
        <span className="ts-dot" />
        {t("No secondary")}
      </div>
      <p className="ts-muted">{t("A second computer that leads the same show comes with Cue 0.4.")}</p>
    </aside>
  );
}

function SelectedGoPlaceholder() {
  const t = useT();
  return (
    <aside className="cue-panel" aria-label={t("Selected GO")}>
      <div className="cue-panel__head">{t("Selected GO")}</div>
      <p className="ts-muted">{t("No GO selected.")}</p>
      <p className="ts-muted">{t("GOs come with Cue 0.3: drag a memory, a track or an image onto the script.")}</p>
      <div className="cue-panel__spacer" />
      <p className="cue-panel__hint">
        {t("Meanwhile: K adds a note where the pointer is.")}
      </p>
    </aside>
  );
}

type LibTab = "lights" | "audio" | "video";

function LibraryPanel() {
  const t = useT();
  const [tab, setTab] = useState<LibTab>("lights");
  return (
    <aside className="cue-library" aria-label={t("Libraries")}>
      <Segmented<LibTab>
        ariaLabel={t("Libraries")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "lights", label: t("Lights") },
          { value: "audio", label: t("Audio") },
          { value: "video", label: t("Video") },
        ]}
      />
      <div className="cue-library__empty">
        <p>{tab === "lights" ? t("Granvelo memories come with Cue 0.3.") : tab === "audio" ? t("Diaframma tracks come with Cue 0.3.") : t("Images and videos come with Cue 0.3.")}</p>
      </div>
      <p className="cue-library__hint">{t("Drag onto the script to create a GO")}</p>
    </aside>
  );
}
