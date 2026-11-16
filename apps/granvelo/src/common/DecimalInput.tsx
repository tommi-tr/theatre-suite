import { useEffect, useState } from "react";
import { parseNumberText } from "@theatre-suite/ui";
import { useLang } from "@theatre-suite/core";
import { fmtNum } from "../lib/format";

/**
 * A small number field (metres, seconds): accepts "4,5" and "4.5", changes the value when leaving the field
 * or with Enter; a value that is not a number or out of range goes back to the previous one.
 */
export function DecimalInput({
  value,
  onChange,
  label,
  unit,
  min = 0,
  max = 1000,
  decimals = 2,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  unit: string;
  min?: number;
  max?: number;
  decimals?: number;
  disabled?: boolean;
}) {
  const lang = useLang();
  const shown = fmtNum(value, lang, decimals);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const v = parseNumberText(text);
    if (v === null || v < min || v > max) {
      setText(shown);
      return;
    }
    const k = 10 ** decimals;
    const r = Math.round(v * k) / k;
    if (r !== value) onChange(r);
    else setText(shown);
  };
  return (
    <span className="gv-decimal">
      <input
        className="ts-input ts-number"
        aria-label={label}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            e.stopPropagation();
            setText(shown);
          }
        }}
      />
      <span className="ts-muted">{unit}</span>
    </span>
  );
}
