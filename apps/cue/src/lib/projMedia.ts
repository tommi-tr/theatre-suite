import { basename } from "@theatre-suite/core";
import type { ImageRef } from "../model/projection";
import { api, isDemo } from "./api";

/**
 * Pictures of the projections as addresses the page can show. Images and thumbnails are parts of the `.tcue` (or
 * pending ones not saved yet); the bytes come from the native side and become a blob address, kept while the app runs
 * (a show has a few dozen pictures). In the browser demo they are plain files of `public/demo/`.
 */
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp" };

export const mimeOf = (name: string): string => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

const cache = new Map<string, Promise<string>>();

/** The address of an image part. */
export function imageUrl(ref: ImageRef): Promise<string> {
  if (isDemo) return Promise.resolve(`${import.meta.env.BASE_URL}demo/${basename(ref.part)}`);
  const key = `${ref.file ?? ""}|${ref.staged ?? ""}|${ref.part}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const bytes = ref.staged ? await api.stagedRead(ref.staged) : ref.file ? await api.tcueReadPart(ref.file, ref.part) : Promise.reject(new Error("no file"));
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOf(ref.part) }));
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Forgets the pictures of the show that was closed. */
export function dropImageCache(): void {
  for (const p of cache.values()) void p.then((u) => URL.revokeObjectURL(u), () => {});
  cache.clear();
}

/** A JPEG thumbnail (cover crop) of any drawable source. */
export async function makeThumb(source: CanvasImageSource, w: number, h: number, width = 320, height = 180): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, width, height);
  const k = Math.max(width / w, height / h);
  g.drawImage(source, (width - w * k) / 2, (height - h * k) / 2, w * k, h * k);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.8));
  if (!blob) throw new Error("thumbnail");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Decodes image bytes (a bitmap and its size). */
export async function decodeImage(bytes: Uint8Array, name: string): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mimeOf(name) }));
  return { bitmap, width: bitmap.width, height: bitmap.height };
}
