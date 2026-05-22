'use client';

import { useState, useCallback } from 'react';
import FloatingPanel from './FloatingPanel';
import UnidadesCargaModal from './UnidadesCargaModal';
import AmenitiesModal from './AmenitiesModal';
import BarriosModal from './BarriosModal';
import LotesCargaModal from './LotesCargaModal';

/**
 * UnidadesPanel — content management for the scene's units / amenities
 * (edificio) or barrios / lotes (terreno). Each row shows a count and an
 * "edit" button that opens the corresponding management modal.
 *
 * Project-level settings (WhatsApp, logo, custom domain) live in
 * ProyectoPanel instead.
 */
export default function UnidadesPanel({
  scene,
  sceneId,
  onUnidadesChange,
  onAmenitiesChange,
  onBarriosChange,
  onLotesChange,
  collapsed,
  onToggle,
}) {
  const sceneType = scene?.type === 'terreno' ? 'terreno' : 'edificio';
  const [showUnidadesModal, setShowUnidadesModal] = useState(false);
  const [showAmenitiesModal, setShowAmenitiesModal] = useState(false);
  const [showBarriosModal, setShowBarriosModal] = useState(false);
  const [showLotesModal, setShowLotesModal] = useState(false);

  const unidadItems = scene?.unidades?.items || [];
  const amenityItems = scene?.amenities?.items || [];
  const barrioItems = scene?.barrios?.items || [];
  const loteItems = scene?.lotes?.items || [];

  const handleUnidadesSave = useCallback(async (newItems) => {
    await onUnidadesChange?.({ items: newItems });
  }, [onUnidadesChange]);

  const handleAmenitiesSave = useCallback(async (newItems) => {
    await onAmenitiesChange?.({ items: newItems });
  }, [onAmenitiesChange]);

  const handleBarriosSave = useCallback(async (newItems) => {
    await onBarriosChange?.({ items: newItems });
  }, [onBarriosChange]);

  const handleLotesSave = useCallback(async (newItems) => {
    await onLotesChange?.({ items: newItems });
  }, [onLotesChange]);

  return (
    <>
      <FloatingPanel
        title="Contenido"
        icon="📋"
        position=""
        collapsed={collapsed}
        onToggle={onToggle}
      >
        {sceneType === 'edificio' ? (
          <>
            {/* Unidades section */}
            <div className="transform-section">
              <div className="transform-section-title">📋 Unidades</div>

              <div className="unidades-summary">
                <div className="unidades-summary-count">
                  <span className="unidades-summary-number">{unidadItems.length}</span>
                  <span className="unidades-summary-label">
                    {unidadItems.length === 1 ? 'unidad' : 'unidades'}
                  </span>
                </div>

                <button
                  className="unidades-manage-btn"
                  onClick={() => setShowUnidadesModal(true)}
                >
                  {unidadItems.length > 0 ? 'Editar' : '➕ Cargar'}
                </button>
              </div>
            </div>

            {/* Amenities section */}
            <div className="transform-section">
              <div className="transform-section-title">🏊 Amenities</div>

              <div className="unidades-summary">
                <div className="unidades-summary-count">
                  <span className="unidades-summary-number">{amenityItems.length}</span>
                  <span className="unidades-summary-label">
                    {amenityItems.length === 1 ? 'amenity' : 'amenities'}
                  </span>
                </div>

                <button
                  className="unidades-manage-btn"
                  onClick={() => setShowAmenitiesModal(true)}
                >
                  {amenityItems.length > 0 ? 'Editar' : '➕ Cargar'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Barrios section */}
            <div className="transform-section">
              <div className="transform-section-title">🗺️ Barrios</div>

              <div className="unidades-summary">
                <div className="unidades-summary-count">
                  <span className="unidades-summary-number">{barrioItems.length}</span>
                  <span className="unidades-summary-label">
                    {barrioItems.length === 1 ? 'barrio' : 'barrios'}
                  </span>
                </div>

                <button
                  className="unidades-manage-btn"
                  onClick={() => setShowBarriosModal(true)}
                >
                  {barrioItems.length > 0 ? 'Editar' : '➕ Cargar'}
                </button>
              </div>
            </div>

            {/* Lotes section */}
            <div className="transform-section">
              <div className="transform-section-title">📐 Lotes</div>

              <div className="unidades-summary">
                <div className="unidades-summary-count">
                  <span className="unidades-summary-number">{loteItems.length}</span>
                  <span className="unidades-summary-label">
                    {loteItems.length === 1 ? 'lote' : 'lotes'}
                  </span>
                </div>

                <button
                  className="unidades-manage-btn"
                  onClick={() => setShowLotesModal(true)}
                >
                  {loteItems.length > 0 ? 'Editar' : '➕ Cargar'}
                </button>
              </div>
            </div>
          </>
        )}

      </FloatingPanel>

      {/* Units data management modal */}
      {showUnidadesModal && (
        <UnidadesCargaModal
          items={unidadItems}
          sceneId={sceneId}
          onSave={handleUnidadesSave}
          onClose={() => setShowUnidadesModal(false)}
        />
      )}

      {/* Amenities data management modal */}
      {showAmenitiesModal && (
        <AmenitiesModal
          items={amenityItems}
          sceneId={sceneId}
          onSave={handleAmenitiesSave}
          onClose={() => setShowAmenitiesModal(false)}
        />
      )}

      {/* Barrios management modal (terreno only) */}
      {showBarriosModal && (
        <BarriosModal
          items={barrioItems}
          lotes={loteItems}
          onSave={handleBarriosSave}
          onClose={() => setShowBarriosModal(false)}
        />
      )}

      {/* Lotes management modal (terreno only) */}
      {showLotesModal && (
        <LotesCargaModal
          items={loteItems}
          barrios={barrioItems}
          onSave={handleLotesSave}
          onClose={() => setShowLotesModal(false)}
        />
      )}
    </>
  );
}
