'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

/**
 * Column definitions for the units table.
 * Each column maps to a standardized field name.
 */
const COLUMNS = [
  { key: 'id', label: 'ID', type: 'text', placeholder: 'Ej: A-101' },
  { key: 'piso', label: 'Piso', type: 'text', placeholder: 'Ej: 1' },
  { key: 'ambientes', label: 'Amb.', type: 'number', placeholder: '0' },
  { key: 'superficie_cubierta', label: 'Sup. Cub.', type: 'number', placeholder: 'm²' },
  { key: 'superficie_semicubierta', label: 'Sup. Semi.', type: 'number', placeholder: 'm²' },
  { key: 'superficie_amenities', label: 'Sup. Amen.', type: 'number', placeholder: 'm²' },
  { key: 'superficie_total', label: 'Sup. Total', type: 'number', placeholder: 'm²' },
  { key: 'imagen_plano', label: 'Imagen Plano', type: 'file', placeholder: 'Subir imagen...' },
  { key: 'imagen_panoramica', label: 'Panorama 360°', type: 'file', placeholder: 'Subir panorama...' },
];

/** Create an empty row with all fields */
function emptyRow() {
  const row = {};
  COLUMNS.forEach((col) => { row[col.key] = ''; });
  return row;
}

/**
 * Parse a CSV string into an array of standardized row objects.
 * - Auto-detects if the first row is a header (by matching column keys/labels).
 * - Handles quoted fields (values with commas or newlines inside quotes).
 * - Falls back to positional mapping if no header match is found.
 */
function parseCSV(text) {
  const lines = splitCSVLines(text);
  if (lines.length === 0) return [];

  const firstRow = splitCSVRow(lines[0]);

  // Try to detect headers by matching against known column keys/labels
  const COLUMN_ALIASES = {
    id: ['id', 'unidad', 'unit', 'codigo', 'código'],
    piso: ['piso', 'floor', 'nivel', 'planta'],
    ambientes: ['ambientes', 'amb', 'ambientes', 'rooms', 'dormitorios'],
    superficie_cubierta: ['superficie_cubierta', 'sup_cubierta', 'sup. cub.', 'sup cub', 'cubierta', 'covered'],
    superficie_semicubierta: ['superficie_semicubierta', 'sup_semicubierta', 'sup. semi.', 'sup semi', 'semicubierta', 'semi'],
    superficie_amenities: ['superficie_amenities', 'sup_amenities', 'sup. amen.', 'sup amen', 'amenities'],
    superficie_total: ['superficie_total', 'sup_total', 'sup. total', 'sup total', 'total', 'superficie'],
    imagen_plano: ['imagen_plano', 'imagen', 'plano', 'image', 'file', 'url', 'foto'],
    imagen_panoramica: ['imagen_panoramica', 'panorama', 'panoramica', '360', 'panorama_360'],
  };

  // Normalize a string for comparison (lowercase, no accents, trim)
  const normalize = (s) =>
    (s || '').toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_. ]/g, '');

  // Try to map first row cells to column keys
  const headerMap = {};
  let headerMatchCount = 0;
  firstRow.forEach((cell, i) => {
    const norm = normalize(cell);
    for (const col of COLUMNS) {
      const aliases = COLUMN_ALIASES[col.key] || [col.key];
      if (aliases.some((a) => normalize(a) === norm) || normalize(col.label) === norm) {
        headerMap[i] = col.key;
        headerMatchCount++;
        break;
      }
    }
  });

  const hasHeader = headerMatchCount >= 2; // At least 2 columns matched → treat as header
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const cells = splitCSVRow(line);
    const row = emptyRow();

    if (hasHeader) {
      cells.forEach((cell, i) => {
        const key = headerMap[i];
        if (key) row[key] = cell.trim();
      });
    } else {
      // Positional fallback
      COLUMNS.forEach((col, i) => {
        if (cells[i] !== undefined) row[col.key] = cells[i].trim();
      });
    }

    return row;
  }).filter((row) =>
    // Filter out completely empty rows
    COLUMNS.some((col) => row[col.key] !== '')
  );
}

/** Split CSV text into lines, respecting quoted fields that span multiple lines */
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
      // Skip \r\n
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

