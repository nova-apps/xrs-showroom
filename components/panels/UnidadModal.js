'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';

const PanoramaViewer = dynamic(() => import('./PanoramaViewer'), { ssr: false });

/**
 * UnidadModal — right-side floating panel showing unit details.
 * Non-blocking: the rest of the page remains fully interactive.
 * Closes when clicking anywhere outside the panel.
 *
 * Standardized field names:
 *   id, piso, ambientes, superficie_cubierta, superficie_semicubierta,
 *   superficie_amenities, superficie_total, imagen_plano, imagen_panoramica
 */
export default function UnidadModal({ unit, onClose, whatsappNumber, projectName }) {
  const [mounted, setMounted] = useState(false);
  const [showPanorama, setShowPanorama] = useState(false);
  const drawerRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!mounted || !unit) return;
    const handleClickOutside = (e) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) {
        onClose();
      }
    };
    // Delay to avoid closing immediately from the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [mounted, unit, onClose]);

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
    <>
      <div className="unit-drawer" ref={drawerRef}>
        {/* Scrollable content */}
        <div className="unit-drawer-scroll">
          {/* Title — full width on mobile */}
          <div className="unit-drawer-header">
            <div className="unit-drawer-header-left">
              <h2 className="unit-drawer-title">Unidad {unit.id || '—'}</h2>
              <span className="unit-drawer-subtitle">Piso {unit.piso || '—'}</span>
            </div>
            <button className="unit-drawer-close" onClick={onClose} title="Volver a la lista">✕</button>
          </div>

          {/* Body — horizontal on mobile: specs left, plan right */}
          <div className="unit-drawer-body">
            {/* Specs */}
            <div className="unit-drawer-specs">
              <div className="unit-drawer-row">
                <span className="unit-drawer-label">Ambientes</span>
                <span className="unit-drawer-value">{unit.ambientes || '—'}</span>
              </div>
              <div className="unit-drawer-row">
                <span className="unit-drawer-label">Sup. cubierta</span>
                <span className="unit-drawer-value">{unit.superficie_cubierta ?? '—'} m²</span>
              </div>
              <div className="unit-drawer-row">
                <span className="unit-drawer-label">Sup. semicubierta</span>
                <span className="unit-drawer-value">{unit.superficie_semicubierta ?? '—'} m²</span>
              </div>
              <div className="unit-drawer-row">
                <span className="unit-drawer-label">Sup. amenities</span>
                <span className="unit-drawer-value">{unit.superficie_amenities ?? '—'} m²</span>
              </div>
              <div className="unit-drawer-row unit-drawer-row-total">
                <span className="unit-drawer-label">Sup. total</span>
                <span className="unit-drawer-value">{unit.superficie_total ?? '—'} m²</span>
              </div>
            </div>

            {/* Floor plan */}
            <div className="unit-drawer-plan">
              {unit.imagen_plano ? (
                <img src={unit.imagen_plano} alt={`Plano ${unit.id}`} />
              ) : (
                <div className="unit-drawer-plan-empty">
                  <span>🏠</span>
                  <p>Sin plano</p>
                </div>
              )}
            </div>
          </div>

          {/* Actions — row on mobile */}
          <div className="unit-drawer-actions">
            <button
              className={`unit-drawer-btn unit-drawer-btn-panorama${!hasPanorama ? ' disabled' : ''}`}
              onClick={() => hasPanorama && setShowPanorama(true)}
              disabled={!hasPanorama}
              title={hasPanorama ? 'Ver vista panorámica 360°' : 'Sin panorama disponible'}
            >
              🌐 Panorámica
            </button>
            <button
              className={`unit-drawer-btn unit-drawer-btn-whatsapp${!whatsappUrl ? ' disabled' : ''}`}
              onClick={handleWhatsappClick}
              disabled={!whatsappUrl}
              title={whatsappUrl ? 'Abrir WhatsApp' : 'Número de WhatsApp no configurado'}
            >
              WhatsApp
            </button>
          </div>
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
    </>,
    document.body
  );
}
