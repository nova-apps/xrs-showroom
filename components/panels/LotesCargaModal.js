'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';

const ESTADO_OPTIONS = [
  { value: 'disponible', label: 'Disponible' },
  { value: 'reservado',  label: 'Reservado' },
  { value: 'vendido',    label: 'Vendido' },
];

const COLUMNS = [
  { key: 'id',                    label: 'ID',           type: 'text',   placeholder: 'Ej: L-001' },
  { key: 'numero',                label: 'Número',       type: 'text',   placeholder: 'Ej: 12' },
  { key: 'barrioId',              label: 'Barrio',       type: 'select-barrio' },
  { key: 'estado',                label: 'Estado',       type: 'select', options: ESTADO_OPTIONS },
  { key: 'superficieTotal',       label: 'm² Total',     type: 'number', placeholder: 'm²' },
  { key: 'superficieConstruible', label: 'm² Constr.',   type: 'number', placeholder: 'm²' },
];

function emptyRow() {
  const row = {};
  COLUMNS.forEach((col) => { row[col.key] = col.key === 'estado' ? 'disponible' : ''; });
  return row;
}

function splitCSVLines(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { inQuotes = !inQuotes; current += ch; }
    else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (current.trim()) lines.push(current);
      current = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else { current += ch; }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

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
    } else { current += ch; }
  }
  cells.push(current);
  return cells;
}

const normalize = (s) =>
  (s || '').toString().toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_. ]/g, '');

function parseCSV(text, barrios) {
  const lines = splitCSVLines(text);
  if (lines.length === 0) return [];

  const ALIASES = {
    id: ['id', 'lote', 'codigo'],
    numero: ['numero', 'n', 'num', 'nro', '#'],
    barrioId: ['barrio', 'barrioid', 'barrio_id'],
    estado: ['estado', 'status'],
    superficieTotal: ['superficietotal', 'm2_total', 'm2 total', 'm² total', 'sup_total', 'sup total', 'total'],
    superficieConstruible: ['superficieconstruible', 'm2_construible', 'm2 construible', 'm² construible', 'construible', 'edificable'],
  };

  const firstRow = splitCSVRow(lines[0]);
  const headerMap = {};
  let headerMatches = 0;
  firstRow.forEach((cell, i) => {
    const norm = normalize(cell);
    for (const col of COLUMNS) {
      const aliases = ALIASES[col.key] || [col.key];
      if (aliases.some((a) => normalize(a) === norm) || normalize(col.label) === norm) {
        headerMap[i] = col.key;
        headerMatches++;
        break;
      }
    }
  });
  const hasHeader = headerMatches >= 2;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const barriosByName = new Map(
    (barrios || []).map((b) => [normalize(b.nombre), b.id]),
  );
  const barriosById = new Set((barrios || []).map((b) => b.id));

  return dataLines.map((line) => {
    const cells = splitCSVRow(line);
    const row = emptyRow();
    if (hasHeader) {
      cells.forEach((cell, i) => {
        const key = headerMap[i];
        if (key) row[key] = cell.trim();
      });
    } else {
      COLUMNS.forEach((col, i) => {
        if (cells[i] !== undefined) row[col.key] = cells[i].trim();
      });
    }

    // Resolve barrio by name if the cell isn't already a known barrio id.
    if (row.barrioId && !barriosById.has(row.barrioId)) {
      const matched = barriosByName.get(normalize(row.barrioId));
      if (matched) row.barrioId = matched;
    }

    // Normalize estado to known values.
    const est = normalize(row.estado);
    const matchedEstado = ESTADO_OPTIONS.find((o) => normalize(o.label) === est || o.value === est);
    row.estado = matchedEstado ? matchedEstado.value : (row.estado || 'disponible');

    return row;
  }).filter((row) => COLUMNS.some((col) => row[col.key] !== '' && row[col.key] !== undefined));
}

/**
 * LotesCargaModal — fullscreen modal with an editable data table for managing
 * lotes (lots) in a terreno-type scene. Mirrors UnidadesCargaModal in chrome
 * and CSV handling, but with lote-specific columns and no Storage uploads.
 */
