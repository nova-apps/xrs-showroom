'use client';

import { useMemo } from 'react';
import FloatingPanel from './FloatingPanel';
import AmenityModal from './AmenityModal';

/**
 * AmenitiesListPanel — left-side panel listing amenities.
 * Mirrors UnidadesListPanel: simple card list with click-to-view-detail.
 */
export default function AmenitiesListPanel({
  amenities = [],
  onSelectAmenity,
  selectedAmenity,
  onCloseModal,
  collapsed,
  onToggle,
}) {
  const items = Array.isArray(amenities) ? amenities : [];

  return (
    <>
      <FloatingPanel
        title="Amenities"
        icon="🏊"
        position=""
        collapsed={collapsed}
        onToggle={onToggle}
      >
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🏊</div>
            <p>Sin amenities.<br />Cargá amenities desde Configuración.</p>
          </div>
        ) : (
          <>
            <div className="unidades-list">
              <div className="unidades-list-header">
                <span className="unidades-list-count">
                  {items.length} {items.length === 1 ? 'amenity' : 'amenities'}
                </span>
              </div>
              <div className="unidades-list-items">
                {items.map((amenity, index) => (
                  <div
                    key={amenity.nombre || index}
                    className="unidad-card"
                    onClick={() => onSelectAmenity?.(amenity)}
                  >
                    <div className="unidad-thumb">
                      {amenity.plano ? (
                        <img src={amenity.plano} alt={amenity.nombre || ''} loading="lazy" />
                      ) : (
                        <div className="unidad-thumb-placeholder">🏊</div>
                      )}
                    </div>
                    <div className="unidad-info">
                      <div className="unidad-title">
                        {amenity.nombre || 'Sin nombre'}
                      </div>
                      {amenity.descripcion && (
                        <div className="unidad-meta">
                          {amenity.descripcion.length > 60
                            ? amenity.descripcion.slice(0, 60) + '…'
                            : amenity.descripcion}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </FloatingPanel>

      {/* Amenity detail modal */}
      {selectedAmenity && (
        <AmenityModal amenity={selectedAmenity} onClose={onCloseModal} />
      )}
    </>
  );
}
