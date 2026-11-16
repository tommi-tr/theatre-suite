# Launcher — how it is built

## Pieces

| Where | What |
|---|---|
| `crates/theatre-project` | The show model: `progetto.theatre`, folder scan, copy of a show, readiness check ("tutto pronto per la serata"), list of known shows, update comparison. No window code, fully tested. |
| `crates/launcher-core` | Launcher logic: settings, detection of installed apps, starting programs, weekly update check, cover images. Tested. |
| `apps/launcher/src-tauri` | The Tauri shell: commands the interface calls, window, file association `.theatre`, single instance. |
| `apps/launcher/src` | The interface (React + zustand). `lib/api.ts` calls the commands; outside Tauri it answers with sample data (`lib/demo.ts`). |

## The show file

`<show folder>/progetto.theatre` is JSON with `format: "theatre.project"` and `formatVersion`.
It lists the documents (id, app, title, relative path, phase), the cover
(`copertina.jpg` and/or a colour) and, for copies, the parent. Fields the launcher does not know
are kept when it saves. "Open everything for the show" opens the documents whose phase is `show`.
Files written by launcher 0.1 may still carry `inShow` / `archived` on documents: on reading, a
starred, non-archived document without a phase becomes `show` and both fields are dropped.
Writes are atomic (temporary file, then rename). If the index is damaged
it is set aside as `progetto.theatre.damaged` and rebuilt by scanning the folder.

## Copies

A copy is staged in `.<name>.copying` and renamed only when complete. Nested shows and symbolic
links are not followed. The copy gets a new id and remembers its parent.

## Updates and installing

Installers are published as releases of the public code repository `tommi-tr/theatre-suite`
(tags `<app>-v<semver>`, e.g. `launcher-v0.4.0`, `diaframma-v0.3.0`, `bardo-v0.2.0`; one Windows
`*-setup.exe` per release; drafts and pre-releases ignored). The separate repository
`theatre-suite-releases` is retired (16/11/2026): the app and the launcher no longer read it.

- **Check**: reads the list of releases (source in the settings, then the public repository),
  keeps every version of every app (`updates-cache.json`: `latest` + `releases`). Weekly at start
  if allowed (silent when offline), or "Check now". Checking never downloads anything.
- **Install** (only when the person presses Install and confirms): the installer is downloaded
  from `https://github.com/…` (redirects allowed), checked against the SHA-256 GitHub publishes
  for the asset when present, kept in `<data>/installers/<app>/<version>/` (so it can be
  installed again offline) and run: apps with `/S` (silent, per-user NSIS; closes the app if open),
  the launcher itself with its normal windows, after which the launcher exits.
- **Older versions**: every published version can be installed (Tauri NSIS allows downgrades).
- **Keep this version** (`settings.held`: app → version): no update is offered for that app while
  the installed version is that one.
- Publishing: pushing a tag `<app>-v<version>` makes the workflow of that app build the installer and
  publish the release in this same repository (built-in `GITHUB_TOKEN`, no secret needed).

## Home order

`settings.showSort`: `modified` (default), `name` or `custom` (`settings.showOrder`, show ids,
set by dragging cards; dragging switches to `custom`). `settings.production` (show ids): those shows
(or a show with a copy marked so) are listed first, under "In production".

## Exports of Bardo scripts

`crates/theatre-project/src/exports.rs`: files `.pdf .docx .odt .txt .rtf` in the show folder
(subfolders up to 3 levels, not nested shows) whose name starts with the script's file name, or
with "<title in the script> - ". Found at every look, never stored.

## Feedback

"Explore, install and update" → "Send feedback". Nothing is sent by the launcher: the text (kind,
app, message, optionally app versions and OS, always shown before use) opens in the person's mail
program (`FEEDBACK_EMAIL` in `src/lib/feedback.ts`, hidden while empty), as a new issue in the
public repository `tommi-tr/theatre-suite` (the default: no e-mail address is published; the dialog
warns that issues are public), or is copied.

## Installed apps

Windows: registry `Uninstall\<AppName>` (HKCU, then HKLM), then `%LOCALAPPDATA%\<Name>\<exe>`.
(`settings.appPaths` for a program chosen by hand still works but is no longer shown.)

## Not yet done

- App header band + show colour gradient inside the apps (design is in `docs/` of the project; apps need to read `progetto.theatre`).
- macOS build.
