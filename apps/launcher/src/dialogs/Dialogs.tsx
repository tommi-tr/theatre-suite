import { useStore } from "../state/store";
import { AdoptDialog, ForgetDialog, NewShowDialog, NewDocDialog, DetailsDialog, OpenAllDialog } from "./Simple";
import { CopyDialog } from "./CopyDialog";
import { CoverDialog } from "./CoverDialog";
import { SettingsDialog } from "./SettingsDialog";

/** The one open window, if any. */
export function Dialogs() {
  const d = useStore((s) => s.dialog);
  if (!d) return null;
  switch (d.kind) {
    case "newShow": return <NewShowDialog />;
    case "copy": return <CopyDialog node={d.node} />;
    case "cover": return <CoverDialog path={d.path} />;
    case "settings": return <SettingsDialog />;
    case "adopt": return <AdoptDialog path={d.path} found={d.found} />;
    case "details": return <DetailsDialog path={d.path} />;
    case "newDoc": return <NewDocDialog path={d.path} app={d.app} phase={d.phase} />;
    case "openAll": return <OpenAllDialog report={d.report} />;
    case "forget": return <ForgetDialog node={d.node} />;
  }
}
