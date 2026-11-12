import type { AppsView } from "./types";

/**
 * Where feedback goes. Nothing is sent by the launcher itself: the person's own mail program
 * (or the GitHub page) opens with the text already written, and the person decides whether to send it.
 *
 * FEEDBACK_EMAIL: leave empty to hide the e-mail button until an address is chosen.
 */
export const FEEDBACK_EMAIL = "";
export const FEEDBACK_ISSUES_URL = "https://github.com/tommi-tr/theatre-suite-releases/issues/new";

export type FeedbackKind = "idea" | "problem" | "question";

/** A mailto link longer than this is cut by some mail programs: the person is told to copy the text instead. */
export const MAILTO_LIMIT = 1800;

/** What the person sends along with the message, in plain words, so they can read it before sending. */
export function techInfo(apps: AppsView | null, info: { version: string; os: string }): string {
  const lines = [`Theatre Suite ${info.version} · ${info.os}`];
  const list = (apps?.apps ?? []).filter((a) => a.installed).map((a) => `${a.name} ${a.installed?.version ?? "?"}`);
  if (list.length > 0) lines.push(list.join(" · "));
  return lines.join("\n");
}

export function feedbackSubject(kindLabel: string, aboutLabel: string): string {
  return `[Theatre Suite] ${kindLabel} · ${aboutLabel}`;
}

export function feedbackBody(message: string, tech: string | null): string {
  return tech ? `${message.trim()}\n\n---\n${tech}` : message.trim();
}

export function mailtoUrl(subject: string, body: string): string {
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function issueUrl(subject: string, body: string): string {
  return `${FEEDBACK_ISSUES_URL}?title=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
