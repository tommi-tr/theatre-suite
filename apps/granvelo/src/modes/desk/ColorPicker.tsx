import { useT } from "@theatre-suite/core";
import { pickerColor, hasColorPicker } from "../../model/desk";
import { valuesOf } from "../../model/universe";
import { useDesk } from "../../store/desk";
import { useDoc } from "../../store/doc";
import { useUi } from "../../store/ui";

/** Colour picker for the selected lights that have red, green and blue: sets R, G, B (and W, A where the light has them). */
export function ColorPicker() {
  const t = useT();
  const doc = useDoc((s) => s.doc)!;
  const selection = useUi((s) => s.selection);
  const values = useDesk((s) => (s.blind ? s.blind.values : s.values));
  const presets = [
    { name: t("Red"), hex: "#FF0000" },
    { name: t("Orange"), hex: "#FF6A00" },
    { name: t("Yellow"), hex: "#FFD400" },
    { name: t("Green"), hex: "#00D84A" },
    { name: t("Cyan"), hex: "#00C8FF" },
    { name: t("Blue"), hex: "#1F3FFF" },
    { name: t("Violet"), hex: "#8A2BFF" },
    { name: t("Magenta"), hex: "#FF1FB4" },
    { name: t("Pink"), hex: "#FF8FB8" },
    { name: t("Warm white"), hex: "#FFC98A" },
    { name: t("White"), hex: "#FFFFFF" },
  ];
  const lights = doc.fixtures.filter((f) => selection.includes(f.id) && hasColorPicker(f));
  if (!lights.length) return null;
  const first = lights[0];
  const current = pickerColor(first, valuesOf(first, values));
  const ids = lights.map((f) => f.id);
  return (
    <section className="gv-picker" aria-label={t("Colour")}>
      <div className="gv-panel__head">
        <span className="gv-panel__title">{t("Colour")}</span>
        <span className="gv-count">{lights.length === 1 ? t("1 light") : t("{n} lights", { n: lights.length })}</span>
      </div>
      <div className="gv-picker__row">
        {presets.map((p) => (
          <button
            key={p.hex}
            type="button"
            className="gv-picker__swatch"
            style={{ background: p.hex }}
            title={p.name}
            aria-label={p.name}
            data-on={current.toUpperCase() === p.hex ? "" : undefined}
            onClick={() => useDesk.getState().setColor(ids, p.hex)}
          />
        ))}
        <label className="gv-picker__custom" title={t("Another colour")}>
          <input type="color" aria-label={t("Another colour")} value={current.toLowerCase()} onInput={(e) => useDesk.getState().setColor(ids, e.currentTarget.value)} onChange={() => {}} />
          <span>{t("Other…")}</span>
        </label>
      </div>
    </section>
  );
}
