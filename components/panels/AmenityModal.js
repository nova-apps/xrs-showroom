'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * AmenityModal — fullscreen modal showing amenity details.
 * Left: info (nombre + descripcion). Right: plano image.
 */
export default function AmenityModal({ amenity, onClose }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!amenity || !mounted) return null;

  return createPortal(
    <div className="unidad-modal-overlay" onClick={onClose}>
      <div className="unidad-modal" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button className="unidad-modal-close" onClick={onClose} title="Cerrar">
          ✕
        </button>

        {/* Left: Info */}
        <div className="unidad-modal-info">
          <h2 className="unidad-modal-title">{amenity.nombre || 'Amenity'}</h2>

          {amenity.descripcion && (
            <>
              <div className="unidad-modal-divider" />
              <div className="amenity-modal-desc">
                {amenity.descripcion}
              </div>
            </>
          )}
        </div>

        {/* Right: Plano image */}
        <div className="unidad-modal-plan">
          {amenity.plano ? (
            <img src={amenity.plano} alt={amenity.nombre || 'Plano'} />
          ) : (
            <div className="unidad-modal-plan-empty">
              <span>🏊</span>
              <p>Sin plano disponible</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
