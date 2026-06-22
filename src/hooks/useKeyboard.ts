// Global keyboard shortcuts (spec §15). Ignores events while typing in a field.

import { useEffect } from 'react';
import { useStore, undo, redo } from '../store/store';
import { transport } from '../audio/transport';
import { exportProjectToFile } from '../persistence/json';

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const s = useStore.getState();

      // Cmd/Ctrl combos first
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        exportProjectToFile(s.exportProject());
        return;
      }
      if (mod) return; // leave other browser shortcuts alone

      switch (e.key) {
        case ' ':
          e.preventDefault();
          void transport.togglePlay();
          break;
        case 'Enter':
          e.preventDefault();
          transport.stop();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) transport.jumpSection(-1);
          else transport.jumpBar(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) transport.jumpSection(1);
          else transport.jumpBar(1);
          break;
        case 'Home':
          e.preventDefault();
          transport.jumpStart();
          break;
        case 'End':
          e.preventDefault();
          transport.jumpEnd();
          break;
        case '+':
        case '=':
          e.preventDefault();
          s.zoomBy(1.25);
          break;
        case '-':
        case '_':
          e.preventDefault();
          s.zoomBy(0.8);
          break;
        case '0':
          e.preventDefault();
          s.zoomToFit();
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          s.deleteSelected();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
