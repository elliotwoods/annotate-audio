# Cue Timeline — Engineering Spec

A browser-based timeline editor for authoring show/lighting cues against a single audio track. Cues live in blocks on stacked rows, snapped to a bar grid derived from a detected (constant) BPM. Built as a static Vite app, fully client-side, deployable to any static host.

This document is written to be handed to a coding agent. It fixes the data model, module boundaries, interaction rules, and a sequenced build plan. Where a decision was deliberately taken, the rationale and the rejected alternative are noted so the agent does not "fix" it.

---

## 1. Scope

**In scope (v1)**
- Load one stereo audio file (FLAC / OGG / M4A) via the browser.
- Constant-BPM beat grid: auto-detected, fully hand-correctable.
- Waveform display (summed stereo to a single peak strip) with horizontal zoom and scroll.
- Stacked rows of cue blocks aligned to the waveform on a shared time axis.
- Two fixed special rows at the top: **Track** and **Section**. Then user-defined cue rows.
- Blocks are ranged (start→end) by default; any block can be toggled to a zero-length **point cue**.
- Per-row icon (lucide set) and colour. Add / remove / reorder rows.
- Snap to a selectable grid (bar / ½ / ¼ / ⅛ bar / off), defaulting to bar.
- Transport at the bottom: play/pause/stop, free scrub, and **quantised jump** to previous/next bar and previous/next section.
- Persistence: JSON project export/import **and** in-browser storage (IndexedDB), including optional caching of the decoded audio so reopening doesn't require re-importing the file.

**Out of scope (v1), but the data model must not preclude it**
- Multiple audio tracks (model keeps a single track but is shaped so a `trackId` could be added).
- Variable tempo / tempo maps (grid is a pure function; a tempo-map implementation can replace it later).
- Export to downstream formats (MIDI cue track, CSV, OSC, MadMapper). The block model is kept format-neutral so an exporter is a pure read-only transform later.
- Per-block parameters/values beyond a text label.
- Audio scrubbing playback (silent scrub in v1; grain-scrub is a later hook).

---

## 2. Tech stack

- **Vite + React + TypeScript** (strict mode).
- **State:** Zustand. Single store; selectors for slices. Add `zundo` (or a small manual command stack) for undo/redo — recommended, not blocking.
- **Icons:** `lucide-react`. Row icon picker draws from the lucide name set.
- **BPM detection:** `essentia.js` (WASM), loaded lazily, run inside a Web Worker.
- **Persistence:** IndexedDB via `idb` (small promise wrapper).
- **Audio:** Web Audio API (`decodeAudioData`, `AudioBufferSourceNode`). No element-based playback.
- **No backend.** Output is a static bundle (`vite build`). Deployable to Netlify / Vercel / GitHub Pages / any static host.

> **License note:** essentia.js is AGPLv3. For a personal/internal tool this is fine; if this is ever distributed as a hosted public product, confirm the licensing implications or isolate detection behind an optional module. Flag to the user; do not silently assume.

---

## 3. Architecture overview

```
                ┌─────────────────────────────────────────────┐
                │                  UI (React)                  │
                │  TopBar · Ruler · Waveform · Lanes · Transport│
                └───────────────┬───────────────┬──────────────┘
                                │               │
                       reads/writes        commands
                                │               │
                        ┌───────▼───────────────▼───────┐
                        │        Zustand store           │
                        │  project · view · playback     │
                        └───┬───────┬─────────┬──────────┘
                            │       │         │
        ┌───────────────────▼─┐ ┌───▼─────┐ ┌─▼────────────────┐
        │   AudioEngine        │ │ Grid    │ │  Persistence     │
        │ decode·play·seek·pos │ │ (pure)  │ │ JSON · IndexedDB │
        └─────────┬────────────┘ └─────────┘ └──────────────────┘
                  │ AudioBuffer
        ┌─────────▼────────────┐      ┌──────────────────────────┐
        │  Peaks Worker        │      │  BPM Worker (essentia.js) │
        │  min/max downsample  │      │  Percival + Rhythm2013    │
        └──────────────────────┘      └──────────────────────────┘
```

