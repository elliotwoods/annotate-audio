// Auto-BPM client (spec §7). Spins up the essentia.js worker, posts the channel data
// (transferring the underlying ArrayBuffers to avoid a copy), and resolves with the
// BpmResult suggestion. The worker is single-use and terminated once it replies — the
// WASM is heavy, so we don't keep it resident. Detection is optional: callers should
// treat a rejection as "no suggestion available" and fall back to manual controls.

import type { BpmRequest, BpmResult, BpmResponse } from './bpmTypes';

export function detectBpm(req: BpmRequest): Promise<BpmResult> {
  return new Promise<BpmResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./bpm.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (err) {
      reject(
        new Error(
          err instanceof Error
            ? `Failed to start BPM worker: ${err.message}`
            : 'Failed to start BPM worker',
        ),
      );
      return;
    }

    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      worker.terminate();
      fn();
    };

    worker.onmessage = (event: MessageEvent<BpmResponse>): void => {
      const res = event.data;
      if (res && res.ok) {
        finish(() => resolve(res.result));
      } else {
        const message = res && !res.ok ? res.error : 'BPM detection failed';
        finish(() => reject(new Error(message)));
      }
    };

    worker.onerror = (event: ErrorEvent): void => {
      finish(() => reject(new Error(event.message || 'BPM worker error')));
    };

    worker.onmessageerror = (): void => {
      finish(() => reject(new Error('BPM worker sent a message that could not be deserialised')));
    };

    // Transfer each channel's ArrayBuffer to the worker to avoid copying. After this call
    // the source Float32Arrays in `req.channels` are detached on this thread.
    // `Float32Array#buffer` is typed `ArrayBufferLike`; decoded channel data is always
    // backed by a real (non-shared) ArrayBuffer at runtime, so the cast is safe.
    const transfer: Transferable[] = req.channels.map((c) => c.buffer as ArrayBuffer);
    try {
      worker.postMessage(req, transfer);
    } catch (err) {
      finish(() =>
        reject(
          new Error(
            err instanceof Error
              ? `Failed to dispatch BPM request: ${err.message}`
              : 'Failed to dispatch BPM request',
          ),
        ),
      );
    }
  });
}
