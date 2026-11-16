import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "../lib/api";
import { coverBackground, showColor } from "../lib/color";
import type { Cover } from "../lib/types";
import { useStore } from "../state/store";

const cache = new Map<string, string | null>();

/** The cover image of a show as a data address (null = none). Reloaded when covers change. */
export function useCoverImage(path: string, cover: Cover, stamp: number): string | null {
  const key = `${path}|${cover.image ?? ""}|${stamp}`;
  const [url, setUrl] = useState<string | null>(cache.get(key) ?? null);
  useEffect(() => {
    if (!cover.image) {
      setUrl(null);
      return;
    }
    if (cache.has(key)) {
      setUrl(cache.get(key) ?? null);
      return;
    }
    let live = true;
    api.coverGet(path).then((u) => {
      cache.set(key, u);
      if (live) setUrl(u);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [key, path, cover.image]);
  return url;
}

/** Cover of a show: the image if there is one, otherwise its colour. */
export function ShowCover({
  path,
  title,
  cover,
  height,
  radius,
  style,
  children,
  letter,
}: {
  path: string;
  title: string;
  cover: Cover;
  height: number;
  radius?: string;
  style?: CSSProperties;
  children?: ReactNode;
  letter?: boolean;
}) {
  const stamp = useStore((s) => s.coverStamp);
  const img = useCoverImage(path, cover, stamp);
  const color = showColor(title, cover);
  const bg = img ? `center / cover no-repeat url(${img})` : coverBackground(color);
  return (
    <div className="ln-cover" style={{ height, background: bg, borderRadius: radius, ...style }}>
      {!img && letter ? <span className="ln-cover__letter" aria-hidden="true">{title.trim().charAt(0).toUpperCase()}</span> : null}
      {children}
    </div>
  );
}
