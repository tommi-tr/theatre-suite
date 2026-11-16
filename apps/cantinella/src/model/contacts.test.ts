import { describe, expect, it } from "vitest";
import { contactToPerson, findExisting, parseContacts, parseCsv, parseCsvRows, parseVCard, roleKey, toCsv, toVCard } from "./contacts";
import { newPerson } from "./defaults";
import { demoData } from "./demo";

describe("vCard", () => {
  it("reads an iPhone export (vCard 3.0, item1.TEL, folded lines)", () => {
    const text = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Ferri;Giulia;;;",
      "FN:Giulia Ferri",
      "NICKNAME:Giuli",
      "item1.TEL;type=pref:+39 347 555 0101",
      "TEL;type=CELL:+39 06 1234567",
      "EMAIL;type=INTERNET;type=HOME:giulia@example.it",
      "NOTE:Mirandolina\\, prima",
      "  lettura il 4",
      "END:VCARD",
    ].join("\r\n");
    const [c] = parseVCard(text);
    expect(c.name).toBe("Giulia Ferri");
    expect(c.phone).toBe("+39 347 555 0101");
    expect(c.email).toBe("giulia@example.it");
    expect(c.aliases).toEqual(["Giuli", "+39 06 1234567"]);
    expect(c.notes).toBe("Mirandolina, prima lettura il 4");
  });

  it("reads an Android export with quoted-printable accents and no FN", () => {
    const text = [
      "BEGIN:VCARD",
      "VERSION:2.1",
      "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Sala;Niccol=C3=B2;;;",
      "TEL;CELL:3475550102",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:2.1",
      "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Stefania =",
      "Neri",
      "END:VCARD",
    ].join("\n");
    const list = parseVCard(text);
    expect(list.map((c) => c.name)).toEqual(["Niccolò Sala", "Stefania Neri"]);
    expect(list[0].phone).toBe("3475550102");
  });

  it("skips cards without any name and uses the organisation as a last resort", () => {
    const text = "BEGIN:VCARD\nTEL:123\nEND:VCARD\nBEGIN:VCARD\nORG:Service Luci Srl;\nTEL:06 555\nEND:VCARD\n";
    expect(parseVCard(text).map((c) => c.name)).toEqual(["Service Luci Srl"]);
  });
});

describe("CSV", () => {
  it("splits quoted cells with separators, quotes and line breaks", () => {
    expect(parseCsvRows('a;"b;c";"d ""e"""\n"riga\ndue";x\n\n', ";")).toEqual([
      ["a", "b;c", 'd "e"'],
      ["riga\ndue", "x"],
    ]);
  });

  it("reads an Italian spreadsheet with ; and Nome/Cognome columns", () => {
    const text = "Nome;Cognome;Cellulare;E-mail;Ruolo;Note\nGiulia;Ferri;347 555 0101;giulia@example.it;Attrice;Mirandolina\nEnrico;Sala;;;tecnico / luci;\n";
    const list = parseCsv(text);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: "Giulia Ferri", phone: "347 555 0101", email: "giulia@example.it", roles: ["Attrice"], notes: "Mirandolina" });
    expect(list[1].roles).toEqual(["tecnico", "luci"]);
  });

  it("reads a Google Contacts export", () => {
    const text =
      "﻿First Name,Middle Name,Last Name,Nickname,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value\n" +
      'Giovanni,,Rota,Gio,gio@example.it,Mobile,+39 347 555 0103 ::: +39 02 555\n';
    const [c] = parseCsv(text);
    expect(c).toMatchObject({ name: "Giovanni Rota", email: "gio@example.it", phone: "+39 347 555 0103", aliases: ["Gio", "+39 02 555"] });
  });

  it("without a header takes name, phone, email in this order", () => {
    expect(parseCsv("Paolo Greco,3475550108,paolo@example.it")[0]).toMatchObject({ name: "Paolo Greco", phone: "3475550108", email: "paolo@example.it" });
  });

  it("chooses vCard or CSV by content", () => {
    expect(parseContacts("BEGIN:VCARD\nFN:A\nEND:VCARD")[0].name).toBe("A");
    expect(parseContacts("nome\nB")[0].name).toBe("B");
  });
});

describe("into the address book", () => {
  it("finds people already there by name or phone", () => {
    const people = demoData().people;
    expect(findExisting(people, { name: "giulia FERRI", phone: "", email: "", aliases: [], roles: [], notes: "" })).toBe(0);
    expect(findExisting(people, { name: "Enrico S.", phone: "3475550102", email: "", aliases: [], roles: [], notes: "" })).toBe(1);
    expect(findExisting(people, { name: "Nuova Persona", phone: "12", email: "", aliases: [], roles: [], notes: "" })).toBe(-1);
  });

  it("turns Italian role words into the preset roles", () => {
    expect(roleKey("Attrice")).toBe("actor");
    expect(roleKey("aiuto regia")).toBe("director");
    expect(roleKey("Fonico")).toBe("crew");
    expect(roleKey("Coreografa")).toBe("Coreografa");
    const p = contactToPerson({ name: " Anna ", phone: "1", email: "", aliases: ["x", "x", " "], roles: ["Regista", "regia"], notes: "" });
    expect(p.name).toBe("Anna");
    expect(p.aliases).toEqual(["x"]);
    expect(p.roles).toEqual(["director"]);
  });
});

describe("export", () => {
  const p = { ...newPerson("Giovanni De Rota"), phone: "+39 347 1", email: "g@x.it", aliases: ["Gio"], roles: ["actor"], notes: "Marchese; primo atto", prod: { sizes: "M, 44", needs: "", documents: "", tour: "" } };
  const roles = (r: string) => (r === "actor" ? "Attore" : r);

  it("writes vCards that come back the same when imported", () => {
    const text = toVCard([p], roles);
    expect(text).toContain("N:Rota;Giovanni De;;;");
    expect(text).toContain("NOTE:Marchese\\; primo atto");
    expect(text).not.toContain("Taglie");
    const back = parseContacts(text)[0];
    expect(back).toMatchObject({ name: "Giovanni De Rota", phone: "+39 347 1", email: "g@x.it" });
    expect(back.aliases).toContain("Gio");
    expect(toVCard([p], roles, { production: true })).toContain("Taglie: M\\, 44");
  });

  it("writes CSV for Excel that comes back the same when imported", () => {
    const text = toCsv([p], roles);
    expect(text.startsWith("\uFEFFNome;Alias;Telefono;Email;Ruoli;Note\r\n")).toBe(true);
    expect(text).toContain('"Marchese; primo atto"');
    expect(parseContacts(text)[0]).toMatchObject({ name: "Giovanni De Rota", email: "g@x.it" });
  });
});
