import { create } from "zustand";
import type { ProjectionItem } from "../model/show";
import { useDoc } from "../store/doc";
import { isDemo, isTauri } from "./api";
import { api } from "./api";
import { fileSha256, resolveSourcePath } from "./sources";

/**
 * The videos of the projections stay outside the `.tcue` (13, "Il file"): when the show opens, each one is looked
 * for next to the show and its fingerprint (SHA-256) compared with the one taken when it was added. A video that
 * changed since then is shown in amber ("cambiato"): it may be another cut, or another file with the same name.
 * "Usa questa versione" takes the new fingerprint.
 */
export type VideoState = "checking" | "ok" | "missing" | "changed";

interface VideoCheckStore {
  byId: Record<string, VideoState>;
  /** The band at the top was closed for this set of changed videos. */
  dismissed: string;
}

export const useVideoCheck = create<VideoCheckStore>(() => ({ byId: {}, dismissed: "" }));

/** What a video is, from what was found (pure: tested). No fingerprint stored = nothing to compare (ok if found). */
export function videoState(found: boolean, stored: string | undefined, now: string | null): VideoState {
  if (!found) return "missing";
  if (!stored || !now) return "ok";
  return stored.toLowerCase() === now.toLowerCase() ? "ok" : "changed";
}

/** The key of what is checked: the videos with their path and fingerprint, and the file they are next to. */
export const videoKey = (items: readonly ProjectionItem[], filePath: string | null): string =>
  `${filePath ?? ""}#${items
    .filter((i) => i.kind === "video")
    .map((i) => `${i.id}:${i.path ?? ""}:${i.sha256 ?? ""}`)
    .join("|")}`;

let run = 0;

async function check(items: readonly ProjectionItem[], filePath: string | null): Promise<void> {
  const mine = ++run;
  const videos = items.filter((i) => i.kind === "video");
  const prev = useVideoCheck.getState().byId;
  useVideoCheck.setState({ byId: Object.fromEntries(videos.map((v) => [v.id, prev[v.id] === "ok" ? "ok" : "checking"])) });
  for (const v of videos) {
    let state: VideoState;
    if (!isTauri) state = isDemo ? "ok" : "missing";
    else {
      const abs = v.path ? await resolveSourcePath({ path: v.path }, filePath) : null;
      const found = !!abs && (await api.pathExists(abs).catch(() => false));
      // Reading a long video takes a few seconds: one at a time, after the show is on screen.
      const now = found && v.sha256 ? await fileSha256(abs!).catch(() => null) : null;
      state = videoState(found, v.sha256, now);
    }
    if (mine !== run) return; // the show changed meanwhile: a newer check runs
    useVideoCheck.setState((s) => ({ byId: { ...s.byId, [v.id]: state } }));
  }
}

/** Checks the videos when a show opens and when its videos change (call once, at start). */
export function startVideoCheck(): () => void {
  let key = "";
  const go = () => {
    const { show, filePath } = useDoc.getState();
    const items = show?.projection.items ?? [];
    const k = videoKey(items, filePath);
    if (k === key) return;
    key = k;
    void check(items, filePath);
  };
  go();
  return useDoc.subscribe((s, prev) => {
    if (s.show?.projection.items !== prev.show?.projection.items || s.filePath !== prev.filePath || s.loadRev !== prev.loadRev) go();
  });
}

/** The videos in amber (changed since they were added), by name. */
export function changedVideos(items: readonly ProjectionItem[], byId: Record<string, VideoState>): ProjectionItem[] {
  return items.filter((i) => i.kind === "video" && byId[i.id] === "changed");
}

/** "Usa questa versione": the video as it is now becomes the reference. */
export async function acceptVideo(item: ProjectionItem): Promise<void> {
  const { filePath } = useDoc.getState();
  const abs = item.path ? await resolveSourcePath({ path: item.path }, filePath) : null;
  const sha256 = abs ? await fileSha256(abs) : null;
  if (!sha256) throw new Error("missing");
  useDoc.getState().change((s) => ({ ...s, projection: { ...s.projection, items: s.projection.items.map((i) => (i.id === item.id ? { ...i, sha256 } : i)) } }));
}
