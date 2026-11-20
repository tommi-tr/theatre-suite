import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeT } from "@theatre-suite/core";
import { DICTS } from "../i18n";
import { DEMO_GOS } from "./demoShow";
import { linkApi, simInfo } from "./link";
import { applyEdit, editPatch } from "./linkRuntime";
import { newShow } from "../model/show";
import { applySharedRun, handleRequest, resetRun, runGo, sharedRun, useRun } from "../show/run";
import { useDoc } from "../store/doc";
import { useLink } from "../store/link";
import { playbackRole } from "../model/link";

const t = makeT(DICTS, "it");

function setLink(tokens: string[]) {
  const info = { ...simInfo(tokens), simulated: false };
  useLink.getState().setInfo(info);
  useRun.setState({ role: playbackRole(info) });
}

beforeEach(() => {
  const show = { ...newShow("Prova"), gos: DEMO_GOS };
  useDoc.getState().load(show, { filePath: null, dirty: false });
  resetRun(DEMO_GOS);
});
afterEach(() => {
  vi.restoreAllMocks();
  useLink.getState().setInfo(simInfo([]));
  useRun.setState({ role: "solo" });
});

describe("the primary applies the secondary's requests like its keys", () => {
  it("a GO of the secondary fires the standby and moves the standby on", () => {
    setLink(["stable"]);
    const before = useRun.getState().playback.standbyId;
    handleRequest(t, "r1", { kind: "go", standbyId: before });
    const after = useRun.getState().playback;
    expect(after.lastGoId).toBe(before);
    expect(after.standbyId).not.toBe(before);
  });

  it("a GO for a standby that already started is refused with a reply, and nothing fires", () => {
    setLink(["stable"]);
    const reply = vi.spyOn(linkApi(), "reply");
    const sb = useRun.getState().playback.standbyId;
    handleRequest(t, "r1", { kind: "go", standbyId: sb });
    const last = useRun.getState().playback.lastGoId;
    handleRequest(t, "r2", { kind: "go", standbyId: sb });
    expect(reply).toHaveBeenCalledWith("r2", false, "alreadyGiven");
    expect(useRun.getState().playback.lastGoId).toBe(last);
  });

  it("safety commands from the secondary toggle the state", () => {
    setLink(["stable", "taken"]);
    handleRequest(t, "r1", { kind: "pause" });
    expect(useRun.getState().playback.paused).toBe(true);
    handleRequest(t, "r2", { kind: "blackout" });
    expect(useRun.getState().playback.blackout).toBe(true);
    handleRequest(t, "r3", { kind: "emergency" });
    expect(useRun.getState().playback.emergency).toBe(true);
    handleRequest(t, "r4", { kind: "emergency" });
    expect(useRun.getState().playback.emergency).toBe(false);
  });

  it("safety commands pressed on both computers at once do not cancel out", () => {
    setLink(["stable"]);
    // The primary pressed P, B, F and E E; the secondary pressed the same before seeing it: nothing is undone.
    useRun.setState({ playback: { ...useRun.getState().playback, paused: true, blackout: true, ftb: true } });
    handleRequest(t, "r1", { kind: "pause", on: true });
    handleRequest(t, "r2", { kind: "blackout", on: true });
    handleRequest(t, "r3", { kind: "fadeToBlack", on: true });
    let p = useRun.getState().playback;
    expect([p.paused, p.blackout, p.ftb]).toEqual([true, true, true]);
    handleRequest(t, "r4", { kind: "emergency", on: true });
    handleRequest(t, "r5", { kind: "emergency", on: true });
    expect(useRun.getState().playback.emergency).toBe(true);
    handleRequest(t, "r6", { kind: "emergency", on: false });
    handleRequest(t, "r7", { kind: "emergency", on: false });
    p = useRun.getState().playback;
    expect(p.emergency).toBe(false);
  });

  it("Back pressed on both computers at once goes back once", () => {
    setLink(["stable"]);
    const reply = vi.spyOn(linkApi(), "reply");
    handleRequest(t, "r1", { kind: "go", standbyId: useRun.getState().playback.standbyId });
    handleRequest(t, "r2", { kind: "go", standbyId: useRun.getState().playback.standbyId });
    const seen = useRun.getState().playback.lastGoId;
    handleRequest(t, "r3", { kind: "back", fromLastGoId: seen });
    const once = useRun.getState().playback.lastGoId;
    expect(once).not.toBe(seen);
    handleRequest(t, "r4", { kind: "back", fromLastGoId: seen });
    expect(reply).toHaveBeenCalledWith("r4", false, "alreadyGiven");
    expect(useRun.getState().playback.lastGoId).toBe(once);
  });
});

describe("the secondary asks, it does not run", () => {
  it("a GO on the secondary becomes a request and changes nothing locally", () => {
    setLink(["secondary", "stable"]);
    const request = vi.spyOn(linkApi(), "request").mockResolvedValue({ requestId: "x", ok: true });
    const before = useRun.getState().playback;
    runGo(t);
    expect(request).toHaveBeenCalledWith({ kind: "go", standbyId: before.standbyId });
    expect(useRun.getState().playback).toBe(before);
  });

  it("with the primary gone nothing is sent", () => {
    setLink(["secondary", "lost"]);
    const request = vi.spyOn(linkApi(), "request");
    runGo(t);
    expect(request).not.toHaveBeenCalled();
  });

  it("shows the state the primary publishes", () => {
    setLink(["stable"]);
    handleRequest(t, "r1", { kind: "go", standbyId: useRun.getState().playback.standbyId });
    const published = JSON.parse(JSON.stringify(sharedRun(useRun.getState())));
    resetRun(DEMO_GOS);
    expect(applySharedRun(published)).toBe(true);
    expect(useRun.getState().playback.lastGoId).toBe(published.playback.lastGoId);
    expect(useRun.getState().startedAt).toBe(published.startedAt);
    expect(applySharedRun({ nonsense: 1 })).toBe(false);
  });
});

describe("edits of the secondary", () => {
  it("only the changed, editable parts travel; the primary applies them", () => {
    const show = useDoc.getState().show!;
    const next = { ...show, title: "Altro", gos: show.gos.slice(1) };
    const patch = editPatch(show, next);
    expect(Object.keys(patch ?? {})).toEqual(["gos"]);
    expect(applyEdit({ type: "patch", set: { ...patch, title: "Hack", id: "x" } })).toBe(true);
    const now = useDoc.getState().show!;
    expect(now.gos.length).toBe(show.gos.length - 1);
    expect(now.title).toBe(show.title);
    expect(now.id).toBe(show.id);
    expect(applyEdit({ type: "other" })).toBe(false);
  });
});
