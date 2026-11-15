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
   │  ├─ contacts.ts   vCard and CSV import and export
   │  ├─ rehearsals.ts dates, answers, Italian date words, messages
   │  ├─ replies.ts    reading pasted WhatsApp replies
   │  ├─ scenes.ts     scenes, characters, who is needed; reading a Bardo script (read only)
   │  ├─ plan.ts       the rehearsal plan (deterministic), warnings, plan messages, .ics events
   │  ├─ budget.ts     costs (cents, VAT, kinds), sectors and seats, break-even, scenarios
   │  ├─ departments.ts departments, things to do, reports, what is due
   │  ├─ tour.ts       venues, technical sheet, travel, gear, call sheet, summary
   │  ├─ calendar.ts   one read-only list of events from every section
   │  ├─ ics.ts        calendar files
   │  └─ demo.ts       "La locandiera", used by /?demo
   ├─ store/           zustand: doc (data + undo history), settings, ui (section, parts, dialogs)
   ├─ shell/           frame "C": section bar on top, parts on the left, start screen, status bar
   ├─ sections/        one file per part (Dates, Availability, Scenes, Plan, Costs, Seats,
   │                   BreakEven, Departments, Reports, People, Venues, TourParts, Calendar)
   ├─ common/          file menu, dialogs (settings, import, copy the list, delete)
   ├─ i18n/            Italian dictionaries, one per group of parts; a test checks that every
   │                   t("…") and every *_LABELS table is translated, and never in two ways
   └─ lib/             Tauri calls, open/save/autosave, exports (save a text file, print), Bardo
```

## Rules

- **Format 1 only** until the suite is published (`00_indice_e_stato.md`): any other number is
  refused with a clear message. The launcher creates new documents in the same format
  (`crates/theatre-project/src/apps.rs`, test `new_cantinella_document_is_in_the_current_format`).
- Every element that may be linked (people, dates, scenes, characters, costs, venues…) has a
  stable `id`. Sections are keys of `data`: `people`, `rehearsals`, `budget`, `departments`, `tour`.
- Money is whole cents everywhere (`MoneyField`, `NetGrossField` in `packages/ui`).
- Bardo is only read: scenes and characters are linked by the ids written in the script, and a
  fingerprint of the file says when it has changed.
- Exports: text files are saved where the user chooses; PDF is the system print dialog
  (`printDoc`), so no PDF library is needed.
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
