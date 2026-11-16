import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLang, type TFunc } from "@theatre-suite/core";
import { parseNumberText } from "@theatre-suite/ui";
import { conflictDetails, lastChannel } from "../../model/addresses";
import { fixtureType } from "../../model/fixtureTypes";
import { listOrder, trussOrdinal, type PlaceKey } from "../../model/ops";
import type { Fixture, FixtureTypeId, GranveloDoc, Id } from "../../model/types";
import { fmtAddress, fmtNum } from "../../lib/format";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";

/** Name of a truss: the user's, or the automatic one from its order front to back. */
export function trussName(t: TFunc, doc: GranveloDoc, trussId: string): string {
  const tr = doc.trusses.find((x) => x.id === trussId);
  if (tr?.name) return tr.name;
  return t("Truss {n}", { n: trussOrdinal(doc, trussId) });
}

export function placeTitle(t: TFunc, doc: GranveloDoc, key: PlaceKey): string {
  switch (key.kind) {
    case "house":
      return t("In the house");
    case "truss":
      return trussName(t, doc, key.trussId);
    case "floatingStage":
      return t("Floating over the stage");
    default:
      return t("On the floor");
  }
}

/** What to call a light in a sentence: its name, or its type. */
export const lightName = (t: TFunc, f: Pick<Fixture, "name" | "typeId">): string => f.name || t(fixtureType(f.typeId).name);

/** How a light is named in a sentence: its name, or its type with its number when it has no name ("PC (5)"). */
export const lightRef = (t: TFunc, f: Pick<Fixture, "name" | "typeId" | "number">): string => f.name || `${t(fixtureType(f.typeId).name)} (${f.number})`;

/** "PC centro (5)": name and number, for tooltips. */
export const lightTag = (t: TFunc, f: Pick<Fixture, "name" | "typeId" | "number">): string => `${lightName(t, f)} (${f.number})`;

/** Hung lights face down (the symbol is drawn upside down), lights on the floor face up. */
export const symbolRotation = (f: Fixture) => (f.mount.kind === "floor" ? 0 : 180);

/** Start of the automatic name of new lights of a type: "PAR" gives "PAR 1", "PAR 2"… */
export function autoNameBase(t: TFunc, typeId: FixtureTypeId): string {
  switch (typeId) {
    case "halogen":
      return t("Halogen");
    case "pc":
      return t("PC");
    case "profile":
      return t("Profile");
    case "parRgb":
    case "parRgbw":
    case "par6":
    case "par7":
      return t("PAR");
    case "ledBar":
      return t("Bar");
    case "washMover":
      return t("Wash");
    case "spotMover":
      return t("Spot");
    case "strobe":
      return t("Strobe light");
    default:
      return t("Smoke");
  }
}

/** The sentences that explain why a light is in conflict, in plain words (empty if it is not). */
export function conflictSentences(t: TFunc, doc: GranveloDoc, f: Fixture): string[] {
  if (f.unused) return [];
  const out = conflictDetails(doc, f.id).map((d) =>
    d.from === d.to
      ? t("Channel {ch} is already used by “{name}”", { ch: d.from, name: lightRef(t, d.other) })
      : t("Channels {from}–{to} are already used by “{name}”", { from: d.from, to: d.to, name: lightRef(t, d.other) }),
  );
  const last = lastChannel(f);
  if (last !== null && last > 512) out.push(t("Its last channel would be {n}, beyond 512.", { n: last }));
  return out;
}

/** "017–020" (or "017" for one channel): the channels a light occupies. */
export function channelRange(f: Pick<Fixture, "address" | "channels">): string {
  if (f.address === null) return "";
  const last = Math.min(512, f.address + Math.max(1, f.channels.length) - 1);
  return last === f.address ? fmtAddress(f.address) : `${fmtAddress(f.address)}–${fmtAddress(last)}`;
}

/** The selected lights that still exist, in the order of the list. */
export function useSelectedIds(): Id[] {
  const doc = useDoc((s) => s.doc);
  const selection = useUi((s) => s.selection);
  return useMemo(() => {
    if (!doc || selection.length === 0) return [];
    const set = new Set(selection);
    return listOrder(doc).filter((id) => set.has(id));
  }, [doc, selection]);
}

/**
 * A number field for the properties: shows `value` (null = the selected lights differ: the field says so), changes it
 * when leaving the field or with Enter; something that is not a number, or out of range, goes back.
 */
export function FieldNumber({
  value,
  onCommit,
  label,
  min,
  max,
  decimals = 2,
  integer,
  unit,
  placeholder,
  disabled,
  pad,
  className,
  title,
}: {
  value: number | null;
  onCommit: (v: number) => void;
  label: string;
  min: number;
  max: number;
  decimals?: number;
  integer?: boolean;
  unit?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Show an address with leading zeros. */
  pad?: boolean;
  className?: string;
  title?: string;
}) {
  const lang = useLang();
  const shown = value === null ? "" : pad ? fmtAddress(value) : fmtNum(value, lang, integer ? 0 : decimals);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    if (text === shown) return;
    const v = parseNumberText(text);
    if (v === null || v < min || v > max || (integer && !Number.isInteger(v))) {
      setText(shown);
      return;
    }
    const k = 10 ** (integer ? 0 : decimals);
    const r = Math.round(v * k) / k;
    if (r !== value) onCommit(r);
    else setText(shown);
  };
  return (
    <span className={`gv-num${className ? ` ${className}` : ""}`}>
      <input
        className="ts-input ts-number"
        aria-label={label}
        title={title}
        inputMode={integer ? "numeric" : "decimal"}
        value={text}
        placeholder={placeholder ?? (value === null ? "—" : undefined)}
        disabled={disabled}
        onChange={(e) => setText(e.currentTarget.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            e.preventDefault();
            setText(shown);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      {unit ? <span className="gv-num__unit">{unit}</span> : null}
    </span>
  );
}

/** A small titled block of the properties panel. */
export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="gv-sec">
      <h4 className="gv-sec__title">{title}</h4>
      {hint ? <p className="gv-sec__hint">{hint}</p> : null}
      {children}
    </section>
  );
}

/** Value shared by all lights, or null when they differ. */
export function common<T>(items: Fixture[], pick: (f: Fixture) => T, same: (a: T, b: T) => boolean = (a, b) => a === b): T | null {
  if (items.length === 0) return null;
  const first = pick(items[0]);
  return items.every((f) => same(pick(f), first)) ? first : null;
}
