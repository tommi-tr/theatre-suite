import { useEffect } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Icon } from "@theatre-suite/ui";
import { useUi } from "../store/ui";

/** Short message at the bottom of the window. */
export function AppToast() {
  const t = useT();
  const toast = useUi((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => useUi.getState().clearToast(), toast.kind === "error" ? 7000 : 4000);
    return () => window.clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`ts-toast${toast.kind === "error" ? " ts-toast--error" : ""}`} role="status">
      <Icon name={toast.kind === "error" ? "alert" : "info"} size={15} color={toast.kind === "error" ? "var(--stop)" : undefined} />
      <span style={{ whiteSpace: "pre-line" }}>{toast.message}</span>
      <Button variant="ghost" iconOnly icon="x" aria-label={t("Close")} style={{ width: 24, height: 24 }} onClick={() => useUi.getState().clearToast()} />
    </div>
  );
}
