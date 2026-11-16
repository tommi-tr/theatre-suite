import { useEffect, useSyncExternalStore } from "react";
import { Button, Dialog } from "./components";

/**
 * Confirmation dialogs of the whole suite, in the app's own look (no system pop-ups).
 * Each app mounts <ConfirmHost /> once; any code can then `await confirmYesNo(...)`
 * or `await confirmSave(...)`. Esc and the X always mean "cancel".
 */

export type SaveChoice = "save" | "discard" | "cancel";

interface Request {
  title: string;
  message: string;
  /** Labels of the buttons: [cancel, (discard), confirm]. */
  cancelLabel: string;
  discardLabel?: string;
  confirmLabel: string;
  /** The confirm button is red (an action that destroys something). */
  danger: boolean;
  closeLabel: string;
  resolve: (choice: SaveChoice) => void;
}

let current: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function ask(req: Omit<Request, "resolve">): Promise<SaveChoice> {
  return new Promise((resolve) => {
    current?.resolve("cancel"); // a new question replaces an old one that nobody answered
    current = { ...req, resolve };
    emit();
  });
}

function answer(choice: SaveChoice) {
  const r = current;
  current = null;
  emit();
  r?.resolve(choice);
}

export interface ConfirmLabels {
  title: string;
  message: string;
  cancel: string;
  /** Translated "Close" for the X button. */
  close?: string;
}

/** "Save changes?": Cancel · Don't save · Save. Enter saves, Esc cancels. */
export function confirmSave(o: ConfirmLabels & { discard: string; save: string }): Promise<SaveChoice> {
  return ask({ title: o.title, message: o.message, cancelLabel: o.cancel, discardLabel: o.discard, confirmLabel: o.save, danger: false, closeLabel: o.close ?? "Close" });
}

/** A yes/no question: Cancel · [action]. `danger` makes the action red. True if confirmed. */
export async function confirmYesNo(o: ConfirmLabels & { confirm: string; danger?: boolean }): Promise<boolean> {
  const c = await ask({ title: o.title, message: o.message, cancelLabel: o.cancel, confirmLabel: o.confirm, danger: o.danger ?? false, closeLabel: o.close ?? "Close" });
  return c === "save";
}

export function ConfirmHost() {
  const req = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (!req) return;
    // The safe default button gets the focus (Enter confirms it).
    const id = window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-confirm-default]")?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [req]);
  if (!req) return null;
  return (
    <Dialog
      title={req.title}
      icon={req.danger ? "alert" : "info"}
      width={460}
      closeLabel={req.closeLabel}
      onClose={() => answer("cancel")}
      footer={
        <>
          <span className="ts-spacer" />
          <Button variant="ghost" onClick={() => answer("cancel")}>
            {req.cancelLabel}
          </Button>
          {req.discardLabel ? (
            <Button variant="ghost" onClick={() => answer("discard")}>
              {req.discardLabel}
            </Button>
          ) : null}
          <Button variant={req.danger ? "danger" : "primary"} data-confirm-default="" onClick={() => answer("save")}>
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="ts-confirm__text">{req.message}</p>
    </Dialog>
  );
}
