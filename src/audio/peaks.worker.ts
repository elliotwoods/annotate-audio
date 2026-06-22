// Peaks worker (spec §9.1). Receives raw channel sample data, downmixes to mono by
// averaging, and computes a min/max pair per fixed-size bucket at a base resolution.
// The min/max Float32Arrays are transferred back to avoid copying.

import type { PeaksRequest, PeaksResponse } from './peaksTypes';

const DEFAULT_SAMPLES_PER_BUCKET = 256;

// `self` is both a DOM and WebWorker global in our lib config; narrow it to the
// dedicated-worker scope so onmessage/postMessage are correctly typed.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<PeaksRequest>): void => {
  const { channels, sampleRate, length } = event.data;
  const samplesPerBucket =
    event.data.samplesPerBucket && event.data.samplesPerBucket > 0
      ? Math.floor(event.data.samplesPerBucket)
      : DEFAULT_SAMPLES_PER_BUCKET;

  const channelCount = channels.length;
  const bucketCount = Math.ceil(length / samplesPerBucket);

  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);

  const invChannelCount = channelCount > 0 ? 1 / channelCount : 0;

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = bucket * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, length);

    let bucketMin = Infinity;
    let bucketMax = -Infinity;

    // Iterate samples in this bucket, downmixing to mono on the fly. We avoid
    // allocating any per-bucket array and never materialise a full mono buffer.
    for (let i = start; i < end; i++) {
      let sum = 0;
      for (let c = 0; c < channelCount; c++) {
        sum += channels[c][i];
      }
      const mono = sum * invChannelCount;
      if (mono < bucketMin) bucketMin = mono;
      if (mono > bucketMax) bucketMax = mono;
    }

    // Guard against empty buckets (e.g. length === 0 or a trailing zero-width bucket).
    if (bucketMin === Infinity) bucketMin = 0;
    if (bucketMax === -Infinity) bucketMax = 0;

    min[bucket] = bucketMin;
    max[bucket] = bucketMax;
  }

  const response: PeaksResponse = {
    min,
    max,
    samplesPerBucket,
    sampleRate,
    length,
  };

  // `Float32Array#buffer` is typed `ArrayBufferLike`; these are freshly allocated and
  // thus always real (non-shared) ArrayBuffers, so the cast is safe.
  const transfer: Transferable[] = [min.buffer as ArrayBuffer, max.buffer as ArrayBuffer];
  ctx.postMessage(response, transfer);
};
