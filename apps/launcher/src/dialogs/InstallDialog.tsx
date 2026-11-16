import { useT } from "@theatre-suite/core";
import { Button, Dialog } from "@theatre-suite/ui";
import { appDef } from "../lib/apps";
import { InstallDialogBody } from "../screens/Suite";
import { useStore } from "../state/store";

const close = () => useStore.getState().setDialog(null);

/** Asks before installing a version: nothing is downloaded or installed without this "yes". */
export function InstallDialog({ app, version }: { app: string; version: string }) {
  const t = useT();
  const name = app === "launcher" ? "Theatre Suite" : (appDef(app)?.name ?? app);
  return (
    <Dialog
      title={t("Install {name} {v}?", { name, v: version })}
      icon="download"
      width={500}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button
            variant="primary"
            icon="download"
            onClick={() => {
              close();
              void useStore.getState().install(app, version);
            }}
          >
            {t("Install")}
          </Button>
        </>
      }
    >
      <InstallDialogBody app={app} version={version} />
    </Dialog>
  );
}
