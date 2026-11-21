import { open } from "@tauri-apps/plugin-dialog";
import { basename, type TFunc } from "@theatre-suite/core";
import { confirmYesNo } from "@theatre-suite/ui";
import { create } from "zustand";
import { api, isTauri } from "./api";
import { decodeImage, makeThumb } from "./projMedia";
import { memFs } from "./memFs";
import { fileSha256, pathRelativeToShow, resolveSourcePath } from "./sources";
import { AnnotationMode, openPdf } from "../script/pdf";
import { newId } from "../prepare/actions";
import type { ProjectionItem } from "../model/show";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";

/**
 * Adding to the projections: images (copied into the .tcue, with a thumbnail), videos (they stay outside, in the show
 * folder: path relative to the .tcue and SHA-256; a poster frame is captured), slides from a PDF (each page drawn as a
 * PNG) or from a .pptx (PowerPoint exports them, Windows only). Nothing here touches the original files.
 */
export const useImporting = create<{ busy: string | null }>(() => ({ busy: null }));

const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"];
const VIDEO_EXT = ["mp4", "m4v", "mov", "webm"];

interface Picked {
  name: string;
  path?: string;
  file?: File;
}

const say = (message: string, kind: "info" | "error" = "info") => useUi.getState().showToast(message, kind);
const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

function pickInBrowser(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    document.body.appendChild(input);
    let done = false;
    const finish = (f: File[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => finish([]));
    input.click();
  });
}

async function pick(filterName: string, extensions: string[], multiple: boolean, title: string): Promise<Picked[]> {
  if (isTauri) {
    const chosen = await open({ filters: [{ name: filterName, extensions }], multiple, directory: false, title });
    const list = chosen === null ? [] : Array.isArray(chosen) ? chosen : [chosen];
    return list.map((p) => ({ name: basename(p), path: p }));
  }
  return (await pickInBrowser(extensions.map((e) => `.${e}`).join(","), multiple)).map((f) => ({ name: f.name, file: f }));
}

/** A picture added to the show: its bytes become the part `images/<id>.<ext>`, with a thumbnail. */
async function stageImage(src: Picked | { bytes: Uint8Array; name: string }, id: string, ext: string) {
  const part = `images/${id}.${ext}`;
  let bytes: Uint8Array;
  let staged: string;
  if ("bytes" in src) {
    bytes = src.bytes;
    staged = (await api.partStageBytes(bytes, part)).path;
  } else if (src.path) {
    staged = (await api.partStage(src.path, part)).path;
    bytes = await api.stagedRead(staged);
  } else {
    bytes = new Uint8Array(await src.file!.arrayBuffer());
    staged = memFs.stage(bytes, part);
  }
  const { bitmap, width, height } = await decodeImage(bytes, part);
  const thumbName = `thumbs/${id}.jpg`;
  const thumb = await api.partStageBytes(await makeThumb(bitmap, width, height), thumbName);
  bitmap.close();
  return { part, thumb: thumbName, parts: [{ name: part, staged }, { name: thumbName, staged: thumb.path }] };
}

function commit(items: ProjectionItem[], parts: { name: string; staged: string }[]) {
  if (!items.length) return;
  useDoc.getState().changeWithParts((s) => ({ ...s, projection: { ...s.projection, items: [...s.projection.items, ...items] } }), parts);
}

async function guarded(t: TFunc, label: string, fn: () => Promise<void>) {
  useImporting.setState({ busy: label });
  try {
    await fn();
  } catch (e) {
    say(t("Could not add this: {error}", { error: String((e as Error)?.message ?? e) }), "error");
  } finally {
    useImporting.setState({ busy: null });
  }
}

/** "Immagini…" */
export async function addImages(t: TFunc): Promise<string[]> {
  const files = await pick(t("Images"), IMAGE_EXT, true, t("Choose images"));
  const added: ProjectionItem[] = [];
  const parts: { name: string; staged: string }[] = [];
  await guarded(t, t("Adding images…"), async () => {
    for (const f of files) {
      const ext = IMAGE_EXT.includes(extOf(f.name)) ? extOf(f.name) : "png";
      try {
        const id = newId();
        const r = await stageImage(f, id, ext);
        parts.push(...r.parts);
        added.push({ id, kind: "image", name: stem(f.name), part: r.part, thumb: r.thumb, transition: { kind: "cut" } });
      } catch {
        say(t("{name} is not an image Cue can read.", { name: f.name }), "error");
      }
    }
    commit(added, parts);
  });
  return added.map((i) => i.id);
}

/** The blank image ("tappo"): one image of the show. */
export async function chooseBlankImage(t: TFunc): Promise<void> {
  const [f] = await pick(t("Images"), IMAGE_EXT, false, t("Choose the blank image"));
  if (!f) return;
  await guarded(t, t("Adding images…"), async () => {
    const id = newId();
    const r = await stageImage(f, id, IMAGE_EXT.includes(extOf(f.name)) ? extOf(f.name) : "png");
    useDoc.getState().changeWithParts((s) => ({ ...s, projection: { ...s.projection, blank: { kind: "image", part: r.part } } }), r.parts);
  });
}

export const clearBlankImage = () => useDoc.getState().change((s) => ({ ...s, projection: { ...s.projection, blank: { kind: "black" } } }));

