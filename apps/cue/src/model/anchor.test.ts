import { describe, expect, it } from "vitest";
import { buildIndex, makeAnchor, normalizeText, pageLines, relocate, wordSimilarity, type PageText, type TextItem } from "./anchor";

/** A page made of lines, one run per line, 3% of the page apart from 10% down. */
function page(n: number, lines: string[], top = 0.1): PageText {
  return { page: n, items: lines.map((str, i) => ({ str, x: 0.1, y: top + i * 0.03, w: str.length * 0.01, h: 0.02 })) };
}

const SCENE = [
  "ATTO PRIMO",
  "SCENA PRIMA",
  "MARCHESE",
  "Fra voi e me vi è qualche differenza.",
  "CONTE",
  "Sulla locanda tanto vale il vostro denaro, quanto vale il mio.",
  "MARCHESE",
  "Ma se la locandiera usa a me delle distinzioni, mi si convengono più che a voi.",
  "CONTE",
  "Per qual ragione?",
  "MARCHESE",
  "Io sono il Marchese di Forlipopoli.",
  "CONTE",
  "Ed io sono il Conte d'Albafiorita.",
];

const yOf = (i: number, top = 0.1) => top + i * 0.03 + 0.01;

describe("lines of a page", () => {
  it("groups runs on the same height into one line, in reading order", () => {
    const items: TextItem[] = [
      { str: "vale il mio.", x: 0.5, y: 0.2, w: 0.2, h: 0.02 },
      { str: "CONTE", x: 0.1, y: 0.1, w: 0.1, h: 0.02 },
      { str: "Sulla locanda", x: 0.1, y: 0.201, w: 0.3, h: 0.02 },
      { str: "  ", x: 0.1, y: 0.5, w: 0.01, h: 0.02 },
    ];
    expect(pageLines(items).map((l) => l.text)).toEqual(["CONTE", "Sulla locanda vale il mio."]);
  });
});

describe("making an anchor", () => {
  it("takes the nearest line as quote and the lines around as context", () => {
    const a = makeAnchor(page(1, SCENE), { x: 0.3, y: yOf(9) + 0.004 });
    expect(a.page).toBe(1);
    expect(a.quote).toBe("Per qual ragione?");
    expect(a.before.endsWith("convengono più che a voi. CONTE")).toBe(true);
    expect(a.after.startsWith("MARCHESE Io sono il Marchese")).toBe(true);
    expect(a.x).toBeCloseTo(0.3);
  });

  it("works on a page without text (page and height only)", () => {
    const a = makeAnchor(page(3, []), { y: 0.42 });
    expect(a).toEqual({ page: 3, y: 0.42, quote: "", before: "", after: "" });
  });

  it("takes context from the next page near the bottom", () => {
    const a = makeAnchor(page(1, ["CONTE", "Per qual ragione?"]), { y: 0.9 }, { next: page(2, ["MARCHESE", "Io sono il Marchese di Forlipopoli."]) });
    expect(a.quote).toBe("Per qual ragione?");
    expect(a.after).toBe("MARCHESE Io sono il Marchese di Forlipopoli.");
  });
});

describe("normalised text", () => {
  it("ignores case, accents, typographic quotes and punctuation", () => {
    expect(normalizeText("Ed io sono il Conte d’Albafiorita!")).toBe(normalizeText("ed io sono il conte d'albafiorita"));
    expect(normalizeText("più — PERCHÉ…")).toBe("piu perche");
    expect(wordSimilarity(["a", "b", "c"], ["a", "x", "c"])).toBeCloseTo(2 / 3);
  });
});

