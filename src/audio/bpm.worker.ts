// Auto-BPM worker (spec §7). Runs essentia.js (WASM) off the main thread to produce a
// tempo *suggestion* only — it never writes the grid. The WASM is loaded lazily via
// dynamic import() the first time a detection request arrives, so the ~2 MB module is
// only paid for when the user actually asks for detection.
//
// Reality check (spec §7.1): the source material is ambient solo violin with soft,
// sustained onsets and little percussive energy. Automatic tempo estimation is
// unreliable here, so we cross-check two estimators and report a coarse confidence.
// Everything is wrapped in try/catch — on any failure we post { ok:false } and the app
// degrades to the always-available manual controls (spec §7.3).

import type { BpmRequest, BpmResponse, BpmResult } from './bpmTypes';

// essentia.js deep-import types are declared ambiently in src/essentia.d.ts (the package
// ships no declarations). The dynamic-import results are treated as `unknown` and narrowed
// defensively below.

// `self` is typed as both a window and a worker global under our lib config; narrow it
// to the dedicated-worker scope so onmessage/postMessage are correctly typed.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Essentia expects 44.1 kHz: PercivalBpmEstimator defaults to it and RhythmExtractor2013
// has no sampleRate parameter (it assumes 44100 internally). If the decoded audio is at a
// different rate we resample the mono mix to 44100 first, otherwise reported BPM and tick
// times would be scaled by sampleRate/44100.
const ESSENTIA_SAMPLE_RATE = 44100;

// RhythmExtractor2013 (multifeature) reports a confidence in roughly [0, 5.32] per the
// essentia documentation (0 = none, 5.32 = highest). We normalise to 0..1.
const MAX_RHYTHM_CONFIDENCE = 5.32;

// Two BPM estimates "agree" if within this relative tolerance (~3%, spec §7.2).
const AGREEMENT_TOLERANCE = 0.03;

// ---------------------------------------------------------------------------
// Minimal structural types for the essentia.js surface we touch. The shipped
// declarations are almost entirely `any`, and the dynamic-import paths carry no
// types at all, so we describe just the pieces we use to keep the rest of the file
// free of `any`.
// ---------------------------------------------------------------------------

/** An emscripten std::vector<float> binding. */
interface VectorFloat {
  size(): number;
  get(index: number): number;
  delete(): void;
}

interface PercivalResult {
  bpm: number;
}

interface RhythmResult {
  bpm: number;
  ticks: VectorFloat;
  confidence: number;
}

interface EssentiaCore {
  arrayToVector(input: Float32Array): VectorFloat;
  PercivalBpmEstimator(
    signal: VectorFloat,
    frameSize?: number,
    frameSizeOSS?: number,
    hopSize?: number,
    hopSizeOSS?: number,
    maxBPM?: number,
    minBPM?: number,
    sampleRate?: number,
  ): PercivalResult;
  RhythmExtractor2013(
    signal: VectorFloat,
    maxTempo?: number,
    method?: string,
    minTempo?: number,
  ): RhythmResult;
  shutdown?(): void;
}

interface EssentiaCtor {
  new (wasmModule: unknown, isDebug?: boolean): EssentiaCore;
}

// ---------------------------------------------------------------------------
// Lazy essentia loader. Robust to both common 0.1.x export shapes for the WASM
// module: a ready emscripten Module object (this build: `export { Module as
// EssentiaWASM }`) OR a factory function returning the module (sync or async).
// ---------------------------------------------------------------------------

let essentiaPromise: Promise<EssentiaCore> | null = null;

async function resolveWasmModule(): Promise<unknown> {
  const wasmMod: unknown = await import('essentia.js/dist/essentia-wasm.es.js');

  // Prefer the named EssentiaWASM export, fall back to the module's default, then the
  // module namespace itself.
  let candidate: unknown = wasmMod;
  if (wasmMod && typeof wasmMod === 'object') {
    const rec = wasmMod as Record<string, unknown>;
    if ('EssentiaWASM' in rec && rec.EssentiaWASM != null) {
      candidate = rec.EssentiaWASM;
    } else if ('default' in rec && rec.default != null) {
      candidate = rec.default;
    }
  }

  // Some builds export a factory function (optionally returning a Promise) instead of a
  // ready module object. Call it and await defensively.
  if (typeof candidate === 'function') {
    const produced: unknown = (candidate as (opts?: unknown) => unknown)({});
    candidate = produced instanceof Promise ? await produced : produced;
  } else if (candidate && typeof (candidate as { then?: unknown }).then === 'function') {
    // Already a thenable module.
    candidate = await (candidate as Promise<unknown>);
  }

  if (candidate == null || typeof candidate !== 'object') {
    throw new Error('essentia WASM module did not resolve to a usable object');
  }
  return candidate;
}

