'use client';

import { useState, useCallback } from 'react';
import FloatingPanel from './FloatingPanel';
import UnidadesCargaModal from './UnidadesCargaModal';
import AmenitiesModal from './AmenitiesModal';

/**
 * Configuración Panel — manages Unidades and Amenities data entry.
 * Houses buttons to open each respective data management modal.
 *
 * Rendered inside RightPanelStack with controlled collapse.
 */
export default function UnidadesPanel({
  scene,
  sceneId,
  onUnidadesChange,
  onAmenitiesChange,
  collapsed,
  onToggle,
}) {
  const [showUnidadesModal, setShowUnidadesModal] = useState(false);
  const [showAmenitiesModal, setShowAmenitiesModal] = useState(false);

  const unidadItems = scene?.unidades?.items || [];
  const amenityItems = scene?.amenities?.items || [];

  const handleUnidadesSave = useCallback(async (newItems) => {
    await onUnidadesChange?.({ items: newItems });
  }, [onUnidadesChange]);

  const handleAmenitiesSave = useCallback(async (newItems) => {
    await onAmenitiesChange?.({ items: newItems });
  }, [onAmenitiesChange]);

  return (
    <>
      <FloatingPanel
        title="Configuración"
        icon="⚙️"
        position=""
        collapsed={collapsed}
        onToggle={onToggle}
      >
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
      </FloatingPanel>

      {/* Units data management modal */}
      {showUnidadesModal && (
        <UnidadesCargaModal
          items={unidadItems}
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
    </>
  );
}
