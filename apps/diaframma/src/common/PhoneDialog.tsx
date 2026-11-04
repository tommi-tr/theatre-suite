import { useT } from "@theatre-suite/core";
import { Button, Dialog } from "@theatre-suite/ui";

export function PhoneDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog title={t("Phone remote")} icon="phone" onClose={onClose} description={t("Coming in a next step of development.")}
      footer={<><span className="ts-spacer" /><Button variant="primary" onClick={onClose}>{t("Done")}</Button></>}>
      <p className="ts-muted">{t("The phone remote is off.")}</p>
    </Dialog>
  );
}
