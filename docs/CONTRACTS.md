# Build contracts (read before writing any file)

This is a Vite + React 18 + TypeScript **strict** app (a Cue Timeline editor). The
foundation (data model, store, transform, grid math, audio engine, transport) is
already written and typechecks. You are implementing a leaf module against fixed
contracts. **Do NOT run `npm install`, `npm run build`, `vite`, or `tsc`** — integration
and the build happen centrally. Only write the files assigned to you.

## Hard rules

- TypeScript strict + `noUnusedLocals`/`noUnusedParameters`. No `any` unless unavoidable
  (prefer `unknown` + narrowing). No non-null `!` on values that can really be null.
- React 18 function components + hooks. No class components.
- **Read the real foundation source for exact signatures** — do not guess:
  - `src/store/store.ts` (the `StoreState` interface = every action), plus exports
    `beginHistoryGroup()`, `endHistoryGroup()`, `undo()`, `redo()`, `clearHistory()`,
    `temporalStore`.
  - `src/store/selectors.ts` (selector hooks).
  - `src/core/transform.ts` (`timeToX`, `xToTime`, `durationToWidth`, `visibleRange`, …).
  - `src/core/grid.ts` (`gridLines`, `barLines`, `snapTime`, `snapStep`, `formatBarsBeats`,
    `formatClock`, `prevBar`, `nextBar`, `beatLen`, `barLen`, …).
  - `src/audio/transport.ts` (the `transport` singleton).
  - `src/audio/AudioEngine.ts`, `src/audio/peaksTypes.ts`, `src/audio/bpmTypes.ts`.
  - `src/model/types.ts`, `src/model/defaults.ts`, `src/ui/lucide.ts`.
- Co-locate component styles in a sibling `.css` file imported at the top of the
  component (e.g. `import './Transport.css'`). Use the CSS variables/tokens defined in
  `src/index.css` (`--bg-0..4`, `--text-0..2`, `--accent`, `--line`, `--gutter-w`,
  `--row-h`, `--ruler-h`, `--waveform-h`, `--transport-h`, `--playhead`, `--danger`,
  `--grid-bar`, `--grid-beat`, `--waveform`, `--radius`, `--mono`, etc.). Dark theme.

## The single coordinate transform (critical — spec §5)

All timeline layers position content with `timeToX(t, view)` from `src/core/transform.ts`,
where `view = useView()` (pixelsPerSecond + scrollSec). **`x = 0` is the LEFT EDGE of the
lane area** (the column to the right of the fixed gutter). The lane area pixel width is
`useStore(s => s.laneWidth)` (already measured for you). Never invent your own mapping —
alignment between the waveform canvas and DOM block edges is an acceptance criterion.

## Layout contract

The timeline is a vertical stack of strips. Each strip is a 2-column grid:
`grid-template-columns: var(--gutter-w) 1fr`. Column 1 = fixed gutter (row header / labels,
does not scroll horizontally). Column 2 = lane (the scrollable/zoomable timeline content),
which is `position: relative; overflow: hidden` and has width `laneWidth`.

- Canvas components (`RulerCanvas`, `WaveformCanvas`) receive `{ width, height }` props =
  the lane-cell size, render a `<canvas>` scaled by `devicePixelRatio`, and read
  `view`/`grid`/`peaks` from the store.
- The Lanes component builds its own per-row 2-column grid using the same `--gutter-w`,
  so its lane cells align horizontally with the ruler/waveform lane cells.

## Module signatures that DON'T exist yet (other agents / central integration)

You may import these by the signatures below; the files will exist at integration time.

