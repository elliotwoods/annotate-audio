// Peaks client (spec §9.1). Spins up the peaks worker, posts the channel data
// (transferring the underlying ArrayBuffers), and resolves with PeaksData built from
// the worker's response. The worker is single-use and terminated once it replies.

import type { PeaksData, PeaksRequest, PeaksResponse } from './peaksTypes';

export function computePeaks(req: PeaksRequest): Promise<PeaksData> {
  return new Promise<PeaksData>((resolve, reject) => {
    const worker = new Worker(new URL('./peaks.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<PeaksResponse>): void => {
      const res = event.data;
      const data: PeaksData = {
        min: res.min,
        max: res.max,
        samplesPerBucket: res.samplesPerBucket,
        sampleRate: res.sampleRate,
        length: res.length,
      };
      worker.terminate();
      resolve(data);
    };

    worker.onerror = (event: ErrorEvent): void => {
      worker.terminate();
      reject(new Error(event.message || 'Peaks worker failed'));
    };

    // Transfer each channel's ArrayBuffer to the worker to avoid copying. After this
    // call the source Float32Arrays in `req.channels` are detached on this thread.
    // `Float32Array#buffer` is typed `ArrayBufferLike`; at runtime decoded channel data
    // is always backed by a real (non-shared) ArrayBuffer, so the cast is safe.
    const transfer: Transferable[] = req.channels.map((c) => c.buffer as ArrayBuffer);
    worker.postMessage(req, transfer);
  });
}
