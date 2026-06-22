// Shared peaks contract (spec §9.1). The peaks worker downmixes to mono and computes
// a min/max pair per bucket at a base resolution; the waveform canvas aggregates base
// buckets to the active samples-per-pixel at render time.

export interface PeaksData {
  /** Per-bucket minimum sample value, in [-1, 1]. Length === bucketCount. */
  min: Float32Array;
  /** Per-bucket maximum sample value, in [-1, 1]. Length === bucketCount. */
  max: Float32Array;
  /** Base resolution: source samples summarised per bucket. */
  samplesPerBucket: number;
  sampleRate: number;
  /** Total source sample count (per channel). */
  length: number;
}

/** Message posted TO the peaks worker. Channel buffers are transferred. */
export interface PeaksRequest {
  channels: Float32Array[];
  sampleRate: number;
  length: number;
  /** Desired base bucket size in samples (default ~256). */
  samplesPerBucket?: number;
}

/** Message posted FROM the peaks worker. min/max buffers are transferred back. */
export interface PeaksResponse {
  min: Float32Array;
  max: Float32Array;
  samplesPerBucket: number;
  sampleRate: number;
  length: number;
}
