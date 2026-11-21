import { useEffect, useState } from "react";
import { imageUrl } from "../lib/projMedia";
import type { ImageRef } from "../model/projection";
import type { ProjectionItem } from "../model/show";
import { useDoc } from "../store/doc";

/** The address of a picture of the show (null while loading or when it is missing). */
export function useImageUrl(ref: ImageRef | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const key = ref ? `${ref.file}|${ref.staged}|${ref.part}` : "";
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (ref) void imageUrl(ref).then((u) => live && setUrl(u), () => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}

/** The thumbnail of an item (a video's frame, an image's picture). */
export function useItemThumb(item: Pick<ProjectionItem, "kind" | "part" | "thumb"> | undefined): string | null {
  const file = useDoc((s) => s.filePath);
  const pending = useDoc((s) => s.pending);
  const part = item ? (item.thumb ?? (item.kind === "video" ? undefined : item.part)) : undefined;
  return useImageUrl(part ? { file, staged: pending[part] ?? null, part } : null);
}
