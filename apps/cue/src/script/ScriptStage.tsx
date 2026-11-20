import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { loadScript, replaceScript } from "../lib/script";
import { SCRIPT_WIDTH_MAX, SCRIPT_WIDTH_MIN } from "../model/show";
import { useDoc } from "../store/doc";
import { NotesColumn, addNote } from "./NotesColumn";
import { PeekBand, ScriptView } from "./ScriptView";
import { useScriptDoc } from "./store";
import { useUi } from "../store/ui";
import { Timeline } from "../timeline/Timeline";
import { AutoScrollPill, usePeekTarget } from "../show/ShowParts";
import { LinkPanel } from "../show/LinkPanel";
import { RemotePointer } from "../show/RemotePointer";
import { anchorAtPoint, anchorHere, anchorTop, scriptLive, useScriptView } from "./view";
import { isItemDrag, readItemDrop } from "../prepare/drag";
import { addItemAt } from "../prepare/actions";

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
export function ScriptStage({ mode, left, right }: { mode: "show" | "prepare"; left?: React.ReactNode; right?: React.ReactNode }) {
  const t = useT();
  const hasNotes = useDoc((s) => (s.show?.notes.length ?? 0) > 0);
  const status = useScriptDoc((s) => s.status);
  const saved = useDoc((s) => s.show?.layout.scriptWidth ?? null);
  const workRef = useRef<HTMLDivElement>(null);
  const [workW, setWorkW] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const frac = drag ?? saved ?? DEFAULT_SCRIPT_WIDTH;
  const selectedGoId = useUi((s) => s.selectedGoId);
  const selectGo = useUi((s) => s.selectGo);
  const peekTarget = usePeekTarget();

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
  // Prepara: a library item dropped on the script or on the columns makes (or joins) a GO at that height.
  const onDragOver = (e: React.DragEvent) => {
    if (mode !== "prepare" || !isItemDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = async (e: React.DragEvent) => {
    if (mode !== "prepare") return;
    const item = readItemDrop(e);
    const work = workRef.current;
    if (!item || !work) return;
    e.preventDefault();
    const r = work.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - r.left), (scriptPx ?? r.width) - 1);
    const anchor = await anchorAtPoint(x, e.clientY - r.top + scriptLive.scrollTop());
    const g = useScriptView.getState().geometry;
    if (anchor) addItemAt(anchor, item, { toY: g ? (a) => anchorTop(g, a) ?? 0 : undefined });
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
      {left}
      <div className="cue-stage__main">
        {hasNotes && status === "ready" ? <NotesColumn editable={mode === "prepare"} /> : null}
        <div ref={workRef} className="cue-stage__work" onDragOver={onDragOver} onDrop={(e) => void onDrop(e)}>
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
            {status === "ready" && mode === "show" ? <AutoScrollPill /> : null}
            {status === "ready" && mode === "show" ? <RemotePointer /> : null}
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
          <Timeline mode={mode} selectedGoId={mode === "prepare" ? selectedGoId : null} onSelectGo={mode === "prepare" ? selectGo : undefined} />
        </div>
        <PeekBand target={peekTarget} />
      </div>
      {right ?? (mode === "show" ? <LinkPanel /> : null)}
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
