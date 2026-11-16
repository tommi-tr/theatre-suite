import { useEffect } from "react";
import { Button, Icon } from "@theatre-suite/ui";
import { useUi } from "../store/ui";

/** Short message at the bottom, optionally with one action ("Mark them all"). */
export function BardoToast() {
  const toast = useUi((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => useUi.getState().clearToast(), toast.action ? 9000 : 4000);
    return () => window.clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`ts-toast${toast.kind === "error" ? " ts-toast--error" : ""}`} role="status">
      <Icon name={toast.kind === "error" ? "alert" : "info"} size={15} color={toast.kind === "error" ? "var(--stop)" : undefined} />
      <span>{toast.message}</span>
      {toast.action ? (
        <Button
          variant="sm"
          onClick={() => {
            toast.action!.run();
            useUi.getState().clearToast();
          }}
        >
          {toast.action.label}
        </Button>
      ) : null}
      <Button variant="ghost" iconOnly icon="x" aria-label="Close" style={{ width: 24, height: 24 }} onClick={() => useUi.getState().clearToast()} />
    </div>
  );
}
