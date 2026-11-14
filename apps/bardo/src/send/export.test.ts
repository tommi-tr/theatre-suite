import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { sampleDoc } from "../model/sample";
import { getData } from "../model/defaults";
import { buildExport } from "./exportModel";
import { exportDocx } from "./exportDocx";
import { exportOdt } from "./exportOdt";
import { exportText } from "./exportText";
import { importFile, importLines, linesFromText } from "../lib/importer";

describe("export", () => {
  const doc = sampleDoc("it");
  const data = getData(doc);
  let firstSpeaker = "";
  doc.forEach((n) => {
    if (!firstSpeaker && n.type.name === "speech") firstSpeaker = n.attrs.speaker;
  });
  const hamlet = data.characters.find((c) => c.id === firstSpeaker)!;

  it("describes the script with speeches, headings and the title page", () => {
    const x = buildExport(doc, {});
    expect(x.blocks.some((b) => b.kind === "para" && b.style === "title")).toBe(true);
    expect(x.blocks.some((b) => b.kind === "para" && b.style === "act")).toBe(true);
    const speeches = x.blocks.filter((b) => b.kind === "speech");
    expect(speeches.length).toBeGreaterThan(10);
    expect(speeches.every((b) => b.kind === "speech" && !b.highlight)).toBe(true);
  });

  it("highlights the speeches of one actor", () => {
    const x = buildExport(doc, { actor: hamlet.id });
    const hi = x.blocks.filter((b) => b.kind === "speech" && b.highlight);
    expect(hi.length).toBeGreaterThan(0);
    expect(hi.every((b) => b.kind === "speech" && b.speaker === hamlet.id)).toBe(true);
  });

  it("writes a Word file with named styles and only the current text", async () => {
    const bytes = await exportDocx(buildExport(doc, {}));
    const files = unzipSync(bytes);
    const xml = strFromU8(files["word/document.xml"]);
    const styles = strFromU8(files["word/styles.xml"]);
    expect(xml).toContain("Amleto");
    expect(styles).toContain("Bardo · Battuta");
  });

  it("writes an OpenDocument file LibreOffice can open", () => {
    const bytes = exportOdt(buildExport(doc, {}));
    const files = unzipSync(bytes);
    expect(strFromU8(files["mimetype"])).toBe("application/vnd.oasis.opendocument.text");
    const content = strFromU8(files["content.xml"]);
    expect(content).toContain("Amleto");
    expect(new DOMParser().parseFromString(content, "application/xml").getElementsByTagName("parsererror").length).toBe(0);
    expect(new DOMParser().parseFromString(strFromU8(files["styles.xml"]), "application/xml").getElementsByTagName("parsererror").length).toBe(0);
  });

  it("writes plain text that can be imported again", () => {
    const text = new TextDecoder().decode(exportText(buildExport(doc, {})));
    expect(text).toContain("AMLETO");
    const back = importLines(linesFromText(text));
    expect(back.report.speeches).toBeGreaterThan(10);
    expect(back.report.characters).toBeGreaterThanOrEqual(data.characters.filter((c) => text.includes(c.name.toLocaleUpperCase())).length - 1);
  });

  it("imports a Word file written by Bardo", async () => {
    const bytes = await exportDocx(buildExport(doc, {}));
    const r = importFile("Amleto.docx", bytes);
    expect(r.report.speeches).toBeGreaterThan(10);
    expect(r.report.acts).toBeGreaterThanOrEqual(1);
    expect(r.report.scenes).toBeGreaterThanOrEqual(1);
  });
});

describe("import", () => {
  it("recognises the usual ways of writing a script", () => {
    const src = [
      "LA TEMPESTA",
      "di William Shakespeare",
      "",
      "PERSONAGGI",
      "PROSPERO, duca di Milano",
      "MIRANDA, sua figlia",
      "",
      "ATTO PRIMO",
      "Scena prima. Una nave in mare",
      "(Tuoni e lampi.)",
      "PROSPERO: Basta stupirsi.",
      "MIRANDA (piangendo): Oh, ho sofferto",
      "con quelli che vedevo soffrire!",
      "",
      "PROSPERO",
      "Non c'è alcun danno.",
      "Nota: questa riga è un commento.",
    ].join("\n");
    const { doc, report } = importLines(linesFromText(src));
    const data = getData(doc);
    expect(data.meta.title).toBe("LA TEMPESTA");
    expect(data.meta.authors).toBe("William Shakespeare");
    expect(data.characters.map((c) => c.name)).toEqual(["Prospero", "Miranda"]);
    expect(data.characters[0].short).toBe("duca di Milano");
    expect(report.acts).toBe(1);
    expect(report.scenes).toBe(1);
    expect(report.speeches).toBe(3);
    expect(report.directions).toBe(1);
    let place = "";
    doc.forEach((n) => {
      if (n.type.name === "scene") place = n.attrs.place;
    });
    expect(place).toBe("Una nave in mare");
  });
});
