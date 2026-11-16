import { useEffect } from "react";
import { create } from "zustand";
import { webglAvailable } from "../stage/StageView";
import type { StageDetail } from "../stage/types";
import { useSettings, type PreviewDetail } from "./settings";

/**
 * The detail of the preview in use: what the Settings say, or, with "Automatica", what the measurement of this computer
 * chose (the middle level until it has been measured). The measurement runs once, on request or the first time the stage
 * is shown in "Automatica"; the result is kept in the settings of this computer.
 */

/** The level in use for a setting and an automatic result. */
export function effectiveDetail(setting: PreviewDetail, auto: { level: StageDetail } | null): StageDetail {
  return setting === "auto" ? (auto?.level ?? "medium") : setting;
}

interface MeasureStore {
  measuring: boolean;
  /** True if the measurement could not run (no 3D). */
  failed: boolean;
  /** Draws a test stage for a moment and keeps the chosen level in the settings. Never overlaps itself. */
  measure: () => Promise<void>;
}

export const useMeasure = create<MeasureStore>((set, get) => ({
  measuring: false,
  failed: false,
  measure: async () => {
    if (get().measuring) return;
    set({ measuring: true, failed: false });
    try {
      if (!webglAvailable()) {
        set({ failed: true });
        // No 3D: the plain 2D views are drawn, cheap anyway.
        useSettings.getState().update({ autoDetail: { level: "medium", ms: 0, at: Date.now() } });
        return;
      }
      const { measurePreview } = await import("../stage/benchmark");
      const r = await measurePreview();
      if (!r) {
        set({ failed: true });
        return;
      }
      useSettings.getState().update({ autoDetail: { level: r.level as "essential" | "medium" | "high", ms: Math.round(r.ms * 10) / 10, at: Date.now() } });
    } finally {
      set({ measuring: false });
    }
  },
}));

/** The detail the stage views must use now. With "Automatica" and no result yet, starts the measurement (once). */
export function useStageDetail(): StageDetail {
  const setting = useSettings((s) => s.settings.previewDetail);
  const auto = useSettings((s) => s.settings.autoDetail);
  const loaded = useSettings((s) => s.loaded);
  useEffect(() => {
    if (setting !== "auto" || auto || !loaded) return;
    const m = useMeasure.getState();
    if (m.measuring || m.failed) return;
    // A moment after the stage appeared, so that the screen is up before the measurement uses the graphics card.
    const id = window.setTimeout(() => void useMeasure.getState().measure(), 800);
    return () => window.clearTimeout(id);
  }, [setting, auto, loaded]);
  return effectiveDetail(setting, auto);
}
