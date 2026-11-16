import type { Mark, Node as PMNode } from "prosemirror-model";
import { DEFAULT_CAST_CONFIG, DEFAULT_CHARACTERS_CONFIG, DEFAULT_TITLE_CONFIG, defaultListConfig, emptyData, newId } from "./defaults";
import { schema } from "./schema";
import { CHARACTER_CAT, type CatItem, type Character, type DocData, type DocLang } from "./types";

/*
 * The example script: the opening of "Hamlet" (public domain).
 * Italian lines are Bardo's own translation.
 * Little markup used below:
 *   {p:Orazio}  character    {o:lanterna} prop       {c:mantello} costume
 *   {l:luce lunare} light    {s:campana}  sound      (…) inside a speech: inline direction
 *   \n line break (verse)
 */

type Line = ["S", string, string] | ["D", string];

interface SampleText {
  meta: DocData["meta"];
  chars: [string, string, string][];
  items: [string, string, string][];
  scene1: { title: string; place: string; desc: string };
  scene2: { title: string; place: string; desc: string };
  lines1: Line[];
  lines2: Line[];
  note: { anchor: string; text: string; author: string };
  roles: [string, string][];
}

const IT: SampleText = {
  meta: { title: "Amleto", subtitle: "Principe di Danimarca", basedOn: "", authors: "William Shakespeare", translation: "Traduzione d’esempio di Bardo" },
  chars: [
    ["claudio", "Claudio", "re di Danimarca"],
    ["amleto", "Amleto", "figlio del re defunto e nipote di Claudio"],
    ["gertrude", "Gertrude", "regina di Danimarca, madre di Amleto"],
    ["spettro", "Lo Spettro", "del re defunto"],
    ["polonio", "Polonio", "gran ciambellano"],
    ["laerte", "Laerte", "figlio di Polonio"],
    ["ofelia", "Ofelia", "figlia di Polonio"],
    ["orazio", "Orazio", "amico di Amleto"],
    ["marcello", "Marcello", "ufficiale"],
    ["bernardo", "Bernardo", "ufficiale"],
    ["francesco", "Francesco", "soldato"],
  ],
  items: [
    ["oggetto", "lanterna", "Accesa, appesa alle mura."],
    ["costume", "mantello", ""],
    ["luce", "luce lunare", "Fredda, dall’alto."],
    ["suono", "campana", "Rintocchi della mezzanotte."],
    ["suono", "trombe", ""],
  ],
  scene1: { title: "Spalti del castello", place: "Elsinore. Gli spalti davanti al castello.", desc: "Le sentinelle aspettano lo Spettro; Orazio lo vede per la prima volta." },
  scene2: { title: "Sala del trono", place: "Una sala di rappresentanza nel castello.", desc: "Claudio parla alla corte." },
  lines1: [
    ["D", "Notte fonda. Una {o:lanterna} sulle mura, {l:luce lunare} fredda. {p:Francesco} è di guardia. Entra {p:Bernardo}."],
    ["S", "bernardo", "Chi va là?"],
    ["S", "francesco", "No, rispondi tu: fermati e fatti riconoscere."],
    ["S", "bernardo", "Lunga vita al re!"],
    ["S", "francesco", "Bernardo?"],
    ["S", "bernardo", "Proprio io."],
    ["S", "francesco", "Arrivi puntuale al tuo turno."],
    ["S", "bernardo", "È appena suonata la mezzanotte. Va’ a dormire, Francesco."],
    ["D", "Lontano, i rintocchi di una {s:campana}."],
    ["S", "francesco", "Grazie del cambio. Fa un freddo che taglia (si stringe nel {c:mantello})\ne ho il cuore stanco."],
    ["S", "bernardo", "Turno tranquillo?"],
    ["S", "francesco", "Non si è mosso nemmeno un topo."],
    ["S", "bernardo", "Allora buona notte. Se incontri Orazio e Marcello,\ni compagni del mio turno, di’ loro di sbrigarsi."],
    ["D", "Entrano {p:Orazio} e {p:Marcello}."],
    ["S", "francesco", "Mi pare di sentirli. Alt! Chi va là?"],
    ["S", "orazio", "Amici di questa terra."],
    ["S", "marcello", "E fedeli al re di Danimarca."],
    ["S", "francesco", "Buona notte a voi."],
    ["S", "marcello", "Addio, onesto soldato. Chi ti ha dato il cambio?"],
    ["S", "francesco", "Bernardo ha preso il mio posto. Buona notte."],
    ["D", "Esce {p:Francesco}."],
    ["S", "marcello", "Ehi! Bernardo!"],
    ["S", "bernardo", "Dimmi, c’è anche Orazio?"],
    ["S", "orazio", "Un pezzo di lui."],
    ["S", "bernardo", "Benvenuto, Orazio. Benvenuto, buon Marcello."],
    ["S", "marcello", "Allora, è riapparsa quella cosa, stanotte?"],
    ["S", "bernardo", "Io non ho visto nulla."],
    ["S", "marcello", "Orazio dice che è solo una nostra fantasia\ne non vuole credere alla terribile visione\nche abbiamo visto due volte."],
    ["S", "orazio", "Via, via, non apparirà."],
    ["D", "Entra {p:Lo Spettro}."],
    ["S", "marcello", "Zitto, interrompiti: guarda, eccolo di nuovo!"],
    ["S", "bernardo", "Ha lo stesso aspetto del re che è morto."],
    ["S", "marcello", "Tu che hai studiato: parlagli, Orazio."],
    ["S", "orazio", "Chi sei tu, che ti prendi quest’ora della notte?\nIn nome del cielo, te lo ordino: parla!"],
    ["S", "marcello", "È offeso."],
    ["S", "bernardo", "Guarda, se ne va!"],
    ["D", "Esce {p:Lo Spettro}."],
  ],
  lines2: [
    ["D", "Squilli di {s:trombe}. Entrano {p:Claudio}, {p:Gertrude}, {p:Amleto}, {p:Polonio}, {p:Laerte} e la corte."],
    ["S", "claudio", "Benché il ricordo della morte di Amleto, nostro caro fratello,\nsia ancora vivo, e convenga ai nostri cuori il lutto\ne a tutto il regno un unico volto di dolore…"],
  ],
  note: { anchor: "mezzanotte", text: "Rintocchi prima o dopo la battuta?", author: "Regia" },
  roles: [
    ["Autore", "William Shakespeare"],
    ["Regia", ""],
    ["Luci", ""],
    ["Audio", ""],
  ],
};

