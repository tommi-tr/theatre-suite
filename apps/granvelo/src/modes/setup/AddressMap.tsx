import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useT } from "@theatre-suite/core";
import { Icon } from "@theatre-suite/ui";
import { addressMap, addressProblems, conflictPairs, type MapCell } from "../../model/addresses";
import { CHANNEL_INFO } from "../../model/fixtureTypes";
import type { Fixture, GranveloDoc, Id } from "../../model/types";
import { UNIVERSE_SIZE } from "../../model/types";
import { fmtAddress } from "../../lib/format";
import { lightTag } from "./common";

/**
 * The 512 DMX channels as a grid: who occupies what. Self-contained (give it the document and the selected lights):
 * Allestimento shows it in the centre for now, the 3D phase will also use it as a view/dialog.
 *
 * Cells: free = neutral; occupied = tinted per light (two tints alternate so neighbours can be told apart, the
 * light's number sits on its first channel); conflict = amber with a "!" (colour and mark); reserved by a light
 * "not used in this production" = hatched grey. The selected lights have their cells outlined in the accent.
 */

interface CellView {
  ch: number;
  /** "free" | "used" | "conflict" | "reserved" */
  kind: "free" | "used" | "conflict" | "reserved";
  /** Light that owns the cell (first of them when in conflict). */
  id: Id | null;
  /** Tint index of the owning light (0 or 1). */
  tint: 0 | 1;
  /** Number to write on this cell (the light's number on its first channel). */
  label: string;
  /** First channel of its run: draws a separator on the left. */
  start: boolean;
  selected: boolean;
}

function buildCells(doc: Pick<GranveloDoc, "fixtures">, selected: Set<Id>): CellView[] {
  const map = addressMap(doc);
  // Tint by order of address, alternating, so two neighbouring lights never look alike.
  const byAddr = [...doc.fixtures].filter((f) => f.address !== null).sort((a, b) => a.address! - b.address! || a.number - b.number);
  const tint = new Map<Id, 0 | 1>();
  byAddr.forEach((f, i) => tint.set(f.id, (i % 2) as 0 | 1));
  const byId = new Map(doc.fixtures.map((f) => [f.id, f]));
  return map.map((c: MapCell) => {
    const ownerId = c.lights[0] ?? c.reserved[0] ?? null;
    const owner = ownerId ? byId.get(ownerId) : undefined;
    const kind: CellView["kind"] = c.conflict ? "conflict" : c.lights.length ? "used" : c.reserved.length ? "reserved" : "free";
    const start = !!owner && owner.address === c.channel;
    return {
      ch: c.channel,
      kind,
      id: ownerId,
      tint: ownerId ? (tint.get(ownerId) ?? 0) : 0,
      label: start ? String(owner!.number) : "",
      start: start || (c.lights.length > 1 && c.lights.some((id) => byId.get(id)?.address === c.channel)),
      selected: [...c.lights, ...c.reserved].some((id) => selected.has(id)),
    };
  });
}

