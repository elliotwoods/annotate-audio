# Cue Timeline

A browser-based timeline editor for authoring show / lighting cues against a single
audio track. Cues live in blocks on stacked rows, snapped to a bar grid derived from a
detected (and fully hand-correctable) constant BPM. Fully client-side; deployable to any
static host. Built per [`specs.md`](./specs.md).

## Features (v1)

- **Load one audio file** (FLAC / OGG / M4A) via the browser's native decoder.
- **Constant-BPM beat grid** — auto-detected *and* fully manual (numeric BPM, downbeat
  offset with "set to playhead" + ±5 ms nudge, tap tempo, time signature).
- **Waveform display** (summed mono peak strip) with horizontal zoom & scroll, computed
  off the main thread in a peaks worker.
- **Stacked cue rows** aligned to the waveform on a shared time axis. Two fixed rows —
  **Track** and **Section** — then user-defined cue rows with per-row lucide icon & colour.
- **Blocks** are ranged (start → end) by default; double-click for a zero-length **point
  cue**. Create / move / resize / label / delete; overlap allowed.
- **Snap** to bar / ½ / ¼ / ⅛ bar / off; hold **Alt** to disable snapping mid-drag.
- **Transport** — play / pause / stop, free click-scrub, and quantised jump to prev/next
  bar and prev/next section; bars:beats + mm:ss.mmm readout; follow-playhead; zoom/fit.
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
