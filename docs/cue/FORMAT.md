# Cue — the `.tcue` file, format 1

A `.tcue` file is one whole show: a **zip** archive with `show.json` and the parts the show owns.
Format 1 has no backward-compatibility promise until the first public release: later phases extend it
(still `formatVersion: 1`). Code: `apps/cue/src-tauri/src/tcue.rs` (zip, atomic save, versions) and
`apps/cue/src/model/show.ts` (types, defaults, parse/serialize).

## Zip layout

| Entry | Content | Compression | Since |
|---|---|---|---|
| `show.json` | the show (below), UTF-8 JSON, written first | deflate | phase 0 |
| `script.pdf` | the script or score (one PDF per show) | stored | phase 1 |
| `thumbs/<id>.jpg` | thumbnails (memories, videos, slides) | stored | phase 2 |
| `images/<id>.<ext>` | projection images and imported slides | stored | phase 4 |

- Part names: relative, `/` separators, ASCII letters, digits and `._-` only, no `..`, at most 200 characters.
  `show.json` is never a part.
- PDF, JPEG, PNG, WebP, GIF, MP4/MOV, ZIP/PPTX are **stored** (already compressed); anything else is deflated.
- **Videos stay outside** the file, in the show folder: path relative to the `.tcue` + SHA-256.
- Tracks and memories stay in the Diaframma / Granvelo files: referenced by source and stable item id.
- Readers ignore entries they do not know; writers copy them unchanged.

## Writing rules

- **Atomic**: the new zip is written to a temporary file next to the file with a name no other save uses
  (`<file>.tcue.<pid>-<n>.tmp`), flushed (`fsync`) and renamed over the old file (on Windows the rename is retried
  a few times if an antivirus holds the file). Saves of the same file inside Cue take turns (one lock per path),
  and the interface runs one save at a time (a held Ctrl+S saves once). If anything fails, the temporary file is
  removed and the old file is untouched.
- **Raw copy**: entries that do not change are copied with their compressed bytes (`raw_copy_file`): never
  recompressed, byte-identical across saves.
- `tcue_save(path, sourcePath, showJson, addParts, removeParts)`: `sourcePath` is the file unchanged parts come
  from (the file itself; the old file on "Save as"; none for a new show). `showJson: null` keeps the source's
  `show.json` byte for byte. `addParts` items are `{ name, data }` (base64) or `{ name, fromPath }` (a file on
  disk, copied by the native side — the way a big PDF gets in).
- Errors come back as `code: detail` (`not-zip`, `not-cue`, `newer`, `damaged`, `io`, `bad-part`, `no-part`);
  the interface turns the code into a sentence.

## Versions and recovery

- Versions are whole copies in `<Name>.versions/` next to the file (`Serata.tcue` → `Serata.versions/`), named
  `YYYY-MM-DD_HHMMSS[_auto].tcue`. Their `show.json` carries two extra fields, `versionKind` (`"named"` |
  `"auto"`) and `versionNote`, removed when a version is restored. Automatic versions: before the first save of
  a session over an existing file and before going back to a version; the newest 30 are kept.