describe("relocating anchors in a new script", () => {
  const old = [page(1, SCENE)];
  const anchorAt = (i: number) => makeAnchor(old[0], { y: yOf(i) });

  it("finds text that moved down on the same page", () => {
    const moved = [page(1, ["ATTO PRIMO", "SCENA PRIMA", "Sala di locanda.", "Il Marchese di Forlipopoli ed il Conte d'Albafiorita.", ...SCENE.slice(2)])];
    const r = relocate(anchorAt(9), buildIndex(moved));
    expect(r.status).toBe("sure");
    expect(r.anchor.page).toBe(1);
    expect(r.anchor.y).toBeCloseTo(yOf(11), 3);
  });

  it("finds text that changed page", () => {
    const filler = Array.from({ length: 20 }, (_, i) => `Una battuta aggiunta numero ${i + 1} per spostare il resto.`);
    const pages = [page(1, ["ATTO PRIMO", ...filler]), page(2, SCENE.slice(1))];
    const r = relocate(anchorAt(11), buildIndex(pages));
    expect(r.status).toBe("sure");
    expect(r.anchor.page).toBe(2);
    expect(r.anchor.y).toBeCloseTo(yOf(10), 3);
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it("tells apart the same character name by its context", () => {
    // "CONTE" appears four times: the one before "Per qual ragione?" is chosen.
    const a = anchorAt(8);
    expect(a.quote).toBe("CONTE");
    const r = relocate(a, buildIndex([page(1, SCENE, 0.2)]));
    expect(r.status).toBe("sure");
    expect(r.anchor.y).toBeCloseTo(yOf(8, 0.2), 3);
  });

  it("is still sure after a small change of the line", () => {
    const edited = SCENE.map((l) => (l === "Io sono il Marchese di Forlipopoli." ? "Io sono il signor Marchese di Forlipopoli." : l));
    const r = relocate(anchorAt(11), buildIndex([page(1, edited)]));
    expect(r.status).toBe("sure");
    expect(r.anchor.y).toBeCloseTo(yOf(11), 3);
  });

  it("is unsure when quote and context are rewritten", () => {
    const rewritten = SCENE.map((l, i) =>
      i === 7 ? "Ma se la padrona mi tratta meglio, è giusto così." : i === 9 ? "E per quale ragione, di grazia?" : i === 11 ? "Perché io sono il Marchese." : l,
    );
    const r = relocate(anchorAt(9), buildIndex([page(1, rewritten)]));
    expect(r.status).not.toBe("sure");
  });

  it("is unsure when the same passage appears twice", () => {
    const twice = [page(1, SCENE), page(2, SCENE)];
    const r = relocate(anchorAt(9), buildIndex(twice));
    expect(r.status).toBe("unsure");
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.candidates.map((c) => c.anchor.page).sort()).toEqual([1, 2]);
    // Equal matches: the page it was on comes first.
    expect(r.candidates[0].anchor.page).toBe(1);
  });

  it("says missing when the text is gone, and keeps page and height", () => {
    const other = [page(1, ["ATTO SECONDO", "SCENA PRIMA", "CAVALIERE", "Amici, che cos'è questo romore?"])];
    const a = makeAnchor(page(4, SCENE), { y: yOf(11) });
    const r = relocate(a, buildIndex(other));
    expect(r.status).toBe("missing");
    expect(r.candidates).toEqual([]);
    expect(r.anchor.page).toBe(1);
    expect(r.anchor.y).toBe(a.y);
  });

  it("says missing for an anchor without text", () => {
    const r = relocate({ page: 2, y: 0.5, quote: "", before: "", after: "" }, buildIndex(old));
    expect(r.status).toBe("missing");
    expect(r.anchor.page).toBe(1);
  });

  it("joins words broken at the end of a line", () => {
    const broken = [page(1, ["CONTE", "Io ho compra-", "ta la contea, quando voi avete venduto il marchesato."])];
    const a = makeAnchor(page(1, ["CONTE", "Io ho comprata la contea, quando voi avete venduto il marchesato."]), { y: yOf(1) });
    const r = relocate(a, buildIndex(broken));
    expect(r.status).toBe("sure");
    expect(r.anchor.y).toBeCloseTo(yOf(1), 3);
  });
});
