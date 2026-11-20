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

- **Atomic**: the new zip is written to `<file>.tcue.tmp` next to the file, flushed (`fsync`) and renamed over
  the old file. If anything fails, the temporary file is removed and the old file is untouched.
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
- Autosave (Cue's data folder, `autosave/session.json`): `{ savedAt, filePath, dirty, showJson }` within ~1.5 s
  of a change. A `session.lock` marks a running session; if it is still there at the next start, Cue offers
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
| `id` | string (32 hex) | generated if missing | used |
| `title` | string | `""` | used |
| `savedWith` | `{ app, version }` | — | used (written at each save) |
| `script` | `Script` \| `null` | `null` | planned, phase 1 (Bardo: phase 5) |
| `sources` | `Source[]` | `[]` | planned, phase 2 |
| `gos` | `Go[]` | `[]` | planned, phase 2 |
| `notes` | `Note[]` | `[]` | planned, phase 1 |
| `speedZones` | `SpeedZone[]` | `[]` | planned, phase 2 |
| `layout` | `Layout` | `{ scriptWidth: null, audioBoxHeights: {} }` | planned, phases 1–2 |
| `projection` | `Projection` | `{ blank: { kind: "black" }, screen: null, items: [] }` | planned, phase 4 |
| `checklist` | `ChecklistItem[]` | `[]` | planned, phase 5 |
| `settings` | `ShowSettings` | `{ autoScrollSpeed: 1, ftbSeconds: 5 }` | planned, phase 2 |

### Shapes

```ts
// A point of the script.
Anchor = { page: number /* from 1 */, y: number /* 0 top … 1 bottom */,
           text?: { before: string, exact: string, after: string } /* to relocate on "Sostituisci copione" */,
           lineId?: string /* Bardo line id */ }

Script = { kind: "pdf", part: "script.pdf", name: string /* original file name */, pages: number, sha256: string }
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
Layout = { scriptWidth: number | null /* px */, audioBoxHeights: { [actionId]: number /* px */ } }

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