- Autosave (Cue's data folder, `autosave/session.json`): `{ savedAt, filePath, dirty, showJson, pendingParts }`
  within ~1.5 s of a change. **Pending parts**: a part added since the last save (a new script PDF) is copied at
  once into `autosave/parts/<random>-<part>` and listed in `pendingParts` (`{ "script.pdf": "<staged path>" }`);
  the next save copies it into the zip (`fromPath`) and removes the staged copy. Recovery takes the staged copies
  back, so a script loaded and not yet saved survives a crash. The autosave and its staged parts are removed on a
  clean exit or when the show is closed. A `session.lock` marks a running session; if it is still there at the next start, Cue offers
  "Recupera". With `--instance <n>` (n ≥ 2) the data folder is `<data folder>-<n>`.

## `show.json`

```json
{ "format": "theatre.cue", "formatVersion": 1, "id": "…", "title": "…" }
```

This minimal object — exactly what the launcher creates — is a valid show. Every other field is optional and
gets its default. **Unknown fields are preserved** on save, at the top level and inside every item (a GO, a
source, an action…): the model lays the known fields over the raw object instead of rebuilding it.

Known fields (status: **used** = read/written by the current version, otherwise *planned, phase N*):

| Field | Type | Default | Status |
|---|---|---|---|
| `format` | `"theatre.cue"` | — | used (required) |
| `formatVersion` | `1` | — | used (required; higher = "newer Cue", refused) |
| `id` | string (any non-empty string: Cue writes 32 hex digits, the launcher a 36-character UUID) | generated if missing | used |
| `title` | string | `""` | used |
| `savedWith` | `{ app, version }` | — | used (written at each save) |
| `script` | `Script` \| `null` | `null` | used (PDF; Bardo: phase 5) |
| `sources` | `Source[]` | `[]` | planned, phase 2 |
| `gos` | `Go[]` | `[]` | planned, phase 2 |
| `notes` | `Note[]` | `[]` | used |
| `speedZones` | `SpeedZone[]` | `[]` | planned, phase 2 |
| `layout` | `Layout` | `{ scriptWidth: null, audioBoxHeights: {} }` | `scriptWidth` used; `audioBoxHeights` phase 2 |
| `projection` | `Projection` | `{ blank: { kind: "black" }, screen: null, items: [] }` | planned, phase 4 |
| `checklist` | `ChecklistItem[]` | `[]` | planned, phase 5 |
| `settings` | `ShowSettings` | `{ autoScrollSpeed: 1, ftbSeconds: 5 }` | planned, phase 2 |

### Shapes

```ts
// A point of the script (apps/cue/src/model/anchor.ts).
Anchor = { page: number /* from 1 */, y: number /* 0 top … 1 bottom */, x?: number /* 0 left … 1 right */,
           quote: string /* the line nearest to the point; "" on a page without text */,
           before: string, after: string /* ~80 characters of text before and after the quote */,
           lineId?: string /* Bardo line id, phase 5 */ }

Script = { kind: "pdf", part: "script.pdf", fileName: string /* original file name */,
           sha256: string /* of the PDF */, pageCount: number }
       | { kind: "bardo", sourceId: string }

// A file of another app, path relative to the .tcue.
Source = { id: string, app: "granvelo" | "diaframma" | "bardo", path: string, docId?: string, name?: string }
ItemRef = { sourceId: string, itemId: string }   // stable id of the memory / track

Go = { id: string, anchor: Anchor, actions: Action[],
       givenBy: "both" | "primary" | "secondary" /* default "both" */,
       auto?: boolean /* starts by itself after the previous one */, note?: string }
Action = { id: string, kind: "light" | "audio" | "projection" | "powerpoint",
           ref?: ItemRef /* light, audio */, projectionItemId?: string,
           powerpoint?: "next" | "previous" | number,
           times?: { fade?: number, delay?: number } /* seconds, override the source file */, levelDb?: number }

Note = { id: string, anchor: Anchor, text: string }
SpeedZone = { id: string, from: Anchor, fromGoId?: string, speed: number /* × general speed, 0.05–20 */ }
Layout = { scriptWidth: number | null /* fraction 0.2–0.8 of script + columns; null = default 0.46 */,
           audioBoxHeights: { [actionId]: number /* px */ } }

Projection = { blank: { kind: "black" } | { kind: "image", part: string }, screen: string | null, items: ProjectionItem[] }
ProjectionItem = { id: string, kind: "image" | "video" | "slide", name: string,
                   part?: "images/<id>.<ext>", path?: string /* video, relative */, sha256?: string,
                   transition: { kind: "cut" } | { kind: "dissolve" | "throughBlack", seconds: number },
                   color?: { brightness, contrast, temperature, saturation }, atEnd?: "hold" | "black" | "next" }

ChecklistItem = { id: string, text: string, done: boolean, origin: "suggested" | "user" }
ShowSettings = { autoScrollSpeed: number /* lines per second */, ftbSeconds: number }
```

GO order is the order of the script (page, then `y`). How GOs are numbered (derived from the order, or a
stored label such as `14.5`) is decided in phase 2; until then no number is stored.

### The script (phase 1)

- One PDF per show, the part `script.pdf` (stored, never recompressed, never modified by Cue). `script.sha256` is the
  SHA-256 of the PDF, `pageCount` its pages. "Esporta il PDF" writes it out unchanged.
- **Anchors** tie notes (and GOs, speed zones) to the script: page and height place them; `quote`, `before`,
  `after` find them again. "Sostituisci copione" looks for every anchor in the new PDF (words normalised: case,
  accents, punctuation, typographic quotes, words broken at line ends), scores quote (60%) and context (20% + 20%)
  and gives each a confidence: **sure** (applied by default), **uncertain** (amber, unticked, other places to pick
  from) or **not found** (keeps page and height). Nothing changes until the user applies the preview.
- `notes`: `{ id, anchor, text }`, shown in the Notes column left of the script (only when there are notes).

