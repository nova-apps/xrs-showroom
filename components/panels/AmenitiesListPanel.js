'use client';

import { useMemo } from 'react';
import AmenityModal from './AmenityModal';
import LazyImage from '../ui/LazyImage';

/**
 * AmenitiesListPanel — left-side panel listing amenities.
 * Renders directly as tab content (no accordion wrapper).
 */
export default function AmenitiesListPanel({
  amenities = [],
  onSelectAmenity,
  selectedAmenity,
  onCloseModal,
}) {
  const items = Array.isArray(amenities) ? amenities : [];

  return (
    <>
      <div className="tab-content-body">
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🏊</div>
            <p>Sin amenities.<br />Cargá amenities desde Configuración.</p>
          </div>
        ) : (
          <div className="unidades-list">
            <div className="unidades-list-items">
              {items.map((amenity, index) => (
                <div
                  key={amenity.nombre || index}
                  className="unidad-card"
                  onClick={() => onSelectAmenity?.(amenity)}
                >
                  <div className="unidad-thumb">
                    {amenity.plano ? (
                      <LazyImage src={amenity.plano} alt={amenity.nombre || ''} />
                    ) : (
                      <div className="unidad-thumb-placeholder">🏔</div>
                    )}
                  </div>
                  <div className="unidad-info">
                    <div className="unidad-title">
                      {amenity.nombre || 'Sin nombre'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Amenity detail modal */}
      {selectedAmenity && (
        <AmenityModal amenity={selectedAmenity} onClose={onCloseModal} />
      )}
    </>
  );
}
