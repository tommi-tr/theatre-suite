import { RibbonShell } from "../common/Fold";
import { useUi } from "../store/ui";
import { Editor } from "./Editor";
import { ComposeRibbon, ManualRibbon } from "./Ribbon";
import { ComposeStatus } from "./StatusBar";
import { StructurePanel } from "./StructurePanel";

/** Componi: bar, structure on the left, the pages in the middle, status at the bottom. */
export function ComposePhase() {
  const ribbon = useUi((s) => s.ribbon);
  const focus = useUi((s) => s.focusMode);
  return (
    <div className="bd-compose">
      {focus ? null : <RibbonShell>{ribbon === "manual" ? <ManualRibbon /> : <ComposeRibbon />}</RibbonShell>}
      <div className="bd-compose__main">
        {focus ? null : <StructurePanel />}
        <Editor />
      </div>
      <ComposeStatus />
    </div>
  );
}
