import { useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Segmented, Switch } from "@theatre-suite/ui";
import { exportBase, saveTextFile } from "../lib/exports";
import { toCsv, toVCard } from "../model/contacts";
import { roleLabel } from "../sections/roles";
import { useDoc } from "../store/doc";

/** Saves the contacts as vCard (phones) or CSV (spreadsheets). Production details only if asked. */
export function ExportContactsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const people = useDoc((s) => s.data.people);
  const [format, setFormat] = useState<"vcf" | "csv">("vcf");
  const [production, setProduction] = useState(false);
  const roles = (r: string) => roleLabel(t, r);
  return (
    <Dialog
      title={t("Export the contacts")}
      icon="download"
      description={t("{n} people. The file stays on this computer until you send it.", { n: people.length })}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button
            variant="primary"
            icon="download"
            onClick={async () => {
              const text = format === "vcf" ? toVCard(people, roles, { production }) : toCsv(people, roles, { production });
              if (await saveTextFile(t, exportBase(t("contacts")), format, format === "vcf" ? "text/vcard" : "text/csv", text)) onClose();
            }}
          >
            {t("Save…")}
          </Button>
        </>
      }
    >
      <div className="cn-copyopts cn-copyopts--col">
        <Segmented<"vcf" | "csv">
          ariaLabel={t("Format")}
          value={format}
          onChange={setFormat}
          options={[
            { value: "vcf", label: t("vCard (phones, Google, Outlook)") },
            { value: "csv", label: t("CSV (Excel and spreadsheets)") },
          ]}
        />
        <label className="cn-switchrow">
          <Switch checked={production} onChange={setProduction} label={t("Include the production details")} />
          {t("Include the production details")}
        </label>
        <p className="ts-field__hint">{t("Sizes, needs and documents are personal: include them only if the file goes to who needs them.")}</p>
      </div>
    </Dialog>
  );
}
