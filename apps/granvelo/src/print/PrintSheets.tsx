import type { Lang, TFunc } from "@theatre-suite/core";
import { SymbolGlyph } from "../common/symbolGlyph";
import { fmtNum } from "../lib/format";
import type { ListData, PlanData } from "./printData";

/**
 * The two sheets, on white paper (the stage is dark on the screen, the prints are light). They take everything as props
 * (no stores, no context) so that the same markup is shown in the preview and handed to the printer.
 */

interface SheetProps {
  t: TFunc;
  lang: Lang;
  title: string;
}

/** The plan seen from above: stage, bars with their names, scenery, every light with its number and address, the measures. */
export function PlanSheet({ t, lang, title, plan }: SheetProps & { plan: PlanData }) {
  const { box, stage, symbol: s, nameX, trusses, lights, pieces, legend } = plan;
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const n = (v: number) => fmtNum(v, lang, 2);
  const hair = 0.018;
  const font = s * 0.5;
  const half = stage.width / 2;
  return (
    <section className="gv-sheet gv-sheet--plan" aria-label={t("Plan of the lights")}>
      <header className="gv-sheet__head">
        <h1>{title}</h1>
      </header>
      <div className="gv-sheet__body">
      <svg className="gv-sheet__plan" viewBox={`${box.minX} ${box.minY} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("Plan of the lights")}>
        {/* The stage. */}
        <rect x={-half} y={-stage.depth} width={stage.width} height={stage.depth} fill="#f6f6f4" stroke="#8a8a8a" strokeWidth={hair * 1.5} />
        <line x1={-half} y1={0} x2={half} y2={0} stroke="#222" strokeWidth={hair * 4} strokeLinecap="round" />
        <text x={0} y={s * 0.62} textAnchor="middle" fontSize={font * 0.9} fill="#777" letterSpacing={font * 0.1}>
          {t("Audience").toUpperCase()}
        </text>
        <text x={0} y={-stage.depth - font * 0.55} textAnchor="middle" fontSize={font * 0.9} fill="#777" letterSpacing={font * 0.1}>
          {t("Back of the stage").toUpperCase()}
        </text>

        {/* Scenery, as light grey outlines. */}
        {pieces.map((p) => (
          <polygon key={p.id} points={p.points} fill="#dedede" stroke="#9a9a9a" strokeWidth={hair} strokeLinejoin="round" />
        ))}

        {/* Bars. */}
        {trusses.map((tr) => {
          const x1 = -half - 0.3;
          const x2 = half + 0.3;
          return (
            <g key={tr.id}>
              <line x1={x1} y1={tr.y - 0.06} x2={x2} y2={tr.y - 0.06} stroke="#555" strokeWidth={hair * 1.4} />
              <line x1={x1} y1={tr.y + 0.06} x2={x2} y2={tr.y + 0.06} stroke="#555" strokeWidth={hair * 1.4} />
              <text x={nameX} y={tr.y - font * 0.1} fontSize={font * 1.05} fontWeight={700} fill="#111">
                {tr.name}
              </text>
              <text x={nameX} y={tr.y + font * 1.05} fontSize={font * 0.85} fill="#555">
                {tr.detail}
              </text>
            </g>
          );
        })}

        {/* Lights: the symbol, then the number (bold) and the address under it. */}
        {lights.map((l) => (
          <g key={l.id}>
            <g transform={`translate(${l.x - s / 2} ${l.y - s / 2}) scale(${s / 24})`}>
              <SymbolGlyph kind={l.symbol} state={l.unused ? "unused" : "normal"} rotate={l.rotate} />
            </g>
            <text x={l.x} y={l.y + s * 0.5 + font * 1.0} textAnchor="middle" fontSize={font * 1.1} fontWeight={700} fill={l.unused ? "#888" : "#111"}>
              {l.number}
            </text>
            {l.address ? (
              <text x={l.x} y={l.y + s * 0.5 + font * 2.05} textAnchor="middle" fontSize={font * 0.88} fill={l.unused ? "#999" : "#444"}>
                {l.address}
              </text>
            ) : null}
          </g>
        ))}

        {/* Measures of the stage. */}
        <g stroke="#444" strokeWidth={hair} fill="#222" fontSize={font}>
          <line x1={-half} y1={0.5 + s * 0.2} x2={half} y2={0.5 + s * 0.2} />
          <line x1={-half} y1={0.5 + s * 0.2 - 0.12} x2={-half} y2={0.5 + s * 0.2 + 0.12} />
          <line x1={half} y1={0.5 + s * 0.2 - 0.12} x2={half} y2={0.5 + s * 0.2 + 0.12} />
          <text x={0} y={0.5 + s * 0.2 + font * 1.15} textAnchor="middle" stroke="none">
            {n(stage.width)} m
          </text>
          <line x1={box.minX + 0.45} y1={0} x2={box.minX + 0.45} y2={-stage.depth} />
          <line x1={box.minX + 0.33} y1={0} x2={box.minX + 0.57} y2={0} />
          <line x1={box.minX + 0.33} y1={-stage.depth} x2={box.minX + 0.57} y2={-stage.depth} />
          <text transform={`translate(${box.minX + 0.3} ${-stage.depth / 2}) rotate(-90)`} textAnchor="middle" stroke="none">
            {n(stage.depth)} m
          </text>
        </g>
      </svg>
      <aside className="gv-sheet__legend" aria-label={t("Key")}>
        <span className="gv-sheet__legendtitle">{t("Key")}</span>
        {legend.map((e) => (
          <span key={e.typeId} className="gv-sheet__legenditem">
            <svg width="16" height="16" viewBox="-2 -2 28 28" aria-hidden="true" style={{ ["--gv-symbol-stroke" as string]: "#222" }}>
              <SymbolGlyph kind={e.symbol} />
            </svg>
            {e.name} × {e.count}
          </span>
        ))}
        <p className="gv-sheet__legendnote">{t("Under each light: its number, then its DMX address.")}</p>
      </aside>
      </div>
    </section>
  );
}

/** The list of lights, grouped by position. */
export function ListSheet({ t, title, list }: Omit<SheetProps, "lang"> & { list: ListData }) {
  return (
    <section className="gv-sheet gv-sheet--list" aria-label={t("List of lights")}>
      <header className="gv-sheet__head">
        <h1>{title}</h1>
        <p>
          {list.lights === 1 ? t("1 light") : t("{n} lights", { n: list.lights })}
          {list.unused > 0 ? ` · ${t("{n} not used", { n: list.unused })}` : ""}
        </p>
      </header>
      {list.groups.length === 0 ? (
        <p className="gv-sheet__empty">{t("There are no lights in this show yet.")}</p>
      ) : (
        <table className="gv-sheet__table">
          <thead>
            <tr>
              <th className="is-num">{t("No.")}</th>
              <th>{t("Name")}</th>
              <th>{t("Type")}</th>
              <th className="is-num">{t("Channels")}</th>
              <th className="is-num">{t("DMX address")}</th>
              <th>{t("Position")}</th>
            </tr>
          </thead>
          {list.groups.map((g) => (
            <tbody key={g.key}>
              <tr className="gv-sheet__group">
                <th colSpan={6}>
                  {g.title}
                  {g.detail ? <span> · {g.detail}</span> : null}
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.id} className={r.unused ? "is-unused" : undefined}>
                  <td className="is-num">{r.number}</td>
                  <td>
                    {r.name}
                    {r.unused ? <em> {t("not used")}</em> : null}
                  </td>
                  <td>{r.type}</td>
                  <td className="is-num">{r.channels}</td>
                  <td className="is-num">{r.range}</td>
                  <td>{r.position}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      )}
    </section>
  );
}
