import { describe, expect, it } from "vitest";
import { makeT } from "@theatre-suite/core";
import { DICTS } from "../i18n";
import { simInfo } from "../lib/link";
import { checkRemoteGo, formatElapsed, formatLatency, givenByLabel, linkPanel, NO_LINK, playbackRole, refusalText, reservationView, routeAction, type LinkInfo } from "./link";

const t = makeT(DICTS, "it");
const NOW = 1_000_000;
const info = (tokens: string[]): LinkInfo => ({ ...simInfo(tokens, NOW), simulated: false });

describe("link panel (13_cue.md, exact Italian texts)", () => {
  it("stable: soft green, 55% green border", () => {
    const p = linkPanel(info(["stable"]), t, "it", NOW);
    expect(p).toMatchObject({ tone: "go", filled: false, border: { tone: "go", opacity: 0.55 }, heading: "Sei il primario · Secondario", title: "Connesso · 0,4 ms", detail: "Via cavo · disponibile" });
    expect(p.button).toEqual({ label: "Togli i comandi", action: "takeCommands" });
    expect(linkPanel(info(["stable", "secondary"]), t, "it", NOW).button?.label).toBe("Non disponibile");
    expect(linkPanel(info(["stable", "taken"]), t, "it", NOW).button?.label).toBe("Ridai i comandi");
  });

  it("unstable and Wi-Fi backup: full amber, dark text", () => {
    const u = linkPanel(info(["unstable"]), t, "it", NOW);
    expect(u).toMatchObject({ tone: "amber", filled: true, ink: "dark", title: "Instabile · 38 ms, 3 battiti persi" });
    expect(linkPanel({ ...info(["unstable"]), lostBeats: 1 }, t, "it", NOW).title).toBe("Instabile · 38 ms, 1 battito perso");
    expect(linkPanel(info(["backup"]), t, "it", NOW)).toMatchObject({ tone: "amber", title: "Ora su Wi-Fi di riserva", detail: "Il cavo non risponde · 6,2 ms" });
  });

  it("lost: full red, white text, elapsed time, a sentence per side", () => {
    const p = linkPanel(info(["lost"]), t, "it", NOW);
    expect(p).toMatchObject({ tone: "red", ink: "white", border: { tone: "red", opacity: 1 }, title: "Scollegato da 0:04", detail: "Il secondario non può dare GO. Tu continui normalmente.", button: null });
    expect(linkPanel(info(["lost", "secondary"]), t, "it", NOW).detail).toBe("Il primario non risponde. Non puoi continuare da qui.");
  });

  it("unavailable: blue; the primary is alone, the secondary gets the veil", () => {
    const p = linkPanel(info(["unavailable"]), t, "it", NOW);
    expect(p).toMatchObject({ tone: "blue", filled: true, detail: "Non disponibile · sei solo", detailStrong: true, veil: null });
    const s = linkPanel(info(["unavailable", "secondary"]), t, "it", NOW);
    expect(s.veil).toEqual({ title: "Non disponibile · le tue scorciatoie sono spente", hold: "Tieni premuto per tornare disponibile" });
  });

  it("no secondary: neutral, no border; pairing shows the code", () => {
    expect(linkPanel(NO_LINK, t, "it", NOW)).toMatchObject({ tone: "neutral", border: null, heading: null, title: "Nessun secondario", detail: "Controlli → Collegamento per abbinarne uno" });
    expect(linkPanel(info(["pairing"]), t, "it", NOW).detail).toBe("Codice di abbinamento 482 913");
    expect(linkPanel(info(["pairing", "secondary"]), t, "it", NOW).detail).toBe("Scrivi il codice che mostra Regia");
  });

  it("formats latency and elapsed time", () => {
    expect(formatLatency(0.43, "it")).toBe("0,4");
    expect(formatLatency(0.43, "en")).toBe("0.4");
    expect(formatLatency(37.6, "it")).toBe("38");
    expect(formatElapsed(4200)).toBe("0:04");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });
});

