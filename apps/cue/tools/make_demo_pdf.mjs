// Generates the demo script of the browser preview (`/?demo`): a few A4 pages of Carlo Goldoni,
// "La locandiera" (1753, public domain), Act I, scenes I–V, in Italian. Serif text, act and scene headings,
// character names in capitals on their own line (as the design images), stage directions in italics,
// a page number at the bottom. It also carries two existing PDF annotations (a highlight with a comment and
// a sticky note) so the preview shows that they are visible read-only.
//
// Run with:  pnpm --filter cue demo-pdf                  → public/demo/locandiera.pdf
//            node tools/make_demo_pdf.mjs --edition 2 out.pdf  → a revised edition (lines added, changed,
//            removed, text moved to other pages) to try "Sostituisci copione".
// It prints where some lines are (page, height), used by the demo notes in src/model/demo.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from "pdf-lib";

const args = process.argv.slice(2);
const edition = args.includes("--edition") ? Number(args[args.indexOf("--edition") + 1]) : 1;
const outArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--edition");
const OUT = outArg ?? join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demo", "locandiera.pdf");

// [kind, text]: H = act heading, S = scene heading, D = stage direction (italic), C = character, L = line.
const SCRIPT = [
  ["H", "ATTO PRIMO"],
  ["S", "SCENA PRIMA"],
  ["D", "Sala di locanda. Il Marchese di Forlipopoli ed il Conte d'Albafiorita."],
  ["C", "MARCHESE"],
  ["L", "Fra voi e me vi è qualche differenza."],
  ["C", "CONTE"],
  ["L", "Sulla locanda tanto vale il vostro denaro, quanto vale il mio."],
  ["C", "MARCHESE"],
  ["L", "Ma se la locandiera usa a me delle distinzioni, mi si convengono più che a voi."],
  ["C", "CONTE"],
  ["L", "Per qual ragione?"],
  ["C", "MARCHESE"],
  ["L", "Io sono il Marchese di Forlipopoli."],
  ["C", "CONTE"],
  ["L", "Ed io sono il Conte d'Albafiorita."],
  ["C", "MARCHESE"],
  ["L", "Sì, Conte! Contea comprata."],
  ["C", "CONTE"],
  ["L", "Io ho comprata la contea, quando voi avete venduto il marchesato."],
  ["C", "MARCHESE"],
  ["L", "Oh basta: son chi sono, e mi si deve portar rispetto."],
  ["C", "CONTE"],
  ["L", "Chi ve lo perde il rispetto? Voi siete quello, che con troppa libertà parlando..."],
  ["C", "MARCHESE"],
  ["L", "Io sono in questa locanda, perché amo la locandiera. Tutti lo sanno, e tutti devono rispettare una giovane che piace a me."],
  ["C", "CONTE"],
  ["L", "Oh, questa è bella! Voi mi vorreste impedire ch'io amassi Mirandolina? Perché credete ch'io sia in Firenze? Perché credete ch'io sia in questa locanda?"],
  ["C", "MARCHESE"],
  ["L", "Oh bene. Voi non farete niente."],
  ["C", "CONTE"],
  ["L", "Io no, e voi sì?"],
  ["C", "MARCHESE"],
  ["L", "Io sì, e voi no. Io son chi sono. Mirandolina ha bisogno della mia protezione."],
  ["C", "CONTE"],
  ["L", "Mirandolina ha bisogno di denari, e non di protezione."],
  ["C", "MARCHESE"],
  ["L", "Denari?... non ne mancano."],
  ["C", "CONTE"],
  ["L", "Io spendo uno zecchino il giorno, signor Marchese, e la regalo continuamente."],
  ["C", "MARCHESE"],
  ["L", "Ed io quel che fo non lo dico."],
  ["C", "CONTE"],
  ["L", "Voi non lo dite, ma già si sa."],
  ["C", "MARCHESE"],
  ["L", "Non si sa tutto."],
  ["C", "CONTE"],
  ["L", "Sì! caro signor Marchese, si sa. I camerieri lo dicono. Tre paoletti il giorno."],
  ["C", "MARCHESE"],
  ["L", "A proposito di camerieri; vi è quel cameriere che ha nome Fabrizio, mi piace poco. Parmi che la locandiera lo guardi assai di buon occhio."],
  ["C", "CONTE"],
  ["L", "Può essere che lo voglia sposare. Non sarebbe cosa mal fatta. Sono sei mesi che è morto il di lei padre. Sola una giovane alla testa di una locanda si troverà imbrogliata. Per me, se si marita, le ho promesso trecento scudi."],
  ["C", "MARCHESE"],
  ["L", "Se si mariterà, io sono il suo protettore, e farò io... E so io quello che farò."],
  ["C", "CONTE"],
  ["L", "Venite qui: facciamola da buoni amici. Diamole trecento scudi per uno."],
  ["C", "MARCHESE"],
  ["L", "Quel ch'io faccio, lo faccio segretamente, e non me ne vanto. Son chi sono. Chi è di là?"],
  ["D", "(chiama)"],
  ["C", "CONTE"],
  ["L", "(Spiantato! Povero e superbo!)"],
  ["D", "(da sé)"],
  ["S", "SCENA SECONDA"],
  ["D", "Fabrizio e detti."],
  ["C", "FABRIZIO"],
  ["L", "Mi comandi, signore."],
  ["D", "(al Marchese)"],
  ["C", "MARCHESE"],
  ["L", "Signore? Chi ti ha insegnato la creanza?"],
  ["C", "FABRIZIO"],
  ["L", "La perdoni."],
  ["C", "CONTE"],
  ["L", "Ditemi: come sta la padroncina?"],
  ["D", "(a Fabrizio)"],
  ["C", "FABRIZIO"],
  ["L", "Sta bene, illustrissimo."],
  ["C", "MARCHESE"],
  ["L", "È alzata dal letto?"],
  ["C", "FABRIZIO"],
  ["L", "Illustrissimo sì."],
  ["C", "MARCHESE"],
  ["L", "Asino."],
  ["C", "FABRIZIO"],
  ["L", "Perché, illustrissimo signore?"],
  ["C", "MARCHESE"],
  ["L", "Che cos'è questo illustrissimo?"],
  ["C", "FABRIZIO"],
  ["L", "È il titolo che ho dato anche a quell'altro Cavaliere."],
  ["C", "MARCHESE"],
  ["L", "Tra lui e me vi è qualche differenza."],
  ["C", "CONTE"],
  ["L", "Sentite?"],
  ["D", "(a Fabrizio)"],
  ["C", "FABRIZIO"],
  ["L", "(Dice la verità. Ci è differenza: me ne accorgo nei conti.)"],
  ["D", "(piano al Conte)"],
  ["C", "MARCHESE"],
  ["L", "Di' alla padrona che venga da me, che le ho da parlare."],
  ["C", "FABRIZIO"],
  ["L", "Eccellenza sì. Ho fallato questa volta?"],
  ["C", "MARCHESE"],
  ["L", "Va bene. Sono tre mesi che lo sai; ma sei un impertinente."],
  ["C", "FABRIZIO"],
  ["L", "Come comanda, Eccellenza."],
  ["C", "CONTE"],
  ["L", "Vuoi vedere la differenza che passa fra il Marchese e me?"],
  ["C", "MARCHESE"],
  ["L", "Che vorreste dire?"],
  ["C", "CONTE"],
  ["L", "Tieni. Ti dono uno zecchino. Fa che anch'egli te ne doni un altro."],
  ["C", "FABRIZIO"],
  ["L", "Grazie, illustrissimo. Eccellenza..."],
  ["C", "MARCHESE"],
  ["L", "Non getto il mio, come i pazzi. Vattene."],
  ["C", "FABRIZIO"],
  ["L", "Illustrissimo signore, il cielo la benedica. Eccellenza. (Rifinito. Fuor del suo paese non vogliono esser titoli per farsi stimare, vogliono esser quattrini.)"],
  ["D", "(parte)"],
  ["S", "SCENA TERZA"],
  ["D", "Il Marchese ed il Conte."],
  ["C", "MARCHESE"],
  ["L", "Voi credete di soverchiarmi con i regali, ma non farete niente. Il mio grado val più di tutte le vostre monete."],
  ["C", "CONTE"],
  ["L", "Io non apprezzo quel che vale, ma quello che si può spendere."],
  ["C", "MARCHESE"],
  ["L", "Spendete pure a rotta di collo. Mirandolina non fa stima di voi."],
  ["C", "CONTE"],
  ["L", "Con tutta la vostra gran nobiltà, credete voi di essere da lei stimato? Vogliono esser denari."],
  ["C", "MARCHESE"],
  ["L", "Che denari? Vuol esser protezione. Esser buono in un incontro di far un piacere."],
  ["C", "CONTE"],
  ["L", "Sì, esser buono in un incontro di prestar cento doppie."],
  ["C", "MARCHESE"],
  ["L", "Farsi portar rispetto bisogna."],
  ["C", "CONTE"],
  ["L", "Quando non mancano denari, tutti rispettano."],
  ["C", "MARCHESE"],
  ["L", "Voi non sapete quel che vi dite."],
  ["C", "CONTE"],
  ["L", "L'intendo meglio di voi."],
  ["S", "SCENA QUARTA"],
  ["D", "Il Cavaliere di Ripafratta dalla sua camera, e detti."],
  ["C", "CAVALIERE"],
  ["L", "Amici, che cos'è questo romore? Vi è qualche dissensione fra di voi altri?"],
  ["C", "CONTE"],
  ["L", "Si disputava sopra un bellissimo punto."],
  ["C", "MARCHESE"],
  ["L", "Il Conte disputa meco sul merito della nobiltà."],
  ["D", "(ironico)"],
  ["C", "CONTE"],
  ["L", "Io non levo il merito alla nobiltà: ma sostengo, che per cavarsi dei capricci, vogliono esser denari."],
  ["C", "CAVALIERE"],
  ["L", "Veramente, Marchese mio..."],
  ["C", "MARCHESE"],
  ["L", "Orsù, parliamo d'altro."],
  ["C", "CAVALIERE"],
  ["L", "Perché siete venuti a simil contesa?"],
  ["C", "CONTE"],
  ["L", "Per un motivo il più ridicolo della terra."],
  ["C", "MARCHESE"],
  ["L", "Sì, bravo! il Conte mette tutto in ridicolo."],
  ["C", "CONTE"],
  ["L", "Il signor Marchese ama la nostra locandiera. Io l'amo ancor più di lui. Egli pretende corrispondenza, come un tributo alla sua nobiltà. Io la spero, come una ricompensa alle mie attenzioni. Pare a voi che la questione non sia ridicola?"],
  ["C", "MARCHESE"],
  ["L", "Bisogna sapere con quanto impegno io la proteggo."],
  ["C", "CONTE"],
  ["L", "Egli la protegge, ed io spendo."],
  ["D", "(al Cavaliere)"],
  ["C", "CAVALIERE"],
  ["L", "In verità non si può contendere per ragione alcuna che lo meriti meno. Una donna vi altera? vi scompone? Una donna? che cosa mai mi convien sentire? Una donna? Io certamente non vi è pericolo che per le donne abbia che dir con nessuno. Non le ho mai amate, non le ho mai stimate, e ho sempre creduto che sia la donna per l'uomo una infermità insopportabile."],
  ["C", "MARCHESE"],
  ["L", "In quanto a questo poi, Mirandolina ha un merito estraordinario."],
  ["C", "CONTE"],
  ["L", "Sin qua il signor Marchese ha ragione. La nostra padroncina della locanda è veramente amabile."],
  ["C", "CAVALIERE"],
  ["L", "Quando l'amo, è molto più di una donna. Che cosa ha ella di straordinario, che non abbiano l'altre donne?"],
  ["C", "MARCHESE"],
  ["L", "Ha un tratto nobile, che incanta."],
  ["C", "CONTE"],
  ["L", "È bella, parla bene, veste con pulizia, è di un ottimo gusto."],
  ["C", "CAVALIERE"],
  ["L", "Tutte cose che non vagliono un fico. Sono tre giorni ch'io sono in questa locanda, e non mi ha fatto specie veruna."],
  ["S", "SCENA QUINTA"],
  ["D", "Mirandolina e detti."],
  ["C", "MIRANDOLINA"],
  ["L", "M'inchino a questi cavalieri. Chi mi domanda di lor signori?"],
  ["C", "MARCHESE"],
  ["L", "Io vi domando, ma non qui."],
  ["C", "MIRANDOLINA"],
  ["L", "Dove mi vuole, Eccellenza?"],
  ["C", "MARCHESE"],
  ["L", "Nella mia camera."],
  ["C", "MIRANDOLINA"],
  ["L", "Nella sua camera? Se ha bisogno di qualche cosa verrà il cameriere a servirla."],
  ["C", "MARCHESE"],
  ["L", "(Che dite di quel contegno?)"],
  ["D", "(al Cavaliere)"],
  ["C", "CAVALIERE"],
  ["L", "(Quello che voi chiamate contegno, io lo chiamerei temerità, impertinenza.)"],
  ["D", "(al Marchese)"],
];

