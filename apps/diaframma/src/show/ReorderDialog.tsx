import { useRef, useState } from "react";
import { formatTime, useT } from "@theatre-suite/core";
import { Button, Dialog, Icon } from "@theatre-suite/ui";
import { effectiveOut, numbering, trackDuration, useDoc } from "../state/doc";
import type { Track } from "../state/types";
import { useSettings } from "../state/settings";

export function ReorderDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const infos = useDoc((s) => s.infos);
  const [order, setOrder] = useState<Track[]>(() => useDoc.getState().tracks);
  const [selected, setSelected] = useState<string | null>(order[0]?.id ?? null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nums = numbering(order, useSettings((x) => x.settings.numberFrom));

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to > order.length) return;
    const next = [...order];
    const [x] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, x);
    setOrder(next);
  };
  const indexAt = (clientY: number) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return rows.length;
  };
  const apply = () => {
    useDoc.getState().setTracks(() => order);
    onClose();
  };

  return (
    <Dialog
      title={t("Reorder tracks")}
      icon="reorder"
      description={t("Drag a row to its new place. Numbers update by themselves.")}
      onClose={onClose}
      footer={
        <>
          <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{t("Alt + ↑ ↓ moves the selected row")}</span>
          <span className="ts-spacer" />
          <Button icon="x" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" icon="check" onClick={apply}>
            {t("Done")}
          </Button>
        </>
      }
    >
      <div
        ref={listRef}
        style={{ display: "flex", flexDirection: "column", gap: 4 }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (!selected) return;
          const i = order.findIndex((x) => x.id === selected);
          if (e.altKey && e.key === "ArrowUp") {
            e.preventDefault();
            move(i, i - 1);
          } else if (e.altKey && e.key === "ArrowDown") {
            e.preventDefault();
            move(i, i + 2);
          } else if (e.key === "ArrowUp" && i > 0) {
            e.preventDefault();
            setSelected(order[i - 1].id);
          } else if (e.key === "ArrowDown" && i < order.length - 1) {
            e.preventDefault();
            setSelected(order[i + 1].id);
          }
        }}
        onPointerMove={(e) => dragId && setDropAt(indexAt(e.clientY))}
        onPointerUp={() => {
          if (dragId !== null && dropAt !== null) move(order.findIndex((x) => x.id === dragId), dropAt);
          setDragId(null);
          setDropAt(null);
        }}
      >
        {order.map((tr, i) => {
          const d = trackDuration(tr, infos);
          const o = effectiveOut(tr, d);
          return (
            <div key={tr.id}>
              {dragId && dropAt === i ? <div className="df-reorder-drop" /> : null}
              <div
                data-row
                className={dragId === tr.id ? "df-reorder-row df-reorder-row--dragging" : "df-reorder-row"}
                aria-selected={selected === tr.id}
                onPointerDown={(e) => {
                  setSelected(tr.id);
                  setDragId(tr.id);
                  (e.currentTarget.parentElement?.parentElement as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
                }}
              >
                <Icon name="grip" size={16} strokeWidth={3} color="var(--text-3)" />
                <span className="mono" style={{ width: 26, textAlign: "right", fontWeight: 600, color: tr.hidden ? "var(--text-3)" : "var(--text)" }}>
                  {nums.get(tr.id) ?? "–"}
                </span>
                <span className="ts-ellipsis" style={{ flex: 1, color: tr.file ? "var(--text)" : "var(--text-3)" }}>
                  {tr.file?.name ?? t("Empty slot")}
                  {tr.hidden ? ` · ${t("hidden")}` : ""}
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                  {o !== null ? formatTime(o - tr.inSec) : ""}
                </span>
              </div>
            </div>
          );
        })}
        {dragId && dropAt === order.length ? <div className="df-reorder-drop" /> : null}
      </div>
    </Dialog>
  );
}
