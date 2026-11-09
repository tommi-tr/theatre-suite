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
It lists the documents (id, app, title, relative path, phase, `archived`, `inShow`), the cover
(`copertina.jpg` and/or a colour) and, for copies, the parent. Fields the launcher does not know
are kept when it saves. Writes are atomic (temporary file, then rename). If the index is damaged
it is set aside as `progetto.theatre.damaged` and rebuilt by scanning the folder.

## Copies

A copy is staged in `.<name>.copying` and renamed only when complete. Nested shows and symbolic
links are not followed. The copy gets a new id and remembers its parent.

## Updates

Sources: GitHub releases with tags `<app>-v<semver>` (drafts and pre-releases ignored), or a JSON
manifest `{schema, apps:{id:{version,url,notes}}}` at an https address. The check runs at most
once a week, only at launcher start, only if the user left it on and has read the first-run notice;
errors are silent. Nothing is ever downloaded or installed by the launcher.
A private repository answers 404 to the public releases API: make releases public or point the
update source to a manifest.

## Installed apps

Windows: registry `Uninstall\<AppName>` (HKCU, then HKLM), then `%LOCALAPPDATA%\<Name>\<exe>`.
The user can always point to the program by hand (Installations and versions).

## Not yet done

- App header band + show colour gradient inside the apps (design is in `docs/` of the project; apps need to read `progetto.theatre`).
- macOS build.
