'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { db, storage } from '@/lib/firebase';
import { ref as dbRef, get } from 'firebase/database';
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { normalizeTour, tourNodeList } from '@/lib/tour';
import TourEditorModal from './TourEditorModal';

/** Free-text columns rendered as plain inputs. */
const TEXT_COLUMNS = [
  { key: 'nombre',      label: 'Nombre',      placeholder: 'Ej: Piscina' },
  { key: 'descripcion', label: 'Descripción', placeholder: 'Descripción...' },
];

/** A fresh, fully-formed amenity row. */
function emptyRow() {
  return { nombre: '', descripcion: '', plano: '', imagenes: [], thumbnail: '', tour: null, oculto: false };
}

/** Coerce a possibly-RTDB-shaped value into a clean array of URLs. */
function toImageArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v && typeof v === 'object') return Object.values(v).filter(Boolean);
  return [];
}

/** Normalize an incoming item (from Firebase) into the editor row shape. */
function normalizeRow(it) {
  return {
    ...emptyRow(),
    ...it,
    imagenes: toImageArray(it?.imagenes),
  };
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

/* ─── CSV parsing (shared shape with UnidadesCargaModal) ─── */

/** Split CSV text into lines, respecting quoted fields that span newlines. */
function splitCSVLines(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (current.trim()) lines.push(current);
      current = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

/** Split a CSV line into cells, respecting quoted fields. */
function splitCSVRow(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === ';') && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

const normHeader = (s) =>
  (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');

/** Collapse stray tabs / repeated whitespace a spreadsheet may leave behind. */
const cleanText = (s) => (s || '').replace(/\s+/g, ' ').trim();

/**
 * Parse an amenities CSV into editor rows.
 * Recognised headers (accent/case-insensitive):
 *   Amenity → nombre, Descripción → descripcion, Imagen → plano (cover),
 *   "Imagen 1".."Imagen N" → imagenes[] (gallery), Thumbnail → thumbnail.
 * Unknown columns are ignored.
 */
function parseAmenitiesCSV(text) {
  const lines = splitCSVLines(text);
  if (lines.length === 0) return [];

  const header = splitCSVRow(lines[0]).map(normHeader);
  const col = {};               // field → cell index
  const galleryIdx = [];        // ordered list of gallery cell indices
  header.forEach((h, i) => {
    if (h === 'amenity' || h === 'nombre' || h === 'name') col.nombre = i;
    else if (h === 'descripcion' || h === 'description') col.descripcion = i;
    else if (h === 'imagen' || h === 'imagen principal' || h === 'plano') col.plano = i;
    else if (h === 'thumbnail' || h === 'miniatura') col.thumbnail = i;
    else if (/^imagen \d+$/.test(h)) galleryIdx.push(i);
  });

  return lines.slice(1).map((line) => {
    const cells = splitCSVRow(line);
    const at = (i) => (i == null ? '' : (cells[i] ?? '').trim());
    const cover = at(col.plano);
    const gallery = galleryIdx.map((i) => at(i)).filter(Boolean);
    return {
      ...emptyRow(),
      nombre: cleanText(at(col.nombre)),
      descripcion: cleanText(at(col.descripcion)),
      plano: cover,
      imagenes: gallery,
      thumbnail: at(col.thumbnail),
    };
  }).filter((r) => r.nombre || r.descripcion || r.plano || r.thumbnail || r.imagenes.length);
}

export default function AmenitiesModal({ items = [], sceneId, onSave, onClose }) {
  const [rows, setRows] = useState(() =>
    items.length > 0 ? items.map(normalizeRow) : [emptyRow()]
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [uploadingCell, setUploadingCell] = useState(null); // { idx, mode, field }
  const [uploadProgress, setUploadProgress] = useState(0);
  const [bulkRecompress, setBulkRecompress] = useState(null); // { done, total } | null
  const [csvStatus, setCsvStatus] = useState(null); // null | { type, msg }
  const [tourEditorIdx, setTourEditorIdx] = useState(null); // row index | null
  const tableRef = useRef(null);
  const importInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const pendingDeletesRef = useRef([]);

  useEffect(() => { setMounted(true); }, []);

  const flashStatus = useCallback((type, msg, ms = 4000) => {
    setCsvStatus({ type, msg });
    setTimeout(() => setCsvStatus(null), ms);
  }, []);

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
      if (tableRef.current) tableRef.current.scrollTop = tableRef.current.scrollHeight;
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
      const copy = { ...prev[idx], imagenes: [...(prev[idx].imagenes || [])] };
      const updated = [...prev];
      updated.splice(idx + 1, 0, copy);
      return updated;
    });
    setHasChanges(true);
  }, []);

  // Hide an amenity from the public list without deleting it (keeps all its
  // data — images, gallery, tour). Toggled back on the same button.
  const toggleHidden = useCallback((idx) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], oculto: !updated[idx].oculto };
      return updated;
    });
    setHasChanges(true);
  }, []);

  // ─── Core upload: compress → upload → resolve URL ───
  const doUpload = useCallback(async (file) => {
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

    return await new Promise((resolve, reject) => {
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
  }, [sceneId]);

  // ─── Single-image upload (plano cover or thumbnail) ───
  const handleFileUpload = useCallback(async (idx, file, field) => {
    if (!file || !sceneId) return;
    setUploadingCell({ idx, mode: 'upload', field });
    setUploadProgress(0);
    try {
      const url = await doUpload(file);
      setRows((prev) => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], [field]: url };
        return updated;
      });
      setHasChanges(true);
    } catch (err) {
      console.error('[Amenity Upload] Error:', err);
    } finally {
      setUploadingCell(null);
      setUploadProgress(0);
    }
  }, [sceneId, doUpload]);

  // ─── Gallery: append one or more images sequentially ───
  const handleGalleryAdd = useCallback(async (idx, fileList) => {
    if (!sceneId || !fileList?.length) return;
    const files = Array.from(fileList);
    for (const file of files) {
      setUploadingCell({ idx, mode: 'upload', field: 'imagenes' });
      setUploadProgress(0);
      try {
        const url = await doUpload(file);
        setRows((prev) => {
          const updated = [...prev];
          const arr = Array.isArray(updated[idx].imagenes) ? updated[idx].imagenes : [];
          updated[idx] = { ...updated[idx], imagenes: [...arr, url] };
          return updated;
        });
        setHasChanges(true);
      } catch (err) {
        console.error('[Amenity Gallery] Upload error:', err);
      }
    }
    setUploadingCell(null);
    setUploadProgress(0);
  }, [sceneId, doUpload]);

  const removeGalleryImage = useCallback((idx, imgIdx) => {
    setRows((prev) => {
      const updated = [...prev];
      const arr = (updated[idx].imagenes || []).filter((_, i) => i !== imgIdx);
      updated[idx] = { ...updated[idx], imagenes: arr };
      return updated;
    });
    setHasChanges(true);
  }, []);

  // ─── 360° tour editor ───
  const handleTourSave = useCallback((idx, tour) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], tour: tour || null };
      return updated;
    });
    setHasChanges(true);
  }, []);

  // Images of tour nodes deleted in the editor — flushed with the other
  // pending deletes after a successful save.
  const queueTourDelete = useCallback((url) => {
    if (url) pendingDeletesRef.current.push(url);
  }, []);

  // ─── Recompress existing cover (plano) ───
  const recompressUrl = useCallback(async (idx, url) => {
    if (!url || !sceneId) return { skipped: true, reason: 'no-url' };

    setUploadingCell({ idx, mode: 'recompress', field: 'plano' });
    setUploadProgress(0);

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`fetch ${resp.status}`);
      const original = await resp.blob();

      if (!original.type.startsWith('image/')) return { skipped: true, reason: 'not-image' };
      if (original.type === 'image/webp' && original.size < ALREADY_OPTIMIZED_BYTES) {
        return { skipped: true, reason: 'already-optimized' };
      }

      const { blob, name } = await compressImage(original, 'amenity.jpg');
      if (blob.size >= original.size) return { skipped: true, reason: 'compression-not-helpful' };

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
      if (result.skipped) console.log('[Amenity Recompress] Skipped:', result.reason);
      else console.log(`[Amenity Recompress] Saved ${(result.savedBytes / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.error('[Amenity Recompress] Error:', err);
      window.alert('Error al comprimir. Revisá la consola.');
    }
  }, [rows, uploadingCell, recompressUrl]);

  const handleRecompressAll = useCallback(async () => {
    if (uploadingCell || bulkRecompress) return;
    const jobs = rows.map((r, i) => ({ idx: i, url: r.plano })).filter((j) => j.url);
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
    if (totalSaved > 0) console.log(`[Amenity Recompress] Total saved: ${(totalSaved / 1024).toFixed(0)} KB`);
  }, [rows, uploadingCell, bulkRecompress, recompressUrl]);

  // ─── CSV import / replace ───
  const importCSV = useCallback((file, mode) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = parseAmenitiesCSV(evt.target.result);
        if (parsed.length === 0) {
          flashStatus('error', 'El CSV está vacío o no tiene datos válidos.');
          return;
        }
        setRows((prev) => {
          if (mode === 'replace') return parsed;
          const isEmpty = prev.length === 1 &&
            !prev[0].nombre && !prev[0].descripcion && !prev[0].plano &&
            !prev[0].thumbnail && !(prev[0].imagenes || []).length;
          return isEmpty ? parsed : [...prev, ...parsed];
        });
        setHasChanges(true);
        flashStatus('ok', mode === 'replace'
          ? `🔄 ${parsed.length} amenities reemplazadas desde CSV.`
          : `✅ ${parsed.length} amenities agregadas desde CSV.`);
      } catch (err) {
        console.error('[Amenity CSV] Parse error:', err);
        flashStatus('error', `Error al leer CSV: ${err.message}`, 5000);
      }
    };
    reader.readAsText(file);
  }, [flashStatus]);

  // ─── CSV export ───
  const handleCSVExport = useCallback(() => {
    const maxGallery = rows.reduce((m, r) => Math.max(m, (r.imagenes || []).length), 0);
    const header = ['Amenity', 'Descripción', 'Imagen',
      ...Array.from({ length: maxGallery }, (_, i) => `Imagen ${i + 1}`), 'Thumbnail'];
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) => {
      const gallery = r.imagenes || [];
      const cells = [r.nombre, r.descripcion, r.plano,
        ...Array.from({ length: maxGallery }, (_, i) => gallery[i] || ''), r.thumbnail];
      return cells.map(esc).join(',');
    });
    const csv = [header.map(esc).join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'amenities.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  // ─── Save ───
  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      // Normalize + drop empty rows. `plano` mirrors the first available image
      // so older readers (list panel, published view) keep working.
      const cleaned = rows
        .map((r) => {
          const imagenes = toImageArray(r.imagenes);
          const plano = (r.plano || '').trim() || imagenes[0] || '';
          const tour = normalizeTour(r.tour);
          return {
            nombre: (r.nombre || '').trim(),
            descripcion: (r.descripcion || '').trim(),
            plano,
            imagenes,
            thumbnail: (r.thumbnail || '').trim(),
            ...(tour ? { tour } : {}),
            // Persist only when hidden — keeps existing rows clean by default.
            ...(r.oculto ? { oculto: true } : {}),
          };
        })
        .filter((r) => r.nombre || r.descripcion || r.plano || r.thumbnail || r.imagenes.length || r.tour);

      await onSave?.(cleaned);
      setHasChanges(false);

      // Flush pending deletes only after a successful save, and never delete a
      // URL still referenced by the published snapshot (the live /view reads it).
      const toDelete = pendingDeletesRef.current.splice(0);
      let publishedUrls = new Set();
      try {
        const snap = await get(dbRef(db, `scenes/${sceneId}/published/amenities/items`));
        for (const item of Object.values(snap.val() || {})) {
          if (item?.plano) publishedUrls.add(item.plano);
          for (const u of toImageArray(item?.imagenes)) publishedUrls.add(u);
          if (item?.thumbnail) publishedUrls.add(item.thumbnail);
          const tour = normalizeTour(item?.tour);
          if (tour?.plano) publishedUrls.add(tour.plano);
          for (const node of Object.values(tour?.nodes || {})) {
            if (node.url) publishedUrls.add(node.url);
          }
        }
      } catch (err) {
        console.warn('[AmenitiesModal] Could not read published amenities; skipping deletes to be safe:', err);
        publishedUrls = new Set(toDelete);
      }
      for (const url of toDelete) {
        if (publishedUrls.has(url)) {
          console.log('[AmenitiesModal] Skipping delete — URL still referenced by published snapshot');
          continue;
        }
        try {
          await deleteObject(storageRef(storage, url));
        } catch (err) {
          console.warn('[AmenitiesModal] Failed to delete old image:', err);
        }
      }
    } catch (err) {
      console.error('[AmenitiesModal] Save error:', err);
    }
    setSaving(false);
  }, [rows, onSave, saving, sceneId]);

  const handleClose = useCallback(() => {
    if (hasChanges) {
      if (!window.confirm('Tenés cambios sin guardar. ¿Cerrar de todos modos?')) return;
    }
    onClose();
  }, [hasChanges, onClose]);

  if (!mounted) return null;

  const busy = uploadingCell !== null || bulkRecompress !== null;

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
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => { importCSV(e.target.files?.[0], 'append'); e.target.value = ''; }}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => { importCSV(e.target.files?.[0], 'replace'); e.target.value = ''; }}
            />
            <button className="ucm-csv-btn" onClick={handleCSVExport} title="Descargar CSV con todas las amenities">
              ⬇ Descargar CSV
            </button>
            <button
              className="ucm-csv-btn"
              onClick={() => importInputRef.current?.click()}
              title="Agregar amenities desde CSV (se suman a las existentes)"
            >
              📄 Importar CSV
            </button>
            <button
              className="ucm-csv-btn ucm-csv-btn-replace"
              onClick={() => {
                const hasData = rows.length > 1 || rows[0]?.nombre || rows[0]?.plano || (rows[0]?.imagenes || []).length;
                if (hasData && !window.confirm('Esto reemplazará TODAS las amenities actuales con el contenido del CSV. ¿Continuar?')) return;
                replaceInputRef.current?.click();
              }}
              title="Reemplazar todas las amenities con un nuevo CSV"
            >
              🔄 Reemplazar CSV
            </button>
            <button
              className={`ucm-save-btn ${saving ? 'saving' : ''} ${!hasChanges ? 'disabled' : ''}`}
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? '⏳ Guardando…' : '💾 Guardar'}
            </button>
            <button className="ucm-close-btn" onClick={handleClose} title="Cerrar">✕</button>
          </div>
        </div>

        {/* Hint + CSV status */}
        <div className="ucm-hint">
          Importá un CSV (Amenity, Descripción, Imagen, Imagen 1…N, Thumbnail) o cargá amenities a mano.
          {csvStatus && (
            <span className={`ucm-csv-status ucm-csv-status-${csvStatus.type}`}>{csvStatus.msg}</span>
          )}
        </div>

        {/* Table */}
        <div className="ucm-table-wrap" ref={tableRef}>
          <table className="ucm-table">
            <thead>
              <tr>
                <th className="ucm-th ucm-th-idx">#</th>
                {TEXT_COLUMNS.map((col) => (
                  <th key={col.key} className="ucm-th">{col.label}</th>
                ))}
                <th className="ucm-th">Imagen principal</th>
                <th className="ucm-th">Galería</th>
                <th className="ucm-th">Thumbnail</th>
                <th className="ucm-th ucm-th-tour">360°</th>
                <th className="ucm-th ucm-th-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => {
                const cellUploading = uploadingCell?.idx === rowIdx;
                return (
                <tr key={rowIdx} className={`ucm-row${row.oculto ? ' ucm-row-hidden' : ''}`}>
                  <td className="ucm-td ucm-td-idx">{rowIdx + 1}</td>

                  {TEXT_COLUMNS.map((col) => (
                    <td key={col.key} className="ucm-td">
                      <input
                        className="ucm-input"
                        type="text"
                        value={row[col.key] || ''}
                        onChange={(e) => handleChange(rowIdx, col.key, e.target.value)}
                        placeholder={col.placeholder}
                      />
                    </td>
                  ))}

                  {/* Imagen principal (cover) */}
                  <td className="ucm-td">
                    <div className="amenity-plano-cell">
                      {row.plano ? (
                        <a href={row.plano} target="_blank" rel="noopener noreferrer" className="amenity-plano-link" title="Ver imagen">
                          <img src={row.plano} alt="cover" className="amenity-plano-thumb-sm" />
                        </a>
                      ) : null}
                      <label className="amenity-upload-btn-sm">
                        {cellUploading && uploadingCell.field === 'plano'
                          ? (uploadingCell.mode === 'recompress'
                              ? (uploadProgress > 0 ? `🗜️ ${uploadProgress}%` : '🗜️ …')
                              : `${uploadProgress}%`)
                          : row.plano ? '🔄' : '📁 Subir'}
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          style={{ display: 'none' }}
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(rowIdx, file, 'plano');
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {row.plano && (
                        <>
                          <button className="amenity-clear-plano" onClick={() => handleRecompress(rowIdx)} disabled={busy} title="Comprimir imagen existente">🗜️</button>
                          <button className="amenity-clear-plano" onClick={() => handleChange(rowIdx, 'plano', '')} disabled={busy} title="Quitar">✕</button>
                        </>
                      )}
                    </div>
                  </td>

                  {/* Galería (imagenes[]) */}
                  <td className="ucm-td">
                    <div className="amenity-gallery-cell">
                      {(row.imagenes || []).map((url, imgIdx) => (
                        <div key={`${url}-${imgIdx}`} className="amenity-gallery-thumb-wrap">
                          <a href={url} target="_blank" rel="noopener noreferrer" title="Ver imagen">
                            <img src={url} alt={`img-${imgIdx + 1}`} className="amenity-plano-thumb-sm" />
                          </a>
                          <button
                            className="amenity-gallery-thumb-remove"
                            onClick={() => removeGalleryImage(rowIdx, imgIdx)}
                            disabled={busy}
                            title="Quitar"
                          >✕</button>
                        </div>
                      ))}
                      <label className="amenity-upload-btn-sm">
                        {cellUploading && uploadingCell.field === 'imagenes' ? `${uploadProgress}%` : '➕ Imágenes'}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          style={{ display: 'none' }}
                          disabled={busy}
                          onChange={(e) => {
                            const files = e.target.files;
                            if (files?.length) handleGalleryAdd(rowIdx, files);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </td>

                  {/* Thumbnail */}
                  <td className="ucm-td">
                    <div className="amenity-plano-cell">
                      {row.thumbnail ? (
                        <a href={row.thumbnail} target="_blank" rel="noopener noreferrer" className="amenity-plano-link" title="Ver thumbnail">
                          <img src={row.thumbnail} alt="thumb" className="amenity-plano-thumb-sm" />
                        </a>
                      ) : null}
                      <label className="amenity-upload-btn-sm">
                        {cellUploading && uploadingCell.field === 'thumbnail' ? `${uploadProgress}%` : row.thumbnail ? '🔄' : '📁 Subir'}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(rowIdx, file, 'thumbnail');
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {row.thumbnail && (
                        <button className="amenity-clear-plano" onClick={() => handleChange(rowIdx, 'thumbnail', '')} disabled={busy} title="Quitar">✕</button>
                      )}
                    </div>
                  </td>

                  {/* Recorrido 360° */}
                  <td className="ucm-td ucm-td-tour">
                    {(() => {
                      const nodeCount = tourNodeList(row.tour).length;
                      return (
                        <button
                          className="amenity-upload-btn-sm"
                          onClick={() => setTourEditorIdx(rowIdx)}
                          disabled={busy}
                          title="Editar recorrido 360° (imágenes equirectangulares)"
                        >
                          {nodeCount > 0 ? `🌐 ${nodeCount}` : '🌐 Crear'}
                        </button>
                      );
                    })()}
                  </td>

                  <td className="ucm-td ucm-td-actions">
                    <button
                      className="ucm-action-btn"
                      onClick={() => toggleHidden(rowIdx)}
                      title={row.oculto ? 'Amenity oculto — mostrar en el listado' : 'Ocultar del listado (no se borra)'}
                    >
                      {row.oculto ? '🙈' : '👁️'}
                    </button>
                    <button className="ucm-action-btn" onClick={() => duplicateRow(rowIdx)} title="Duplicar">📋</button>
                    <button className="ucm-action-btn ucm-action-btn-delete" onClick={() => removeRow(rowIdx)} title="Eliminar">🗑️</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="ucm-footer">
          <button className="ucm-add-btn" onClick={addRow}>➕ Agregar Amenity</button>
          <button
            className="ucm-add-btn"
            onClick={handleRecompressAll}
            disabled={busy || !rows.some((r) => r.plano)}
            title="Recomprime las imágenes principales que no estén ya optimizadas"
          >
            {bulkRecompress
              ? `🗜️ Comprimiendo ${bulkRecompress.done}/${bulkRecompress.total}…`
              : '🗜️ Comprimir todos'}
          </button>
        </div>
      </div>

      {/* 360° tour editor for one amenity row */}
      {tourEditorIdx !== null && rows[tourEditorIdx] && (
        <TourEditorModal
          amenity={rows[tourEditorIdx]}
          sceneId={sceneId}
          onSave={(tour) => handleTourSave(tourEditorIdx, tour)}
          onClose={() => setTourEditorIdx(null)}
          onQueueDelete={queueTourDelete}
        />
      )}
    </div>,
    document.body
  );
}
