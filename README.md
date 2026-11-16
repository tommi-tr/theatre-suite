# Theatre Suite

A family of desktop apps for the theatre. Each app installs and runs on its own,
and all of them share the same look and the same building blocks.

| App | What it does | Status |
|---|---|---|
| **Theatre Suite launcher** (`apps/launcher`) | One place for the shows: each show is a folder; the launcher lists what was made for it with every app, opens it, copies a show for tour versions, and shows which apps and versions are installed | in development |
| **Diaframma** (`apps/diaframma`) | Sound cues for shows (GO with the space bar) and control of the audio players open on the computer during rehearsals | in development |
| **Cantinella** (`apps/cantinella`) | Production of a show: rehearsals and availability, budget, departments and contacts, tour, calendar. Local and offline | in development |
| **Bardo** (`apps/bardo`) | Writing scripts on live pages: speeches, stage directions, acts and scenes, characters and automatic lists; formatting models; PDF, Word, LibreOffice and text export | in development |

## Repository layout

```
apps/            one folder per app
packages/ui      shared visual identity: colours, fonts, icons, components
packages/core    shared logic: languages, themes, undo/redo, formatting
crates/          shared Rust code: the show model (`theatre-project`) and launcher logic (`launcher-core`)
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
pnpm launcher:dev       # run the launcher in development
pnpm launcher:build     # build the launcher installer
cargo test -p theatre-project -p launcher-core   # tests of the show model and launcher logic
pnpm bardo:dev          # run Bardo in development
pnpm bardo:test         # Bardo's tests
pnpm bardo:build        # build Bardo's Windows installer
pnpm cantinella:dev     # run Cantinella in development
pnpm cantinella:test    # Cantinella's tests
```

`pnpm --filter launcher dev` alone (no Tauri) opens the launcher interface in a normal
browser with sample data, handy for working on the layout.

## Download

Installers (Windows 10/11) are published as [releases](https://github.com/tommi-tr/theatre-suite/releases)
of this repository, one per app (`launcher-v…`, `diaframma-v…`, `bardo-v…`, `cantinella-v…`). The
launcher installs and updates the apps from there. The installers are not signed yet: Windows may
show "Windows protected your PC" (More info → Run anyway).

## Feedback

Ideas and problems are welcome as [issues](https://github.com/tommi-tr/theatre-suite/issues).
Issues are public: please don't write passwords or private data. The launcher has a
"Send feedback" window that opens a new issue with the text ready.

## License

No license has been chosen yet: for now the source is visible but all rights are reserved.

## Installer builds

Every push builds a Windows installer with GitHub Actions
(one workflow per app: **Diaframma · Windows installer**, **Bardo · Windows installer**,
**Launcher · Windows installer**, **Cantinella · Windows installer**). Open the run and
download the artifact (for example **Diaframma-Windows-installer**).
