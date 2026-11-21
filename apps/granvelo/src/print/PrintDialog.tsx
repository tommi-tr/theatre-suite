import { useMemo, useState } from "react";
import { useLang, useT } from "@theatre-suite/core";
import { Button, Dialog, Icon, Segmented } from "@theatre-suite/ui";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { ListSheet, PlanSheet } from "./PrintSheets";
import { listData, planData, sheetTitle } from "./printData";
import { printSheets } from "./printLayer";
import "./print.css";

type Choice = "plan" | "list" | "both";

/** "Stampa": preview of the electricians' sheets (plan seen from above, list of lights), then the system print dialog. */
export function PrintDialog() {
  const t = useT();
  const lang = useLang();
  const doc = useDoc((s) => s.doc)!;
  const [choice, setChoice] = useState<Choice>("both");
  const [busy, setBusy] = useState(false);
  const close = () => useUi.getState().closeDialog();
  const date = useMemo(() => new Date(), []);
  const plan = useMemo(() => planData(doc, t, lang), [doc, t, lang]);
  const list = useMemo(() => listData(doc, t, lang), [doc, t, lang]);
  const showPlan = choice !== "list";
  const showList = choice !== "plan";
  const sheets = (
    <>
      {showPlan ? <PlanSheet t={t} lang={lang} title={sheetTitle(doc.title, t("Plan of the lights"), date, lang)} plan={plan} /> : null}
      {showList ? <ListSheet t={t} title={sheetTitle(doc.title, t("List of lights"), date, lang)} list={list} /> : null}
    </>
  );
  const print = async () => {
    setBusy(true);
    try {
      await printSheets(sheets);
    } catch (e) {
      useUi.getState().showToast(String(e), "error");
    }
    setBusy(false);
  };
  return (
    <Dialog
      title={t("Print")}
      icon="printer"
      width={940}
      onClose={close}
      closeLabel={t("Close")}
      description={t("The plan of the lights seen from above and the list of lights, for the electricians. They print in black on white paper.")}
      footer={
        <>
          <span className="ts-muted gv-printprev__tip">
            <Icon name="info" size={12} /> {t("On Windows, choose “Microsoft Print to PDF” to make a PDF file.")}
          </span>
          <span className="ts-spacer" />
          <Button onClick={close}>{t("Close")}</Button>
          <Button variant="primary" icon="printer" disabled={busy || doc.fixtures.length === 0} onClick={() => void print()}>
            {t("Print…")}
          </Button>
        </>
      }
    >
      <div className="gv-printprev__bar">
        <Segmented<Choice>
          ariaLabel={t("What to print")}
          small
          value={choice}
          onChange={setChoice}
          options={[
            { value: "plan", label: t("Plan") },
            { value: "list", label: t("List") },
            { value: "both", label: t("Both") },
          ]}
        />
        <span className="ts-muted gv-printprev__sizes">
          {showPlan ? t("Plan: A4 landscape") : ""}
          {showPlan && showList ? " · " : ""}
          {showList ? t("List: A4 portrait") : ""}
        </span>
      </div>
      <div className="gv-printprev" aria-label={t("Preview of the sheets")}>
        {doc.fixtures.length === 0 ? <p className="gv-printprev__empty">{t("There are no lights in this show yet.")}</p> : sheets}
      </div>
    </Dialog>
  );
}
