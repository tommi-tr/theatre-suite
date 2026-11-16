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
