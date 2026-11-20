import { beforeEach, describe, expect, it } from "vitest";
import { newShow } from "../model/show";
import { useDoc } from "./doc";

const show = () => newShow("La locandiera", () => "id1");

describe("open show: saving and pending parts", () => {
  beforeEach(() => useDoc.getState().load(show(), { filePath: "C:\\S\\Serata.tcue", dirty: false }));

  it("is clean after a save of what is shown", () => {
    useDoc.getState().change((s) => ({ ...s, title: "Nuovo" }));
    const saved = useDoc.getState().show!;
    useDoc.getState().markSaved("C:\\S\\Serata.tcue", [], "abc", saved, {});
    expect(useDoc.getState().dirty).toBe(false);
  });

  it("stays dirty when the show changed while the file was being written", () => {
    useDoc.getState().change((s) => ({ ...s, title: "Prima" }));
    const saved = useDoc.getState().show!;
    useDoc.getState().change((s) => ({ ...s, title: "Durante il salvataggio" }));
    useDoc.getState().markSaved("C:\\S\\Serata.tcue", [], "abc", saved, {});
    expect(useDoc.getState().dirty).toBe(true);
    expect(useDoc.getState().show!.title).toBe("Durante il salvataggio");
  });

  it("keeps a new script pending until it is saved, and cannot undo past it", () => {
    useDoc.getState().change((s) => ({ ...s, title: "Prima" }));
    useDoc.getState().changeWithPart((s) => ({ ...s, script: { kind: "pdf", part: "script.pdf", fileName: "a.pdf", sha256: "1", pageCount: 3 } }), { name: "script.pdf", staged: "/auto/parts/1-script.pdf" });
    expect(useDoc.getState().pending).toEqual({ "script.pdf": "/auto/parts/1-script.pdf" });
    expect(useDoc.getState().canUndo).toBe(false);
    const saved = useDoc.getState().show!;
    const savedPending = useDoc.getState().pending;
    // Another script chosen while saving the first one: that one stays pending.
    useDoc.getState().changeWithPart((s) => ({ ...s, script: { kind: "pdf", part: "script.pdf", fileName: "b.pdf", sha256: "2", pageCount: 4 } }), { name: "script.pdf", staged: "/auto/parts/2-script.pdf" });
    useDoc.getState().markSaved("C:\\S\\Serata.tcue", [{ name: "script.pdf", size: 10 }], "abc", saved, savedPending);
    expect(useDoc.getState().pending).toEqual({ "script.pdf": "/auto/parts/2-script.pdf" });
    expect(useDoc.getState().dirty).toBe(true);
  });

  it("forgets pending parts when another show is opened", () => {
    useDoc.getState().changeWithPart((s) => s, { name: "script.pdf", staged: "/x" });
    useDoc.getState().load(show(), { filePath: null, dirty: false });
    expect(useDoc.getState().pending).toEqual({});
  });
});
