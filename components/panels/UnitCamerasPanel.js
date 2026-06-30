'use client';

import { useState, useMemo, useCallback } from 'react';
import FloatingPanel from './FloatingPanel';

/**
 * UnitCamerasPanel — editor tool to assign a saved camera pose to one or more
 * units. The operator multi-selects units (here in the list, or by clicking
 * the colliders in the 3D scene — both feed the same `selectedIds`), frames
 * the camera however they like, then captures the current pose. At view time
 * a clicked unit with a saved pose snaps the camera to it instead of the
 * auto-computed framing (which can land behind a building on facing towers).
 *
 * Poses live on `scene.orbit.unitCameras` keyed by unit id, so they survive a
 * units CSV re-import and reuse the existing orbit persistence.
 */
export default function UnitCamerasPanel({
  units = [],
  unitCameras = {},
  selectedIds = [],
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onCapture,
  onClearPoses,
  collapsed,
  onToggle,
}) {
  const [query, setQuery] = useState('');
  const [flash, setFlash] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) => {
      const id = String(u.id ?? '').toLowerCase();
      const piso = String(u.piso ?? '').toLowerCase();
      return id.includes(q) || piso.includes(q);
    });
  }, [units, query]);

  const poseCount = useMemo(
    () => units.filter((u) => unitCameras?.[String(u.id)]).length,
    [units, unitCameras]
  );
  const selectedWithPose = useMemo(
    () => selectedIds.filter((id) => unitCameras?.[String(id)]).length,
    [selectedIds, unitCameras]
  );

  const handleCapture = useCallback(() => {
    if (!onCapture || selectedIds.length === 0) return;
    onCapture();
    setFlash(true);
    setTimeout(() => setFlash(false), 1200);
  }, [onCapture, selectedIds.length]);

  if (units.length === 0) {
    return (
      <FloatingPanel title="Cámaras de unidad" icon="🎯" position="" collapsed={collapsed} onToggle={onToggle}>
        <div className="empty-state">
          <p>Sin unidades. Cargá unidades desde el panel “Unidades” primero.</p>
        </div>
      </FloatingPanel>
    );
  }

  return (
    <FloatingPanel title="Cámaras de unidad" icon="🎯" position="" collapsed={collapsed} onToggle={onToggle}>
      <div className="initial-camera-help" style={{ marginBottom: 10 }}>
        Seleccioná unidades (en esta lista o clickeándolas en la escena), ubicá la
        cámara como querés que se vea y guardá la posición. Al clickear esas
        unidades en el visor, la cámara va directo a esa pose.
      </div>

      {/* Capture / clear actions */}
      <div className="initial-camera-card">
        <div className="initial-camera-card-label">
          {selectedIds.length} seleccionada{selectedIds.length === 1 ? '' : 's'}
          {selectedWithPose > 0 && ` · ${selectedWithPose} con pose`}
        </div>
        <div className="initial-camera-row">
          <button
            className={`initial-camera-btn${flash ? ' saved' : ''}`}
            onClick={handleCapture}
            disabled={selectedIds.length === 0}
            style={selectedIds.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {flash ? '✓ Guardado' : 'Capturar cámara para la selección'}
          </button>
          {selectedWithPose > 0 && (
            <button
              className="initial-camera-clear"
              onClick={onClearPoses}
              title="Quitar la pose guardada de las unidades seleccionadas"
            >
              ✕
            </button>
          )}
        </div>
        <div className="initial-camera-info">
          <span>{poseCount} de {units.length} con pose guardada</span>
        </div>
      </div>

      {/* Selection helpers */}
      <div className="transform-row" style={{ gap: 8, marginTop: 8 }}>
        <button
          className="unidad-clear-filters"
          style={{ flex: 1 }}
          onClick={() => onSelectAll?.(filtered.map((u) => String(u.id)))}
        >
          Seleccionar {query ? 'filtradas' : 'todas'}
        </button>
        <button
          className="unidad-clear-filters"
          style={{ flex: 1 }}
          onClick={onClearSelection}
          disabled={selectedIds.length === 0}
        >
          Limpiar selección
        </button>
      </div>

      {/* Search */}
      <div className="sidebar-search" style={{ marginTop: 8 }}>
        <div className="sidebar-search-wrapper">
          <span className="sidebar-search-icon">🔍</span>
          <input
            type="text"
            className="sidebar-search-input"
            placeholder="Buscar unidad..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="sidebar-search-clear" onClick={() => setQuery('')} title="Limpiar búsqueda">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Unit checklist */}
      <div className="unitcam-list" style={{ marginTop: 8, maxHeight: 320, overflowY: 'auto' }}>
        {filtered.map((unit, index) => {
          const id = String(unit.id ?? index);
          const checked = selectedSet.has(id);
          const hasPose = !!unitCameras?.[id];
          return (
            <label
              key={unit.id || index}
              className="unitcam-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                background: checked ? 'rgba(255, 176, 32, 0.14)' : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleSelect?.(id)}
              />
              <span style={{ flex: 1, fontSize: 12 }}>
                Piso {unit.piso || '—'} · {unit.id || 'Sin ID'}
              </span>
              {hasPose && <span title="Tiene pose guardada">📷</span>}
            </label>
          );
        })}
        {filtered.length === 0 && (
          <div className="empty-state"><p>No hay unidades que coincidan.</p></div>
        )}
      </div>
    </FloatingPanel>
  );
}
