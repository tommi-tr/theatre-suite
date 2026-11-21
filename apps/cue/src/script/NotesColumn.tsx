import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, confirmYesNo } from "@theatre-suite/ui";
import { useDoc } from "../store/doc";
import type { ScriptNote } from "../model/show";
import { anchorTop, scriptLive, useScriptView } from "./view";

/** Space between two notes pushed one under the other (px). */
const NOTE_GAP = 6;
/** The first line of a note sits on its anchor. */
const LIFT = 9;

export function addNote(anchor: ScriptNote["anchor"]): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  useDoc.getState().change((s) => ({ ...s, notes: [...s.notes, { id, anchor, text: "" }] }));
  useScriptView.getState().setEditingNote(id);
  return id;
}

/**
 * Notes of the script, left of it (only when there are notes): every note sits at the height of its point of
 * the script and scrolls with it; notes too close are pushed down. Click to edit; × deletes (after asking).
 */
export function NotesColumn({ editable }: { editable: boolean }) {
  const t = useT();
  const notes = useDoc((s) => s.show?.notes ?? []);
  const geometry = useScriptView((s) => s.geometry);
  const layerRef = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, HTMLElement>());
  const [measureRev, setMeasureRev] = useState(0);

  // Follow the script's scroll without re-rendering.
  useEffect(
    () =>
      scriptLive.onScroll((top) => {
        if (layerRef.current) layerRef.current.style.transform = `translateY(${-top}px)`;
      }),
    [],
  );

  // Heights change while typing: place again.
  useEffect(() => {
    const ro = new ResizeObserver(() => setMeasureRev((n) => n + 1));
    for (const el of boxes.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [notes]);

  // Place: wanted top = the anchor; never on top of the previous note.
  useLayoutEffect(() => {
    if (!geometry) return;
    const placed = notes
      .map((n) => ({ n, want: anchorTop(geometry, n.anchor) }))
      .filter((p): p is { n: ScriptNote; want: number } => p.want !== null)
      .sort((a, b) => a.want - b.want);
    let bottom = -Infinity;
    for (const { n, want } of placed) {
      const el = boxes.current.get(n.id);
      if (!el) continue;
      const top = Math.max(want - LIFT, bottom + NOTE_GAP);
      el.style.top = `${top}px`;
      bottom = top + el.offsetHeight;
      const dot = layerRef.current?.querySelector<HTMLElement>(`[data-dot="${n.id}"]`);
      if (dot) dot.style.top = `${want - 3}px`;
    }
  }, [notes, geometry, measureRev]);

  return (
    <aside className="cue-notes" aria-label={t("Notes")}>
      <div className="cue-notes__title ts-label">
        {t("Notes")} <span className="ts-muted">{notes.length}</span>
      </div>
      <div className="cue-notes__clip">
        <div ref={layerRef} className="cue-notes__layer" style={{ height: geometry?.contentHeight ?? 0 }}>
          {notes.map((n) => (
            <span key={`d${n.id}`} className="cue-notes__dot" data-dot={n.id} />
          ))}
          {notes.map((n) => (
            <NoteBox
              key={n.id}
              note={n}
              editable={editable}
              boxRef={(el) => {
                if (el) boxes.current.set(n.id, el);
                else boxes.current.delete(n.id);
              }}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function NoteBox({ note, editable, boxRef }: { note: ScriptNote; editable: boolean; boxRef: (el: HTMLElement | null) => void }) {
  const t = useT();
  const editing = useScriptView((s) => s.editingNote === note.id);
  const [draft, setDraft] = useState(note.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) {
      setDraft(note.text);
      requestAnimationFrame(() => {
        const a = areaRef.current;
        if (!a) return;
        a.focus();
        a.setSelectionRange(a.value.length, a.value.length);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  useLayoutEffect(() => {
    const a = areaRef.current;
    if (!a) return;
    a.style.height = "0px";
    a.style.height = `${a.scrollHeight}px`;
  }, [draft, editing]);

  const remove = () => useDoc.getState().change((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== note.id) }));
  const commit = () => {
    useScriptView.getState().setEditingNote(null);
    const text = draft.trim();
    // A new note left empty is simply not kept.
    if (!text) return remove();
    if (text !== note.text) useDoc.getState().change((s) => ({ ...s, notes: s.notes.map((n) => (n.id === note.id ? { ...n, text } : n)) }));
  };
  const askDelete = async () => {
    const ok = await confirmYesNo({ title: t("Please confirm"), message: t("Delete this note?"), cancel: t("Cancel"), confirm: t("Delete"), danger: true, close: t("Close") });
    if (ok) remove();
  };
  return (
    <div ref={boxRef} className={`cue-note${editing ? " cue-note--editing" : ""}`}>
      {editing ? (
        <textarea
          ref={areaRef}
          className="cue-note__area"
          value={draft}
          placeholder={t("Write the note…")}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft(note.text);
              useScriptView.getState().setEditingNote(null);
              if (!note.text) remove();
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <button type="button" className="cue-note__text" disabled={!editable} title={editable ? t("Click to edit") : undefined} onClick={() => useScriptView.getState().setEditingNote(note.id)}>
          {note.text || <span className="ts-muted">{t("Empty note")}</span>}
        </button>
      )}
      <div className="cue-note__meta">
        <span className="mono">{t("p. {n}", { n: note.anchor.page })}</span>
        {editable && !editing ? <Button variant="ghost" iconOnly icon="trash" className="cue-note__del" aria-label={t("Delete the note")} title={t("Delete the note")} onClick={() => void askDelete()} /> : null}
      </div>
    </div>
  );
}
