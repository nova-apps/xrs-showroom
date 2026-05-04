'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * AmenityModal — modal showing amenity details.
 * Column layout: nombre on top, plano image below.
 */
export default function AmenityModal({ amenity, onClose }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!amenity || !mounted) return null;

  return createPortal(
    <div className="unidad-modal-overlay" onClick={onClose}>
      <div className="unidad-modal amenity-modal" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button className="unidad-modal-close" onClick={onClose} title="Cerrar">
          ✕
        </button>

        {/* Name */}
        <div className="amenity-modal-header">
          <h2 className="unidad-modal-title">{amenity.nombre || 'Amenity'}</h2>
        </div>

        {/* Plano image */}
        <div className="amenity-modal-image">
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
