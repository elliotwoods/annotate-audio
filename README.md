# Cue Timeline

A browser-based timeline editor for authoring show / lighting cues against a single
audio track. Cues live in blocks on stacked rows, snapped to a bar grid derived from a
detected (and fully hand-correctable) constant BPM. Client-side core (deployable to any
static host), with optional cloud sharing on Vercel + Cloudflare R2 (see below). Built per
[`specs.md`](./specs.md).

## Features (v1)

- **Load one audio file** (FLAC / OGG / M4A) via the file picker **or by dragging it
  anywhere onto the window** (a dropped `.cuetl.json` imports a project instead).
- **Constant-BPM beat grid** — auto-detected *and* fully manual (numeric BPM, downbeat
  offset with "set to playhead" + ±5 ms nudge, tap tempo, time signature).
- **Waveform display** (summed mono peak strip) with horizontal zoom & scroll, computed
  off the main thread in a peaks worker.
- **Dual ruler** — a bars/beats row and a time (mm:ss) row, both with adaptive tick
  density so labels never collide at any zoom.
- **Resizable row-header column** (drag the divider; double-click to reset) so long cue
  names aren't truncated; the width is remembered across reloads.
- **Stacked cue rows** aligned to the waveform on a shared time axis. Two fixed rows —
  **Track** and **Section** — then user-defined cue rows with per-row lucide icon & colour.
- **Row groups (folders)** — organize cue rows into named, collapsible, colour-coded
  folders that nest arbitrarily. Reorganize by dragging the grip handle in the gutter
  (drop between rows to reorder, onto a folder header to nest); collapsing a folder hides
  its rows. Track/Section stay pinned at the top.
- **Prep-cue column** — a resizable left-hand column for a per-row "prep cue": the state
  each row should be in before the scene starts. Multi-line; the row grows to fit it.
- **Blocks** are ranged (start → end) by default; double-click for a zero-length **point
  cue**. Create / move / resize / label / delete; overlap allowed. **Multi-line labels**:
  Shift+Enter adds a line (Enter commits, Esc cancels) and the row auto-grows to fit the
  tallest label.
- **Snap** to bar / ½ / ¼ / ⅛ bar / off; hold **Alt** to disable snapping mid-drag.
- **Transport** — play / pause / stop, free click-scrub, and quantised jump to prev/next
  bar and prev/next section; bars:beats + mm:ss.mmm readout; follow-playhead; zoom/fit.
- **Navigation** — pan by dragging with the right or middle mouse button, horizontal
  trackpad scroll, Ctrl/⌘+wheel to zoom at the cursor, plus the keyboard shortcuts below.
- **Undo / redo** across content edits (zundo).
- **Persistence** — JSON project export/import (`*.cuetl.json`) **and** in-browser
  IndexedDB autosave, including a cache of the original audio blob (keyed by content hash)
  so reopening a project doesn't require re-importing the file.

## Tech stack

Vite · React 18 · TypeScript (strict) · Zustand (+ zundo) · lucide-react · idb ·
essentia.js (BPM detection, in a Web Worker) · Web Audio API.

## Getting started

```bash
npm install
npm run dev        # start the dev server
npm run build      # typecheck (tsc -b) + production build to dist/
npm run preview    # preview the production build
npm test           # run the unit tests (grid math, transform, store)
```

## Architecture

```
UI (React)  ──reads/writes──▶  Zustand store (project · view · playback)
   │                                  │
   │                          ┌───────┴────────┬─────────────────┐
   ▼                          ▼                ▼                 ▼
Timeline layers          AudioEngine        Grid (pure)      Persistence
(Ruler/Waveform/Lanes)   decode·play·seek   bpm/snap/bars     JSON · IndexedDB
   uses ONE transform     │                                   │
   (core/transform.ts)    ├─ Peaks worker (min/max downsample)
                          └─ BPM worker (essentia.js: Percival + Rhythm2013)
```

- **Single source of time.** One coordinate transform (`src/core/transform.ts`,
  `timeToX` / `xToTime`) is shared by the ruler, waveform canvas, lane DOM, and playhead,
  so everything stays pixel-aligned under zoom/scroll. No view computes its own mapping.
- **Seconds are canonical.** Blocks store seconds, not bar positions. Correcting the
  BPM/offset moves the gridlines but leaves blocks glued to their audio positions; an
  explicit **"Re-snap all to grid"** command pulls them onto the new grid when wanted.
- **Hybrid rendering.** Waveform + bar grid + ruler are `<canvas>`; cue lanes, blocks, and
  the playhead are absolutely-positioned DOM (simpler hit-testing, editing, a11y).

