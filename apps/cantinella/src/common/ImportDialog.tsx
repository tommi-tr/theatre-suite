import { useMemo, useRef, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Icon } from "@theatre-suite/ui";
import { contactToPerson, findExisting, parseContacts, type ImportedContact } from "../model/contacts";
import type { Person } from "../model/types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { roleLabel } from "../sections/roles";

/** UTF-8, otherwise Windows-1252 (CSV saved by Excel on an Italian Windows). */
async function readText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

interface Row {
  contact: ImportedContact;
  /** Index of the same person already in the contacts, or -1. */
  existing: number;
  checked: boolean;
}

/** Fills the empty fields of an existing person; never overwrites what is there. */
function complete(p: Person, c: ImportedContact): Person {
  const n = contactToPerson(c);
  return {
    ...p,
    phone: p.phone || n.phone,
    email: p.email || n.email,
    notes: p.notes || n.notes,
    aliases: [...new Set([...p.aliases, ...n.aliases])],
    roles: [...new Set([...p.roles, ...n.roles])],
  };
}

/** Import from vCard or CSV with a preview: nothing enters the contacts before the confirmation. */
export function ImportDialog() {
  const t = useT();
  const people = useDoc((s) => s.data.people);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [drag, setDrag] = useState(false);
  const close = () => useUi.getState().closeDialog();

  const load = async (file: File) => {
    setFileName(file.name);
    const list = parseContacts(await readText(file));
    setRows(list.map((contact) => {
      const existing = findExisting(people, contact);
      return { contact, existing, checked: existing < 0 };
    }));
  };

  const adding = rows?.filter((r) => r.checked && r.existing < 0).length ?? 0;
  const completing = rows?.filter((r) => r.checked && r.existing >= 0).length ?? 0;
  const confirmLabel = useMemo(() => {
    if (adding && completing) return t("Add {n} and complete {m}", { n: adding, m: completing });
    if (completing) return completing === 1 ? t("Complete 1 person") : t("Complete {n} people", { n: completing });
    return adding === 1 ? t("Add 1 person") : t("Add {n} people", { n: adding });
  }, [adding, completing, t]);

  const confirm = () => {
    if (!rows) return;
    useDoc.getState().change((d) => {
      const next = [...d.people];
      for (const r of rows) {
        if (!r.checked) continue;
        if (r.existing >= 0 && next[r.existing]) next[r.existing] = complete(next[r.existing], r.contact);
        else next.push(contactToPerson(r.contact));
      }
      return { ...d, people: next };
    });
    close();
    useUi.getState().go("departments", "people");
    useUi.getState().showToast(t("Contacts updated. Ctrl Z undoes the import."));
  };

  return (
    <Dialog
      title={t("Import contacts")}
      icon="upload"
      description={t("vCard files (.vcf) from a phone or Google Contacts, or CSV from a spreadsheet. Nothing is added before you confirm.")}
      onClose={close}
      width={760}
      footer={
        <>
          {rows ? (
            <Button variant="ghost" icon="folderOpen" onClick={() => inputRef.current?.click()}>
              {t("Another file…")}
            </Button>
          ) : null}
          <span className="ts-spacer" />
          <Button onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" icon="check" disabled={!adding && !completing} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept=".vcf,.vcard,.csv,.txt,text/vcard,text/csv"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) void load(f);
          e.currentTarget.value = "";
        }}
      />
      {!rows ? (
        <button
          type="button"
          className={`cn-drop${drag ? " cn-drop--on" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void load(f);
          }}
        >
          <Icon name="upload" size={22} />
          <span className="cn-drop__title">{t("Choose a file, or drop it here")}</span>
          <span className="ts-field__hint">{t("On an iPhone: Contacts → select → Export vCard. On Android: Contacts → Export to .vcf file.")}</span>
        </button>
      ) : rows.length === 0 ? (
        <div className="cn-import__none">
          <Icon name="alert" size={16} color="var(--sb)" />
          {t("No contacts found in {name}. Is it a vCard or a CSV with a column for the name?", { name: fileName ?? "" })}
        </div>
      ) : (
        <div className="cn-import">
          <div className="cn-import__summary">
            <span className="ts-ellipsis">{fileName}</span>
            <span className="ts-spacer" />
            <button type="button" className="cn-linkbtn" onClick={() => setRows(rows.map((r) => ({ ...r, checked: true })))}>
              {t("Select all")}
            </button>
            <button type="button" className="cn-linkbtn" onClick={() => setRows(rows.map((r) => ({ ...r, checked: false })))}>
              {t("None")}
            </button>
          </div>
          <div className="cn-import__rows">
            {rows.map((r, i) => (
              <label key={i} className={`cn-import__row${r.existing >= 0 ? " cn-import__row--known" : ""}`}>
                <input
                  type="checkbox"
                  checked={r.checked}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    setRows(rows.map((x, j) => (j === i ? { ...x, checked } : x)));
                  }}
                />
                <span className="cn-import__name ts-ellipsis">{r.contact.name}</span>
                <span className="mono ts-ellipsis">{r.contact.phone}</span>
                <span className="ts-ellipsis">{r.contact.email}</span>
                <span className="ts-ellipsis ts-muted">{contactToPerson(r.contact).roles.map((x) => roleLabel(t, x)).join(", ")}</span>
                <span className="cn-import__state">
                  {r.existing >= 0 ? (
                    <span className="cn-known">{t("Already there: completes missing details")}</span>
                  ) : (
                    <span className="cn-new">{t("New")}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
