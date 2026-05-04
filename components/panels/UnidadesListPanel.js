'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import UnidadModal from './UnidadModal';
import LazyImage from '../ui/LazyImage';

/**
 * UnidadesListPanel — left-side panel with filters + unit list.
 * Filters: Ambientes (circle buttons), Metraje (range slider).
 *
 * Standardized field names:
 *   id, piso, ambientes, superficie_cubierta, superficie_semicubierta,
 *   superficie_amenities, superficie_total, imagen_plano
 */
export default function UnidadesListPanel({ unidades = [], onSelectUnit, selectedUnit, onCloseModal, whatsappNumber, projectName }) {
  const items = Array.isArray(unidades) ? unidades : [];

  // Filter state
  const [selectedAmb, setSelectedAmb] = useState(new Set()); // empty = all
  const [metrajeRange, setMetrajeRange] = useState([0, 300]);
  const [showAmbientes, setShowAmbientes] = useState(false);
  const [showMetraje, setShowMetraje] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    setIsMobile(mql.matches);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Compute min/max metraje from data
  const metrajeMinMax = useMemo(() => {
    if (items.length === 0) return [0, 300];
    const vals = items.map((u) => Number(u.superficie_total) || 0).filter((v) => v > 0);
    if (vals.length === 0) return [0, 300];
    const min = Math.floor(Math.min(...vals) / 10) * 10;
    const max = Math.ceil(Math.max(...vals) / 10) * 10;
    return [min, max];
  }, [items]);

  // Initialize metraje range when data arrives
  useEffect(() => {
    setMetrajeRange(metrajeMinMax);
  }, [metrajeMinMax]);

  // Get unique ambientes values
  const ambOptions = useMemo(() => {
    const set = new Set();
    items.forEach((u) => {
      const v = Number(u.ambientes);
      if (v > 0) set.add(v);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [items]);

  // Filter items
  const filtered = useMemo(() => {
    return items.filter((u) => {
      // Search query filter (match id or piso)
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchId = (u.id || '').toString().toLowerCase().includes(q);
        const matchPiso = (u.piso || '').toString().toLowerCase().includes(q);
        if (!matchId && !matchPiso) return false;
      }
      // Ambientes filter (multi-select — match ANY selected)
      if (selectedAmb.size > 0) {
        const amb = Number(u.ambientes) || 0;
        let matches = false;
        for (const sel of selectedAmb) {
          if (sel === '+') {
            if (amb >= 5) { matches = true; break; }
          } else {
            if (amb === sel) { matches = true; break; }
          }
        }
        if (!matches) return false;
      }
      // Metraje filter
      const sup = Number(u.superficie_total) || 0;
      if (sup < metrajeRange[0] || sup > metrajeRange[1]) return false;
      return true;
    });
  }, [items, selectedAmb, metrajeRange, searchQuery]);

  const toggleAmb = useCallback((val) => {
    setSelectedAmb((prev) => {
      const next = new Set(prev);
      if (next.has(val)) {
        next.delete(val);
      } else {
        next.add(val);
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedAmb(new Set());
    setMetrajeRange(metrajeMinMax);
    setSearchQuery('');
  }, [metrajeMinMax]);

  const hasActiveFilters = selectedAmb.size > 0 ||
    metrajeRange[0] !== metrajeMinMax[0] ||
    metrajeRange[1] !== metrajeMinMax[1] ||
    searchQuery.length > 0;

  // Shared filter UI (used in both mobile filter view and desktop inline)
  const renderFilters = () => (
    <div className="unidad-filters">
      {/* Ambientes */}
      <div className="unidad-filter-section">
        <div
          className="unidad-filter-header"
          onClick={() => setShowAmbientes(!showAmbientes)}
        >
          <span>Ambientes</span>
          <span className={`unidad-filter-chevron ${showAmbientes ? 'open' : ''}`}>▾</span>
        </div>
        {showAmbientes && (
          <div className="unidad-filter-pills">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                className={`unidad-pill ${selectedAmb.has(n) ? 'active' : ''}`}
                onClick={() => toggleAmb(n)}
              >
                {n}
              </button>
            ))}
            <button
              className={`unidad-pill ${selectedAmb.has('+') ? 'active' : ''}`}
              onClick={() => toggleAmb('+')}
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* Metraje */}
      <div className="unidad-filter-section">
        <div
          className="unidad-filter-header"
          onClick={() => setShowMetraje(!showMetraje)}
        >
          <span>Metraje</span>
          <span className={`unidad-filter-chevron ${showMetraje ? 'open' : ''}`}>▾</span>
        </div>
        {showMetraje && (
          <>
            <div className="unidad-range-slider">
              <input
                type="range"
                min={metrajeMinMax[0]}
                max={metrajeMinMax[1]}
                step={5}
                value={metrajeRange[0]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMetrajeRange([Math.min(v, metrajeRange[1]), metrajeRange[1]]);
                }}
              />
              <input
                type="range"
                min={metrajeMinMax[0]}
                max={metrajeMinMax[1]}
                step={5}
                value={metrajeRange[1]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMetrajeRange([metrajeRange[0], Math.max(v, metrajeRange[0])]);
                }}
              />
            </div>
            <div className="unidad-range-labels">
              <span>{metrajeRange[0]}m²</span>
              <span>{metrajeRange[1]}m²</span>
            </div>
          </>
        )}
      </div>

      {/* Clear */}
      {hasActiveFilters && (
        <button className="unidad-clear-filters" onClick={clearFilters}>
          Limpiar filtros
        </button>
      )}
    </div>
  );

  const renderSearch = () => (
    <div className="sidebar-search unidades-search">
      <div className="sidebar-search-wrapper">
        <span className="sidebar-search-icon">🔍</span>
        <input
          id="sidebar-unit-search"
          type="text"
          className="sidebar-search-input"
          placeholder="Buscar unidad..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className="sidebar-search-clear"
            onClick={() => setSearchQuery('')}
            title="Limpiar búsqueda"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );

  const renderList = () => (
    <div className="unidades-list">
      <div className="unidades-list-header">
        <span className="unidades-list-count">
          Mostrando {filtered.length} resultados
        </span>
      </div>
      <div className="unidades-list-items">
        {filtered.map((unit, index) => (
          <div
            key={unit.id || index}
            className={`unidad-card${isMobile ? ' unidad-card-compact' : ''}`}
            onClick={() => {
              if (onSelectUnit) onSelectUnit(unit);
            }}
          >
            {!isMobile && (
              <div className="unidad-thumb">
                {unit.imagen_plano ? (
                  <LazyImage src={unit.imagen_plano} alt={unit.id || ''} />
                ) : (
                  <div className="unidad-thumb-placeholder">🏠</div>
                )}
              </div>
            )}
            <div className="unidad-info">
              {isMobile ? (
                <div className="unidad-title">
                  Piso {unit.piso || '—'} - {unit.id || 'Sin ID'} · {unit.ambientes || '—'} amb · {unit.superficie_total || '—'}m²
                </div>
              ) : (
                <>
                  <div className="unidad-title">
                    Piso {unit.piso || '—'} - {unit.id || 'Sin ID'}
                  </div>
                  <div className="unidad-meta">
                    {unit.ambientes || '—'} amb · {unit.superficie_total || '—'}m² sup. total
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="empty-state">
            <p>No hay unidades que coincidan con los filtros.</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="tab-content-body">
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <p>Sin datos.<br />Cargá unidades desde el panel Unidades en el editor.</p>
          </div>
        ) : isMobile ? (
          /* ─── Mobile layout: toggle between filters and list ─── */
          <>
            {mobileFiltersOpen ? (
              <div className="mobile-filters-view">
                <button
                  className="mobile-filters-back"
                  onClick={() => setMobileFiltersOpen(false)}
                >
                  ← Volver a unidades
                </button>
                {renderSearch()}
                {renderFilters()}
              </div>
            ) : (
              <>
                <div className="mobile-filters-toggle-row">
                  <span className="unidades-list-count">
                    {filtered.length} unidades
                  </span>
                  <button
                    className="mobile-filters-btn"
                    onClick={() => setMobileFiltersOpen(true)}
                  >
                    <span className="mobile-filters-btn-icon">⚙</span>
                    Filtros
                    {hasActiveFilters && <span className="mobile-filters-badge" />}
                  </button>
                </div>
                {renderList()}
              </>
            )}
          </>
        ) : (
          /* ─── Desktop layout: search + filters + list inline ─── */
          <>
            {renderSearch()}
            {renderFilters()}
            {renderList()}
          </>
        )}
      </div>

      {/* Unit detail modal */}
      {selectedUnit && (
        <UnidadModal unit={selectedUnit} onClose={onCloseModal} whatsappNumber={whatsappNumber} projectName={projectName} />
      )}
    </>
  );
}
