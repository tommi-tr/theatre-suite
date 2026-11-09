# Bardo

Bardo writes theatre scripts. You write the text; Bardo lays out the pages
while you type, numbers acts and scenes, and keeps lists and indexes up to date.

## Three phases

- **Compose** – the page in the middle, the structure on the left, the
  sheets (Title, Characters, Cast and crew…) on the right of the page.
  A character's name at the start of a line + **Tab** makes a speech.
  `Ctrl+1…6` marks a word as character, prop, light, sound…
- **Format** – choose a model (top left: Classico, Contemporaneo, Leggio,
  Dattiloscritto, or yours). Any change makes it "Customised"; save it as a
  model to use it in every script. Click a part of the examples to change
  its style for the whole script.
- **Send** – PDF (exactly the pages on screen), Word, LibreOffice, text or a
  clean Bardo copy. A copy for one actor highlights their speeches; a copy for
  a department highlights its category. The version number is in the file name.

## Files

- `.bardo` is JSON: the text, the script data and the earlier versions
  (compressed). Exports contain only the current text.
- Autosave every ~2 s in Bardo's own data folder; after a crash the work
  comes back.

## Import

`File → Import from Word or text…` reads `.docx` and `.txt`. It recognises
"ATTO PRIMO", "Scena II", "AMLETO: …", a name in capitals alone on a line,
stage directions in brackets or italics, and a "Personaggi" list. It uses
rules and statistics, not AI, and runs on the computer.

## Code map (`apps/bardo/src`)

| Folder | What |
|---|---|
| `model/` | schema, script data, numbering, index of the script, lists, file format |
| `editor/` | ProseMirror plugins: pagination, autocomplete, keys, commands, automatic blocks |
| `compose/`, `format/`, `send/` | the three phases |
| `send/export*.ts` | neutral export model → Word, OpenDocument, text |
| `send/PrintView.tsx` | copies the pages on screen for PDF and printing |
| `lib/importer.ts` | import from Word or text |
