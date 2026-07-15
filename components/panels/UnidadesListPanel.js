'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import LazyImage from '../ui/LazyImage';
import Icon from '../ui/Icon';

const ORIENTACIONES = ['N', 'S', 'E', 'O', 'NE', 'NO', 'SE', 'SO'];

/** A field counts as "present" only when it has a non-blank value. Empty
 *  fields are omitted from the client UI (label + value), never shown as "—". */
const hasVal = (v) => v != null && String(v).trim() !== '';

const ESTADO_LABELS = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' };
const ESTADO_ORDER = ['disponible', 'reservado', 'vendido'];

/**
 * UnidadesListPanel — left-side panel with filters + unit list.
 * Filters: Ambientes (circle buttons), Metraje (range slider).
 *
 * `selectedUnit` is purely the "currently highlighted" unit (drives the
 * `.active` row + scroll-into-view). The detail modal is owned by the
 * parent so collider-tap on mobile can highlight without opening it.
 */
export default function UnidadesListPanel({ unidades = [], onSelectUnit, selectedUnit }) {
  const items = Array.isArray(unidades) ? unidades : [];

  // Filter state
  const [selectedAmb, setSelectedAmb] = useState(new Set()); // empty = all
  const [selectedOrient, setSelectedOrient] = useState(new Set());
  const [selectedEstados, setSelectedEstados] = useState(new Set());
  const [metrajeRange, setMetrajeRange] = useState([0, 300]);
  const [showAmbientes, setShowAmbientes] = useState(false);
  const [showOrient, setShowOrient] = useState(false);
  const [showEstado, setShowEstado] = useState(false);
  const [showMetraje, setShowMetraje] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Refs for list items so we can scrollIntoView the selected unit
  // (e.g. when the user clicks the collider in the 3D scene).
  const cardRefs = useRef(new Map());

  // Detect mobile viewport
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    setIsMobile(mql.matches);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // When the selected unit changes (e.g. from a collider click), scroll the
  // matching card into view. Defers to next frame so any tab/expand-driven
  // layout change has settled.
  useEffect(() => {
    const id = selectedUnit?.id;
    if (id == null) return;
    const raf = requestAnimationFrame(() => {
      const el = cardRefs.current.get(String(id));
      if (el?.scrollIntoView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedUnit?.id]);

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

  // Only the orientaciones actually present in the data, in canonical order.
  const orientOptions = useMemo(() => {
    const present = new Set(items.map((u) => u.orientacion).filter(Boolean));
    return ORIENTACIONES.filter((o) => present.has(o));
  }, [items]);

  // Only the estados actually present in the data, in canonical order.
  const estadoOptions = useMemo(() => {
    const present = new Set(items.map((u) => u.estado).filter(Boolean));
    return ESTADO_ORDER.filter((e) => present.has(e));
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
      // Orientacion filter (multi-select — match ANY selected)
      if (selectedOrient.size > 0) {
        if (!selectedOrient.has(u.orientacion)) return false;
      }
      // Estado filter (multi-select — match ANY selected)
      if (selectedEstados.size > 0) {
        if (!selectedEstados.has(u.estado)) return false;
      }
      // Metraje filter
      const sup = Number(u.superficie_total) || 0;
      if (sup < metrajeRange[0] || sup > metrajeRange[1]) return false;
      return true;
    });
  }, [items, selectedAmb, selectedOrient, selectedEstados, metrajeRange, searchQuery]);

  const toggleAmb = useCallback((val) => {
    setSelectedAmb((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  }, []);

  const toggleOrient = useCallback((val) => {
    setSelectedOrient((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  }, []);

  const toggleEstado = useCallback((val) => {
    setSelectedEstados((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedAmb(new Set());
    setSelectedOrient(new Set());
    setSelectedEstados(new Set());
    setMetrajeRange(metrajeMinMax);
    setSearchQuery('');
  }, [metrajeMinMax]);

  const hasActiveFilters = selectedAmb.size > 0 ||
    selectedOrient.size > 0 ||
    selectedEstados.size > 0 ||
    metrajeRange[0] !== metrajeMinMax[0] ||
    metrajeRange[1] !== metrajeMinMax[1] ||
    searchQuery.length > 0;

  // Shared filter UI (used in both mobile filter view and desktop inline)
  const renderFilters = () => (
    <div className="unidad-filters">
      {/* Ambientes */}
      <div className="unidad-filter-section">
        <button
          type="button"
          className="unidad-filter-header"
          onClick={() => setShowAmbientes(!showAmbientes)}
          aria-expanded={showAmbientes}
          aria-controls="filtro-ambientes"
        >
          <span>Ambientes</span>
          <span className={`unidad-filter-chevron ${showAmbientes ? 'open' : ''}`} aria-hidden="true">▾</span>
        </button>
        {showAmbientes && (
          <div className="unidad-filter-pills" id="filtro-ambientes">
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

      {/* Orientacion — only the values that actually appear in the data */}
      {orientOptions.length > 0 && (
        <div className="unidad-filter-section">
          <button
            type="button"
            className="unidad-filter-header"
            onClick={() => setShowOrient(!showOrient)}
            aria-expanded={showOrient}
            aria-controls="filtro-orientacion"
          >
            <span>Orientación</span>
            <span className={`unidad-filter-chevron ${showOrient ? 'open' : ''}`} aria-hidden="true">▾</span>
          </button>
          {showOrient && (
            <div className="unidad-filter-pills" id="filtro-orientacion">
              {orientOptions.map((o) => (
                <button
                  key={o}
                  className={`unidad-pill ${selectedOrient.has(o) ? 'active' : ''}`}
                  onClick={() => toggleOrient(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Estado — only when the data carries availability */}
      {estadoOptions.length > 0 && (
        <div className="unidad-filter-section">
          <button
            type="button"
            className="unidad-filter-header"
            onClick={() => setShowEstado(!showEstado)}
            aria-expanded={showEstado}
            aria-controls="filtro-estado"
          >
            <span>Estado</span>
            <span className={`unidad-filter-chevron ${showEstado ? 'open' : ''}`} aria-hidden="true">▾</span>
          </button>
          {showEstado && (
            <div className="unidad-filter-pills" id="filtro-estado">
              {estadoOptions.map((e) => (
                <button
                  key={e}
                  className={`unidad-pill ${selectedEstados.has(e) ? 'active' : ''}`}
                  onClick={() => toggleEstado(e)}
                >
                  {ESTADO_LABELS[e]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Metraje */}
      <div className="unidad-filter-section">
        <button
          type="button"
          className="unidad-filter-header"
          onClick={() => setShowMetraje(!showMetraje)}
          aria-expanded={showMetraje}
          aria-controls="filtro-metraje"
        >
          <span>Metraje</span>
          <span className={`unidad-filter-chevron ${showMetraje ? 'open' : ''}`} aria-hidden="true">▾</span>
        </button>
        {showMetraje && (
          <div id="filtro-metraje">
            <div className="unidad-range-slider">
              <input
                type="range"
                min={metrajeMinMax[0]}
                max={metrajeMinMax[1]}
                step={5}
                value={metrajeRange[0]}
                aria-label="Metraje mínimo"
                aria-valuetext={`${metrajeRange[0]} m²`}
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
                aria-label="Metraje máximo"
                aria-valuetext={`${metrajeRange[1]} m²`}
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
          </div>
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
        <span className="sidebar-search-icon" aria-hidden="true"><Icon name="search" /></span>
        <input
          id="sidebar-unit-search"
          type="text"
          className="sidebar-search-input"
          placeholder="Buscar unidad..."
          aria-label="Buscar unidad"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className="sidebar-search-clear"
            onClick={() => setSearchQuery('')}
            title="Limpiar búsqueda"
            aria-label="Limpiar búsqueda"
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
      <div className="unidades-list-items unidades-rows">
        {filtered.map((unit, index) => {
          const active = selectedUnit && String(selectedUnit.id) === String(unit.id);
          const setRef = (el) => {
            const key = String(unit.id ?? index);
            if (el) cardRefs.current.set(key, el);
            else cardRefs.current.delete(key);
          };
          const plan = unit.imagen_plano ? (
            <LazyImage src={unit.imagen_plano} alt={unit.id || ''} />
          ) : (
            <div className="unidad-thumb-placeholder" aria-hidden="true"><Icon name="image" /></div>
          );

          // Mobile: single-column rows following the design — leading floor-plan
          // thumb · title «id · Piso» · subtitle «amb · orientación» · big m² on
          // the right, an availability dot on the title and a bronze bar when
          // selected. (Price lives in the detail drawer, not the list row.)
          if (isMobile) {
            const sub = [];
            if (hasVal(unit.ambientes)) sub.push(`${unit.ambientes} amb`);
            if (hasVal(unit.orientacion)) sub.push(unit.orientacion);
            return (
              <div
                key={unit.id || index}
                ref={setRef}
                className={`unidad-card unidad-row${active ? ' active' : ''}`}
                onClick={() => onSelectUnit?.(unit)}
              >
                <div className="unidad-thumb unidad-row-thumb">{plan}</div>
                <div className="unidad-info unidad-row-info">
                  <div className="unidad-title unidad-row-title">
                    {ESTADO_LABELS[unit.estado] && (
                      <span
                        className={`estado-dot estado-dot-${unit.estado}`}
                        title={ESTADO_LABELS[unit.estado]}
                        aria-label={ESTADO_LABELS[unit.estado]}
                        role="img"
                      />
                    )}
                    {unit.id || 'Sin ID'}{hasVal(unit.piso) ? ` · Piso ${unit.piso}` : ''}
                  </div>
                  {sub.length > 0 && <div className="unidad-meta unidad-row-sub">{sub.join(' · ')}</div>}
                </div>
                {hasVal(unit.superficie_total) && (
                  <div className="unidad-row-metric">
                    <span className="unidad-row-m2-num">{unit.superficie_total}</span>
                    <span className="unidad-row-m2-unit">m²</span>
                  </div>
                )}
              </div>
            );
          }

          // Desktop: original row with thumb + stacked info (unchanged).
          return (
            <div
              key={unit.id || index}
              ref={setRef}
              className={`unidad-card${active ? ' active' : ''}`}
              onClick={() => onSelectUnit?.(unit)}
            >
              <div className="unidad-thumb">{plan}</div>
              <div className="unidad-info">
                <div className="unidad-title">
                  {hasVal(unit.piso) ? `Piso ${unit.piso} · ` : ''}{unit.id || 'Sin ID'}
                </div>
                {(() => {
                  const meta = [];
                  if (hasVal(unit.ambientes)) meta.push(`${unit.ambientes} amb`);
                  if (hasVal(unit.superficie_total)) meta.push(`${unit.superficie_total}m²`);
                  return meta.length > 0 ? <div className="unidad-meta">{meta.join(' · ')}</div> : null;
                })()}
                {hasVal(unit.precio) && (
                  <div className="unidad-price">{unit.precio}</div>
                )}
                {ESTADO_LABELS[unit.estado] && (
                  <span className={`estado-badge estado-badge-${unit.estado}`}>
                    {ESTADO_LABELS[unit.estado]}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="empty-state">
            <p>No hay unidades que coincidan con los filtros.</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="tab-content-body">
      {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true"><Icon name="empty" /></div>
            <p>Todavía no hay unidades para mostrar.</p>
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
                  aria-label="Abrir filtros"
                >
                  <span className="mobile-filters-btn-icon" aria-hidden="true"><Icon name="filters" /></span>
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
  );
}
