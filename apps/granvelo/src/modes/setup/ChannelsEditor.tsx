import { useRef, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { occupiedChannels } from "../../model/addresses";
import { CHANNEL_INFO, channelColor } from "../../model/fixtureTypes";
import { CHANNEL_FUNCTIONS } from "../../model/types";
import { addChannel, applyChannelsToType, lightsToSync, moveChannel, removeChannel, setChannel } from "../../model/ops";
import type { Fixture } from "../../model/types";
import { fmtAddress } from "../../lib/format";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";
import { warnNewProblems } from "./actions";

/** The channels of one light, in DMX order: function, optional label, order (drag or buttons), add/remove, apply to the type. */
export function ChannelsEditor({ f }: { f: Fixture }) {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const change = (recipe: Parameters<ReturnType<typeof useDoc.getState>["change"]>[0], key?: string) => {
    const before = useDoc.getState().doc!;
    useDoc.getState().change(recipe, key);
    const after = useDoc.getState().doc!;
    if (after !== before) warnNewProblems(t, before, after);
  };
  const occupied = occupiedChannels(f);
  const sync = lightsToSync(doc, f.id);
  const same = doc.fixtures.filter((x) => x.typeId === f.typeId && x.id !== f.id).length;
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [handle, setHandle] = useState<number | null>(null);
  const [labelOpen, setLabelOpen] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const focusRow = (i: number, what: string) => {
    window.requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-row="${i}"] [data-act="${what}"]`)?.focus());
  };

  return (
    <div className="gv-ch">
      <ol className="gv-ch__list" ref={listRef}>
        {f.channels.map((c, i) => {
          const info = CHANNEL_INFO[c.function];
          const ch = occupied[i];
          const showLabel = !!c.label || labelOpen === i;
          return (
            <li
              key={i}
              data-row={i}
              className="gv-ch__row"
              data-over={over === i && drag !== null && drag !== i ? "" : undefined}
              data-drag={drag === i ? "" : undefined}
              draggable={handle === i}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== i) setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null && drag !== i) change((d) => moveChannel(d, f.id, drag, i));
                setDrag(null);
                setOver(null);
                setHandle(null);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
                setHandle(null);
              }}
            >
              <div className="gv-ch__line">
                <span className="gv-ch__grip" title={t("Drag to change the order")} onPointerDown={() => setHandle(i)} onPointerUp={() => setHandle(null)} onPointerLeave={() => drag === null && setHandle(null)}>
                  <Icon name="grip" size={14} />
                </span>
                <span className={`gv-ch__dmx${ch === undefined && f.address !== null ? " gv-ch__dmx--out" : ""}`} title={t("DMX channel")}>
                  {ch !== undefined ? fmtAddress(ch) : "—"}
                </span>
                <span className="gv-swatch" style={{ background: channelColor(c.function, f.typeId) }} aria-hidden="true" />
                <select
                  className="ts-select gv-ch__fn"
                  aria-label={t("Function of channel {n}", { n: i + 1 })}
                  value={c.function}
                  onChange={(e) => change((d) => setChannel(d, f.id, i, { function: e.currentTarget.value as (typeof CHANNEL_FUNCTIONS)[number] }))}
                >
                  {CHANNEL_FUNCTIONS.map((fn) => (
                    <option key={fn} value={fn}>
                      {t(CHANNEL_INFO[fn].label)}
                    </option>
                  ))}
                </select>
                <span className="gv-ch__btns">
                  <Button variant="ghost" iconOnly icon="tags" on={showLabel} className="gv-ch__b" aria-label={t("Label of channel {n}", { n: i + 1 })} title={t("Label (optional)")} onClick={() => setLabelOpen(labelOpen === i ? null : i)} />
                  <Button
                    variant="ghost"
                    iconOnly
                    icon="arrowUp"
                    data-act="up"
                    className="gv-ch__b"
                    disabled={i === 0}
                    aria-label={t("Move channel {n} up", { n: i + 1 })}
                    title={t("Move up")}
                    onClick={() => {
                      change((d) => moveChannel(d, f.id, i, i - 1));
                      focusRow(i - 1, "up");
                    }}
                  />
                  <Button
                    variant="ghost"
                    iconOnly
                    icon="arrowDown"
                    data-act="down"
                    className="gv-ch__b"
                    disabled={i === f.channels.length - 1}
                    aria-label={t("Move channel {n} down", { n: i + 1 })}
                    title={t("Move down")}
                    onClick={() => {
                      change((d) => moveChannel(d, f.id, i, i + 1));
                      focusRow(i + 1, "down");
                    }}
                  />
                  <Button variant="ghost" iconOnly icon="x" className="gv-ch__b" disabled={f.channels.length <= 1} aria-label={t("Remove channel {n}", { n: i + 1 })} title={t("Remove channel")} onClick={() => change((d) => removeChannel(d, f.id, i))} />
                </span>
              </div>
              {showLabel ? (
                <LabelField
                  value={c.label ?? ""}
                  placeholder={t(info.label)}
                  label={t("Label of channel {n}", { n: i + 1 })}
                  autoFocus={labelOpen === i}
                  onCommit={(label) => {
                    change((d) => setChannel(d, f.id, i, { label }), `label:${f.id}:${i}`);
                    if (!label) setLabelOpen(null);
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="gv-ch__foot">
        <Button variant="sm" icon="plus" onClick={() => change((d) => addChannel(d, f.id))}>
          {t("Add a channel")}
        </Button>
        <Button
          variant="sm"
          icon="copy"
          disabled={same === 0}
          title={same === 0 ? t("There is no other light of this type") : undefined}
          onClick={() => {
            const n = sync.length;
            change((d) => applyChannelsToType(d, f.id));
            useUi.getState().showToast(n === 0 ? t("All lights of this type already have these channels.") : n === 1 ? t("Channels copied to 1 light of this type.") : t("Channels copied to {n} lights of this type.", { n }));
          }}
        >
          {t("Apply to all lights of this type")}
        </Button>
      </div>
    </div>
  );
}

function LabelField({ value, onCommit, placeholder, label, autoFocus }: { value: string; onCommit: (v: string) => void; placeholder: string; label: string; autoFocus: boolean }) {
  const [text, setText] = useState(value);
  return (
    <input
      className="ts-input gv-ch__label"
      value={text}
      placeholder={placeholder}
      aria-label={label}
      autoFocus={autoFocus}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={() => text.trim() !== value && onCommit(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        else if (e.key === "Escape") {
          setText(value);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}
