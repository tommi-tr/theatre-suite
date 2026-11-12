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

## Updates

Sources: GitHub releases with tags `<app>-v<semver>` (drafts and pre-releases ignored), or a JSON
manifest `{schema, apps:{id:{version,url,notes}}}` at an https address. The source in the settings
is read first, then the public repository `tommi-tr/theatre-suite-releases`; the newest version of
each app wins and the check fails only if no source answers. It runs at most once a week, only at
launcher start, only if the user left it on and has read the first-run notice (errors are silent
there); "Check now" is always available. Nothing is ever downloaded or installed by the launcher.

A private repository answers 404 to the public releases API (the launcher reports it as
`NOT_FOUND`, shown as a sentence). Two ways out, either is enough: make `theatre-suite` public, or
create the public repository `theatre-suite-releases`, add to `theatre-suite` a secret
`RELEASES_TOKEN` (a token allowed to write releases there) and tag as usual: the workflow then
publishes each installer in both places.

## Feedback

"Explore, install and update" → "Send feedback". Nothing is sent by the launcher: the text (kind,
app, message, optionally app versions and OS, always shown before use) opens in the person's mail
program (`FEEDBACK_EMAIL` in `src/lib/feedback.ts`, hidden while empty), as a new GitHub issue in
the public releases repository, or is copied.

## Installed apps

Windows: registry `Uninstall\<AppName>` (HKCU, then HKLM), then `%LOCALAPPDATA%\<Name>\<exe>`.
The user can always point to the program by hand (Explore, install and update).

## Not yet done

- App header band + show colour gradient inside the apps (design is in `docs/` of the project; apps need to read `progetto.theatre`).
- macOS build.