/** A frame of the video, and its length, read by playing it muted in a hidden element (the same way the output will). */
async function captureVideo(url: string): Promise<{ thumb: Uint8Array | null; durationSec: number | null }> {
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = url;
  try {
    await new Promise<void>((ok, bad) => {
      v.onloadeddata = () => ok();
      v.onerror = () => bad(new Error("unreadable"));
      window.setTimeout(() => bad(new Error("timeout")), 15000);
    });
    const dur = Number.isFinite(v.duration) ? v.duration : null;
    v.currentTime = Math.min(1, (dur ?? 2) * 0.1);
    await new Promise<void>((ok) => {
      v.onseeked = () => ok();
      window.setTimeout(ok, 4000);
    });
    return { thumb: v.videoWidth ? await makeThumb(v, v.videoWidth, v.videoHeight) : null, durationSec: dur };
  } catch {
    return { thumb: null, durationSec: null };
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}

/** "Video…": the file stays outside the show file, inside the show folder (copied there, after asking, if it is elsewhere). */
export async function addVideos(t: TFunc): Promise<void> {
  const showFile = useDoc.getState().filePath;
  if (!isTauri) return say(t("Videos can be added in the Cue program, not in this preview."));
  if (!showFile) return say(t("Save the show first: videos are found next to the show file."), "error");
  const files = await pick(t("Videos"), VIDEO_EXT, true, t("Choose videos (MP4)"));
  const added: ProjectionItem[] = [];
  const parts: { name: string; staged: string }[] = [];
  await guarded(t, t("Adding videos…"), async () => {
    for (const f of files) {
      let rel = await pathRelativeToShow(showFile, f.path!);
      if (rel === null || rel.startsWith("..") || /^([a-zA-Z]:|[\\/])/.test(rel)) {
        const ok = await confirmYesNo({
          title: t("Video outside the show folder"),
          message: t("{name} is not in the show folder. Cue plays videos only from there, so that they travel with the show. Copy it into the folder “video” next to the show file?", { name: f.name }),
          cancel: t("Cancel"),
          confirm: t("Copy it"),
          close: t("Close"),
        });
        if (!ok) continue;
        rel = await api.projCopyVideo(showFile, f.path!);
      }
      const abs = await resolveSourcePath({ path: rel }, showFile);
      const sha256 = abs ? await fileSha256(abs) : null;
      const id = newId();
      let thumb: string | undefined;
      let durationSec: number | undefined;
      try {
        const cap = await captureVideo(await api.projVideoUrl(showFile, rel));
        if (cap.durationSec !== null) durationSec = Math.round(cap.durationSec);
        if (cap.thumb) {
          const name = `thumbs/${id}.jpg`;
          parts.push({ name, staged: (await api.partStageBytes(cap.thumb, name)).path });
          thumb = name;
        } else say(t("Cue cannot read this video: use MP4 with H.264 video."), "error");
      } catch {
        say(t("Cue cannot read this video: use MP4 with H.264 video."), "error");
      }
      added.push({ id, kind: "video", name: basename(rel), path: rel, ...(sha256 ? { sha256 } : {}), ...(thumb ? { thumb } : {}), ...(durationSec !== undefined ? { durationSec } : {}), transition: { kind: "cut" }, atEnd: "hold" });
    }
    commit(added, parts);
  });
}

/** Draws every page of a PDF as a 1920-wide PNG and adds them as slides. */
export async function addSlidesFromPdf(t: TFunc): Promise<void> {
  const [f] = await pick("PDF", ["pdf"], false, t("Choose the PDF of the presentation"));
  if (!f) return;
  const added: ProjectionItem[] = [];
  const parts: { name: string; staged: string }[] = [];
  await guarded(t, t("Reading the PDF…"), async () => {
    const bytes = f.path ? await api.readBytes(f.path) : new Uint8Array(await f.file!.arrayBuffer());
    const doc = await openPdf(bytes);
    const base = stem(f.name);
    for (let n = 1; n <= doc.numPages; n++) {
      useImporting.setState({ busy: t("Slide {n} of {total}…", { n, total: doc.numPages }) });
      const page = await doc.getPage(n);
      const w0 = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1920 / w0.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false })!;
      await page.render({ canvas, canvasContext: ctx, viewport, annotationMode: AnnotationMode.ENABLE, background: "#ffffff" }).promise;
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
      if (!blob) throw new Error("png");
      const id = newId();
      const r = await stageImage({ bytes: new Uint8Array(await blob.arrayBuffer()), name: `${id}.png` }, id, "png");
      parts.push(...r.parts);
      added.push({ id, kind: "slide", name: `${base} · ${n}`, part: r.part, thumb: r.thumb, transition: { kind: "cut" } });
    }
    commit(added, parts);
  });
}

/** Windows with PowerPoint: the .pptx exported by PowerPoint itself as PNG images. */
export async function addSlidesFromPowerPoint(t: TFunc): Promise<void> {
  const [f] = await pick("PowerPoint", ["pptx", "ppt", "pptm"], false, t("Choose the PowerPoint file"));
  if (!f?.path) return;
  const added: ProjectionItem[] = [];
  const parts: { name: string; staged: string }[] = [];
  await guarded(t, t("PowerPoint is exporting the slides…"), async () => {
    const dir = await api.pptTempDir();
    try {
      const files = await api.pptExport(f.path!, dir);
      if (!files.length) throw new Error("export-failed");
      const base = stem(f.name);
      for (let i = 0; i < files.length; i++) {
        useImporting.setState({ busy: t("Slide {n} of {total}…", { n: i + 1, total: files.length }) });
        const id = newId();
        const r = await stageImage({ name: basename(files[i]), path: files[i] }, id, "png");
        parts.push(...r.parts);
        added.push({ id, kind: "slide", name: `${base} · ${i + 1}`, part: r.part, thumb: r.thumb, transition: { kind: "cut" } });
      }
      commit(added, parts);
    } finally {
      void api.pptCleanup(dir).catch(() => {});
    }
  });
}