async function getEssentia(): Promise<EssentiaCore> {
  if (essentiaPromise) return essentiaPromise;

  essentiaPromise = (async (): Promise<EssentiaCore> => {
    const coreMod: unknown = await import('essentia.js/dist/essentia.js-core.es.js');

    let Ctor: unknown;
    if (coreMod && typeof coreMod === 'object') {
      const rec = coreMod as Record<string, unknown>;
      Ctor = rec.default ?? rec.Essentia;
    }
    if (typeof Ctor !== 'function') {
      throw new Error('essentia core module has no constructable default export');
    }

    const wasmModule = await resolveWasmModule();
    const Essentia = Ctor as unknown as EssentiaCtor;
    const instance = new Essentia(wasmModule);
    if (!instance || typeof instance.arrayToVector !== 'function') {
      throw new Error('essentia instance is missing expected methods');
    }
    return instance;
  })();

  // If construction fails, clear the cache so a later request can retry from scratch.
  essentiaPromise.catch(() => {
    essentiaPromise = null;
  });

  return essentiaPromise;
}

// ---------------------------------------------------------------------------
// Signal preparation.
// ---------------------------------------------------------------------------

/** Average all channels into a single mono Float32Array of `length` samples. */
function downmixToMono(channels: Float32Array[], length: number): Float32Array {
  const mono = new Float32Array(length);
  const channelCount = channels.length;
  if (channelCount === 0) return mono;
  if (channelCount === 1) {
    // Copy so we own the buffer (the incoming buffer was transferred to us, but copying
    // keeps ownership semantics simple and avoids surprises if essentia mutates input).
    mono.set(channels[0].subarray(0, length));
    return mono;
  }
  const inv = 1 / channelCount;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channelCount; c++) {
      sum += channels[c][i];
    }
    mono[i] = sum * inv;
  }
  return mono;
}

/**
 * Linear-resample `input` (at `fromRate`) to `toRate`. Adequate for tempo estimation —
 * we are not after audiophile quality, just a consistent sample rate for essentia.
 */
function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = toRate / fromRate;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLength);
  const step = fromRate / toRate;
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * step;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Result assembly.
// ---------------------------------------------------------------------------

function relativeDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  return denom > 0 ? Math.abs(a - b) / denom : 0;
}

