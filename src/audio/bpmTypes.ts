// Shared BPM-detection contract (spec §7). The worker returns a SUGGESTION only —
// it never writes the grid. The UI presents it with confidence + octave candidates
// and an explicit "Apply" (spec §7.2).

export interface BpmRequest {
  /** Mono (or to-be-downmixed) channel data. Transferred. */
  channels: Float32Array[];
  sampleRate: number;
  length: number;
}

export interface BpmResult {
  /** Primary single-BPM estimate (Percival), matching the constant-tempo model. */
  bpm: number;
  /** Secondary estimate (RhythmExtractor2013 multifeature), if available. */
  bpmSecondary?: number;
  /** First detected beat time — a candidate downbeat offset (seconds). */
  offsetCandidate?: number;
  /** 0..1 confidence from the secondary extractor, if available. */
  confidence?: number;
  /** Coarse confidence bucket derived from agreement + raw confidence. */
  confidenceLabel: 'low' | 'med' | 'high';
  /** Human-readable agreement note for the UI. */
  agreement: string;
  /** Octave-error candidates including ½× and 2× (spec §7.2). */
  candidates: number[];
}

export type BpmResponse =
  | { ok: true; result: BpmResult }
  | { ok: false; error: string };