/** The revised edition: a direction added at the top (all moves down), a line changed, one removed, a long one added. */
function revise(script) {
  const out = [];
  for (const [k, t] of script) {
    if (k === "S" && t === "SCENA PRIMA") {
      out.push([k, t], ["D", "Mattina. Si sentono campane lontane. Il Marchese passeggia nervoso, il Conte legge una lettera seduto al tavolo."]);
      continue;
    }
    if (t === "Io sono il Marchese di Forlipopoli.") {
      out.push([k, "Io sono il signor Marchese di Forlipopoli."]);
      continue;
    }
    if (t === "Asino.") {
      out.pop(); // the MARCHESE before it goes too
      continue;
    }
    out.push([k, t]);
    if (t === "SCENA TERZA")
      out.push(
        ["D", "Il Conte si siede; il Marchese resta in piedi accanto alla porta, con il cappello in mano. Pausa lunga. Si sente ridere Mirandolina dalle cucine, poi silenzio. Il Marchese si volta di scatto verso il Conte."],
        ["D", "Luce che cambia lentamente: dal mattino al mezzogiorno."],
      );
  }
  return out;
}

const PAGE = { w: 595.28, h: 841.89 };
const M = { left: 78, right: 78, top: 80, bottom: 80 };

const doc = await PDFDocument.create();
doc.setTitle("La locandiera — Atto primo (estratto)");
doc.setAuthor("Carlo Goldoni");
doc.setSubject("Copione dimostrativo di Cue (pubblico dominio)");
doc.setCreator("Theatre Suite · Cue demo");
doc.setProducer("pdf-lib");
// Fixed dates: the same script every time it is generated.
doc.setCreationDate(new Date(Date.UTC(2026, 10, 20)));
doc.setModificationDate(new Date(Date.UTC(2026, 10, 20)));
const roman = await doc.embedFont(StandardFonts.TimesRoman);
const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);