export function AddressMap({ doc, selected, onSelect }: { doc: GranveloDoc; selected: Id[]; onSelect?: (id: Id, e: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">) => void }) {
  const t = useT();
  const sel = useMemo(() => new Set(selected), [selected]);
  const cells = useMemo(() => buildCells(doc, sel), [doc, sel]);
  const problems = useMemo(() => addressProblems(doc), [doc]);
  const pairs = conflictPairs(problems);
  const used = useMemo(() => cells.filter((c) => c.kind !== "free").length, [cells]);
  const out = problems.outOfRange.size;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(32);
  const [tip, setTip] = useState<{ ch: number; x: number; y: number; align: "start" | "mid" | "end" } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  // 32 columns when each cell is at least 14 px wide, else 16: the grid is always readable.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setCols(el.clientWidth - 40 >= 32 * 14 ? 32 : 16);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const describe = (ch: number): string => {
    const c = cells[ch - 1];
    const owners = (doc.fixtures as Fixture[]).filter((f) => (f.address !== null && f.address <= ch && ch < f.address + f.channels.length));
    if (owners.length === 0) return t("Channel {ch} · free", { ch });
    const parts = owners.map((f) => {
      const fn = f.channels[ch - (f.address as number)];
      const name = fn ? (fn.label ?? t(CHANNEL_INFO[fn.function].label)) : "";
      return `${lightTag(t, f)}${f.unused ? ` · ${t("not used")}` : ""} · ${name}`;
    });
    return `${t("Channel {ch}", { ch })} · ${parts.join(" / ")}${c.kind === "conflict" ? ` · ${t("Conflict")}` : ""}`;
  };

  const chOf = (el: EventTarget | null): number | null => {
    const n = (el as HTMLElement | null)?.closest?.("[data-ch]")?.getAttribute("data-ch");
    return n ? Number(n) : null;
  };
  const showTip = (ch: number, el: Element) => {
    const w = wrapRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (w) {
      const x = r.left - w.left + r.width / 2;
      setTip({ ch, x, y: r.top - w.top, align: x < 150 ? "start" : x > w.width - 150 ? "end" : "mid" });
    }
  };

  const choose = (ch: number, e: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">) => {
    const c = cells[ch - 1];
    if (c.id && onSelect) onSelect(c.id, e);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = cursor ?? 1;
    let next = cur;
    if (e.key === "ArrowRight") next = cur + 1;
    else if (e.key === "ArrowLeft") next = cur - 1;
    else if (e.key === "ArrowDown") next = cur + cols;
    else if (e.key === "ArrowUp") next = cur - cols;
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = UNIVERSE_SIZE;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(cur, e);
      return;
    } else return;
    e.preventDefault();
    next = Math.max(1, Math.min(UNIVERSE_SIZE, next));
    setCursor(next);
    const el = wrapRef.current?.querySelector(`[data-ch="${next}"]`);
    if (el) showTip(next, el);
  };

  return (
    <section className="gv-map" aria-label={t("Address map")} ref={wrapRef}>
      <header className="gv-map__head">
        <h3 className="gv-map__title">{t("Address map")}</h3>
        <span className="gv-map__summary">
          {t("{used} channels used of 512", { used })}
          {" · "}
          {pairs === 0 && out === 0 ? (
            <span className="gv-map__ok">{t("no conflicts")}</span>
          ) : (
            <span className="gv-map__bad" role="status" title={out > 0 ? t("Out of range") : t("Address conflict")}>
              <Icon name="alert" size={13} />
              {pairs > 0 ? (pairs === 1 ? t("1 conflict") : t("{n} conflicts", { n: pairs })) : null}
              {pairs > 0 && out > 0 ? " · " : null}
              {out > 0 ? (out === 1 ? t("1 light goes past channel 512") : t("{n} lights go past channel 512", { n: out })) : null}
            </span>
          )}
        </span>
      </header>
      <div
        className="gv-map__grid"
        role="application"
        aria-label={t("The 512 DMX channels. Arrow keys move, Enter selects the light.")}
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => cursor === null && setCursor(1)}
        onMouseOver={(e) => {
          const ch = chOf(e.target);
          if (ch) showTip(ch, (e.target as HTMLElement).closest("[data-ch]")!);
        }}
        onMouseLeave={() => setTip(null)}
        onBlur={() => setTip(null)}
        onClick={(e) => {
          const ch = chOf(e.target);
          if (ch) choose(ch, e);
        }}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, ["--gv-cols" as string]: cols }}
      >
        {cells.map((c) => (
          <Cell key={c.ch} c={c} rowStart={(c.ch - 1) % cols === 0} cursor={cursor === c.ch} />
        ))}
      </div>
      {tip ? (
        <div className="gv-map__tip" data-align={tip.align} role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {describe(tip.ch)}
        </div>
      ) : null}
      <ul className="gv-map__legend" aria-label={t("Legend")}>
        <li>
          <span className="gv-cell gv-cell--free" aria-hidden="true" /> {t("Free")}
        </li>
        <li>
          <span className="gv-cell gv-cell--used" data-tint="0" aria-hidden="true" />
          <span className="gv-cell gv-cell--used" data-tint="1" aria-hidden="true" /> {t("Used by a light (its number on its first channel)")}
        </li>
        <li>
          <span className="gv-cell gv-cell--conflict" aria-hidden="true" /> {t("Conflict: two lights on one channel")}
        </li>
        <li>
          <span className="gv-cell gv-cell--reserved" aria-hidden="true" /> {t("Kept by a light not used")}
        </li>
        <li>
          <span className="gv-cell gv-cell--used gv-cell--selected" data-tint="0" aria-hidden="true" /> {t("Selected")}
        </li>
      </ul>
    </section>
  );
}

const Cell = memo(function Cell({ c, rowStart, cursor }: { c: CellView; rowStart: boolean; cursor: boolean }) {
  return (
    <div
      className={`gv-cell gv-cell--${c.kind}${c.selected ? " gv-cell--selected" : ""}${c.start ? " gv-cell--start" : ""}${cursor ? " gv-cell--cursor" : ""}${rowStart ? " gv-cell--row" : ""}`}
      data-ch={c.ch}
      data-tint={c.kind === "used" || c.kind === "conflict" ? c.tint : undefined}
      data-row={rowStart ? fmtAddress(c.ch) : undefined}
    >
      {c.kind === "conflict" ? <span className="gv-cell__mark">!</span> : c.label}
    </div>
  );
});