**Single source of time:** one coordinate transform (Section 5) is shared by the ruler, waveform canvas, and lane DOM so everything stays pixel-aligned under zoom/scroll. Do not let any view compute its own mapping.

---

## 4. Data model

All canonical times are in **seconds** (Float). See Section 5 for why seconds, not bars, are canonical.

```ts
type RowKind = 'track' | 'section' | 'cue';

type SnapResolution = 'bar' | 'half' | 'quarter' | 'eighth' | 'off';

interface BeatGrid {
  bpm: number;          // > 0, constant
  offset: number;       // seconds; time of bar 1, beat 1 (the downbeat anchor)
  beatsPerBar: number;  // time-signature numerator (default 4)
  beatUnit: number;     // time-signature denominator (default 4)
}

interface Row {
  id: string;           // uuid
  kind: RowKind;        // 'track' and 'section' rows always present, not deletable
  name: string;         // editable; for 'track' this is the audio track name
  icon: string;         // lucide icon name (track/section get sensible defaults)
  color: string;        // hex, e.g. "#7C5CFF"
  order: number;        // vertical position; track=0, section=1 enforced
}

interface Block {
  id: string;           // uuid
  rowId: string;
  start: number;        // seconds
  end: number;          // seconds; for a point cue, end === start
  isPoint: boolean;     // true => rendered as a marker, zero length
  label: string;        // free text
}

interface AudioMeta {
  fileName: string;
  mimeType: string;
  sampleRate: number;
  duration: number;     // seconds
  channels: number;
  hash: string;         // content hash; key for cached audio blob in IndexedDB
}

interface ViewState {
  pixelsPerSecond: number; // zoom
  scrollSec: number;       // left edge of viewport, in seconds
  snap: SnapResolution;
  followPlayhead: boolean;
}

interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  audio: AudioMeta | null;
  grid: BeatGrid;
  rows: Row[];          // includes the two fixed rows
  blocks: Block[];
  view: ViewState;
  updatedAt: number;    // epoch ms
}
```

**Invariants**
- Exactly one `kind: 'track'` row and one `kind: 'section'` row exist at all times; both have `order` 0 and 1 and cannot be deleted or reordered below cue rows.
- Cue rows have unique `order` values ≥ 2.
- `start <= end`. Point cues satisfy `start === end && isPoint === true`.
- Blocks never reference a missing `rowId`.

---

## 5. Time & coordinate system

### 5.1 The transform
One module owns the mapping and is imported everywhere:

```ts
timeToX(t, view)  = (t - view.scrollSec) * view.pixelsPerSecond
xToTime(x, view)  = view.scrollSec + x / view.pixelsPerSecond
```

All rendering layers (ruler, waveform canvas, lanes, playhead) use these. The waveform canvas redraws on `pixelsPerSecond` / `scrollSec` change; lane DOM elements set `left`/`width` from the same functions.

### 5.2 Why seconds are canonical (deliberate)
Blocks store **seconds**, not bar positions. The audio recording is the ground truth; cues are placed against what the performer actually played. If the user later corrects the BPM or downbeat, **gridlines move but existing blocks stay glued to their audio positions** — which is what you want when the initial detection was slightly off and you'd already placed cues on real musical events.

- Snapping is computed *live* at edit time from the current grid; it does not rewrite stored positions retroactively.
- Provide an explicit, opt-in command **"Re-snap all blocks to grid"** for the case where the user re-grids and *does* want everything pulled to the new bar lines.

> Rejected alternative: storing blocks in musical position (bar.beat.tick). That makes blocks follow BPM edits, which is wrong for cues authored against a fixed recording — they'd drift off the audio. Do not switch the canonical unit.

---

## 6. Beat grid (pure module)

Constant-BPM grid math, no audio dependency, fully unit-testable.