/** Split a CSV line into cells, respecting quoted fields */
function splitCSVRow(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'; // Escaped quote
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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

/**
 * UnidadesCargaModal — fullscreen modal with an editable data table
 * for loading/managing unit data. Persists to Firebase on save.
 *
 * @param {Array}    items       - Current units array from Firebase
 * @param {Function} onSave      - (items[]) => void — persist to Firebase
 * @param {Function} onClose     - Close the modal
 */
export default function UnidadesCargaModal({ items = [], sceneId, onSave, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [csvStatus, setCsvStatus] = useState(null); // null | { type, msg }
  const [uploadingCell, setUploadingCell] = useState(null); // { rowIdx, colKey }
  const [uploadProgress, setUploadProgress] = useState(0);
  const tableRef = useRef(null);
  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);

  // Initialize rows from existing items
  useEffect(() => {
    if (items && items.length > 0) {
      setRows(items.map((item) => ({ ...emptyRow(), ...item })));
    } else {
      setRows([emptyRow()]);
    }
    setHasChanges(false);
  }, []);

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
    // Scroll to bottom after adding
    setTimeout(() => {
      if (tableRef.current) {
        tableRef.current.scrollTop = tableRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  const removeRow = useCallback((index) => {
    setRows((prev) => {
      if (prev.length <= 1) return [emptyRow()];
      return prev.filter((_, i) => i !== index);
    });
    setHasChanges(true);
  }, []);

  const duplicateRow = useCallback((index) => {
    setRows((prev) => {
      const newRow = { ...prev[index], id: prev[index].id ? `${prev[index].id}-copy` : '' };
      const next = [...prev];
      next.splice(index + 1, 0, newRow);
      return next;
    });
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Filter out completely empty rows
      const validRows = rows.filter((row) =>
        COLUMNS.some((col) => row[col.key] !== '' && row[col.key] !== undefined && row[col.key] !== null)
      );
      await onSave(validRows);
      setHasChanges(false);
    } catch (err) {
      console.error('[UnidadesCarga] Save failed:', err);
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

  // ─── CSV Import (append) ───
  const handleCSVImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const parsedRows = parseCSV(text);

        if (parsedRows.length === 0) {
          setCsvStatus({ type: 'error', msg: 'El archivo CSV está vacío o no tiene datos válidos.' });
          setTimeout(() => setCsvStatus(null), 4000);
          return;
        }

        setRows((prev) => {
          const isEmpty = prev.length === 1 && COLUMNS.every((col) => !prev[0][col.key]);
          return isEmpty ? parsedRows : [...prev, ...parsedRows];
        });
        setHasChanges(true);
        setCsvStatus({ type: 'ok', msg: `✅ ${parsedRows.length} unidades agregadas desde CSV.` });
        setTimeout(() => setCsvStatus(null), 4000);
      } catch (err) {
        console.error('[CSV Import] Parse error:', err);
        setCsvStatus({ type: 'error', msg: `Error al leer CSV: ${err.message}` });
        setTimeout(() => setCsvStatus(null), 5000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // ─── CSV Replace (overwrite all) ───
  const handleCSVReplace = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const parsedRows = parseCSV(text);

        if (parsedRows.length === 0) {
          setCsvStatus({ type: 'error', msg: 'El archivo CSV está vacío o no tiene datos válidos.' });
          setTimeout(() => setCsvStatus(null), 4000);
          return;
        }

        setRows(parsedRows);
        setHasChanges(true);
        setCsvStatus({ type: 'ok', msg: `🔄 ${parsedRows.length} unidades reemplazadas desde CSV.` });
        setTimeout(() => setCsvStatus(null), 4000);
      } catch (err) {
        console.error('[CSV Replace] Parse error:', err);
        setCsvStatus({ type: 'error', msg: `Error al leer CSV: ${err.message}` });
        setTimeout(() => setCsvStatus(null), 5000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // ─── CSV Export (download) ───
  const handleCSVExport = useCallback(() => {
    const header = COLUMNS.map((col) => col.key).join(',');
    const csvRows = rows.map((row) =>
      COLUMNS.map((col) => {
        const val = String(row[col.key] ?? '');
        // Escape values that contain commas, quotes, or newlines
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(',')
    );
    const csvText = [header, ...csvRows].join('\n');

    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'unidades.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  // Paste handler — support pasting from spreadsheets
  const handlePaste = useCallback((e) => {
    const clipText = e.clipboardData?.getData('text/plain');
    if (!clipText || !clipText.includes('\t')) return; // Only intercept tab-separated data

    e.preventDefault();
    const pastedRows = clipText.trim().split('\n').map((line) => {
      const values = line.split('\t');
      const row = emptyRow();
      COLUMNS.forEach((col, i) => {
        if (values[i] !== undefined) {
          row[col.key] = values[i].trim();
        }
      });
      return row;
    });

    if (pastedRows.length > 0) {
      setRows((prev) => {
        // If the table only has one empty row, replace it
        const isEmpty = prev.length === 1 && COLUMNS.every((col) => !prev[0][col.key]);
        return isEmpty ? pastedRows : [...prev, ...pastedRows];
      });
      setHasChanges(true);
    }
  }, []);

  // ─── File upload for imagen_plano ───
  const handleFileUpload = useCallback(async (rowIdx, colKey, file) => {
    if (!file || !sceneId) return;

    setUploadingCell({ rowIdx, colKey });
    setUploadProgress(0);

    const path = `scenes/${sceneId}/unidades/${Date.now()}_${file.name}`;
    const fileRef = storageRef(storage, path);
    const uploadTask = uploadBytesResumable(fileRef, file);

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        setUploadProgress(pct);
      },
      (error) => {
        console.error('[Unidad Upload] Error:', error);
        setUploadingCell(null);
        setUploadProgress(0);
      },
      async () => {
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          setRows((prev) => {
            const updated = [...prev];
            updated[rowIdx] = { ...updated[rowIdx], [colKey]: url };
            return updated;
          });
          setHasChanges(true);
        } catch (err) {
          console.error('[Unidad Upload] getDownloadURL error:', err);
        }
        setUploadingCell(null);
        setUploadProgress(0);
      }
    );
  }, [sceneId]);

  if (!mounted) return null;

  return createPortal(
    <div className="ucm-overlay" onClick={handleClose}>
      <div className="ucm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ucm-header">
          <div className="ucm-header-left">
            <h2 className="ucm-title">📋 Gestionar Unidades</h2>
            <span className="ucm-count">{rows.length} {rows.length === 1 ? 'unidad' : 'unidades'}</span>
          </div>
          <div className="ucm-header-right">
            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={handleCSVImport}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={handleCSVReplace}
            />

            <button
              className="ucm-csv-btn"
              onClick={handleCSVExport}
              title="Descargar CSV con todas las unidades"
            >
              ⬇ Descargar CSV
            </button>
            <button
              className="ucm-csv-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Agregar unidades desde CSV (se suman a las existentes)"
            >
              📄 Importar CSV
            </button>
            <button
              className="ucm-csv-btn ucm-csv-btn-replace"
              onClick={() => {
                if (rows.length > 1 || COLUMNS.some((col) => rows[0]?.[col.key])) {
                  if (!window.confirm('Esto reemplazará TODAS las unidades actuales con el contenido del CSV. ¿Continuar?')) return;
                }
                replaceInputRef.current?.click();
              }}
              title="Reemplazar todas las unidades con un nuevo CSV"
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
            <button className="ucm-close-btn" onClick={handleClose} title="Cerrar">
              ✕
            </button>
          </div>
        </div>

        {/* Hint + CSV status */}
        <div className="ucm-hint">
          Podés pegar datos desde Excel/Sheets, o importar un archivo CSV.
          {csvStatus && (
            <span className={`ucm-csv-status ucm-csv-status-${csvStatus.type}`}>
              {csvStatus.msg}
            </span>
          )}
        </div>

        {/* Table */}
        <div className="ucm-table-wrap" ref={tableRef} onPaste={handlePaste}>
          <table className="ucm-table">
            <thead>
              <tr>
                <th className="ucm-th ucm-th-num">#</th>
                {COLUMNS.map((col) => (
                  <th key={col.key} className="ucm-th">{col.label}</th>
                ))}
                <th className="ucm-th ucm-th-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="ucm-row">
                  <td className="ucm-td ucm-td-num">{ri + 1}</td>
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
                              title="Ver imagen"
                            >
                              <img
                                src={row[col.key]}
                                alt="plano"
                                className="amenity-plano-thumb-sm"
                              />
                            </a>
                          ) : null}
                          <label className="amenity-upload-btn-sm">
                            {uploadingCell?.rowIdx === ri && uploadingCell?.colKey === col.key
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
                                if (file) handleFileUpload(ri, col.key, file);
                                e.target.value = '';
                              }}
                            />
                          </label>
                          {row[col.key] && (
                            <button
                              className="amenity-clear-plano"
                              onClick={() => handleCellChange(ri, col.key, '')}
                              title="Quitar"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ) : (
                        <input
                          type={col.type}
                          className="ucm-input"
                          placeholder={col.placeholder}
                          value={row[col.key] ?? ''}
                          onChange={(e) => handleCellChange(ri, col.key, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="ucm-td ucm-td-actions">
                    <button
                      className="ucm-row-btn ucm-row-dup"
                      onClick={() => duplicateRow(ri)}
                      title="Duplicar fila"
                    >
                      📋
                    </button>
                    <button
                      className="ucm-row-btn ucm-row-del"
                      onClick={() => removeRow(ri)}
                      title="Eliminar fila"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="ucm-footer">
          <button className="ucm-add-btn" onClick={addRow}>
            + Agregar unidad
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
