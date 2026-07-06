'use client';

import Image from 'next/image';
import AmenityModal, { amenityGallery } from './AmenityModal';
import { tourHasNodes } from '@/lib/tour';
import Icon from '../ui/Icon';

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
  // Hidden amenities (oculto) stay in the data but never show in the list.
  const items = (Array.isArray(amenities) ? amenities : []).filter((a) => !a?.oculto);

  return (
    <>
      <div className="tab-content-body">
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true"><Icon name="empty" /></div>
            <p>Todavía no hay amenities para mostrar.</p>
          </div>
        ) : (
          <div className="unidades-list">
            <div className="unidades-list-items amenities-grid-list">
              {items.map((amenity, index) => {
                // Prefer the dedicated thumbnail, then the cover image, then
                // the first gallery image. Old amenities only have `plano`.
                const gallery = amenityGallery(amenity);
                const cover = amenity.thumbnail || amenity.plano || gallery[0] || '';
                // What's inside — so the click is intentional, not a lottery (AMN-1).
                const hasTour = tourHasNodes(amenity.tour);
                const photoCount = gallery.length;
                return (
                <div
                  key={amenity.nombre || index}
                  className="unidad-card amenity-card"
                  onClick={() => onSelectAmenity?.(amenity)}
                >
                  <div className="unidad-thumb amenity-card-thumb">
                    {cover ? (
                      <Image
                        src={cover}
                        alt={amenity.nombre || ''}
                        fill
                        sizes="(max-width: 768px) 50vw, 96px"
                        quality={90}
                        style={{ objectFit: 'cover' }}
                      />
                    ) : (
                      <div className="unidad-thumb-placeholder" aria-hidden="true"><Icon name="image" /></div>
                    )}
                  </div>
                  <div className="unidad-info amenity-card-info">
                    <div className="unidad-title amenity-card-name">
                      {amenity.nombre || 'Sin nombre'}
                    </div>
                    {hasTour ? (
                      <div className="amenity-card-meta amenity-card-meta-360">
                        <Icon name="globe" /> Recorrido 360°
                      </div>
                    ) : photoCount > 1 ? (
                      <div className="amenity-card-meta">{photoCount} fotos</div>
                    ) : null}
                  </div>
                </div>
                );
              })}
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
