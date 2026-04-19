'use client';

import { useRef, useCallback, useEffect } from 'react';

const MAX_HISTORY = 100;

/**
 * Undo/redo history hook.
 *
 * Each entry: { type: string, key: string, before: any, after: any }
 *
 * @param {Object} handlers — map of type → { apply(key, value), save(key, value) }
 *   apply: immediately updates the 3D scene / UI
 *   save:  persists to Firebase (debounced by the caller)
 */
export function useHistory(handlers) {
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  /** Push a new action onto the history. Clears redo stack. */
  const push = useCallback((entry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > MAX_HISTORY) {
      undoStack.current.shift();
    }
    redoStack.current = [];
  }, []);

  /** Undo the last action. */
  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push(entry);

    const h = handlersRef.current[entry.type];
    if (h) {
      h.apply(entry.key, entry.before);
      h.save(entry.key, entry.before);
    }
  }, []);

  /** Redo the last undone action. */
  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry);

    const h = handlersRef.current[entry.type];
    if (h) {
      h.apply(entry.key, entry.after);
      h.save(entry.key, entry.after);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e) => {
      const isMac = navigator.platform?.startsWith('Mac');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'z') return;

      // Don't intercept when typing in inputs
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return { push, undo, redo };
}
