import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { Row } from '../model/types';
import { useStore } from '../store/store';
import { getIcon } from './lucide';
import { IconPicker } from './IconPicker';
import { ColorPicker } from './ColorPicker';
import './RowGutter.css';

export interface RowGutterProps {
  row: Row;
}

type OpenPopover = 'none' | 'icon' | 'color';

export function RowGutter({ row }: RowGutterProps): JSX.Element {
  const updateRow = useStore((s) => s.updateRow);
  const moveRow = useStore((s) => s.moveRow);
  const removeRow = useStore((s) => s.removeRow);
  // Subscribe to this row's block count so the remove-confirm decision is current.
  const rowBlockCount = useStore((s) => s.core.blocks.reduce((n, b) => (b.rowId === row.id ? n + 1 : n), 0));

  const [name, setName] = useState(row.name);
  const [popover, setPopover] = useState<OpenPopover>('none');

  // Keep the local input in sync when the row name changes externally (undo, load…).
  useEffect(() => {
    setName(row.name);
  }, [row.name]);

  const commitName = () => {
    const trimmed = name;
    if (trimmed !== row.name) updateRow(row.id, { name: trimmed });
  };

  const isCue = row.kind === 'cue';
  const Icon = getIcon(row.icon);

  const handleRemove = () => {
    if (rowBlockCount > 0) {
      const ok = window.confirm(
        `Delete row “${row.name}” and its ${rowBlockCount} block${rowBlockCount === 1 ? '' : 's'}?`,
      );
      if (!ok) return;
    }
    removeRow(row.id);
  };

  return (
    <div className={`row-gutter row-gutter--${row.kind}`}>
      <div className="row-gutter__icon-wrap">
        <button
          type="button"
          className="row-gutter__icon"
          title="Change icon"
          aria-label="Change icon"
          data-popover-trigger
          style={{ color: row.color }}
          onClick={() => setPopover((p) => (p === 'icon' ? 'none' : 'icon'))}
        >
          <Icon size={18} />
        </button>
        {popover === 'icon' && (
          <IconPicker
            value={row.icon}
            onPick={(icon) => {
              updateRow(row.id, { icon });
              setPopover('none');
            }}
            onClose={() => setPopover('none')}
          />
        )}
      </div>

      <input
        className="row-gutter__name"
        type="text"
        value={name}
        title={row.name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setName(row.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Row name"
      />

      <div className="row-gutter__color-wrap">
        <button
          type="button"
          className="row-gutter__swatch"
          title="Change colour"
          aria-label="Change colour"
          data-popover-trigger
          style={{ background: row.color }}
          onClick={() => setPopover((p) => (p === 'color' ? 'none' : 'color'))}
        />
        {popover === 'color' && (
          <ColorPicker
            value={row.color}
            onPick={(color) => updateRow(row.id, { color })}
            onClose={() => setPopover('none')}
          />
        )}
      </div>

      {isCue && (
        <div className="row-gutter__actions">
          <button
            type="button"
            className="ghost icon row-gutter__reorder"
            title="Move row up"
            aria-label="Move row up"
            onClick={() => moveRow(row.id, -1)}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            className="ghost icon row-gutter__reorder"
            title="Move row down"
            aria-label="Move row down"
            onClick={() => moveRow(row.id, 1)}
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className="ghost icon row-gutter__remove"
            title="Remove row"
            aria-label="Remove row"
            onClick={handleRemove}
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
