import { ScriptStage } from "../script/ScriptStage";

/**
 * Prepara: libraries on the left (0.3), the script with its notes (and, from 0.3, the GOs) in the centre, the
 * selected GO on the right. Same layout as Show.
 */
export function PrepareMode() {
  return <ScriptStage mode="prepare" />;
}
