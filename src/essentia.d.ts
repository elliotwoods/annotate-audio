// essentia.js 0.1.3 ships no TypeScript declarations and no `exports`/`types` map, so
// its deep dist imports are untyped. These ambient declarations (in a declaration-only
// file, so they are NOT module augmentations) type the dynamically-imported modules as
// `any`. The BPM worker narrows the runtime shapes defensively.

declare module 'essentia.js/dist/essentia-wasm.es.js';
declare module 'essentia.js/dist/essentia.js-core.es.js';
