# Cantinella — architecture overview

Production of a show: rehearsals, budget, departments and contacts, tour, calendar.
Specification and decisions live in the project documents (`09_cantinella.md`); this page
explains how the code is organised.

## Layout

```
apps/cantinella/
├─ src-tauri/          native side: files only (atomic writes, autosave, crash recovery)
├─ tools/make_icons.mjs  app icons from the "Telaio" geometry (pnpm --filter cantinella icons)
└─ src/
   ├─ model/           the document, pure functions with tests (vitest)
   │  ├─ types.ts      format 1: { format, formatVersion, app, savedAt, data }
   │  ├─ file.ts       parse / serialize; unknown fields of `data` are kept (`extra`)
   │  ├─ contacts.ts   vCard and CSV import (phone exports, Google, Outlook, spreadsheets)
   │  └─ demo.ts       "La locandiera", used by /?demo
   ├─ store/           zustand: doc (data + undo history), settings, ui (section, parts, dialogs)
   ├─ shell/           frame "C": section bar on top, parts on the left, start screen, status bar
   ├─ sections/        the parts; in 0.1 only the address book (People.tsx) is real
   ├─ common/          file menu, dialogs (settings, import, copy the list, delete)
   └─ lib/             Tauri calls, open/save/autosave, version
```

## Rules

- **Format 1 only** until the suite is published (`00_indice_e_stato.md`): any other number is
  refused with a clear message. The launcher creates new documents in the same format
  (`crates/theatre-project/src/apps.rs`, test `new_cantinella_document_is_in_the_current_format`).
- Every element that may be linked (people now; dates, scenes, costs later) has a stable `id`.
- The data of a section that arrives later is stored as a new key of `data`; older versions of
  Cantinella keep keys they do not know (`extra`).
- Undo: snapshots of the whole document (`History` from `@theatre-suite/core`); typing in the same
  field within 1.2 s is one step.
- Show: if the file sits in a show folder (`progetto.theatre` next to it) the title bar shows
  the show name and colour (`TitleBar` with `show`, `parseShowIndex` in `@theatre-suite/core`).
- Nothing leaves the computer: no network calls; copying is done with the clipboard on request.

## Commands

```
pnpm --filter cantinella dev          # interface in the browser; add /?demo for sample data
pnpm --filter cantinella test         # model tests
pnpm --filter cantinella typecheck
pnpm cantinella:dev                   # the real app (Tauri)
cargo test -p cantinella --lib
```
