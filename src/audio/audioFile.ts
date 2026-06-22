// Audio load orchestration (spec §8.1, §9.1, §13.2): read → hash → decode → meta →
// cache blob → compute peaks. Also project-session helpers that keep the AudioEngine,
// store, and peaks consistent when switching projects (new / open / import).

import { transport } from './transport';
import { AudioDecodeError } from './AudioEngine';
import { computePeaks } from './peaksClient';
import { hashArrayBuffer } from '../core/hash';
import { useStore } from '../store/store';
import { saveAudioBlob, getAudioBlob } from '../persistence/db';
import type { AudioMeta, Project } from '../model/types';

function formatLabel(file: File): string {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  return file.type || (ext ? ext.toUpperCase() : 'audio');
}

async function computePeaksIntoStore(): Promise<void> {
  const { channels, sampleRate, length } = transport.engine.getChannelArrays();
  if (!channels.length || length === 0) {
    useStore.getState().setPeaks(null);
    return;
  }
  try {
    const peaks = await computePeaks({ channels, sampleRate, length });
    useStore.getState().setPeaks(peaks);
  } catch {
    // Peaks are a visual nicety; failure must not block audio playback.
    useStore.getState().setPeaks(null);
  }
}

/**
 * Given a freshly-decoded buffer (already installed on the engine) + the original file,
 * build & publish AudioMeta, cache the blob (keyed by content hash) and compute peaks.
 * Returns the meta so callers can compare hashes.
 */
async function installDecodedAudio(
  file: File,
  audioBuffer: AudioBuffer,
  hash: string,
): Promise<AudioMeta> {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  const meta: AudioMeta = {
    fileName: file.name,
    mimeType: file.type || (ext ? `audio/${ext}` : 'application/octet-stream'),
    sampleRate: audioBuffer.sampleRate,
    duration: audioBuffer.duration,
    channels: audioBuffer.numberOfChannels,
    hash,
  };
  useStore.getState().setAudioMeta(meta);
  // Cache the original bytes so reopening doesn't require re-importing (spec §13.2).
  // Non-fatal: a quota failure must not break loading.
  try {
    await saveAudioBlob(hash, file);
  } catch {
    /* storage full / unavailable — ignore */
  }
  await computePeaksIntoStore();
  return meta;
}

/**
 * Load a user-selected audio file: decode it, publish AudioMeta, cache the original
 * blob and compute waveform peaks. Throws {@link AudioDecodeError} with a clear,
 * format-specific message on decode failure (spec §8.1).
 */
export async function loadAudioFile(file: File): Promise<void> {
  const buf = await file.arrayBuffer();
  const hash = await hashArrayBuffer(buf);
  // decode() throws AudioDecodeError on failure and installs the buffer on success.
  const audioBuffer = await transport.engine.decode(buf, formatLabel(file));
  await installDecodedAudio(file, audioBuffer, hash);
  useStore.getState().zoomToFit();
}

/**
 * Rehydrate audio for a project being opened: if the referenced blob is in the cache,
 * decode it and recompute peaks. Returns true on success, false if not cached / failed
 * (caller should then prompt the user to locate the file — spec §13.1).
 */
export async function rehydrateAudio(meta: AudioMeta): Promise<boolean> {
  try {
    const blob = await getAudioBlob(meta.hash);
    if (!blob) return false;
    const buf = await blob.arrayBuffer();
    await transport.engine.decode(buf, meta.mimeType || meta.fileName);
    await computePeaksIntoStore();
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-import a file the user located for an existing project. Decodes it, updates the
 * project's AudioMeta to reference the located file (so its hash matches the now-cached
 * blob and autosave persists the link), and reports whether the content hash matched the
 * project's original (so the UI can warn on mismatch — spec §13.1).
 */
export async function relinkAudioFile(
  file: File,
  expectedHash: string,
): Promise<{ matched: boolean }> {
  const buf = await file.arrayBuffer();
  const hash = await hashArrayBuffer(buf);
  const audioBuffer = await transport.engine.decode(buf, formatLabel(file));
  await installDecodedAudio(file, audioBuffer, hash);
  return { matched: hash === expectedHash };
}

// ── project session orchestration ──────────────────────────────────────────────

/** Stop playback and forget any decoded audio + peaks (used when switching projects). */
export function clearAudioSession(): void {
  transport.stop();
  transport.engine.clear();
  useStore.getState().setPeaks(null);
}

/** Start a fresh project, clearing any stale decoded audio from the engine. */
export function startNewProject(name?: string): void {
  clearAudioSession();
  useStore.getState().newProject(name);
}

/**
 * Switch to a project (open/import): clear stale audio, load it, and rehydrate its audio
 * from cache. Returns true if audio is ready (either no audio referenced, or rehydrated);
 * false means the referenced audio isn't cached and the user should relink it.
 */
export async function loadProjectWithAudio(project: Project): Promise<boolean> {
  clearAudioSession();
  useStore.getState().loadProject(project);
  if (!project.audio) return true;
  return rehydrateAudio(project.audio);
}
