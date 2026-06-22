// Auto BPM detection panel (spec §7.1/§7.2). The detector returns a SUGGESTION
// only — it never writes the grid. We always surface the ambient-violin
// reliability caveat (§7.1) and the AGPL/essentia.js note (§2), present a
// confidence label + agreement, and require an explicit "Apply".

import { useCallback } from 'react';
import { WandSparkles, CircleAlert, Loader } from 'lucide-react';
import { useStore } from '../store/store';
import { useAudio, useDetection } from '../store/selectors';
import type { Confidence } from '../store/store';
import { transport } from '../audio/transport';
import { detectBpm } from '../audio/bpmClient';
import './DetectPanel.css';

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: 'low confidence',
  med: 'medium confidence',
  high: 'high confidence',
};

const CAVEAT =
  'Tempo detection is unreliable for soft, sustained sources like solo violin — ' +
  'treat this as a starting guess and fine-tune manually.';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Detection failed.';
}

export function DetectPanel() {
  const audio = useAudio();
  const detection = useDetection();
  const setDetection = useStore((s) => s.setDetection);
  const applyDetection = useStore((s) => s.applyDetection);

  const hasAudio = audio !== null && transport.engine.isLoaded;
  const running = detection?.status === 'running';

  const handleDetect = useCallback(async () => {
    if (!transport.engine.isLoaded || running) return;
    const { channels, sampleRate, length } = transport.engine.getChannelArrays();
    if (channels.length === 0 || length === 0) {
      setDetection({ status: 'error', error: 'No audio data available to analyse.' });
      return;
    }
    setDetection({ status: 'running' });
    try {
      const result = await detectBpm({ channels, sampleRate, length });
      setDetection({
        status: 'done',
        bpm: result.bpm,
        offsetCandidate: result.offsetCandidate,
        confidence: result.confidenceLabel,
        agreement: result.agreement,
        candidates: result.candidates,
      });
    } catch (err) {
      setDetection({ status: 'error', error: errorMessage(err) });
    }
  }, [running, setDetection]);

  // Narrow to a usable suggestion: status 'done' WITH a primary bpm. Once `bpm` is
  // pulled into a local const the type narrows cleanly (no non-null assertions).
  const suggestion =
    detection?.status === 'done' && detection.bpm !== undefined
      ? { ...detection, bpm: detection.bpm }
      : null;

  // Candidates other than the primary BPM (the ½× / 2× octave-error options, §7.2).
  const altCandidates =
    suggestion?.candidates?.filter((c) => Math.abs(c - suggestion.bpm) > 0.01) ?? [];

  return (
    <div className="detect-panel">
      <div className="detect-row">
        <button
          type="button"
          onClick={handleDetect}
          disabled={!hasAudio || running}
          title={hasAudio ? 'Detect tempo with essentia.js' : 'Load audio first'}
        >
          {running ? (
            <Loader size={15} className="detect-spin" aria-hidden />
          ) : (
            <WandSparkles size={15} aria-hidden />
          )}
          {running ? 'Detecting…' : 'Detect BPM'}
        </button>

        {suggestion && (
          <div className="detect-suggestion">
            <span className="detect-est tabular">
              Detected ≈ {suggestion.bpm.toFixed(1)} BPM
              {suggestion.confidence ? ` (${CONFIDENCE_LABEL[suggestion.confidence]})` : ''}
            </span>
            {suggestion.agreement && (
              <span className="detect-agreement muted">{suggestion.agreement}</span>
            )}
            <button
              type="button"
              className="primary"
              onClick={() => applyDetection(suggestion.bpm, suggestion.offsetCandidate)}
              title="Apply the detected BPM (and candidate offset) to the grid"
            >
              Apply
            </button>
            {altCandidates.map((c) => (
              <button
                type="button"
                key={c}
                className="ghost detect-candidate"
                onClick={() => applyDetection(c)}
                title={`Apply octave-error candidate ${c.toFixed(1)} BPM`}
              >
                {c.toFixed(1)}
              </button>
            ))}
          </div>
        )}

        {detection?.status === 'error' && (
          <span className="detect-error" role="alert">
            <CircleAlert size={14} aria-hidden /> {detection.error ?? 'Detection failed.'}
          </span>
        )}
      </div>

      <div className="detect-notes">
        <span className="detect-caveat" role="note">
          <CircleAlert size={12} aria-hidden /> {CAVEAT}
        </span>
        <span className="detect-license muted">
          Detection uses essentia.js (AGPLv3).
        </span>
      </div>
    </div>
  );
}