const EN: SampleText = {
  meta: { title: "Hamlet", subtitle: "Prince of Denmark", basedOn: "", authors: "William Shakespeare", translation: "" },
  chars: [
    ["claudio", "Claudius", "King of Denmark"],
    ["amleto", "Hamlet", "son to the late King, and nephew to the present King"],
    ["gertrude", "Gertrude", "Queen of Denmark, mother to Hamlet"],
    ["spettro", "Ghost", "of Hamlet's father"],
    ["polonio", "Polonius", "Lord Chamberlain"],
    ["laerte", "Laertes", "son to Polonius"],
    ["ofelia", "Ophelia", "daughter to Polonius"],
    ["orazio", "Horatio", "friend to Hamlet"],
    ["marcello", "Marcellus", "an officer"],
    ["bernardo", "Bernardo", "an officer"],
    ["francesco", "Francisco", "a soldier"],
  ],
  items: [
    ["oggetto", "lantern", "Lit, hanging on the wall."],
    ["costume", "cloak", ""],
    ["luce", "moonlight", "Cold, from above."],
    ["suono", "bell", "Midnight strikes."],
    ["suono", "trumpets", ""],
  ],
  scene1: { title: "The platform", place: "Elsinore. A platform before the castle.", desc: "The guards wait for the Ghost; Horatio sees it for the first time." },
  scene2: { title: "The throne room", place: "A room of state in the castle.", desc: "Claudius speaks to the court." },
  lines1: [
    ["D", "Midnight. A {o:lantern} on the wall, cold {l:moonlight}. {p:Francisco} at his post. Enter {p:Bernardo}."],
    ["S", "bernardo", "Who's there?"],
    ["S", "francesco", "Nay, answer me: stand, and unfold yourself."],
    ["S", "bernardo", "Long live the king!"],
    ["S", "francesco", "Bernardo?"],
    ["S", "bernardo", "He."],
    ["S", "francesco", "You come most carefully upon your hour."],
    ["S", "bernardo", "'Tis now struck twelve; get thee to bed, Francisco."],
    ["D", "Far off, a {s:bell} strikes."],
    ["S", "francesco", "For this relief much thanks: 'tis bitter cold, (he pulls his {c:cloak} tight)\nAnd I am sick at heart."],
    ["S", "bernardo", "Have you had quiet guard?"],
    ["S", "francesco", "Not a mouse stirring."],
    ["S", "bernardo", "Well, good night.\nIf you do meet Horatio and Marcellus,\nThe rivals of my watch, bid them make haste."],
    ["D", "Enter {p:Horatio} and {p:Marcellus}."],
    ["S", "francesco", "I think I hear them. Stand, ho! Who's there?"],
    ["S", "orazio", "Friends to this ground."],
    ["S", "marcello", "And liegemen to the Dane."],
    ["S", "francesco", "Give you good night."],
    ["S", "marcello", "O, farewell, honest soldier:\nWho hath relieved you?"],
    ["S", "francesco", "Bernardo has my place.\nGive you good night."],
    ["D", "Exit {p:Francisco}."],
    ["S", "marcello", "Holla! Bernardo!"],
    ["S", "bernardo", "Say,\nWhat, is Horatio there?"],
    ["S", "orazio", "A piece of him."],
    ["S", "bernardo", "Welcome, Horatio: welcome, good Marcellus."],
    ["S", "marcello", "What, has this thing appear'd again to-night?"],
    ["S", "bernardo", "I have seen nothing."],
    ["S", "marcello", "Horatio says 'tis but our fantasy,\nAnd will not let belief take hold of him\nTouching this dreaded sight, twice seen of us."],
    ["S", "orazio", "Tush, tush, 'twill not appear."],
    ["D", "Enter {p:Ghost}."],
    ["S", "marcello", "Peace, break thee off; look, where it comes again!"],
    ["S", "bernardo", "In the same figure, like the king that's dead."],
    ["S", "marcello", "Thou art a scholar; speak to it, Horatio."],
    ["S", "orazio", "What art thou that usurp'st this time of night?\nBy heaven I charge thee, speak!"],
    ["S", "marcello", "It is offended."],
    ["S", "bernardo", "See, it stalks away!"],
    ["D", "Exit {p:Ghost}."],
  ],
  lines2: [
    ["D", "Flourish of {s:trumpets}. Enter {p:Claudius}, {p:Gertrude}, {p:Hamlet}, {p:Polonius}, {p:Laertes} and the court."],
    ["S", "claudio", "Though yet of Hamlet our dear brother's death\nThe memory be green, and that it us befitted\nTo bear our hearts in grief and our whole kingdom\nTo be contracted in one brow of woe…"],
  ],
  note: { anchor: "twelve", text: "Bell before or after the line?", author: "Director" },
  roles: [
    ["Author", "William Shakespeare"],
    ["Director", ""],
    ["Lighting", ""],
    ["Sound", ""],
  ],
};

