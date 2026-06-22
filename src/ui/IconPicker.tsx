import { useEffect, useMemo, useRef, useState } from 'react';
import { getIcon, ICON_NAMES } from './lucide';
import './IconPicker.css';

/** Max icons rendered at once — ICON_NAMES has ~1500 entries, so cap for perf. */
const MAX_RENDERED = 240;

export interface IconPickerProps {
  /** Currently selected icon name (kebab-case). */
  value: string;
  /** Called with the chosen icon name. */
  onPick: (name: string) => void;
  /** Called when the popover should close (outside click / Esc). */
  onClose: () => void;
}

export function IconPicker({ value, onPick, onClose }: IconPickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search field on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on outside click + Escape.
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
    // capture so we beat any stopPropagation on inner handlers
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? ICON_NAMES.filter((n) => n.includes(q)) : ICON_NAMES;
    return list.slice(0, MAX_RENDERED);
  }, [query]);

  const totalMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ICON_NAMES.filter((n) => n.includes(q)).length : ICON_NAMES.length;
  }, [query]);

  return (
    <div className="icon-picker" ref={rootRef} role="dialog" aria-label="Choose icon">
      <input
        ref={inputRef}
        className="icon-picker__search"
        type="text"
        placeholder="Search icons…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search icons"
      />
      <div className="icon-picker__grid" role="listbox">
        {matches.map((name) => {
          const Icon = getIcon(name);
          const active = name === value;
          return (
            <button
              key={name}
              type="button"
              className={active ? 'icon-picker__item active' : 'icon-picker__item'}
              title={name}
              aria-label={name}
              aria-selected={active}
              role="option"
              onClick={() => onPick(name)}
            >
              <Icon size={18} />
            </button>
          );
        })}
        {matches.length === 0 && <div className="icon-picker__empty">No icons match.</div>}
      </div>
      {totalMatches > matches.length && (
        <div className="icon-picker__more">
          Showing {matches.length} of {totalMatches} — refine your search.
        </div>
      )}
    </div>
  );
}
