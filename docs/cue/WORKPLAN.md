# Cue — technical work plan (for developers and agents)

Read first: `docs/cue/13_cue.md` (the approved spec, Italian), `docs/cue/design/` (approved design preview + screenshots + measured details), this file. Granvelo is the closest existing app: copy its patterns (structure, demo mode, settings dialog, title bar, CI), never its code by duplication when it can be shared.

## Conventions (all phases)
- Monorepo: `apps/<app>` (Tauri 2 + React 19 + TypeScript 7 + Vite 8 + zustand), `crates/` (shared Rust), `packages/ui` (all styling/components/icons: `theme.css`, `components.tsx`, `icons.tsx`), `packages/core` (i18n, history, show/project helpers).
- **Graphics only from `packages/ui`**. Cue adds only its accent in `apps/cue/src/app.css` (`[data-app="cue"]`): Gesso — dark `--accent #E2DED4`, `--accent-ink #0E0F12`, `--accent-soft #2B2A26`, `--accent-line #4A4740`; light `--accent #4B4840`, `--accent-ink #FFFFFF`, `--accent-soft #ECEAE4`, `--accent-line #CFCBC2`; logo colour `--logo-a #77726A`. Department colours (type marks only, never fills): lights magenta (Granvelo accent: dark #F06FCF / light #A3218A), audio indigo (Diaframma accent: dark #8E80FF / light #5442E0), projections cyan (dark #4CD6E6 / light #0A7886). Green/amber/red/blue are states and are never redefined. A component needed by two apps goes in `packages/ui`.
- Logo: `CUE_LOGO` in `packages/ui/src/icons.tsx` (use `AppLogo accentPath="" accentDots={CUE_LOGO.dots} inkPath={CUE_LOGO.ink} strokeWidth={CUE_LOGO.stroke(size)}`).
- Texts: keys are the English strings, Italian in `apps/cue/src/i18n/it*.ts` (like Granvelo). Italian is the default. "Show" as mode name needs a distinct key from "Show" = "Mostra" (see Granvelo). A vitest test checks every key has a translation and no English string is translated two ways.
- Default theme dark. Reference screen 1366×768, usable at 1280×720.
- `/?demo` in the browser (`vite build` + `vite preview --port 1425`) must show a demo show ("La locandiera / Serata.tcue") with simulated outputs; every phase must be checkable there with screenshots (Playwright, 1366×768).
- Tests: vitest for TS models; `cargo test` for crates. Commands: `pnpm -r typecheck`, `pnpm --filter cue exec vitest run`, `cargo test -p audio-engine -p dmx-engine -p cue`.
- Diaframma and Granvelo must keep identical behaviour: `pnpm --filter granvelo exec vitest run`, `cargo test -p granvelo --lib`, `cargo test -p diaframma`, typecheck all.
- Commits in English, author `Claude <noreply@anthropic.com>`, message ending with the two trailer lines given by the director. Never commit secrets or real data. Never two file names differing only by case.
- Every delivered version bumps: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, the package line in `Cargo.lock` (and the launcher's fake version in `src/lib/demo.ts`).
- Linux needs `CARGO_TARGET_DIR=/home/claude/target-shared` (shared, saves rebuilds; cargo locks it, so builds serialize — be patient, 2 CPUs).
- **Arduino pedal is postponed**: the UI shows only "Prossimamente" (Settings → Tasti → Pedale card; Controlli → Pedale card). F13 is still accepted as a GO key (so a pedal that already sends F13 works), but no Arduino docs/firmware now.

## Architecture
### Rust
- `crates/audio-engine`: Diaframma's engine (core, dsp, decode, model, selftest, the `Engine` type) without Tauri: events go through a sink trait/closure (`Fn(&str, serde_json::Value)`) supplied by the app. Diaframma keeps its `#[tauri::command]` wrappers.
- `crates/dmx-engine`: Granvelo's engine (core, driver, discovery, engine, fade, hires, tests) without Tauri; Granvelo keeps its commands.
- `apps/cue/src-tauri`: `storage.rs` (.tcue zip: open, read part, atomic save copying unchanged entries raw, autosave + crash recovery, versions in `<Name>.versions/`, settings), `audio.rs` (commands over `audio-engine`), `dmx.rs` (commands over `dmx-engine`), `net/` (phase 3), `projection.rs` (phase 4, second window), `ppt.rs` (phase 4, PowerPoint via a persistent PowerShell COM helper, Windows only), `power.rs` (keep Windows awake while open: `SetThreadExecutionState`), `files.rs` (read `.diaframma` / `.granvelo` / Bardo files as text, sha256 of video files, relative paths).
- Single-instance plugin, except when started with `--instance <n>` (development/test of two instances on one computer: separate settings/autosave folder and network port offset). Document this in `docs/cue/README.md`.

### TypeScript
- `packages/show-files` (`@theatre-suite/show-files`): readers of the other apps' files shared with them — Granvelo (types, file parse/validate, universe computation from a memory, fade times) and Diaframma (types, file parse, track → engine params). Granvelo and Diaframma import from it (their old modules may re-export so imports stay stable). Their tests stay green.
- `apps/cue/src`: `shell/` (title bar, mode selector Prepara · Proiezioni · Controlli · Show, Settings), `model/` (pure, tested: `.tcue` show model, GO ordering/merging, anchors, timeline layout, standby logic, request protocol), `store/` (zustand), `lib/` (Tauri wrappers, each with a browser simulation for `/?demo`), `modes/<mode>/`, `script/` (PDF rendering with pdf.js), `i18n/`.

### `.tcue` format 1 (zip)
- `show.json`: `{ format: "theatre.cue", formatVersion: 1, id, title, script, sources, gos, notes, speedZones, layout, projection, checklist, settings, ... }`; unknown fields kept on save. Exact schema written in `docs/cue/FORMAT.md` by phase 0 and extended (still format 1, no compatibility needed before publication) in later phases.
- `script.pdf`, `thumbs/<id>.jpg`, `images/<id>.<ext>`. Videos stay outside (relative path + sha256).
- References to other apps' items: `{ sourceId, itemId }` where the source is `{ id, app, path (relative to the .tcue), docId? }` and `itemId` is the stable id of the memory/track (Granvelo memories must have a stable id: verify in phase 0).

## Phases
- **0 (0.1.0)**: engines to crates; `packages/show-files`; `packages/ui` gets Granvelo's "command with key" bottom-bar items, the output status pill, the red "cable unplugged" band (Granvelo uses them from there); Cue skeleton (title bar, modes with empty states, Settings with all categories, `.tcue` new/open/save/autosave/recover/versions, demo, icons, CI `.github/workflows/cue-windows.yml`); launcher knows Cue (fifth Gesso stroke in its icon, app list, creates `.tcue` documents, Theatre Suite page with 5 apps in a 3-column grid with a sixth quiet card "Altre app in arrivo" linking to "Scrivici"). Diaframma 0.3.2, Granvelo 0.6.1, launcher 0.4.4.
- **1 (0.2.0)**: script: import PDF into the .tcue, pdf.js pages, scroll/zoom keys, peek (Ctrl held), white/dark paper with brightness, notes column, anchors (page + y + surrounding text), replace script with anchor relocation preview, draggable divider.
- **2 (0.3.0)**: sources (link .diaframma/.granvelo files), libraries in Prepara, drag to create GOs, merged GOs, selected-GO panel, timeline columns + lines + buttons (design rules in 13), standby/GO/back, engines driven by Cue (audio-engine + dmx-engine), safety commands, keys + conflict check, Lock, auto scroll with speed zones + "Segui", F13 as GO.
- **3 (0.4.0)**: primary/secondary over UDP/TCP on the direct cable (pairing 6-digit code, HMAC-SHA256 signed messages, heartbeat 100 ms, requests with ack/retry, file transfer + sha256, assigned GOs, reservation with C, coloured border/panel, unavailable veil, chat, remote pointer, optional Wi-Fi backup with dedup). Tested with two instances on one computer.
- **4 (0.5.0)**: projections window on second screen, sequence/transitions/colour/blank image, video, PowerPoint import (PDF of slides → images; or via PowerPoint COM export) and live control.
- **5 (0.6.0)**: Controlli + checklist, on-the-fly edits and end of show, evening log + report, Bardo as source, dry run, reliability tests, polish, "Come provare".