const CAT_CODES: Record<string, string> = { p: CHARACTER_CAT, o: "oggetto", c: "costume", l: "luce", s: "suono" };

/** The example script ("Hamlet", act I) in the chosen language. */
export function sampleDoc(lang: DocLang): PMNode {
  const T = lang === "it" ? IT : EN;
  const n = schema.nodes;
  const m = schema.marks;
  const data = emptyData(lang);
  data.meta = { ...T.meta };
  data.version = "1.0";
  const charIds = new Map<string, string>();
  data.characters = T.chars.map(([key, name, short]): Character => {
    const id = `ch-${key}`;
    charIds.set(key, id);
    return { id, name, short, long: "", actor: "" };
  });
  const byName = new Map(data.characters.map((c) => [c.name.toLowerCase(), c.id]));
  data.items = T.items.map(([cat, name, description]): CatItem => ({ id: `it-${cat}-${name.replace(/\s+/g, "-")}`, cat, name, description }));
  const itemByName = new Map(data.items.map((i) => [`${i.cat}:${i.name}`, i.id]));
  data.cast = T.roles.map(([role, people]) => ({ id: newId("role"), role, people }));
  const noteId = newId("note");
  data.notes = [{ id: noteId, text: T.note.text, author: T.note.author, created: new Date().toISOString() }];

  /** Turns the little markup into text nodes with marks. */
  const inline = (src: string, allowInline: boolean): PMNode[] => {
    const out: PMNode[] = [];
    const push = (text: string, marks: Mark[]) => {
      const parts = text.split("\n");
      parts.forEach((p, i) => {
        if (i > 0) out.push(n.hard_break.create());
        if (!p) return;
        // The note anchor gets its mark.
        const at = p.indexOf(T.note.anchor);
        if (at >= 0) {
          if (at > 0) out.push(schema.text(p.slice(0, at), marks));
          out.push(schema.text(T.note.anchor, [...marks, m.note.create({ id: noteId })]));
          const rest = p.slice(at + T.note.anchor.length);
          if (rest) out.push(schema.text(rest, marks));
        } else out.push(schema.text(p, marks));
      });
    };
    const re = /\{(\w):([^}]+)\}|\(([^)]*)\)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    const base = (inParen: boolean): Mark[] => (inParen && allowInline ? [m.inline_dir.create()] : []);
    while ((match = re.exec(src))) {
      if (match.index > last) push(src.slice(last, match.index), []);
      if (match[1]) {
        const cat = CAT_CODES[match[1]];
        const name = match[2];
        const item = cat === CHARACTER_CAT ? byName.get(name.toLowerCase()) ?? "" : itemByName.get(`${cat}:${name}`) ?? "";
        push(name, [m.cat.create({ cat, item })]);
      } else {
        // Inline direction: keep the parentheses, mark the whole thing.
        const innerParts = inline(match[3], false);
        const mark = base(true);
        out.push(schema.text("(", mark));
        for (const p of innerParts) out.push(p.isText ? p.mark([...p.marks, ...mark]) : p);
        out.push(schema.text(")", mark));
      }
      last = re.lastIndex;
    }
    if (last < src.length) push(src.slice(last), []);
    return out;
  };

  const lines = (list: Line[]): PMNode[] =>
    list.map((l) => {
      if (l[0] === "D") return n.direction.create({ id: newId("dir") }, inline(l[1], false));
      const id = charIds.get(l[1]) ?? "";
      const name = data.characters.find((c) => c.id === id)?.name ?? "";
      return n.speech.create({ id: newId("sp"), speaker: id, name }, inline(l[2], true));
    });

  return n.doc.create({ data }, [
    n.auto.create({ id: newId("auto"), kind: "title", config: DEFAULT_TITLE_CONFIG }),
    n.auto.create({ id: newId("auto"), kind: "characters", config: DEFAULT_CHARACTERS_CONFIG(lang) }),
    n.auto.create({ id: newId("auto"), kind: "cast", config: DEFAULT_CAST_CONFIG(lang) }),
    n.act.create({ id: newId("act") }),
    n.scene.create({ id: newId("scene"), ...T.scene1, silent: [] }),
    ...lines(T.lines1),
    n.scene.create({ id: newId("scene"), ...T.scene2, silent: [] }),
    ...lines(T.lines2),
    n.page_break.create(),
    n.auto.create({ id: newId("auto"), kind: "list", config: defaultListConfig(lang, "index") }),
    n.auto.create({ id: newId("auto"), kind: "list", config: defaultListConfig(lang, "presence") }),
  ]);
}
