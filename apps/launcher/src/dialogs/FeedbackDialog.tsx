import { useEffect, useState } from "react";
import { useT } from "@theatre-suite/core";
import { Button, Dialog, Segmented } from "@theatre-suite/ui";
import { api } from "../lib/api";
import { APPS } from "../lib/apps";
import { FEEDBACK_EMAIL, MAILTO_LIMIT, type FeedbackKind, feedbackBody, feedbackSubject, issueUrl, mailtoUrl, techInfo } from "../lib/feedback";
import { openLink } from "../lib/pick";
import { useStore } from "../state/store";

const close = () => useStore.getState().setDialog(null);

/**
 * Feedback from the first users. Nothing is sent from here: the mail program (or the GitHub page)
 * opens with the text ready, or the text is copied. The person decides what happens next.
 */
export function FeedbackDialog({ app }: { app?: string }) {
  const t = useT();
  const apps = useStore((s) => s.apps);
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [about, setAbout] = useState(app ?? "suite");
  const [message, setMessage] = useState("");
  const [withInfo, setWithInfo] = useState(true);
  const [info, setInfo] = useState("");

  useEffect(() => {
    void api.appInfo().then((i) => setInfo(techInfo(apps, i))).catch(() => {});
  }, [apps]);

  const kindLabel = kind === "idea" ? t("Idea") : kind === "problem" ? t("Problem") : t("Question");
  const aboutLabel = about === "suite" ? t("Whole suite") : (APPS.find((a) => a.id === about)?.name ?? about);
  const subject = feedbackSubject(kindLabel, aboutLabel);
  const body = feedbackBody(message, withInfo && info ? info : null);
  const empty = message.trim().length === 0;
  const mailUrl = FEEDBACK_EMAIL ? mailtoUrl(subject, body) : "";
  const tooLongForMail = mailUrl.length > MAILTO_LIMIT;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      useStore.getState().showToast(t("Text copied."));
    } catch {
      useStore.getState().showToast(t("The text could not be copied."), "error");
    }
  };

  return (
    <Dialog
      title={t("Send feedback")}
      icon="message"
      width={560}
      onClose={close}
      description={t("Your ideas and the problems you find help make the apps better. Write what you like: no technical words needed.")}
      footer={
        <>
          <Button onClick={close}>{t("Close")}</Button>
          <Button icon="copy" disabled={empty} onClick={() => void copy()}>{t("Copy the text")}</Button>
          <Button icon="link" variant={FEEDBACK_EMAIL ? "tool" : "primary"} disabled={empty} onClick={() => void openLink(issueUrl(subject, body))}>
            {t("Write it on GitHub")}
          </Button>
          {FEEDBACK_EMAIL ? (
            <Button variant="primary" icon="message" disabled={empty || tooLongForMail} title={tooLongForMail ? t("The message is too long for an e-mail: use “Copy the text”.") : undefined} onClick={() => void openLink(mailUrl)}>
              {t("Send by e-mail")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="ln-form">
        <div className="ln-setting">
          <div><strong>{t("What is it?")}</strong></div>
          <Segmented<FeedbackKind>
            ariaLabel={t("What is it?")}
            value={kind}
            onChange={setKind}
            options={[
              { value: "idea", label: t("Idea") },
              { value: "problem", label: t("Problem") },
              { value: "question", label: t("Question") },
            ]}
          />
        </div>
        <label className="ln-field">
          <span className="ln-field__label">{t("What is it about?")}</span>
          <select className="ln-input" value={about} onChange={(e) => setAbout(e.currentTarget.value)}>
            <option value="suite">{t("Whole suite")}</option>
            {APPS.filter((a) => !a.soon).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="ln-field">
          <span className="ln-field__label">{t("Your message")}</span>
          <textarea
            className="ln-input ln-textarea"
            rows={6}
            autoFocus
            value={message}
            placeholder={kind === "problem" ? t("What were you doing, what did you expect and what happened instead?") : t("Write here…")}
            onChange={(e) => setMessage(e.currentTarget.value)}
          />
        </label>
        <label className="ln-check">
          <input type="checkbox" checked={withInfo} onChange={(e) => setWithInfo(e.currentTarget.checked)} />
          <span>{t("Add the versions of the apps and of Windows, so I can reproduce the problem")}</span>
        </label>
        {withInfo && info ? <pre className="ln-info">{info}</pre> : null}
        <p className="ln-privacy">
          {t("Nothing is sent from here. Your mail program (or the GitHub page) opens with the text ready, and you decide whether to send it.")}{" "}
          {t("On GitHub the message is public: don't write passwords or private data.")}
        </p>
      </div>
    </Dialog>
  );
}
