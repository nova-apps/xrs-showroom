'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';

const PanoramaViewer = dynamic(() => import('./PanoramaViewer'), { ssr: false });

/**
 * UnidadModal — fullscreen modal showing unit details.
 * Left: info table + action buttons. Right: large floor plan image.
 *
 * Standardized field names:
 *   id, piso, ambientes, superficie_cubierta, superficie_semicubierta,
 *   superficie_amenities, superficie_total, imagen_plano, imagen_panoramica
 */
export default function UnidadModal({ unit, onClose, whatsappNumber, projectName }) {
  const [mounted, setMounted] = useState(false);
  const [showPanorama, setShowPanorama] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!unit || !mounted) return null;

  const hasPanorama = !!unit.imagen_panoramica;

  // Build WhatsApp URL with pre-filled message
  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
        `Hola! Estoy consultando por la unidad ${unit.id || '—'}${projectName ? ` del proyecto ${projectName}` : ''}. Me gustaría recibir más información.`
      )}`
    : null;

  const handleWhatsappClick = () => {
    if (whatsappUrl) {
      window.open(whatsappUrl, '_blank');
    }
  };

  return createPortal(
    <div className="unidad-modal-overlay" onClick={onClose}>
      <div className="unidad-modal" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button className="unidad-modal-close" onClick={onClose} title="Cerrar">
          ✕
        </button>

        {/* Left: Info */}
        <div className="unidad-modal-info">
          <h2 className="unidad-modal-title">Unidad {unit.id || '—'}</h2>

          <div className="unidad-modal-row">
            <span className="unidad-modal-label">Piso</span>
            <span className="unidad-modal-value">{unit.piso || '—'}</span>
          </div>

          <div className="unidad-modal-divider" />

          <div className="unidad-modal-row">
            <span className="unidad-modal-label">Ambientes</span>
            <span className="unidad-modal-value">{unit.ambientes || '—'}</span>
          </div>
          <div className="unidad-modal-row">
            <span className="unidad-modal-label">Superficie cubierta</span>
            <span className="unidad-modal-value">{unit.superficie_cubierta ?? '—'} m²</span>
          </div>
          <div className="unidad-modal-row">
            <span className="unidad-modal-label">Superficie semicubierta</span>
            <span className="unidad-modal-value">{unit.superficie_semicubierta ?? '—'} m²</span>
          </div>
          <div className="unidad-modal-row">
            <span className="unidad-modal-label">Superficie amenities</span>
            <span className="unidad-modal-value">{unit.superficie_amenities ?? '—'} m²</span>
          </div>
          <div className="unidad-modal-row unidad-modal-row-total">
            <span className="unidad-modal-label">Superficie total</span>
            <span className="unidad-modal-value">{unit.superficie_total ?? '—'} m²</span>
          </div>

          <div className="unidad-modal-actions">
            <button
              className={`unidad-modal-btn unidad-modal-btn-panorama${!hasPanorama ? ' disabled' : ''}`}
              onClick={() => hasPanorama && setShowPanorama(true)}
              disabled={!hasPanorama}
              title={hasPanorama ? 'Ver vista panorámica 360°' : 'Sin panorama disponible'}
            >
              🌐 Vista Panorámica
            </button>
            <button
              className={`unidad-modal-btn unidad-modal-btn-whatsapp${!whatsappUrl ? ' disabled' : ''}`}
              onClick={handleWhatsappClick}
              disabled={!whatsappUrl}
              title={whatsappUrl ? 'Abrir WhatsApp' : 'Número de WhatsApp no configurado'}
            >
              Hablemos por WhatsApp
            </button>
          </div>
        </div>

        {/* Right: Floor plan image */}
        <div className="unidad-modal-plan">
          {unit.imagen_plano ? (
            <img src={unit.imagen_plano} alt={`Plano ${unit.id}`} />
          ) : (
            <div className="unidad-modal-plan-empty">
              <span>🏠</span>
              <p>Sin plano disponible</p>
            </div>
          )}
        </div>
      </div>

      {/* 360° Panorama Viewer */}
      {showPanorama && (
        <PanoramaViewer
          url={unit.imagen_panoramica}
          unitId={unit.id}
          onClose={() => setShowPanorama(false)}
        />
      )}
    </div>,
    document.body
  );
}
