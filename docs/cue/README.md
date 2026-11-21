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
pnpm --filter cue exec vitest run    # show.json model, anchors, open show, dictionary (also: pnpm cue:test)
cargo test -p cue --lib              # .tcue zip, atomic and concurrent saves, staged parts, export, versions
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

### Step by step: primary and secondary on one computer

1. Open a terminal in the project folder and run `pnpm --filter cue tauri dev`. The first window is **instance 1**
   (title bar "Cue"). A debug build accepts 127.0.0.1, so no cable and no second computer are needed.
2. Open a second terminal and start the same program with a number: `<target dir>/debug/cue --instance 2`
   (Windows: `target\debug\cue.exe --instance 2`). The title bar of the second window says "Cue · Istanza 2".
   An installed (release) Cue has no loopback on instance 1: start both copies with `--instance 2` and `--instance 3`.
3. **Instance 1**: Settings (Ctrl+,) -> Collegamento -> choose **Primario**. Read the Windows firewall card, press
   "Ho capito, attiva", and in the Windows window choose **Reti private** -> Consenti. A 6-digit code appears.
4. **Instance 2**: Settings -> Collegamento -> **Secondario** (same firewall card). Under "Primario trovato" the name
   of instance 1 appears within a second; type the code and press "Abbina". The first time takes about a second.
5. Open a show on instance 1 (save it first: only a saved `.tcue` can be sent). Instance 2 receives it by itself
   and opens it in Show, with the banner "Spettacolo ricevuto dal primario".
6. Both title bars now have a 6 px green border in Show and the right panel reads "Connesso · 0,4 ms".
   Try: Space on instance 2 (the GO runs on instance 1 and shows on both), hold C on either (blue standby and band,
   grey "Prenotato dal ..." on the other), "Togli i comandi" on the primary, "Non disponibile" on the secondary,
   the chat, an edit in Prepara on the secondary (it appears on the primary after a moment).
7. Close instance 1 (or choose "Nessuno"): instance 2 turns red, "Il primario non risponde". Start it again and the
   secondary reconnects by itself, without a code (the pairing is remembered; "Dimentica" removes it on both).

Without Tauri: `pnpm --filter cue dev` and open `http://localhost:1425/?demo&link=stable` (also `unstable`, `backup`,
`lost`, `unavailable`, `pairing`; add `,secondary`, `,reserved-me`, `,reserved-other`, `,taken`) to see every state
without a network. `cargo test -p cue --test link` runs the network core automatically.

## Notes

- While Cue is open Windows does not sleep and the screen stays on (`src-tauri/src/power.rs`,
  `SetThreadExecutionState`); the request ends with the process.
- Icons: `pnpm --filter cue icons` (geometry of `CUE_LOGO` in `packages/ui`).
- Script rendering: `pdfjs-dist` (worker bundled with `?url`; CMaps, standard fonts, wasm decoders and ICC profiles
  are served from the app under `/pdfjs/…`, see `vite.config.ts`: no network). Code in `src/script/`.
- Demo script: `pnpm --filter cue demo-pdf` regenerates `public/demo/locandiera.pdf` (Goldoni, public domain;
  `pdf-lib`). `node tools/make_demo_pdf.mjs --edition 2 /tmp/ed2.pdf` makes a revised edition to try
  "Sostituisci copione" (one note is not found, the others are).
- CI: `.github/workflows/cue-windows.yml` (installer artifact `Cue-Windows-installer`, release on `cue-v*` tags).
