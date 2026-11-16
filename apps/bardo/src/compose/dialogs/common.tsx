import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@theatre-suite/ui";
import { getData } from "../../model/defaults";
import type { DocData } from "../../model/types";
import { useDoc } from "../../store/doc";

/** The editor view, its state and the script data (dialogs need all three). */
export function useScript() {
  const view = useDoc((s) => s.view);
  const state = useDoc((s) => s.state);
  const data: DocData | null = state ? getData(state.doc) : null;
  return { view, state, data };
}

/** Text field that commits on blur or Enter (renames are applied everywhere at once). */
export function CommitInput({
  value,
  onCommit,
  id,
  placeholder,
  className = "ts-input",
  style,
  autoFocus,
}: {
  value: string;
  onCommit: (v: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      className={className}
      style={style}
      value={draft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function CommitArea({ value, onCommit, id, rows = 2, placeholder, serif }: { value: string; onCommit: (v: string) => void; id?: string; rows?: number; placeholder?: string; serif?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      id={id}
      className="bd-textarea"
      rows={rows}
      value={draft}
      placeholder={placeholder}
      style={serif ? { fontFamily: "'Source Serif 4', Georgia, serif", fontStyle: "italic", fontSize: 13.5 } : undefined}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className="bd-check" onClick={() => onChange(!checked)}>
      <span className="bd-check__box">{checked ? <Icon name="check" size={11} strokeWidth={3.2} /> : null}</span>
      {children}
    </button>
  );
}

export function Field({ label, htmlFor, children, help }: { label: string; htmlFor?: string; children: ReactNode; help?: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="bd-flabel">
        {label}
      </label>
      {children}
      {help ? <div className="bd-help">{help}</div> : null}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ts-seg ts-seg--sm" role="radiogroup" aria-label={label} style={{ display: "flex" }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} aria-pressed={o.value === value} className="ts-seg__btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
