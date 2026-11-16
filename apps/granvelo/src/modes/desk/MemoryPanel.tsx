import { memo, useMemo, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { litCount, memoriesInOrder, nextMemoryNumber, stateUniverse } from "../../model/memories";
import { moveInSequence } from "../../model/sequence";
import { memoryNumberFree } from "../../model/desk";
import type { GranveloDoc, Memory } from "../../model/types";
import { useDesk } from "../../store/desk";
import { useDoc } from "../../store/doc";
import { StageView2D } from "../../stage";
import { transitionParts } from "../transitionText";
import { deleteMemoryAsk, renameMemoryTo, renumberMemory, restoreAsk, selectMemory, toggleBlind } from "./actions";
import { InlineEdit } from "./parts";

const memoryTitle = (t: ReturnType<typeof useT>, m: Pick<Memory, "number" | "label">) => m.label || t("Memory {n}", { n: m.number });

/** The memory on stage (or in Blind): its state and Salva / Salva come nuova / Ripristina. */
export function OnStageBox() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const liveId = useDesk((s) => s.liveMemoryId);
  const modified = useDesk((s) => s.modified);
  const blind = useDesk((s) => s.blind);
  const [asking, setAsking] = useState(false);
  const [num, setNum] = useState("");
  const [label, setLabel] = useState("");
  const live = doc.memories.find((m) => m.id === liveId) ?? null;
  const editing = blind ? (doc.memories.find((m) => m.id === blind.memoryId) ?? null) : live;
  const dirty = blind ? blind.modified : modified;
  const numberOk = memoryNumberFree(doc, Number(num.trim() || NaN));

  const open = () => {
    setNum(String(nextMemoryNumber(doc)));
    setLabel("");
    setAsking(true);
  };
  const create = () => {
    if (!numberOk) return;
    if (useDesk.getState().saveAsNew(Number(num), label)) setAsking(false);
  };

  return (
    <section className="gv-onstage" data-blind={blind ? "" : undefined} data-dirty={dirty ? "" : undefined} aria-label={blind ? t("Memory in Blind") : t("On stage")}>
      <div className="gv-onstage__top">
        <span className="gv-panel__title">{blind ? t("In Blind") : t("On stage")}</span>
        {editing ? <span className="gv-onstage__num">{editing.number}</span> : null}
      </div>
      <div className="gv-onstage__name ts-ellipsis">{editing ? memoryTitle(t, editing) : t("No memory: free desk")}</div>
      <div className="gv-onstage__state" role="status">
        {dirty ? (
          <span className="gv-onstage__warn">
            <span className="ts-dot ts-dot--sb" /> {t("changed, not saved")}
          </span>
        ) : editing ? (
          <span className="ts-muted">{t("as saved")}</span>
        ) : (
          <span className="ts-muted">{t("Move the faders, then save the look as a memory.")}</span>
        )}
      </div>
      {asking && !blind ? (
        <div className="gv-onstage__form">
          <label className="gv-onstage__field">
            <span>{t("Number")}</span>
            <input className="ts-input" inputMode="numeric" value={num} aria-invalid={!numberOk} onChange={(e) => setNum(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && create()} autoFocus />
          </label>
          <label className="gv-onstage__field gv-onstage__field--grow">
            <span>{t("Name")}</span>
            <input className="ts-input" value={label} placeholder={t("e.g. Dawn")} onChange={(e) => setLabel(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          </label>
          {!numberOk ? <p className="gv-onstage__error">{t("The number must be a whole number above zero, not used by another memory.")}</p> : null}
          <div className="gv-onstage__buttons">
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="primary" icon="save" disabled={!numberOk} onClick={create}>
              {t("Save memory")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="gv-onstage__buttons">
          {editing ? (
            <Button variant="primary" icon="save" disabled={!dirty} onClick={() => useDesk.getState().save()} title={t("Save over this memory")}>
              {t("Save")}
            </Button>
          ) : null}
          {!blind ? (
            <Button icon="plus" onClick={open} title={t("Save the lights as a new memory")}>
              {t("Save as new")}
            </Button>
          ) : null}
          {editing ? (
            <Button variant="ghost" icon="reset" disabled={!dirty} onClick={() => void restoreAsk(t)} title={t("Go back to the saved values of this memory")}>
              {t("Restore")}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** One memory of the list: thumbnail of the stage, number, name; on stage = green, in Blind = blue. */
const MemoryRow = memo(function MemoryRow({ doc, m, live, blind, cursor, dirty, seqIndex, seqLength }: { doc: GranveloDoc; m: Memory; live: boolean; blind: boolean; cursor: boolean; dirty: boolean; seqIndex: number; seqLength: number }) {
  const t = useT();
  const lang = useLang();
  const [editing, setEditing] = useState<"name" | "number" | null>(null);
  const values = useMemo(() => stateUniverse(doc, m.state), [doc.fixtures, m.state]);
  const stageDoc = useMemo(() => ({ stage: doc.stage, trusses: doc.trusses, fixtures: doc.fixtures, scenery: doc.scenery }), [doc.stage, doc.trusses, doc.fixtures, doc.scenery]);
  const lit = litCount(doc, m.state);
  const meta = [lit === 1 ? t("1 light on") : t("{n} lights on", { n: lit }), transitionParts(t, lang, m.transition).main].join(" · ");
  return (
    <li
      className="gv-mrow"
      data-live={live ? "" : undefined}
      data-blind={blind ? "" : undefined}
      data-cursor={cursor ? "" : undefined}
      aria-current={live ? "true" : undefined}
    >
      <div
        className="gv-mrow__main"
        role="button"
        tabIndex={0}
        title={t("Put this memory on stage")}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) useDesk.getState().setCursor(m.id);
          else void selectMemory(t, m.id);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void selectMemory(t, m.id);
          }
        }}
      >
        <span className="gv-stagebox gv-mrow__thumb" aria-hidden>
          <StageView2D doc={stageDoc} view="plan" values={values} scenery={m.scenery} compact />
        </span>
        <span className="gv-mrow__text">
          <span className="gv-mrow__line">
            {editing === "number" ? (
              <InlineEdit
                value={String(m.number)}
                label={t("Number")}
                numeric
                width={52}
                onCommit={(v) => {
                  setEditing(null);
                  if (v.trim() !== String(m.number)) renumberMemory(t, m.id, v);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <span className="gv-mrow__num">{m.number}</span>
            )}
            {editing === "name" ? (
              <InlineEdit
                value={m.label}
                label={t("Name")}
                placeholder={t("Memory {n}", { n: m.number })}
                onCommit={(v) => {
                  setEditing(null);
                  renameMemoryTo(m.id, v);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <span className="gv-mrow__name ts-ellipsis" onDoubleClick={(e) => { e.stopPropagation(); setEditing("name"); }}>
                {memoryTitle(t, m)}
              </span>
            )}
          </span>
          <span className="gv-mrow__meta ts-ellipsis">
            {live ? (
              <span className="gv-mrow__tag gv-mrow__tag--live">{dirty ? t("on stage · changed") : t("on stage")}</span>
            ) : blind ? (
              <span className="gv-mrow__tag gv-mrow__tag--blind">{t("in Blind")}</span>
            ) : null}
            {seqIndex < 0 ? <span className="gv-mrow__tag">{t("not in the sequence")}</span> : null}
            {meta}
          </span>
        </span>
      </div>
      <div className="gv-mrow__tools">
        {seqIndex >= 0 ? (
          <>
            <button type="button" className="gv-mrow__tool" disabled={seqIndex === 0} title={t("Earlier in the show")} aria-label={t("Earlier in the show")} onClick={() => useDoc.getState().change((d) => moveInSequence(d, m.id, -1))}>
              <Icon name="arrowUp" size={14} />
            </button>
            <button type="button" className="gv-mrow__tool" disabled={seqIndex === seqLength - 1} title={t("Later in the show")} aria-label={t("Later in the show")} onClick={() => useDoc.getState().change((d) => moveInSequence(d, m.id, 1))}>
              <Icon name="arrowDown" size={14} />
            </button>
          </>
        ) : null}
        <button type="button" className="gv-mrow__tool gv-mrow__tool--blind" title={t("Change it in Blind (the stage does not change)")} aria-label={t("Blind")} onClick={() => void toggleBlind(t, m.id)}>
          <Icon name="eyeOff" size={14} />
        </button>
        <button type="button" className="gv-mrow__tool" title={t("Rename")} aria-label={t("Rename")} onClick={() => setEditing("name")}>
          <Icon name="pencil" size={14} />
        </button>
        <button type="button" className="gv-mrow__tool" title={t("Change the number")} aria-label={t("Change the number")} onClick={() => setEditing("number")}>
          <Icon name="tags" size={14} />
        </button>
        <button type="button" className="gv-mrow__tool" title={t("Delete the memory")} aria-label={t("Delete the memory")} onClick={() => void deleteMemoryAsk(t, m.id)}>
          <Icon name="trash" size={14} />
        </button>
      </div>
    </li>
  );
});

/** The memories of the show in show order (the sequence first, then the ones left out, by number). */
export function MemoryList() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const liveId = useDesk((s) => s.liveMemoryId);
  const blindId = useDesk((s) => s.blind?.memoryId ?? null);
  const cursorId = useDesk((s) => s.cursorId);
  const modified = useDesk((s) => s.modified);
  const memories = useMemo(() => memoriesInOrder(doc), [doc.memories, doc.sequence]);
  const seqLength = doc.sequence.length;
  return (
    <section className="gv-mlist" aria-label={t("Memories")}>
      <div className="gv-panel__head">
        <span className="gv-panel__title">{t("Memories")}</span>
        <span className="gv-count">{memories.length}</span>
      </div>
      {memories.length === 0 ? (
        <p className="gv-empty">{t("No memories yet. Set the lights and press “Save as new”.")}</p>
      ) : (
        <ul className="gv-memlist gv-mlist__ul">
          {memories.map((m) => (
            <MemoryRow key={m.id} doc={doc} m={m} live={m.id === liveId} blind={m.id === blindId} cursor={m.id === cursorId} dirty={m.id === liveId && modified} seqIndex={doc.sequence.indexOf(m.id)} seqLength={seqLength} />
          ))}
        </ul>
      )}
    </section>
  );
}