/** Build the de-duplicated, sorted, rounded candidate set incl. ½× and 2× octaves. */
function buildCandidates(bpm: number, bpmSecondary?: number): number[] {
  const raw: number[] = [];
  const add = (value: number): void => {
    if (Number.isFinite(value) && value > 0) {
      raw.push(value * 0.5, value, value * 2);
    }
  };
  add(bpm);
  if (bpmSecondary !== undefined) add(bpmSecondary);

  const seen = new Set<number>();
  const unique: number[] = [];
  for (const value of raw) {
    const rounded = Math.round(value);
    if (rounded > 0 && !seen.has(rounded)) {
      seen.add(rounded);
      unique.push(rounded);
    }
  }
  unique.sort((a, b) => a - b);
  return unique;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

ctx.onmessage = (event: MessageEvent<BpmRequest>): void => {
  // Fire-and-forget async work; all errors are funnelled into a { ok:false } message.
  void runDetection(event.data);
};

async function runDetection(req: BpmRequest): Promise<void> {
  // Track every essentia object we allocate so we can .delete() them in a finally block
  // and avoid leaking WASM heap memory across detections.
  const toDelete: Array<{ delete(): void }> = [];

  try {
    const { channels, sampleRate, length } = req;
    if (!channels || channels.length === 0 || length <= 0) {
      throw new Error('No audio data supplied for BPM detection');
    }

    const essentia = await getEssentia();

    // Downmix → mono, then resample to the rate essentia expects.
    const mono = downmixToMono(channels, length);
    const signal = resample(mono, sampleRate, ESSENTIA_SAMPLE_RATE);
    if (signal.length === 0) {
      throw new Error('Audio signal is empty after downmix/resample');
    }

    const vector = essentia.arrayToVector(signal);
    toDelete.push(vector);

    // --- Primary: PercivalBpmEstimator (single constant-tempo BPM). -------------------
    const percival = essentia.PercivalBpmEstimator(
      vector,
      1024,
      2048,
      128,
      128,
      210,
      50,
      ESSENTIA_SAMPLE_RATE,
    );
    const bpm = percival.bpm;
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new Error('Primary estimator returned an invalid BPM');
    }

    // --- Secondary: RhythmExtractor2013 multifeature (BPM + ticks + confidence). ------
    // This estimator is more robust on non-percussive material (spec §7.2). It is wrapped
    // separately so that a failure here still yields a usable primary-only result.
    let bpmSecondary: number | undefined;
    let offsetCandidate: number | undefined;
    let confidence: number | undefined;

    try {
      const rhythm = essentia.RhythmExtractor2013(vector, 208, 'multifeature', 40);
      if (rhythm.ticks) toDelete.push(rhythm.ticks);

      if (Number.isFinite(rhythm.bpm) && rhythm.bpm > 0) {
        bpmSecondary = rhythm.bpm;
      }

      if (rhythm.ticks && rhythm.ticks.size() > 0) {
        // First detected beat time is our candidate downbeat offset (seconds).
        offsetCandidate = rhythm.ticks.get(0);
      }

      if (Number.isFinite(rhythm.confidence)) {
        confidence = Math.min(1, Math.max(0, rhythm.confidence / MAX_RHYTHM_CONFIDENCE));
      }
    } catch {
      // Secondary estimator failed — keep going with the Percival estimate alone.
      bpmSecondary = undefined;
      offsetCandidate = undefined;
      confidence = undefined;
    }

    // --- Agreement + confidence label. ------------------------------------------------
    let confidenceLabel: BpmResult['confidenceLabel'];
    let agreement: string;

    if (bpmSecondary === undefined) {
      // Only one estimator produced a usable value — we can't cross-check.
      confidenceLabel = 'low';
      agreement = `Percival ${round1(bpm)} — secondary estimate unavailable`;
    } else {
      const diff = relativeDiff(bpm, bpmSecondary);
      // Also treat a clean octave relationship as "partial" agreement (the most common
      // failure mode is an octave error, spec §7.2).
      const ratio = bpm / bpmSecondary;
      const octaveRelated =
        relativeDiff(ratio, 2) < AGREEMENT_TOLERANCE ||
        relativeDiff(ratio, 0.5) < AGREEMENT_TOLERANCE;

      const solidConfidence = confidence !== undefined && confidence >= 0.5;

      if (diff <= AGREEMENT_TOLERANCE) {
        confidenceLabel = solidConfidence ? 'high' : 'med';
        agreement =
          `Percival ${round1(bpm)} / Rhythm2013 ${round1(bpmSecondary)}` +
          ` — agree (±${Math.round(AGREEMENT_TOLERANCE * 100)}%)`;
      } else if (octaveRelated) {
        confidenceLabel = 'med';
        agreement =
          `Percival ${round1(bpm)} / Rhythm2013 ${round1(bpmSecondary)}` +
          ' — octave-related (½×/2×)';
      } else {
        confidenceLabel = 'low';
        agreement =
          `Percival ${round1(bpm)} / Rhythm2013 ${round1(bpmSecondary)}` +
          ` — disagree (>${Math.round(AGREEMENT_TOLERANCE * 100)}%)`;
      }
    }

    const result: BpmResult = {
      bpm,
      confidenceLabel,
      agreement,
      candidates: buildCandidates(bpm, bpmSecondary),
    };
    if (bpmSecondary !== undefined) result.bpmSecondary = bpmSecondary;
    if (offsetCandidate !== undefined) result.offsetCandidate = offsetCandidate;
    if (confidence !== undefined) result.confidence = confidence;

    const response: BpmResponse = { ok: true, result };
    ctx.postMessage(response);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'BPM detection failed with an unknown error';
    const response: BpmResponse = { ok: false, error: message };
    ctx.postMessage(response);
  } finally {
    // Release every WASM object we created, regardless of success/failure.
    for (const obj of toDelete) {
      try {
        obj.delete();
      } catch {
        // Ignore — a missing/failed delete must not mask the real outcome.
      }
    }
  }
}
