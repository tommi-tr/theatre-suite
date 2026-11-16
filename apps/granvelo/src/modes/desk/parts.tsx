import { useEffect, useRef, useState } from "react";
import { useT } from "@theatre-suite/core";

/** A text that becomes a field on demand: used to rename groups and memories. Enter or click away confirms, Esc cancels. */
export function InlineEdit({
  value,
  label,
  placeholder,
  onCommit,
  onCancel,
  numeric,
  width,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  numeric?: boolean;
  width?: number | string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    if (ok) onCommit(draft);
    else onCancel();
  };
  const t = useT();
  return (
    <input
      ref={ref}
      className="ts-input gv-inline"
      style={{ width }}
      aria-label={label}
      placeholder={placeholder ?? t("Name")}
      value={draft}
      inputMode={numeric ? "numeric" : undefined}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
    />
  );
}

/** Is the keyboard focus in a field where typing must not trigger a shortcut? */
export const isTyping = (el: EventTarget | null): boolean => !!(el as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");

/** Is a question of the interface (confirmation, dialog) open? Then keys belong to it. */
export const questionOpen = (): boolean => !!document.querySelector(".ts-overlay");

/** The element of a light's card on the desk, to bring it into view. */
export const cardId = (fixtureId: string) => `gv-card-${fixtureId}`;
export function scrollCardIntoView(fixtureId: string) {
  document.getElementById(cardId(fixtureId))?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}
