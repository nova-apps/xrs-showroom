'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

/**
 * Column definitions for the amenities table.
 */
const COLUMNS = [
  { key: 'nombre',      label: 'Nombre',      type: 'text',     placeholder: 'Ej: Piscina' },
  { key: 'descripcion', label: 'Descripción',  type: 'text',     placeholder: 'Descripción...' },
  { key: 'plano',       label: 'Plano',        type: 'file',     placeholder: 'Subir imagen...' },
];

function emptyRow() {
  const row = {};
  COLUMNS.forEach((col) => { row[col.key] = ''; });
  return row;
}

export default function AmenitiesModal({ items = [], sceneId, onSave, onClose }) {
  const [rows, setRows] = useState(() =>
    items.length > 0 ? items.map((it) => ({ ...emptyRow(), ...it })) : [emptyRow()]
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [uploadingCell, setUploadingCell] = useState(null); // { idx }
  const [uploadProgress, setUploadProgress] = useState(0);
  const tableRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);

  // ─── Cell editing ───
  const handleChange = useCallback((rowIdx, colKey, value) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[rowIdx] = { ...updated[rowIdx], [colKey]: value };
      return updated;
    });
    setHasChanges(true);
  }, []);

  // ─── Row operations ───
  const addRow = useCallback(() => {
    setRows((prev) => [...prev, emptyRow()]);
    setHasChanges(true);
    setTimeout(() => {
      if (tableRef.current) {
        tableRef.current.scrollTop = tableRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  const removeRow = useCallback((idx) => {
    setRows((prev) => {
      if (prev.length === 1) return [emptyRow()];
      return prev.filter((_, i) => i !== idx);
    });
    setHasChanges(true);
  }, []);

  const duplicateRow = useCallback((idx) => {
    setRows((prev) => {
      const copy = { ...prev[idx] };
      const updated = [...prev];
      updated.splice(idx + 1, 0, copy);
      return updated;
    });
    setHasChanges(true);
  }, []);

  // ─── File upload ───
  const handleFileUpload = useCallback(async (idx, file) => {
    if (!file || !sceneId) return;

    setUploadingCell({ idx });
    setUploadProgress(0);

    const path = `scenes/${sceneId}/amenities/${Date.now()}_${file.name}`;
    const fileRef = storageRef(storage, path);
    const uploadTask = uploadBytesResumable(fileRef, file);

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        setUploadProgress(pct);
      },
      (error) => {
        console.error('[Amenity Upload] Error:', error);
        setUploadingCell(null);
        setUploadProgress(0);
      },
      async () => {
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          setRows((prev) => {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], plano: url };
            return updated;
          });
          setHasChanges(true);
        } catch (err) {
          console.error('[Amenity Upload] getDownloadURL error:', err);
        }
        setUploadingCell(null);
        setUploadProgress(0);
      }
    );
  }, [sceneId]);

  // ─── Save ───
  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const cleaned = rows.filter(
        (r) => COLUMNS.some((col) => (r[col.key] || '').toString().trim())
      );
      await onSave?.(cleaned);
      setHasChanges(false);
    } catch (err) {
      console.error('[AmenitiesModal] Save error:', err);
    }
    setSaving(false);
  }, [rows, onSave, saving]);

  const handleClose = useCallback(() => {
    if (hasChanges) {
      if (!window.confirm('Tenés cambios sin guardar. ¿Cerrar de todos modos?')) return;
    }
    onClose();
  }, [hasChanges, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="ucm-overlay" onClick={handleClose}>
      <div className="ucm-modal amenities-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ucm-header">
          <div className="ucm-header-left">
            <h2 className="ucm-title">🏊 Gestionar Amenities</h2>
            <span className="ucm-count">
              {rows.length} {rows.length === 1 ? 'amenity' : 'amenities'}
            </span>
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

        {/* Table */}
        <div className="ucm-table-wrap" ref={tableRef}>
          <table className="ucm-table">
            <thead>
              <tr>
                <th className="ucm-th ucm-th-idx">#</th>
                {COLUMNS.map((col) => (
                  <th key={col.key} className="ucm-th">{col.label}</th>
                ))}
                <th className="ucm-th ucm-th-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx} className="ucm-row">
                  <td className="ucm-td ucm-td-idx">{rowIdx + 1}</td>

                  {COLUMNS.map((col) => (
                    <td key={col.key} className="ucm-td">
                      {col.type === 'file' ? (
                        <div className="amenity-plano-cell">
                          {row[col.key] ? (
                            <a
                              href={row[col.key]}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="amenity-plano-link"
                              title="Ver plano"
                            >
                              <img
                                src={row[col.key]}
                                alt="plano"
                                className="amenity-plano-thumb-sm"
                              />
                            </a>
                          ) : null}
                          <label className="amenity-upload-btn-sm">
                            {uploadingCell?.idx === rowIdx
                              ? `${uploadProgress}%`
                              : row[col.key]
                                ? '🔄'
                                : '📁 Subir'}
                            <input
                              type="file"
                              accept="image/*,.pdf"
                              style={{ display: 'none' }}
                              disabled={uploadingCell !== null}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(rowIdx, file);
                                e.target.value = '';
                              }}
                            />
                          </label>
                          {row[col.key] && (
                            <button
                              className="amenity-clear-plano"
                              onClick={() => handleChange(rowIdx, col.key, '')}
                              title="Quitar"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ) : (
                        <input
                          className="ucm-input"
                          type={col.type}
                          value={row[col.key] || ''}
                          onChange={(e) => handleChange(rowIdx, col.key, e.target.value)}
                          placeholder={col.placeholder}
                        />
                      )}
                    </td>
                  ))}

                  <td className="ucm-td ucm-td-actions">
                    <button
                      className="ucm-action-btn"
                      onClick={() => duplicateRow(rowIdx)}
                      title="Duplicar"
                    >📋</button>
                    <button
                      className="ucm-action-btn ucm-action-btn-delete"
                      onClick={() => removeRow(rowIdx)}
                      title="Eliminar"
                    >🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add row */}
        <div className="ucm-footer">
          <button className="ucm-add-btn" onClick={addRow}>
            ➕ Agregar Amenity
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
