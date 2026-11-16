import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./api";

/** Asks for a folder. Null if the person cancels. In the browser demo it returns an example path. */
export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  if (!isTauri) return "C:\\Teatro\\Esempio";
  const r = await open({ directory: true, multiple: false, title, defaultPath });
  return typeof r === "string" ? r : null;
}

/** Asks for an image file. Null if the person cancels. */
export async function pickImage(title: string): Promise<string | null> {
  if (!isTauri) return null;
  const r = await open({ multiple: false, title, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }] });
  return typeof r === "string" ? r : null;
}

/** Asks for a program file (an app's executable). */
export async function pickProgram(title: string): Promise<string | null> {
  if (!isTauri) return null;
  const r = await open({ multiple: false, title });
  return typeof r === "string" ? r : null;
}

/** Opens a web address (https) or a new e-mail (mailto) in the person's own browser or mail program. Nothing else. */
export async function openLink(url: string): Promise<void> {
  if (!/^(https:\/\/|mailto:)/i.test(url)) return;
  if (!isTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
