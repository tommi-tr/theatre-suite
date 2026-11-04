# Decisions

- 2026-11-04 · Monorepo with pnpm workspaces: `apps/*`, `packages/ui`, `packages/core`. One Cargo workspace at the root.
- 2026-11-04 · Shared UI written as plain React components + one CSS file of design tokens (no UI framework), so every app gets the same look with no extra weight.
- 2026-11-04 · i18n: tiny in-house helper (English text as key, Italian dictionary). No external library.
- 2026-11-04 · Fonts Geist / Geist Mono bundled through @fontsource (offline).
- 2026-11-04 · Windows installer: NSIS, per-user (no admin rights), WebView2 bootstrapper embedded.
