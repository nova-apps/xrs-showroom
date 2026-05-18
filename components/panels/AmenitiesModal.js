'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';

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

const MAX_DIM = 1600;
const WEBP_QUALITY = 0.8;
const ALREADY_OPTIMIZED_BYTES = 300_000;

async function compressImage(input, originalName = 'image') {
  const type = input.type || '';
  if (!type.startsWith('image/')) return { blob: input, name: originalName };

  const bitmap = await createImageBitmap(input);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY)
  );
  if (!blob) return { blob: input, name: originalName };

  const baseName = originalName.replace(/\.[^.]+$/, '');
  return { blob, name: `${baseName}.webp` };
}

export default function AmenitiesModal({ items = [], sceneId, onSave, onClose }) {
  const [rows, setRows] = useState(() =>
    items.length > 0 ? items.map((it) => ({ ...emptyRow(), ...it })) : [emptyRow()]
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [uploadingCell, setUploadingCell] = useState(null); // { idx, mode }
  const [uploadProgress, setUploadProgress] = useState(0);
  const [bulkRecompress, setBulkRecompress] = useState(null); // { done, total } | null
  const tableRef = useRef(null);
  const pendingDeletesRef = useRef([]);

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

    setUploadingCell({ idx, mode: 'upload' });
    setUploadProgress(0);

    let blob = file;
    let name = file.name;
    try {
      const compressed = await compressImage(file, file.name);
      blob = compressed.blob;
      name = compressed.name;
    } catch (err) {
      console.warn('[Amenity Upload] Compression failed, uploading original:', err);
    }

    const path = `scenes/${sceneId}/amenities/${Date.now()}_${name}`;
    const fileRef = storageRef(storage, path);
    const uploadTask = uploadBytesResumable(fileRef, blob, {
      contentType: blob.type || file.type,
      cacheControl: 'public, max-age=2592000, immutable',
    });

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

  // ─── Recompress existing plano ───
  const recompressUrl = useCallback(async (idx, url) => {
    if (!url || !sceneId) return { skipped: true, reason: 'no-url' };

    setUploadingCell({ idx, mode: 'recompress' });
    setUploadProgress(0);

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`fetch ${resp.status}`);
      const original = await resp.blob();

      if (!original.type.startsWith('image/')) {
        return { skipped: true, reason: 'not-image' };
      }
      if (original.type === 'image/webp' && original.size < ALREADY_OPTIMIZED_BYTES) {
        return { skipped: true, reason: 'already-optimized' };
      }

      const { blob, name } = await compressImage(original, 'amenity.jpg');
      if (blob.size >= original.size) {
        return { skipped: true, reason: 'compression-not-helpful' };
      }

      const path = `scenes/${sceneId}/amenities/${Date.now()}_${name}`;
      const fileRef = storageRef(storage, path);
      const uploadTask = uploadBytesResumable(fileRef, blob, {
        contentType: blob.type,
        cacheControl: 'public, max-age=2592000, immutable',
      });

      const newUrl = await new Promise((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          reject,
          async () => {
            try { resolve(await getDownloadURL(uploadTask.snapshot.ref)); }
            catch (err) { reject(err); }
          }
        );
      });

      pendingDeletesRef.current.push(url);
      setRows((prev) => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], plano: newUrl };
        return updated;
      });
      setHasChanges(true);
      return { skipped: false, savedBytes: original.size - blob.size };
    } finally {
      setUploadingCell(null);
      setUploadProgress(0);
    }
  }, [sceneId]);

  const handleRecompress = useCallback(async (idx) => {
    if (uploadingCell) return;
    const url = rows[idx]?.plano;
    if (!url) return;
    try {
      const result = await recompressUrl(idx, url);
      if (result.skipped) {
        console.log('[Amenity Recompress] Skipped:', result.reason);
      } else {
        console.log(`[Amenity Recompress] Saved ${(result.savedBytes / 1024).toFixed(0)} KB`);
      }
    } catch (err) {
      console.error('[Amenity Recompress] Error:', err);
      window.alert('Error al comprimir. Revisá la consola.');
    }
  }, [rows, uploadingCell, recompressUrl]);

  const handleRecompressAll = useCallback(async () => {
    if (uploadingCell || bulkRecompress) return;
    const jobs = rows
      .map((r, i) => ({ idx: i, url: r.plano }))
      .filter((j) => j.url);
    if (jobs.length === 0) return;

    setBulkRecompress({ done: 0, total: jobs.length });
    let totalSaved = 0;
    for (let i = 0; i < jobs.length; i++) {
      try {
        const result = await recompressUrl(jobs[i].idx, jobs[i].url);
        if (!result.skipped) totalSaved += result.savedBytes;
      } catch (err) {
        console.error('[Amenity Recompress] Job failed:', err);
      }
      setBulkRecompress({ done: i + 1, total: jobs.length });
    }
    setBulkRecompress(null);
    if (totalSaved > 0) {
      console.log(`[Amenity Recompress] Total saved: ${(totalSaved / 1024).toFixed(0)} KB`);
    }
  }, [rows, uploadingCell, bulkRecompress, recompressUrl]);

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

      // Flush pending deletes only after a successful save — if the save
      // fails (or user never saves), the old URLs remain valid in Firestore.
      const toDelete = pendingDeletesRef.current.splice(0);
      for (const url of toDelete) {
        try {
          await deleteObject(storageRef(storage, url));
        } catch (err) {
          console.warn('[AmenitiesModal] Failed to delete old plano:', err);
        }
      }
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
                              ? uploadingCell.mode === 'recompress'
                                ? (uploadProgress > 0 ? `🗜️ ${uploadProgress}%` : '🗜️ …')
                                : `${uploadProgress}%`
                              : row[col.key]
                                ? '🔄'
                                : '📁 Subir'}
                            <input
                              type="file"
                              accept="image/*,.pdf"
                              style={{ display: 'none' }}
                              disabled={uploadingCell !== null || bulkRecompress !== null}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(rowIdx, file);
                                e.target.value = '';
                              }}
                            />
                          </label>
                          {row[col.key] && (
                            <>
                              <button
                                className="amenity-clear-plano"
                                onClick={() => handleRecompress(rowIdx)}
                                disabled={uploadingCell !== null || bulkRecompress !== null}
                                title="Comprimir plano existente"
                              >
                                🗜️
                              </button>
                              <button
                                className="amenity-clear-plano"
                                onClick={() => handleChange(rowIdx, col.key, '')}
                                disabled={uploadingCell !== null || bulkRecompress !== null}
                                title="Quitar"
                              >
                                ✕
                              </button>
                            </>
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
          <button
            className="ucm-add-btn"
            onClick={handleRecompressAll}
            disabled={uploadingCell !== null || bulkRecompress !== null || !rows.some((r) => r.plano)}
            title="Recomprime todos los planos existentes que no estén ya optimizados"
          >
            {bulkRecompress
              ? `🗜️ Comprimiendo ${bulkRecompress.done}/${bulkRecompress.total}…`
              : '🗜️ Comprimir todos'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