function wrap(text, font, size, width) {
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

const pages = [];
let page = null;
let y = 0;
const placed = []; // { page, top, bottom, text, x, w }
function newPage() {
  page = doc.addPage([PAGE.w, PAGE.h]);
  pages.push(page);
  y = PAGE.h - M.top;
}
function need(h) {
  if (!page || y - h < M.bottom) newPage();
}
function draw(text, { font = roman, size = 12, x = M.left, centre = false } = {}) {
  const w = font.widthOfTextAtSize(text, size);
  const dx = centre ? (PAGE.w - w) / 2 : x;
  page.drawText(text, { x: dx, y: y - size, size, font, color: rgb(0.08, 0.08, 0.09) });
  placed.push({ page: pages.length, top: y, bottom: y - size * 1.2, text, x: dx, w, size });
  y -= size * 1.32;
}

newPage();
const body = PAGE.w - M.left - M.right;
const script = edition === 2 ? revise(SCRIPT) : SCRIPT;
for (let i = 0; i < script.length; i++) {
  const [kind, text] = script[i];
  if (kind === "H") {
    if (i > 0) newPage();
    y -= 30;
    draw(text, { font: bold, size: 16, centre: true });
    y -= 14;
  } else if (kind === "S") {
    need(70);
    y -= 14;
    draw(text, { font: bold, size: 13, centre: true });
    y -= 4;
  } else if (kind === "D") {
    const lines = wrap(text, italic, 11.5, body - 40);
    need(lines.length * 15 + 4);
    for (const l of lines) draw(l, { font: italic, size: 11.5, x: M.left + 40 });
    y -= 4;
  } else if (kind === "C") {
    // A character name never stays alone at the bottom of a page.
    need(12 * 1.32 * 3 + 6);
    y -= 3;
    draw(text, { font: bold, size: 11.5 });
  } else {
    const lines = wrap(text, roman, 12, body - 24);
    need(lines.length * 15.9);
    for (const l of lines) draw(l, { x: M.left + 24 });
  }
}
pages.forEach((p, i) => {
  const label = `— ${i + 1} —`;
  p.drawText(label, { x: (PAGE.w - roman.widthOfTextAtSize(label, 10)) / 2, y: 44, size: 10, font: roman, color: rgb(0.4, 0.4, 0.42) });
});

// Existing annotations (made by someone before Cue): a highlight with a comment, a sticky note.
function annotate(p, dict) {
  const ref = doc.context.register(doc.context.obj(dict));
  const pageObj = pages[p - 1];
  pageObj.node.addAnnot(ref);
}
const hl = placed.find((l) => l.text.startsWith("Ma se la locandiera usa a me"));
if (hl) {
  const [x1, x2, y1, y2] = [hl.x - 1, hl.x + hl.w + 1, hl.bottom + 1, hl.top + 1];
  annotate(hl.page, {
    Type: "Annot",
    Subtype: "Highlight",
    Rect: [x1, y1, x2, y2],
    QuadPoints: [x1, y2, x2, y2, x1, y1, x2, y1],
    C: [1, 0.86, 0.25],
    CA: 0.55,
    F: 4,
    T: PDFHexString.fromText("Regia"),
    Contents: PDFHexString.fromText("Qui il Marchese si alza: luce un po' più calda."),
  });
}
const note = placed.find((l) => l.text === "SCENA SECONDA");
if (note) {
  annotate(note.page, {
    Type: "Annot",
    Subtype: "Text",
    Rect: [PAGE.w - M.right + 8, note.bottom, PAGE.w - M.right + 26, note.bottom + 18],
    Name: PDFName.of("Comment"),
    C: [1, 0.86, 0.25],
    F: 4,
    T: PDFHexString.fromText("Regia"),
    Contents: PDFHexString.fromText("Entra Fabrizio da destra, con il vassoio."),
  });
}

mkdirSync(dirname(OUT), { recursive: true });
const bytes = await doc.save({ useObjectStreams: false });
writeFileSync(OUT, bytes);
console.log(`${OUT}: ${pages.length} pages, ${bytes.length} bytes (edition ${edition})`);
// Where some lines are, as fractions of the page (the centre of the line), for the demo notes.
for (const want of ["SCENA SECONDA", "Asino.", "Tieni. Ti dono uno zecchino. Fa che anch'egli te ne doni un altro.", "SCENA QUINTA", "Per qual ragione?"]) {
  const l = placed.find((p) => p.text === want);
  if (l) console.log(JSON.stringify({ quote: want, page: l.page, y: +(1 - (l.top - l.size * 0.5) / PAGE.h).toFixed(4) }));
}