```ts
const beatLen   = (g) => 60 / g.bpm;                 // seconds per beat
const barLen    = (g) => beatLen(g) * g.beatsPerBar; // seconds per bar

// time -> musical position
function timeToBars(t, g) {
  const bars = (t - g.offset) / barLen(g);
  return bars; // float; bar index 0 == first downbeat
}

// nearest grid time at a given subdivision
function snapTime(t, g, snap: SnapResolution): number {
  if (snap === 'off') return t;
  const div = { bar:1, half:2, quarter:4, eighth:8 }[snap]; // subdivisions per bar
  const step = barLen(g) / div;
  return g.offset + Math.round((t - g.offset) / step) * step;
}

// bar boundaries within [t0, t1] for ruler/grid rendering
function* barLines(t0, t1, g): Generator<{ time:number; bar:number; beat:number }>
```

- Display formats: `bars:beats` (1-indexed, e.g. `17.3`) and `mm:ss.mmm`. Provide both in the transport readout.
- Negative bar indices are allowed before the offset; the ruler should label them sensibly (or clamp display to ≥ 1 — agent's choice, but be consistent).

---

## 7. BPM detection

### 7.1 Reality check (must be surfaced in UI)
The source is ambient solo violin: soft, sustained onsets, little percussive energy. Automatic tempo estimation will be **unreliable** here. The detector provides a *starting guess*, not an answer. The manual controls (Section 7.3) are the primary path, not a fallback.

### 7.2 Detector
Run essentia.js in a dedicated Web Worker (lazy-load the WASM only when the user requests detection or on first audio load).

- Primary: `PercivalBpmEstimator` → single BPM (matches the constant-tempo model).
- Secondary, for cross-checking on soft material: `RhythmExtractor2013` (multifeature) → BPM + beat ticks + confidence. Its combined onset functions (HFC, complex-domain spectral difference, energy-band periodicity) handle non-percussive audio better than naive peak-picking.
- Resolve to a single mono Float32 buffer at the rate essentia expects; downmix stereo first.
- Report: estimated BPM, a confidence/agreement indicator (e.g. do the two estimators agree within tolerance; expose octave-error candidates ×0.5 / ×2), and the first detected beat time as a candidate `offset`.

The worker returns a *suggestion*; it never writes the grid directly. The UI presents "Detected ≈ NNN BPM (low/med/high confidence) — Apply?" plus the ½× and 2× candidates (octave errors are the most common failure).

### 7.3 Manual controls (always available)
- Numeric BPM field.
- Downbeat **offset** field, plus a "set offset to playhead" button (play to the first downbeat, hit the button).
- **Tap tempo** button: average inter-tap interval over the last N taps; show live estimate; "apply".
- Time-signature numerator/denominator (default 4/4).
- A nudge control on offset (± a few ms) for fine alignment against the waveform.

Acceptance: with detection off entirely, a user can produce a correct grid using only tap-tempo + set-offset-to-playhead.

---

## 8. Audio engine

### 8.1 Loading & formats
- Read file → `ArrayBuffer` → `AudioContext.decodeAudioData`.
- Native decode coverage: M4A/AAC broadly supported; FLAC supported in current Chrome/Firefox/Safari; **OGG Vorbis is not supported in Safari**. Do not assume a format works — on decode failure, show a clear error naming the format and suggest transcoding or a different browser. (A WASM fallback decoder is a documented later hook, not v1.)
- Store `AudioMeta` including a content `hash` (e.g. hash the ArrayBuffer) for the IndexedDB cache key.

### 8.2 Playback & transport
- Web Audio graph: `AudioBufferSourceNode → GainNode → destination`.
- Sources are one-shot; **seek = stop current source + start a new one at offset**.
- Track position without timers drifting: `position = (ctx.currentTime - startedAtCtxTime) + startOffset` while playing; hold a frozen position while paused.
- `play() / pause() / stop()` (stop returns to 0 or to a stored "stop marker" — pick play-from-pause semantics: pause holds position, stop resets to 0).
- Free seek: clicking the ruler/waveform sets position to `xToTime(clickX)` (no snap).
- Loop (optional v1 nicety): loop region between two markers.
- Playback rate (optional): expose `playbackRate` on the source; note it shifts pitch (no time-stretch in v1).

---

## 9. Waveform rendering

### 9.1 Peaks (Web Worker)
- On audio load, post channel data to a peaks worker.
- Downmix to mono, compute a **min/max pair per bucket** at a base resolution fine enough for max practical zoom (e.g. one pair per ~256 samples, or build 2–3 mip levels). Return transferable `Float32Array`s.
- At render time, aggregate base buckets to the current `samplesPerPixel` for the active zoom.

### 9.2 Canvas
- Single waveform canvas (plus a grid/ruler canvas, or draw grid on the same canvas) scaled by `devicePixelRatio`.
- Redraw only when dirty (zoom, scroll, resize, new peaks) via `requestAnimationFrame`; do not redraw per frame while idle.
- Vertical height is fixed (the user confirmed no need for vertical zoom). Summed/mono display — a single peak strip, not split L/R — to preserve vertical space for cue lanes.
- Playhead is a separate cheap overlay (1px line) updated each frame during playback; do not redraw the whole waveform to move it.

---

## 10. Lanes, rows & blocks

### 10.1 Rendering choice (deliberate hybrid)
- **Waveform + bar grid + ruler: canvas.**
- **Cue lanes, blocks, and the playhead overlay: absolutely-positioned DOM**, positioned via the shared transform.

> Rejected alternative: all-canvas. Block hit-testing, drag/resize handles, inline label editing, focus, and accessibility are dramatically simpler as DOM. Canvas is reserved for the high-density waveform only.

### 10.2 Layout per row
- Left **gutter** (fixed width, does not scroll horizontally): icon, editable name, colour swatch, and (for cue rows) remove + reorder handles.
- Right **lane** (scrolls/zooms with the timeline): the blocks.
- Track row: a single block (or full-width bar) showing the audio track name; spans the audio duration.
- Section row: ranged blocks the user creates to mark sections; these are the targets for quantised section jumps (Section 11).

### 10.3 Block interactions
- **Create ranged block:** click-drag on empty lane space → block from drag-start to drag-end, both ends snapped per current snap resolution.
- **Create point cue:** double-click (or a "point" mode) → zero-length marker at the snapped time; `isPoint = true`.
- **Move:** drag body; snaps; stays within its row (no cross-row drag in v1).
- **Resize:** drag either edge; snaps; cannot invert (clamp `start <= end`); resizing a point cue past zero converts it to ranged (clear `isPoint`), and collapsing a ranged block to zero can convert to point (offer, don't force).
- **Select:** click; multi-select with shift (nice-to-have). Selected block shows handles.
- **Label:** inline text edit on the selected block (double-click body when not in create mode, or an edit affordance); empty labels allowed.
- **Delete:** Delete/Backspace on selection, or a context action.
- Blocks within a row **may not overlap**? — Decide: allow overlap is simpler and arguably useful for cues; **default: allow overlap**, render with slight transparency. (If the user later wants exclusivity per row, it's a validation hook.)

### 10.4 Row management
- Add cue row → appends with default icon/colour, `order = max+1`.
- Remove cue row → confirm if it has blocks; deletes its blocks.
- Reorder cue rows (drag handle); Track(0)/Section(1) pinned above.
- Icon picker: searchable lucide name list. Colour picker: swatch + hex input.

---

## 11. Transport controls (bottom bar)

Easy to operate, large hit targets. Left-to-right suggested order:

- **Stop** (reset to 0), **Play/Pause** (toggle), 
- **◀︎ Section / Section ▶︎** — jump to previous/next **section boundary** (start times of Section-row blocks, sorted; also treat each block end as a boundary or not — default: section *starts* only).
- **◀︎ Bar / Bar ▶︎** — jump to previous/next bar line from current position.
- **Time readout:** `bars:beats` and `mm:ss.mmm`, both shown.
- **Snap selector:** bar / ½ / ¼ / ⅛ / off.
- **Zoom** in/out (and fit-to-window).
- **Follow playhead** toggle (auto-scroll to keep playhead in view during playback).
- **Loop** toggle (optional), **rate** (optional).

**Quantised vs free (explicit):**
- Clicking the waveform/ruler = **free** seek (no snap), for getting roughly somewhere fast.
- Bar/Section buttons and their keyboard equivalents = **quantised** jumps.
- "Next bar" from a position already exactly on a bar advances to the following bar (don't no-op).

---

## 12. Snapping

- Snap applies to block create/move/resize, governed by the `snap` resolution and `snapTime()` (Section 6).
- A momentary modifier (e.g. hold **Alt**) disables snap for the current drag regardless of the selector — standard DAW ergonomics.
- Transport quantised jumps ignore the snap selector; they always target bar/section as labelled.

---

## 13. Persistence

### 13.1 JSON project file
- **Export:** serialize `Project` (Section 4) to JSON, download as `<name>.cuetl.json`. Include `schemaVersion`.
- **Import:** validate `schemaVersion`; migrate if needed; load into store. Note that JSON does **not** contain audio — on import, if the referenced `audio.hash` is in the IndexedDB cache, rehydrate it; otherwise prompt the user to locate the audio file (match by hash when provided; warn on mismatch).

### 13.2 IndexedDB (in-browser running)
Two object stores:
- `projects`: keyed by `project.id`, value = full `Project` JSON. **Autosave** (debounced, e.g. 1–2 s after last change) on every mutation; bump `updatedAt`.
- `audio`: keyed by `audio.hash`, value = the original file `Blob` (so reopening a project re-decodes locally without re-import). Provide a "manage storage / clear cached audio" affordance, since FLAC blobs are large.

On app start: list `projects`, offer New / Open recent; reopen the most recent by default if present.

---

## 14. UI layout (summary)

```
┌──────────────────────────────────────────────────────────────────┐
│ TopBar: project name · New/Open · Import/Export JSON ·            │
│         Load audio · BPM · offset(+set/nudge) · time-sig ·         │
│         Tap · Detect · Snap · Zoom                                 │
├───────────┬────────────────────────────────────────────────────── │
│  Ruler    │  bars : beats ticks  (canvas)                          │
├───────────┼────────────────────────────────────────────────────── │
│  (gutter) │  Waveform strip (canvas, summed mono)                  │
├───────────┼────────────────────────────────────────────────────── │
│  Track ▸  │  [ audio track name spanning duration ]                │
│  Section ▸│  [ Intro ][ A ][ B ][ Outro ]   ← section blocks       │
│  House ▸  │     [ block ]        • point      [ block ]            │
│  Mylar  ▸ │   [block][ block ]        [ block ]                    │
│  + add row│  …                                                     │
├───────────┴────────────────────────────────────────────────────── │
│ Transport: ⏹ ⏯  ◀Sec Sec▶  ◀Bar Bar▶  17.3 / 01:08.250            │
│            snap[bar▾] zoom[−][+][fit] ☐follow ☐loop                │
└──────────────────────────────────────────────────────────────────┘
```

- Dark theme by default (cue/show context). See `frontend-design` guidance for tokens.
- Playhead is a vertical line spanning ruler → all lanes.
- Horizontal scroll/zoom affects ruler + waveform + lanes together; the gutter is fixed.

---

## 15. Keyboard shortcuts

- **Space** play/pause · **Return** stop
- **← / →** previous / next bar · **Shift+← / →** previous / next section
- **Home / End** start / end
- **+ / −** zoom in/out · **0** fit to window
- **Alt (hold)** disable snap during drag
- **Delete / Backspace** delete selection
- **Cmd/Ctrl+S** export JSON · **Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z** undo/redo (if implemented)

---

## 16. Build plan (sequenced tasks for the agent)

Each task is independently runnable/testable and ends in a working app.

1. **Scaffold.** Vite + React + TS (strict), Zustand store with `Project`/`ViewState`/playback slices, app shell + layout regions (TopBar, Ruler, Waveform, Lanes, Transport), dark theme tokens. No audio yet; render a static grid against a hardcoded `BeatGrid` to prove the coordinate transform.
2. **Coordinate transform + ruler + zoom/scroll.** Implement `timeToX/xToTime`, the `barLines` generator, ruler canvas, horizontal zoom (pixelsPerSecond) and scroll, fit-to-window. Pure-function unit tests for grid math.
3. **Audio engine + transport.** File load, `decodeAudioData` with format-failure handling, `AudioMeta` + hash, play/pause/stop, free seek (click), playhead position tracking + overlay, time readout (bars:beats + mm:ss).
4. **Peaks worker + waveform canvas.** Worker downsample (min/max, mip or base resolution), transferable buffers, summed-mono waveform render, dirty-redraw on zoom/scroll, devicePixelRatio scaling.
5. **Beat grid controls.** Manual BPM/offset/time-sig fields, set-offset-to-playhead, tap tempo, nudge; grid renders against the waveform; `snapTime` + snap selector + Alt-to-disable.
6. **Auto-BPM (essentia.js worker).** Lazy WASM load, `PercivalBpmEstimator` + `RhythmExtractor2013`, confidence + ½×/2× candidates, "Apply" into the grid (never auto-write). Surface the ambient-violin reliability caveat in the UI.
7. **Rows & blocks.** Fixed Track/Section rows; cue-row CRUD with lucide icon picker + colour; gutter + lanes (DOM overlay); create ranged blocks (drag), point cues (double-click), move, resize, select, inline label, delete; overlap allowed with transparency.
8. **Quantised transport + follow.** Prev/next bar, prev/next section (from Section-row blocks), follow-playhead auto-scroll.
9. **Persistence + polish.** JSON import/export with schemaVersion + validation/migration; IndexedDB autosave (debounced) + audio blob cache keyed by hash + recent-projects open/new; "re-snap all to grid" command; keyboard shortcuts; empty/error states; `vite build` + static deploy config (base path note for GitHub Pages).

Optional later (documented hooks, not v1): undo/redo, loop region, playback rate, audio scrub, multi-track, tempo map, exporters (MIDI/CSV/OSC/MadMapper), WASM fallback decoder.

---

## 17. Acceptance criteria (key checks)

- **Grid math:** `snapTime`, `timeToBars`, `barLines` pass unit tests including non-4/4 and negative bars.
- **Alignment:** at any zoom/scroll, a bar line drawn on the waveform canvas sits at the same x as a block edge snapped to that bar (shared transform, no drift).
- **Tempo correction:** changing BPM/offset moves gridlines but leaves existing blocks at their stored seconds; "Re-snap all" pulls them to the new grid.
- **Detection:** auto-BPM produces a suggestion + confidence + octave candidates and never overwrites the grid without "Apply". A correct grid is achievable with detection disabled, using tap + set-offset.
- **Formats:** FLAC/OGG/M4A load where the browser supports them; an unsupported format yields a clear, specific error (not a silent failure).
- **Transport:** free click-seek is unsnapped; bar/section jumps are quantised; "next bar" from exactly on a bar advances.
- **Persistence:** reload the page → most recent project reopens with audio rehydrated from cache; JSON export reimports to an identical project (modulo `updatedAt`).
- **Rows:** Track/Section cannot be deleted/reordered below cue rows; cue rows support icon/colour/reorder/remove; point cues render distinctly from ranged blocks.

---

## 18. Open decisions to confirm with the user

These are defaulted above but cheap to flip — confirm before or during build:
- **Block overlap within a row:** defaulted to *allowed*. Switch to per-row exclusivity?
- **Stop semantics:** stop → return to 0 (vs. return to a stop marker)?
- **Section boundaries for jumps:** section *starts* only (default) vs. starts *and* ends?
- **Undo/redo in v1:** recommended; include now or defer?