```ts
// src/audio/peaksClient.ts   (Agent: peaks)
import type { PeaksData, PeaksRequest } from './peaksTypes';
export function computePeaks(req: PeaksRequest): Promise<PeaksData>;

// src/audio/bpmClient.ts     (Agent: bpm)
import type { BpmRequest, BpmResult } from './bpmTypes';
export function detectBpm(req: BpmRequest): Promise<BpmResult>; // rejects with Error on failure

// src/persistence/db.ts      (Agent: persistence)
import type { Project } from '../model/types';
export function listProjects(): Promise<Project[]>;            // newest first
export function getProject(id: string): Promise<Project | undefined>;
export function saveProject(p: Project): Promise<void>;
export function deleteProject(id: string): Promise<void>;
export function getAudioBlob(hash: string): Promise<Blob | undefined>;
export function saveAudioBlob(hash: string, blob: Blob): Promise<void>;
export function deleteAudioBlob(hash: string): Promise<void>;
export function listAudioHashes(): Promise<string[]>;
export function clearAllAudio(): Promise<void>;
export function estimateStorage(): Promise<{ usage: number; quota: number } | null>;

// src/persistence/json.ts    (Agent: persistence)
export function exportProjectToFile(p: Project): void;          // downloads <name>.cuetl.json
export function importProjectFromFile(file: File): Promise<Project>; // validates + migrates
export function validateProject(obj: unknown): Project;         // throws on invalid

// src/persistence/autosave.ts (Agent: persistence)
export function startAutosave(): () => void;                    // debounced; returns unsubscribe

// src/audio/audioFile.ts     (central integration)
export function loadAudioFile(file: File): Promise<void>;       // decode+meta+cache+peaks; throws AudioDecodeError
export function rehydrateAudio(meta: import('../model/types').AudioMeta): Promise<boolean>;

// src/ui/Timeline.tsx        (central) — mounts RulerCanvas, WaveformCanvas, Lanes, Playhead
// src/ui/StartDialog.tsx     (central) — recent projects / new / open
```

## Useful store actions (see store.ts for the full list)

`newProject(name?)`, `loadProject(project)`, `exportProject(): Project`, `setProjectName`,
`setAudioMeta`, `setPeaks`, `setGrid`, `setBpm`, `setOffset`, `nudgeOffset`,
`setOffsetToTime`, `setTimeSig`, `setView`, `setPixelsPerSecond`, `setScrollSec`, `setSnap`,
`setFollow`, `toggleFollow`, `setLaneWidth`, `zoomBy(factor, focalX?)`, `zoomToFit()`,
`setPlayback`, `addCueRow(): string`, `removeRow`, `updateRow`, `moveRow(id, -1|1)`,
`reorderCueRows(ids)`, `addBlock(rowId,start,end,label?): string`,
`addPointCue(rowId,time,label?): string`, `updateBlock`, `moveBlock(id,newStart)`,
`resizeBlock(id,'start'|'end',time)`, `setBlockLabel`, `toggleBlockPoint`, `deleteBlocks`,
`deleteSelected`, `selectBlock(id, additive?)`, `setSelection`, `clearSelection`,
`resnapAllToGrid`, `setDetection`, `applyDetection(bpm, offset?)`.

Selectors (`src/store/selectors.ts`): `useView`, `useGrid`, `useAudio`, `useProjectName`,
`useProjectId`, `useSelection`, `useIsPlaying`, `useDetection`, `useSnap`, `useSortedRows`,
`useRow(id)`, `useBlocksByRow(id)`, `useAllBlocks`, `useSectionBoundaries`,
`useContentDuration`.

## Snapping in interactions (spec §12)

When creating/moving/resizing blocks: snap times with `snapTime(t, grid, view.snap)`. Holding
**Alt** during the gesture disables snap regardless of the selector (read `e.altKey`).
Transport jumps are already quantised in the transport singleton — don't re-snap them.

## Defaults / decisions already made

- Block overlap within a row: **allowed**, render selected/overlapping with slight
  transparency.
- Stop → returns to 0. Section jumps target section **starts** only.
- Point cue: `isPoint === true`, `end === start`, rendered as a marker (e.g. a diamond/teardrop),
  visually distinct from ranged blocks.
