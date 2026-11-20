import type { DmxApi } from "@theatre-suite/show-files/granvelo/dmxApi";
import type { EngineCommand } from "../model/playback";
import type { Library } from "../model/sources";
import { splitEngineId, type AudioApi } from "./audio";

/**
 * Runs the engine commands of model/playback.ts on the outputs: lights (DMX engine), sound (audio engine),
 * projections (phase 4, passed to `projection`). One output failing never stops the others: every command is tried
 * and failures are reported to `onError` (the interface shows them; the show goes on).
 */

export interface RunnerDeps {
  dmx: DmxApi;
  audio: AudioApi;
  library: Library;
  /** Projection / PowerPoint commands (phase 4). */
  projection?: (cmd: Extract<EngineCommand, { kind: "projection" }>) => void;
  onError?: (cmd: EngineCommand, error: unknown) => void;
  /** Timer for sounds with a delay (default setTimeout; tests pass their own). */
  later?: (fn: () => void, ms: number) => void;
}

export async function runCommand(cmd: EngineCommand, d: RunnerDeps): Promise<void> {
  switch (cmd.kind) {
    case "light": {
      const p = d.library.fadePayload(cmd.ref, cmd.transition);
      if (!p) throw new Error(`memory not found: ${cmd.ref?.sourceId}/${cmd.ref?.itemId}`);
      await d.dmx.fadeTo(p);
      return;
    }
    case "audioPlay": {
      const play = () => d.audio.playNow(cmd.ref.sourceId, cmd.engineTrackId);
      if (cmd.delaySec > 0) {
        const later = d.later ?? ((fn, ms) => void setTimeout(fn, ms));
        later(() => void play().catch((e) => d.onError?.(cmd, e)), cmd.delaySec * 1000);
      } else await play();
      return;
    }
    case "audioStop": {
      if (cmd.ref && cmd.engineTrackId) {
        await d.audio.stopTrack(cmd.ref.sourceId, cmd.engineTrackId, cmd.fadeSec);
        return;
      }
      const ref = cmd.ref;
      if (!ref && cmd.fadeSec === null) {
        await d.audio.stopAll(false);
        return;
      }
      // Every copy of the track (or every voice), with the fade of the action.
      const live = await d.audio.state();
      const fade = cmd.fadeSec ?? 1.5;
      for (const v of live.voices) {
        const id = splitEngineId(v.trackId);
        if (!id) continue;
        if (!ref || (id.sourceId === ref.sourceId && id.baseTrackId === ref.itemId)) await d.audio.stopTrack(id.sourceId, id.trackId, fade);
      }
      return;
    }
    case "audioStopAll":
      await d.audio.stopAll(cmd.immediate);
      return;
    case "audioPause":
      await d.audio.setPaused(cmd.paused);
      return;
    case "dmxPause":
      await (cmd.paused ? d.dmx.pause() : d.dmx.resume());
      return;
    case "dmxBlackout":
      await d.dmx.blackout(cmd.on);
      return;
    case "dmxFadeToBlack":
      await (cmd.on ? d.dmx.fadeToBlack(cmd.seconds) : d.dmx.releaseBlack(cmd.seconds));
      return;
    case "dmxEmergency":
      if (cmd.on) {
        // Light at once, whatever the masters were (they come back when the emergency ends).
        await d.dmx.blackout(false);
        await d.dmx.releaseBlack(0);
        const values = d.library.emergencyValues();
        if (values) await d.dmx.setUniverse(values);
      } else {
        await d.dmx.blackout(!!cmd.blackout);
        if (cmd.ftb) await d.dmx.fadeToBlack(0);
      }
      return;
    case "projection":
      d.projection?.(cmd);
      return;
  }
}

/** Runs the commands in order; a failing one is reported and the next ones still run. */
export async function runCommands(cmds: readonly EngineCommand[], d: RunnerDeps): Promise<void> {
  for (const c of cmds) {
    try {
      await runCommand(c, d);
    } catch (e) {
      d.onError?.(c, e);
    }
  }
}