export default function LotesCargaModal({ items = [], barrios = [], onSave, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [csvStatus, setCsvStatus] = useState(null);
  const tableRef = useRef(null);
  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);

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
    setTimeout(() => {
      if (tableRef.current) tableRef.current.scrollTop = tableRef.current.scrollHeight;
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
      const validRows = rows.filter((row) =>
        COLUMNS.some((col) => row[col.key] !== '' && row[col.key] !== undefined && row[col.key] !== null)
      );
      await onSave(validRows);
      setHasChanges(false);
    } catch (err) {
      console.error('[LotesCarga] Save failed:', err);
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

  // ─── CSV Import / Replace / Export ───
  const importCSV = useCallback((e, replace) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = parseCSV(evt.target.result, barrios);
        if (parsed.length === 0) {
          setCsvStatus({ type: 'error', msg: 'El CSV está vacío o no tiene datos válidos.' });
          setTimeout(() => setCsvStatus(null), 4000);
          return;
        }
        setRows((prev) => {
          if (replace) return parsed;
          const isEmpty = prev.length === 1 && COLUMNS.every((col) => !prev[0][col.key]);
          return isEmpty ? parsed : [...prev, ...parsed];
        });
        setHasChanges(true);
        setCsvStatus({
          type: 'ok',
          msg: `${replace ? '🔄' : '✅'} ${parsed.length} lotes ${replace ? 'reemplazados' : 'agregados'} desde CSV.`,
        });
        setTimeout(() => setCsvStatus(null), 4000);
      } catch (err) {
        console.error('[LotesCarga CSV] Parse error:', err);
        setCsvStatus({ type: 'error', msg: `Error al leer CSV: ${err.message}` });
        setTimeout(() => setCsvStatus(null), 5000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [barrios]);

  const handleCSVExport = useCallback(() => {
    const header = COLUMNS.map((col) => col.key).join(',');
    const csvRows = rows.map((row) =>
      COLUMNS.map((col) => {
        const val = String(row[col.key] ?? '');
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(',')
    );
    const blob = new Blob([[header, ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lotes.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  const handlePaste = useCallback((e) => {
    const clipText = e.clipboardData?.getData('text/plain');
    if (!clipText || !clipText.includes('\t')) return;
    e.preventDefault();
    const barriosByName = new Map(
      (barrios || []).map((b) => [normalize(b.nombre), b.id]),
    );
    const barriosById = new Set((barrios || []).map((b) => b.id));
    const pasted = clipText.trim().split('\n').map((line) => {
      const values = line.split('\t');
      const row = emptyRow();
      COLUMNS.forEach((col, i) => {
        if (values[i] !== undefined) row[col.key] = values[i].trim();
      });
      if (row.barrioId && !barriosById.has(row.barrioId)) {
        const matched = barriosByName.get(normalize(row.barrioId));
        if (matched) row.barrioId = matched;
      }
      const est = normalize(row.estado);
      const matchedEst = ESTADO_OPTIONS.find((o) => normalize(o.label) === est || o.value === est);
      row.estado = matchedEst ? matchedEst.value : (row.estado || 'disponible');
      return row;
    });
    if (pasted.length > 0) {
      setRows((prev) => {
        const isEmpty = prev.length === 1 && COLUMNS.every((col) => !prev[0][col.key]);
        return isEmpty ? pasted : [...prev, ...pasted];
      });
      setHasChanges(true);
    }
  }, [barrios]);

  if (!mounted) return null;

  return createPortal(
    <div className="ucm-overlay" onClick={handleClose}>
      <div className="ucm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ucm-header">
          <div className="ucm-header-left">
            <h2 className="ucm-title">📋 Gestionar Lotes</h2>
            <span className="ucm-count">{rows.length} {rows.length === 1 ? 'lote' : 'lotes'}</span>
          </div>
          <div className="ucm-header-right">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => importCSV(e, false)}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => importCSV(e, true)}
            />
            <button className="ucm-csv-btn" onClick={handleCSVExport} title="Descargar CSV">
              <Icon name="download" /> Descargar CSV
            </button>
            <button
              className="ucm-csv-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Agregar lotes desde CSV"
            >
              <Icon name="doc" /> Importar CSV
            </button>
            <button
              className="ucm-csv-btn ucm-csv-btn-replace"
              onClick={() => {
                if (rows.length > 1 || COLUMNS.some((col) => rows[0]?.[col.key])) {
                  if (!window.confirm('Esto reemplazará TODOS los lotes actuales con el contenido del CSV. ¿Continuar?')) return;
                }
                replaceInputRef.current?.click();
              }}
              title="Reemplazar todos los lotes con un nuevo CSV"
            >
              <Icon name="refresh" /> Reemplazar CSV
            </button>
            <button
              className={`ucm-save-btn ${saving ? 'saving' : ''} ${!hasChanges ? 'disabled' : ''}`}
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? '⏳ Guardando…' : <><Icon name="save" /> Guardar</>}
            </button>
            <button className="ucm-close-btn" onClick={handleClose} title="Cerrar">
              ✕
            </button>
          </div>
        </div>

        <div className="ucm-hint">
          Podés pegar datos desde Excel/Sheets, o importar un archivo CSV. Para barrios podés usar el nombre o el ID.
          {csvStatus && (
            <span className={`ucm-csv-status ucm-csv-status-${csvStatus.type}`}>{csvStatus.msg}</span>
          )}
        </div>

        {barrios.length === 0 && (
          <div className="ucm-hint" style={{ color: 'var(--accent-yellow, #fcc419)' }}>
            ⚠️ No hay barrios cargados todavía. Cargá al menos uno desde "Cargar Barrios" antes de asignar barrios a los lotes.
          </div>
        )}

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
                      {col.type === 'select-barrio' ? (
                        <select
                          className="ucm-input"
                          value={row[col.key] ?? ''}
                          onChange={(e) => handleCellChange(ri, col.key, e.target.value)}
                        >
                          <option value="">— sin barrio —</option>
                          {barrios.map((b) => (
                            <option key={b.id} value={b.id}>{b.nombre || b.id}</option>
                          ))}
                        </select>
                      ) : col.type === 'select' ? (
                        <select
                          className="ucm-input"
                          value={row[col.key] ?? ''}
                          onChange={(e) => handleCellChange(ri, col.key, e.target.value)}
                        >
                          {col.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
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
                      <Icon name="copy" />
                    </button>
                    <button
                      className="ucm-row-btn ucm-row-del"
                      onClick={() => removeRow(ri)}
                      title="Eliminar fila"
                    >
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ucm-footer">
          <button className="ucm-add-btn" onClick={addRow}>+ Agregar lote</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
