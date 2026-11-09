import { useUi } from "../store/ui";
import { AutoListDialog } from "../compose/dialogs/AutoListDialog";
import { CastDialog, CharactersDialog, NoteDialog, PartDialog, RenameDialog, SceneDialog, TitleDialog } from "../compose/dialogs/SheetDialogs";
import { CategoriesDialog, GuideDialog, SettingsDialog, StatsDialog, SymbolsDialog, VersionDialog } from "../compose/dialogs/MiscDialogs";
import { ModelsDialog } from "../format/ModelsDialog";
import { ImportDialog } from "./ImportDialog";

/** Shows the window asked for (one at a time). */
export function Dialogs() {
  const d = useUi((s) => s.dialog);
  if (!d) return null;
  switch (d.kind) {
    case "title":
      return <TitleDialog pos={d.pos} />;
    case "characters":
      return <CharactersDialog pos={d.pos} extra={d.extra} />;
    case "cast":
      return <CastDialog pos={d.pos} />;
    case "scene":
      return d.pos !== undefined ? <SceneDialog pos={d.pos} /> : null;
    case "act":
    case "tableau":
      return d.pos !== undefined ? <PartDialog pos={d.pos} /> : null;
    case "autolist":
      return <AutoListDialog pos={d.pos} extra={d.extra} />;
    case "categories":
      return <CategoriesDialog />;
    case "version":
      return <VersionDialog />;
    case "stats":
      return <StatsDialog />;
    case "symbols":
      return <SymbolsDialog />;
    case "note":
      return d.extra ? <NoteDialog id={d.extra} /> : null;
    case "rename":
      return d.extra ? <RenameDialog id={d.extra} /> : null;
    case "settings":
      return <SettingsDialog />;
    case "guide":
      return <GuideDialog />;
    case "models":
      return <ModelsDialog />;
    case "import":
      return <ImportDialog />;
    default:
      return null;
  }
}