describe("routing", () => {
  it("applies locally without a link or on the primary, broadcasting when connected", () => {
    expect(routeAction(NO_LINK, { kind: "go" })).toEqual({ kind: "local", broadcast: false });
    expect(routeAction(info(["stable"]), { kind: "go" })).toEqual({ kind: "local", broadcast: true });
    expect(routeAction(info(["lost"]), { kind: "go" })).toEqual({ kind: "local", broadcast: false });
  });

  it("asks the primary from the secondary, refusing what is already known", () => {
    expect(routeAction(info(["secondary", "stable"]), { kind: "go" })).toEqual({ kind: "remote" });
    expect(routeAction(info(["secondary", "lost"]), { kind: "blackout" })).toEqual({ kind: "refuse", reason: "notConnected" });
    expect(routeAction(info(["secondary", "stable", "taken"]), { kind: "go" })).toEqual({ kind: "refuse", reason: "commandsTaken" });
    expect(routeAction(info(["secondary", "stable", "taken"]), { kind: "release" })).toEqual({ kind: "remote" });
    expect(routeAction(info(["secondary", "stable", "reserved-other"]), { kind: "go" })).toEqual({ kind: "refuse", reason: "reservedByPrimary" });
    expect(routeAction(info(["secondary", "stable", "reserved-other"]), { kind: "emergency" })).toEqual({ kind: "remote" });
    expect(routeAction(info(["secondary", "unavailable"]), { kind: "go" })).toEqual({ kind: "refuse", reason: "unavailable" });
    expect(routeAction({ ...info(["secondary", "stable"]), simulated: true }, { kind: "go" })).toEqual({ kind: "local", broadcast: false });
  });

  it("refuses the primary's GO while the secondary holds the reservation", () => {
    expect(routeAction(info(["stable", "reserved-other"]), { kind: "go" })).toEqual({ kind: "refuse", reason: "reservedBySecondary" });
    expect(routeAction(info(["stable", "reserved-other"]), { kind: "blackout" })).toEqual({ kind: "local", broadcast: true });
    expect(routeAction(info(["lost", "reserved-other"]), { kind: "go" }).kind).toBe("local");
  });

  it("refuses a remote GO meant for a standby that already started", () => {
    expect(checkRemoteGo({ kind: "go", standbyId: "g7" }, "g7")).toBeNull();
    expect(checkRemoteGo({ kind: "go", standbyId: "g7" }, "g8")).toBe("alreadyGiven");
    expect(checkRemoteGo({ kind: "go" }, "g8")).toBeNull();
    expect(refusalText("alreadyGiven", t)).toBe("Quel GO è già partito");
  });
});

describe("reservation and givers", () => {
  it("shows who holds the reservation", () => {
    expect(reservationView(info(["stable", "reserved-me"]), t)).toEqual({ mine: true, other: false, ribbon: "Prenotato da te · solo tu puoi dare il GO", goLabel: null });
    expect(reservationView(info(["stable", "secondary", "reserved-other"]), t).goLabel).toBe("Prenotato dal primario");
    expect(reservationView(info(["stable", "reserved-other"]), t).goLabel).toBe("Prenotato dal secondario");
    expect(reservationView(NO_LINK, t).ribbon).toBeNull();
  });

  it("maps the link to the playback role and labels assigned GOs", () => {
    expect(playbackRole(info(["stable"]))).toBe("primary");
    expect(playbackRole(info(["lost"]))).toBe("solo");
    expect(playbackRole(info(["unavailable"]))).toBe("solo");
    expect(playbackRole(NO_LINK)).toBe("solo");
    expect(playbackRole(info(["secondary", "stable"]))).toBe("secondary");
    expect(givenByLabel("secondary", "primary", t)).toBe("lo dà il secondario");
    expect(givenByLabel("primary", "secondary", t)).toBe("lo dà il primario");
    expect(givenByLabel("both", "secondary", t)).toBeNull();
    expect(givenByLabel("secondary", "solo", t)).toBeNull();
  });
});
