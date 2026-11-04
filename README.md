# Theatre Suite

A family of desktop apps for the theatre. Each app installs and runs on its own,
and all of them share the same look and the same building blocks.

| App | What it does | Status |
|---|---|---|
| **Diaframma** (`apps/diaframma`) | Sound cues for shows (GO with the space bar) and control of the audio players open on the computer during rehearsals | in development |

## Repository layout

```
apps/            one folder per app
packages/ui      shared visual identity: colours, fonts, icons, components
packages/core    shared logic: languages, themes, undo/redo, formatting
docs/            app specifications and decisions
```

## Requirements for development

- Node.js 22.12 or newer, pnpm 10 (`corepack enable`)
- Rust (stable) with the MSVC toolchain on Windows
- Windows 10/11 with WebView2 (already present on Windows 11)

```
pnpm install
pnpm diaframma:dev      # run Diaframma in development
pnpm diaframma:build    # build the Windows installer
```

## Installer

Every push builds a Windows installer with GitHub Actions
(workflow **Diaframma · Windows installer**). Open the run and download the
artifact **Diaframma-Windows-installer**.