Source layout: `core/` (pure transform + grid + ids/hash), `model/` (types + defaults),
`store/` (Zustand store + selectors), `audio/` (engine, transport, workers, load
orchestration), `persistence/` (idb, JSON, autosave), `ui/` (components), `hooks/`.

## ⚠️ License note — essentia.js is AGPLv3

Automatic BPM detection uses [essentia.js](https://mtg.github.io/essentia.js/), which is
**AGPL-3.0**. For a personal / internal tool this is fine (the choice confirmed for this
build). **If you ever distribute this as a hosted public product, review the AGPL
implications** or isolate detection behind an optional module — the rest of the app has no
copyleft dependencies, and the detector is already self-contained in
`src/audio/bpm.worker.ts` + `bpmClient.ts`, loaded lazily only when the user clicks
"Detect BPM". Manual grid controls are the primary path and require no AGPL code.

## Browser / format support

- **M4A/AAC**: broadly supported. **FLAC**: current Chrome/Firefox/Safari.
- **OGG Vorbis is not supported in Safari.** On decode failure the app shows a clear,
  specific error naming the format and suggesting a transcode or a different browser
  (no silent failures). A WASM fallback decoder is a documented future hook, not v1.

## Deployment

The build output in `dist/` is a static bundle — deploy to Netlify, Vercel, GitHub Pages,
or any static host.

- **Root-hosted** (Netlify/Vercel/custom domain): `npm run build` as-is (`base = '/'`).
- **GitHub Pages project site** (served from `https://user.github.io/<repo>/`): build with
  the base path set to the repo name:

  ```bash
  VITE_BASE="/<repo>/" npm run build
  ```

  (`vite.config.ts` reads `VITE_BASE`, defaulting to `/`.)

## Cloud sharing (Vercel + Cloudflare R2)

Optional cloud persistence lets you **share a link to a set**, **save immutable snapshots**
(saves never overwrite previous saves), and have audio travel with the link. It is additive:
the local IndexedDB autosave still works offline. Storage backend is **Cloudflare R2**;
the API runs as **Vercel serverless functions** under `/api`.

### Capability model

- **Verified user** — holds the `ADMIN_KEY`. Can create new cloud projects (and view/edit
  any set). Paste the key once via **Sign in** in the top bar; it is stored in the browser
  and keeps you signed in indefinitely.
- **Private links** — each set has two:
  - **Edit link** (`/?p=<id>&e=<token>`) — open + save new snapshots.
  - **View-only link** (`/?p=<id>&v=<token>`) — open + play, no saving.

  Anyone with a link has that access. Links carry secrets — treat them as private. On open,
  the token is moved into the browser's local storage and stripped from the address bar.

### Setup

1. **Cloudflare R2**: create a (private) bucket. Create an R2 API token → access key id +
   secret. Add a **CORS policy** allowing `PUT` and `GET` from your app origin (required for
   the browser to upload/download audio directly via presigned URLs), e.g.:

   ```json
   [{ "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:3000"],
      "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["*"] }]
   ```

2. **Environment variables** (copy `.env.example` → `.env` for local `vercel dev`, and set
   the same in the Vercel project): `ADMIN_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (optional `R2_ENDPOINT`).

   Generate the `ADMIN_KEY` (~10 url-safe chars), e.g.:

   ```bash
   node -e "console.log(require('crypto').randomBytes(8).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,10))"
   ```

   To rotate it, set a new value and re-deploy; previously signed-in users must re-enter it.

3. **Run / deploy**: `vercel dev` serves the SPA and `/api` together locally; `vercel`
   deploys. The Vite framework preset auto-detects `/api`; `vercel.json` rewrites non-`/api`
   paths to `index.html`.

### Storage layout (R2)

```
projects/{id}/meta.json                  name, audioHash, tokens, latest pointer, timestamps
projects/{id}/snapshots/{ts}-{rand}.json immutable Project JSON — one per save
audio/{hash}                             audio blob, deduplicated by content hash
```

## Reliability note on detection

The detector is a **starting guess**, not an answer — especially for soft, sustained,
non-percussive material (e.g. ambient solo violin), where automatic tempo estimation is
unreliable. It reports a confidence and ½×/2× octave-error candidates, and **never writes
the grid without an explicit "Apply".** A correct grid is achievable with detection
disabled, using only tap-tempo + set-offset-to-playhead.

## Known limitations / deferred (documented hooks, not v1)

- The main JS bundle includes the full lucide icon set (for the icon picker); it could be
  trimmed/lazy-loaded if bundle size matters for public hosting.
- Silent scrub (no grain playback while dragging the playhead); single audio track; constant
  tempo only (no tempo map); no exporters (MIDI/CSV/OSC/MadMapper) yet; no loop region /
  playback-rate UI; WASM fallback decoder. The data model is shaped so these can be added
  without breaking changes.
```
