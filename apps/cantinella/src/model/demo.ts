import type { ShowInfo } from "@theatre-suite/core";
import { newData, newPerson } from "./defaults";
import type { CantinellaData } from "./types";

/** "La locandiera": the company of the design preview, for `/?demo`. */
export const DEMO_SHOW: ShowInfo = { id: "demo", title: "La locandiera", color: "#6d5a3a" };

export function demoData(): CantinellaData {
  const d = newData("Produzione");
  const p = (name: string, roles: string[], phone: string, email: string, aliases: string[] = [], notes = "") => ({
    ...newPerson(name),
    roles,
    phone,
    email,
    aliases,
    notes,
  });
  d.people = [
    p("Giulia Ferri", ["actor"], "+39 347 555 0101", "giulia.ferri@example.it", ["Giuli"], "Mirandolina"),
    p("Enrico Sala", ["actor"], "+39 347 555 0102", "enrico.sala@example.it", [], "Il Cavaliere di Ripafratta"),
    p("Giovanni Rota", ["actor"], "+39 347 555 0103", "", ["Gio", "Giovi"], "Il Marchese di Forlipopoli"),
    p("Marco Bellini", ["actor"], "+39 347 555 0104", "marco.bellini@example.it", [], "Il Conte d'Albafiorita"),
    p("Luca Fadda", ["actor"], "+39 347 555 0105", "", [], "Fabrizio"),
    p("Stefania Neri", ["actor"], "+39 347 555 0106", "stefania.neri@example.it", ["Stefi"], "Ortensia"),
    p("Chiara Valli", ["actor"], "+39 347 555 0107", "", [], "Dejanira"),
    p("Paolo Greco", ["actor"], "+39 347 555 0108", "", [], "Servitore del Cavaliere"),
    p("Anna Morelli", ["director", "production"], "+39 347 555 0109", "anna.morelli@example.it", [], "Regia e organizzazione"),
    p("Davide Conti", ["crew"], "+39 347 555 0110", "davide.conti@example.it", [], "Luci e fonica"),
  ];
  return d;
}
