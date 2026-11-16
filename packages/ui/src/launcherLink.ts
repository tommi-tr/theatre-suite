import { useCallback, useEffect, useRef, useState } from "react";
import type { ShowBand } from "./components";

/** What an app can do about the launcher (its own Tauri commands; in a browser demo, stand-ins). */
export interface LauncherIo {
  /** Is the launcher installed? */
  available: () => Promise<boolean>;
  /** Brings the launcher to the front on that show folder. */
  open: (showDir: string) => Promise<void>;
  /** Called when opening failed (show a message). */
  onError?: (e: unknown) => void;
}

/** Shortcut of "back to the launcher": Ctrl + Shift + L (Ctrl + L alone is the Lock of the stage apps). */
export const LAUNCHER_SHORTCUT = "Ctrl Shift L";

/**
 * "Torna al launcher" for the title bar (`onHome` / `homeTitle` of TitleBar).
 * It exists only when the document is inside a show whose folder is known and the launcher is
 * installed: otherwise it returns nothing and the bar stays plain. The app is never closed.
 * `back` writes the tooltip text ("Torna a Theatre Suite · {show}") in the app's language.
 */
export function useBackToLauncher(
  show: ShowBand | null | undefined,
  io: LauncherIo,
  back: (showTitle: string) => string,
): { onHome?: () => void; homeTitle?: string } {
  const [installed, setInstalled] = useState(false);
  const ioRef = useRef(io);
  ioRef.current = io;
  useEffect(() => {
    let alive = true;
    io.available().then((v) => alive && setInstalled(!!v)).catch(() => alive && setInstalled(false));
    return () => {
      alive = false;
    };
    // The installed state is asked once per app start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dir = show?.dir;
  const ready = installed && !!dir;
  const go = useCallback(() => {
    if (!dir) return;
    ioRef.current.open(dir).catch((e) => ioRef.current.onError?.(e));
  }, [dir]);

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyL") {
        e.preventDefault();
        e.stopPropagation();
        go();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ready, go]);

  if (!ready || !show) return {};
  return { onHome: go, homeTitle: `${back(show.title)} · ${LAUNCHER_SHORTCUT}` };
}
