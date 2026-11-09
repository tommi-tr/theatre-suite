# Decisions

- 2026-11-04 · Monorepo with pnpm workspaces: `apps/*`, `packages/ui`, `packages/core`. One Cargo workspace at the root.
- 2026-11-04 · Shared UI written as plain React components + one CSS file of design tokens (no UI framework), so every app gets the same look with no extra weight.
- 2026-11-04 · i18n: tiny in-house helper (English text as key, Italian dictionary). No external library.
- 2026-11-04 · Fonts Geist / Geist Mono bundled through @fontsource (offline).
- 2026-11-04 · Windows installer: NSIS, per-user (no admin rights), WebView2 bootstrapper embedded.
- 2026-11-09 · Bardo: the page is an editable document (ProseMirror) paginated live with spacers; automatic blocks (title page, characters, lists) are written by Bardo from the script data.
- 2026-11-09 · Bardo: all non-text data (characters, categories, format…) lives in the document attributes, so undo covers it.
- 2026-11-09 · Bardo: old versions are kept gzip-compressed inside the .bardo file and are never exported.
- 2026-11-09 · Bardo: PDF = the pages on screen, printed by WebView2 PrintToPdf on Windows (system print window elsewhere). Word (.docx) and LibreOffice (.odt) use named paragraph styles and common system fonts.
- 2026-11-09 · Bardo: import of .docx/.txt by rules and statistics, no AI.
- 2026-11-09 · Bardo accent: copper (rame); icon: "battute".
