# Cue — developer notes

Cue is the stage manager's digital prompt book of the Theatre Suite (spec: `13_cue.md`, plan: `WORKPLAN.md`,
file format: `FORMAT.md`, approved design: `design/`). App: `apps/cue` (Tauri 2 + React 19 + TypeScript),
identifier `it.theatresuite.cue`, files `.tcue`, dev port **1425**.

## Run

```sh
pnpm install
pnpm --filter cue tauri dev          # the app, with hot reload (also: pnpm cue:dev)
```

Demo in a browser, without Tauri (fake show "La locandiera / Serata.tcue" in memory; files are not written):

```sh
cd apps/cue
npx vite build && npx vite preview --port 1425
# open http://localhost:1425/?demo        (the show)
#      http://localhost:1425/?demo&start  (the first screen)
```

## Tests

```sh
pnpm -r typecheck
pnpm --filter cue exec vitest run    # show.json model, dictionary (also: pnpm cue:test)
cargo test -p cue --lib              # .tcue zip, atomic save, raw copy, versions, --instance
```

On Linux set `CARGO_TARGET_DIR` to a shared folder to avoid rebuilding Tauri for every app.

## Two instances on one computer (`--instance <n>`)

Cue is single-instance: a second launch (a double click on a `.tcue`) hands the file to the running window.
Started with `--instance <n>` (n ≥ 2) it runs as a separate process instead, with its own data folder
(`<app data>/it.theatresuite.cue-<n>`: settings, autosave, crash marker) and its own webview data; the title
bar shows "Istanza n". Used from phase 3 to try primary and secondary on one computer.

```sh
pnpm --filter cue tauri dev                     # first terminal: instance 1 and the dev server on 1425
<target dir>/debug/cue --instance 2             # second terminal: the debug build uses the same dev server
```

(Windows: `target\debug\cue.exe --instance 2`.) An installed Cue accepts the same argument.

## Notes

- While Cue is open Windows does not sleep and the screen stays on (`src-tauri/src/power.rs`,
  `SetThreadExecutionState`); the request ends with the process.
- Icons: `pnpm --filter cue icons` (geometry of `CUE_LOGO` in `packages/ui`).
- CI: `.github/workflows/cue-windows.yml` (installer artifact `Cue-Windows-installer`, release on `cue-v*` tags).
