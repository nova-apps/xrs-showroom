'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

const ESTADO_LABELS = {
  disponible: 'Disponible',
  reservado:  'Reservado',
  vendido:    'Vendido',
};

/**
 * LotesListPanel — left-side panel for terreno-type scenes.
 * Same look-and-feel as UnidadesListPanel but with lote-specific filters:
 * barrio chips (with color), estado chips, and an optional m² total range.
 *
 * `selectedLote` is the currently highlighted lote (drives `.active` row +
 * scroll-into-view). The detail modal is owned by the parent.
 */
export default function LotesListPanel({
  lotes = [],
  barrios = [],
  onSelectLote,
  selectedLote,
}) {
  const items = Array.isArray(lotes) ? lotes : [];
  const barrioList = Array.isArray(barrios) ? barrios : [];
  const barriosById = useMemo(() => {
    const map = new Map();
    for (const b of barrioList) if (b?.id) map.set(b.id, b);
    return map;
  }, [barrioList]);

  // Filter state
  const [selectedBarrios, setSelectedBarrios] = useState(new Set());
  const [selectedEstados, setSelectedEstados] = useState(new Set());
  const [metrajeRange, setMetrajeRange] = useState([0, 1000]);
  const [showMetraje, setShowMetraje] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const cardRefs = useRef(new Map());

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    setIsMobile(mql.matches);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const id = selectedLote?.id;
    if (id == null) return;
    const raf = requestAnimationFrame(() => {
      const el = cardRefs.current.get(String(id));
      if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedLote?.id]);

  const metrajeMinMax = useMemo(() => {
    if (items.length === 0) return [0, 1000];
    const vals = items.map((l) => Number(l.superficieTotal) || 0).filter((v) => v > 0);
    if (vals.length === 0) return [0, 1000];
    const min = Math.floor(Math.min(...vals) / 10) * 10;
    const max = Math.ceil(Math.max(...vals) / 10) * 10;
    return [min, max];
  }, [items]);

  useEffect(() => {
    setMetrajeRange(metrajeMinMax);
  }, [metrajeMinMax]);

  const filtered = useMemo(() => {
    return items.filter((l) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchNum = (l.numero || '').toString().toLowerCase().includes(q);
        const matchId = (l.id || '').toString().toLowerCase().includes(q);
        if (!matchNum && !matchId) return false;
      }
      if (selectedBarrios.size > 0 && !selectedBarrios.has(l.barrioId)) return false;
      if (selectedEstados.size > 0 && !selectedEstados.has(l.estado || 'disponible')) return false;
      const sup = Number(l.superficieTotal) || 0;
      if (sup < metrajeRange[0] || sup > metrajeRange[1]) return false;
      return true;
    });
  }, [items, searchQuery, selectedBarrios, selectedEstados, metrajeRange]);

  const toggleBarrio = useCallback((id) => {
    setSelectedBarrios((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleEstado = useCallback((value) => {
    setSelectedEstados((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedBarrios(new Set());
    setSelectedEstados(new Set());
    setMetrajeRange(metrajeMinMax);
    setSearchQuery('');
  }, [metrajeMinMax]);

  const hasActiveFilters =
    selectedBarrios.size > 0 ||
    selectedEstados.size > 0 ||
    metrajeRange[0] !== metrajeMinMax[0] ||
    metrajeRange[1] !== metrajeMinMax[1] ||
    searchQuery.length > 0;

  const renderBarrioChips = () => (
    <div className="unidad-filter-pills lote-barrio-chips">
      {barrioList.map((b) => (
        <button
          key={b.id}
          className={`unidad-pill lote-barrio-chip${selectedBarrios.has(b.id) ? ' active' : ''}`}
          onClick={() => toggleBarrio(b.id)}
          title={b.nombre || b.id}
        >
          <span
            className="lote-barrio-dot"
            style={{ background: b.color || 'rgba(255,255,255,0.4)' }}
          />
          {b.nombre || b.id}
        </button>
      ))}
    </div>
  );

  const renderFilters = () => (
    <div className="unidad-filters">
      {barrioList.length > 0 && (
        <div className="unidad-filter-section">
          <div className="unidad-filter-header" style={{ cursor: 'default' }}>
            <span>Barrios</span>
          </div>
          {renderBarrioChips()}
        </div>
      )}

      <div className="unidad-filter-section">
        <div className="unidad-filter-header" style={{ cursor: 'default' }}>
          <span>Estado</span>
        </div>
        <div className="unidad-filter-pills">
          {Object.entries(ESTADO_LABELS).map(([value, label]) => (
            <button
              key={value}
              className={`unidad-pill${selectedEstados.has(value) ? ' active' : ''}`}
              onClick={() => toggleEstado(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="unidad-filter-section">
        <div
          className="unidad-filter-header"
          onClick={() => setShowMetraje(!showMetraje)}
        >
          <span>Sup. total</span>
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
          type="text"
          className="sidebar-search-input"
          placeholder="Buscar lote..."
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

  // Compact, always-visible barrio chips above the list (mobile + desktop).
  const renderBarrioChipsBar = () => (
    barrioList.length > 0 && (
      <div className="lote-barrio-chips-bar">
        {renderBarrioChips()}
      </div>
    )
  );

  const renderList = () => (
    <div className="unidades-list">
      <div className="unidades-list-header">
        <span className="unidades-list-count">
          Mostrando {filtered.length} resultados
        </span>
      </div>
      <div className="unidades-list-items">
        {filtered.map((lote, index) => {
          const barrio = barriosById.get(lote.barrioId);
          const isActive = selectedLote && String(selectedLote.id) === String(lote.id);
          return (
            <div
              key={lote.id || index}
              ref={(el) => {
                const key = String(lote.id ?? index);
                if (el) cardRefs.current.set(key, el);
                else cardRefs.current.delete(key);
              }}
              className={`unidad-card${isMobile ? ' unidad-card-grid-item' : ''}${isActive ? ' active' : ''}`}
              onClick={() => onSelectLote?.(lote)}
            >
              <div className="unidad-info">
                <div className="unidad-title">
                  Lote {lote.numero || lote.id || '—'}
                </div>
                <div className="unidad-meta">
                  {barrio?.nombre && (
                    <>
                      <span
                        className="lote-barrio-dot"
                        style={{ background: barrio.color || 'rgba(255,255,255,0.4)' }}
                      />
                      {barrio.nombre} ·{' '}
                    </>
                  )}
                  {lote.superficieTotal ? `${lote.superficieTotal}m²` : '—'}
                </div>
                {lote.estado && (
                  <div className={`lote-estado-tag lote-estado-${lote.estado}`}>
                    {ESTADO_LABELS[lote.estado] || lote.estado}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="empty-state">
            <p>No hay lotes que coincidan con los filtros.</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="tab-content-body">
      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📐</div>
          <p>Sin datos.<br />Cargá lotes desde el panel Configuración en el editor.</p>
        </div>
      ) : isMobile ? (
        <>
          {mobileFiltersOpen ? (
            <div className="mobile-filters-view">
              <button
                className="mobile-filters-back"
                onClick={() => setMobileFiltersOpen(false)}
              >
                ← Volver a lotes
              </button>
              {renderSearch()}
              {renderFilters()}
            </div>
          ) : (
            <>
              <div className="mobile-filters-toggle-row">
                <span className="unidades-list-count">
                  {filtered.length} lotes
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
              {renderBarrioChipsBar()}
              {renderList()}
            </>
          )}
        </>
      ) : (
        <>
          {renderSearch()}
          {renderBarrioChipsBar()}
          {renderFilters()}
          {renderList()}
        </>
      )}
    </div>
  );
}
