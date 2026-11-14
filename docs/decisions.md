# Decisions

- 2026-11-04 · Monorepo with pnpm workspaces: `apps/*`, `packages/ui`, `packages/core`. One Cargo workspace at the root.
- 2026-11-04 · Shared UI written as plain React components + one CSS file of design tokens (no UI framework), so every app gets the same look with no extra weight.
- 2026-11-04 · i18n: tiny in-house helper (English text as key, Italian dictionary). No external library.
- 2026-11-04 · Fonts Geist / Geist Mono bundled through @fontsource (offline).
- 2026-11-04 · Windows installer: NSIS, per-user (no admin rights), WebView2 bootstrapper embedded.
- 2026-11-09 · One launcher for the whole suite. A show is a folder with an index file `progetto.theatre` (JSON, versioned, unknown fields preserved). Apps stay separate programs; the launcher lists and opens their documents. No links between documents in the launcher for now.
- 2026-11-09 · Show model and launcher logic live in Rust crates (`theatre-project`, `launcher-core`) with tests, so they can be checked without compiling the Tauri window.
- 2026-11-09 · Copy of a show = new folder with all the files, nested in `Copie/` of the original or anywhere the user chooses; copies are listed inside the original's card.
- 2026-11-09 · Weekly update check: only looks, never downloads or installs; starts only after a first-run notice; the user can turn it off.
- 2026-11-09 · Bardo: the page is an editable document (ProseMirror) paginated live with spacers; automatic blocks (title page, characters, lists) are written by Bardo from the script data.
- 2026-11-09 · Bardo: all non-text data (characters, categories, format…) lives in the document attributes, so undo covers it.
- 2026-11-09 · Bardo: old versions are kept gzip-compressed inside the .bardo file and are never exported.
- 2026-11-09 · Bardo: PDF = the pages on screen, printed by WebView2 PrintToPdf on Windows (system print window elsewhere). Word (.docx) and LibreOffice (.odt) use named paragraph styles and common system fonts.
- 2026-11-09 · Bardo: import of .docx/.txt by rules and statistics, no AI.
- 2026-11-09 · Bardo accent: copper (rame); icon: "battute".
- 2026-11-14 · Cantinella: one JSON file per production (`.cantinella`, format 1), sections as keys of `data`, unknown keys kept. Frame "C": sections on top, parts on the left. Accent slate (ardesia), icon "Telaio".
- 2026-11-14 · Shared: `TitleBar` takes `show` (show name + colour band) and `version`; `StatusLight`, `CopyPreview` in `packages/ui`; show index reading and show colour in `packages/core` (`show.ts`), reused by the launcher.
