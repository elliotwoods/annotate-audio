// EditableNumber — a minimal numeric field that reads as plain text (with a dotted
// underline hinting it's editable) and turns into a real <input> only when clicked or
// activated by keyboard. Used for the toolbar grid controls (BPM / offset / time-sig)
// so the top bar stays light. Commit on Enter/blur; Escape reverts. Models the
// editing-state swap used by BlockView's cue-label editor.

import { useEffect, useRef, useState } from 'react';
import './EditableNumber.css';

export function EditableNumber({
  value,
  onCommit,
  min,
  max,
  step,
  width,
  format,
  ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Pixel width applied to both the resting text and the editor, so layout doesn't jump. */
  width?: number;
  /** How to render the resting value (defaults to a trimmed number). */
  format?: (n: number) => string;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const begin = () => {
    setDraft(Number.isFinite(value) ? String(roundForEdit(value)) : '');
    setEditing(true);
  };

  // Focus + select once the input has mounted.
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [editing]);

  const commit = () => {
    const n = parseFloat(draft);
    if (Number.isFinite(n)) {
      let v = n;
      if (min != null) v = Math.max(min, v);
      if (max != null) v = Math.min(max, v);
      if (v !== value) onCommit(v);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        className="editable-num__input"
        style={width != null ? { width } : undefined}
        value={draft}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
          }
        }}
      />
    );
  }

  const display = format ? format(value) : String(value);
  return (
    <span
      role="button"
      tabIndex={0}
      className="editable-num"
      style={width != null ? { minWidth: width } : undefined}
      aria-label={`${ariaLabel}: ${display}. Activate to edit.`}
      onClick={begin}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          begin();
        }
      }}
    >
      {display}
    </span>
  );
}

/** Round the editor seed to kill float noise (e.g. 0.30000000004) while keeping precision. */
function roundForEdit(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
