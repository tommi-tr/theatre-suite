import { api } from "./api";
import { useDoc } from "../state/doc";

let busy = false;

/** Checks that the audio files of the cue list are still there, and updates the "missing" marks. */
export async function checkFilesNow(): Promise<void> {
  if (busy) return;
  const doc = useDoc.getState();
  const withFile = doc.tracks.filter((t) => t.file);
  if (!withFile.length) {
    if (Object.values(doc.missing).some(Boolean)) doc.setMissing({});
    return;
  }
  busy = true;
  try {
    const exists = await api.pathsExist(withFile.map((t) => t.file!.path));
    const now = useDoc.getState();
    const next: Record<string, boolean> = {};
    withFile.forEach((t, i) => {
      if (!exists[i]) next[t.id] = true;
    });
    const prev = Object.keys(now.missing).filter((k) => now.missing[k]);
    const same = prev.length === Object.keys(next).length && prev.every((k) => next[k]);
    if (!same) now.setMissing(next);
  } catch {
    // The check must never disturb the show.
  } finally {
    busy = false;
  }
}

/**
 * Keeps watching the files while the app runs (every ~2 s) and whenever the track in attention changes.
 * Returns the function that stops it.
 */
export function startFileMonitor(): () => void {
  const timer = window.setInterval(() => {
    if (!document.hidden) void checkFilesNow();
  }, 2000);
  let prevStandby = useDoc.getState().live.standbyId;
  const unsub = useDoc.subscribe((s) => {
    if (s.live.standbyId !== prevStandby) {
      prevStandby = s.live.standbyId;
      void checkFilesNow();
    }
  });
  void checkFilesNow();
  return () => {
    window.clearInterval(timer);
    unsub();
  };
}
