import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderMinus,
  FolderPlus,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import type { Row } from '../model/types';
import { useStore } from '../store/store';
import { subtreeIds } from '../core/rowtree';
import { GROUP_INDENT } from './metrics';
import { getIcon } from './lucide';
import { IconPicker } from './IconPicker';
import { ColorPicker } from './ColorPicker';
import './RowGutter.css';

export interface RowGutterProps {
  row: Row;
  depth: number;
  dragging?: boolean;
  onGripPointerDown?: (e: React.PointerEvent, rowId: string) => void;
}

type OpenPopover = 'none' | 'icon' | 'color';

export function RowGutter({ row, depth, dragging, onGripPointerDown }: RowGutterProps): JSX.Element {
  const updateRow = useStore((s) => s.updateRow);
  const moveRow = useStore((s) => s.moveRow);
  const removeRow = useStore((s) => s.removeRow);
  const removeGroup = useStore((s) => s.removeGroup);
  const toggleCollapse = useStore((s) => s.toggleCollapse);
  const addCueRow = useStore((s) => s.addCueRow);
  const addGroup = useStore((s) => s.addGroup);

  const [name, setName] = useState(row.name);
  const [popover, setPopover] = useState<OpenPopover>('none');

  // Keep the local input in sync when the row name changes externally (undo, load…).
  useEffect(() => {
    setName(row.name);
  }, [row.name]);

  const commitName = () => {
    if (name !== row.name) updateRow(row.id, { name });
  };

  const isCue = row.kind === 'cue';
  const isGroup = row.kind === 'group';
  const isFixed = row.kind === 'track' || row.kind === 'section';
  const Icon = getIcon(row.icon);

  const handleRemoveCue = () => {
    const blocks = useStore.getState().core.blocks.filter((b) => b.rowId === row.id).length;
    if (blocks > 0 && !window.confirm(`Delete row “${row.name}” and its ${blocks} block${blocks === 1 ? '' : 's'}?`)) {
      return;
    }
    removeRow(row.id);
  };

  const handleDeleteGroup = () => {
    const { rows, blocks } = useStore.getState().core;
    const ids = subtreeIds(rows, row.id);
    const rowCount = ids.size - 1; // excluding the group itself
    const blockCount = blocks.filter((b) => ids.has(b.rowId)).length;
    const detail = rowCount > 0 || blockCount > 0 ? ` and its ${rowCount} row${rowCount === 1 ? '' : 's'}` : '';
    if (window.confirm(`Delete group “${row.name}”${detail}? This can be undone.`)) {
      removeGroup(row.id, 'delete');
    }
  };

  return (
    <div
      className={`row-gutter row-gutter--${row.kind}${dragging ? ' row-gutter--dragging' : ''}`}
      style={{ boxShadow: `inset 3px 0 0 ${row.color}` }}
    >
      {depth > 0 && (
        <span className="row-gutter__indent" aria-hidden="true">
          {Array.from({ length: depth }, (_, i) => (
            <span key={i} className="row-gutter__indent-rail" style={{ width: GROUP_INDENT }} />
          ))}
        </span>
      )}

      {!isFixed && (
        <button
          type="button"
          className="row-gutter__grip"
          title="Drag to reorder / nest"
          aria-label="Drag handle"
          onPointerDown={(e) => onGripPointerDown?.(e, row.id)}
        >
          <GripVertical size={14} />
        </button>
      )}

      {isGroup && (
        <button
          type="button"
          className="row-gutter__chevron"
          title={row.collapsed ? 'Expand group' : 'Collapse group'}
          aria-label={row.collapsed ? 'Expand group' : 'Collapse group'}
          aria-expanded={!row.collapsed}
          onClick={() => toggleCollapse(row.id)}
        >
          {row.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
      )}

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
        aria-label={isGroup ? 'Group name' : 'Row name'}
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

      {(isCue || isGroup) && (
        <div className="row-gutter__actions">
          {isGroup && (
            <>
              <button
                type="button"
                className="ghost icon row-gutter__act"
                title="Add cue row to group"
                aria-label="Add cue row to group"
                onClick={() => addCueRow(row.id)}
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                className="ghost icon row-gutter__act"
                title="Add subgroup"
                aria-label="Add subgroup"
                onClick={() => addGroup(row.id)}
              >
                <FolderPlus size={14} />
              </button>
            </>
          )}
          <button
            type="button"
            className="ghost icon row-gutter__act"
            title="Move up"
            aria-label="Move up"
            onClick={() => moveRow(row.id, -1)}
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            className="ghost icon row-gutter__act"
            title="Move down"
            aria-label="Move down"
            onClick={() => moveRow(row.id, 1)}
          >
            <ChevronDown size={14} />
          </button>
          {isGroup && (
            <button
              type="button"
              className="ghost icon row-gutter__act"
              title="Ungroup (keep rows)"
              aria-label="Ungroup, keeping its rows"
              onClick={() => removeGroup(row.id, 'ungroup')}
            >
              <FolderMinus size={14} />
            </button>
          )}
          <button
            type="button"
            className="ghost icon row-gutter__remove"
            title={isGroup ? 'Delete group' : 'Remove row'}
            aria-label={isGroup ? 'Delete group' : 'Remove row'}
            onClick={isGroup ? handleDeleteGroup : handleRemoveCue}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
