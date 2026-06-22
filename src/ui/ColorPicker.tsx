import { useEffect, useRef, useState } from 'react';
import { ROW_PALETTE } from '../model/defaults';
import './ColorPicker.css';

export interface ColorPickerProps {
  /** Currently selected colour (hex). */
  value: string;
  /** Called with a valid hex colour string (e.g. "#7C5CFF"). */
  onPick: (hex: string) => void;
  /** Called when the popover should close (outside click / Esc). */
  onClose: () => void;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalise a hex string to 6-digit lowercase form, or null if invalid. */
function normaliseHex(raw: string): string | null {
  const v = raw.trim();
  if (!HEX_RE.test(v)) return null;
  if (v.length === 4) {
    const r = v[1];
    const g = v[2];
    const b = v[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return v.toLowerCase();
}

export function ColorPicker({ value, onPick, onClose }: ColorPickerProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hexText, setHexText] = useState(value);

  useEffect(() => {
    setHexText(value);
  }, [value]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      // Ignore clicks on the trigger that opened us (it manages its own toggle).
      if (target?.closest('[data-popover-trigger]')) return;
      if (rootRef.current && !rootRef.current.contains(target)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  const commitHex = () => {
    const hex = normaliseHex(hexText);
    if (hex) onPick(hex);
    else setHexText(value); // revert invalid input
  };

  return (
    <div className="color-picker" ref={rootRef} role="dialog" aria-label="Choose colour">
      <div className="color-picker__swatches">
        {ROW_PALETTE.map((c) => {
          const active = c.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              className={active ? 'color-picker__swatch active' : 'color-picker__swatch'}
              style={{ background: c }}
              title={c}
              aria-label={c}
              onClick={() => onPick(c)}
            />
          );
        })}
      </div>
      <div className="color-picker__custom">
        <input
          type="color"
          className="color-picker__native"
          value={normaliseHex(value) ?? '#000000'}
          onChange={(e) => onPick(e.target.value)}
          aria-label="Custom colour"
        />
        <input
          type="text"
          className="color-picker__hex"
          value={hexText}
          spellCheck={false}
          placeholder="#RRGGBB"
          onChange={(e) => setHexText(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitHex();
            }
          }}
          aria-label="Hex colour"
        />
      </div>
    </div>
  );
}
