'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

const newBarrioId = () =>
  `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

function emptyRow() {
  return { id: newBarrioId(), nombre: '', color: '#3b82f6' };
}

/**
 * BarriosModal — manage barrios (neighborhoods) for a terreno-type scene.
 *
 * Barrios are a grouping dimension for lotes. Schema: { id, nombre, color? }.
 * Deletion is blocked if any lote still references the barrio — the user has
 * to re-assign or delete those lotes first.
 */
export default function BarriosModal({ items = [], lotes = [], onSave, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const tableRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (items && items.length > 0) {
      // Preserve ids; generate one for any item missing it (defensive).
      setRows(items.map((item) => ({ ...emptyRow(), ...item, id: item.id || newBarrioId() })));
    } else {
      setRows([emptyRow()]);
    }
    setHasChanges(false);
  }, []);

  const loteCountByBarrio = useMemo(() => {
    const map = new Map();
    for (const lote of lotes || []) {
      if (!lote?.barrioId) continue;
      map.set(lote.barrioId, (map.get(lote.barrioId) || 0) + 1);
    }
    return map;
  }, [lotes]);

  const handleCellChange = useCallback((rowIndex, key, value) => {
    setRows((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [key]: value };
      return next;
    });
    setHasChanges(true);
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, emptyRow()]);
    setHasChanges(true);
    setTimeout(() => {
      if (tableRef.current) tableRef.current.scrollTop = tableRef.current.scrollHeight;
    }, 50);
  }, []);

  const removeRow = useCallback((index) => {
    setRows((prev) => {
      const target = prev[index];
      const inUse = loteCountByBarrio.get(target?.id) || 0;
      if (inUse > 0) {
        window.alert(
          `No se puede eliminar este barrio: tiene ${inUse} lote${inUse === 1 ? '' : 's'} asignado${inUse === 1 ? '' : 's'}.\n\n` +
          'Reasigná o eliminá esos lotes primero desde "Cargar Lotes".',
        );
        return prev;
      }
      if (prev.length <= 1) return [emptyRow()];
      return prev.filter((_, i) => i !== index);
    });
    setHasChanges(true);
  }, [loteCountByBarrio]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const validRows = rows
        .filter((row) => (row.nombre || '').trim() !== '')
        .map((row) => ({
          id: row.id || newBarrioId(),
          nombre: row.nombre.trim(),
          color: row.color || null,
        }));
      await onSave(validRows);
      setHasChanges(false);
    } catch (err) {
      console.error('[BarriosModal] Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [rows, onSave]);

  const handleClose = useCallback(() => {
    if (hasChanges) {
      if (!window.confirm('Tenés cambios sin guardar. ¿Cerrar de todos modos?')) return;
    }
    onClose();
  }, [hasChanges, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="ucm-overlay" onClick={handleClose}>
      <div className="ucm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ucm-header">
          <div className="ucm-header-left">
            <h2 className="ucm-title">🗺️ Gestionar Barrios</h2>
            <span className="ucm-count">{rows.length} {rows.length === 1 ? 'barrio' : 'barrios'}</span>
          </div>
          <div className="ucm-header-right">
            <button
              className={`ucm-save-btn ${saving ? 'saving' : ''} ${!hasChanges ? 'disabled' : ''}`}
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? '⏳ Guardando…' : '💾 Guardar'}
            </button>
            <button className="ucm-close-btn" onClick={handleClose} title="Cerrar">
              ✕
            </button>
          </div>
        </div>

        <div className="ucm-hint">
          Los barrios agrupan los lotes. El color se usa como chip de filtro en el panel del visor.
        </div>

        <div className="ucm-table-wrap" ref={tableRef}>
          <table className="ucm-table">
            <thead>
              <tr>
                <th className="ucm-th ucm-th-num">#</th>
                <th className="ucm-th">Nombre</th>
                <th className="ucm-th">Color</th>
                <th className="ucm-th">Lotes</th>
                <th className="ucm-th ucm-th-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const usage = loteCountByBarrio.get(row.id) || 0;
                return (
                  <tr key={row.id || ri} className="ucm-row">
                    <td className="ucm-td ucm-td-num">{ri + 1}</td>
                    <td className="ucm-td">
                      <input
                        type="text"
                        className="ucm-input"
                        placeholder="Ej: Barrio Norte"
                        value={row.nombre ?? ''}
                        onChange={(e) => handleCellChange(ri, 'nombre', e.target.value)}
                      />
                    </td>
                    <td className="ucm-td">
                      <input
                        type="color"
                        className="ucm-input"
                        style={{ padding: 2, height: 32 }}
                        value={row.color || '#3b82f6'}
                        onChange={(e) => handleCellChange(ri, 'color', e.target.value)}
                      />
                    </td>
                    <td className="ucm-td" style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
                      {usage}
                    </td>
                    <td className="ucm-td ucm-td-actions">
                      <button
                        className="ucm-row-btn ucm-row-del"
                        onClick={() => removeRow(ri)}
                        title={usage > 0 ? `${usage} lote(s) usan este barrio` : 'Eliminar barrio'}
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="ucm-footer">
          <button className="ucm-add-btn" onClick={addRow}>+ Agregar barrio</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
