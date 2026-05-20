'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const ESTADO_LABELS = {
  disponible: 'Disponible',
  reservado:  'Reservado',
  vendido:    'Vendido',
};

/**
 * LoteModal — right-side floating panel showing lote details.
 * Mirrors UnidadModal in chrome; lote-specific fields (no plano, no
 * panorama). Closes when clicking anywhere outside the panel.
 */
export default function LoteModal({ lote, barrio, onClose, whatsappNumber, projectName }) {
  const [mounted, setMounted] = useState(false);
  const drawerRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || !lote) return;
    const handleClickOutside = (e) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [mounted, lote, onClose]);

  if (!lote || !mounted) return null;

  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
        `Hola! Estoy consultando por el lote ${lote.numero || lote.id || '—'}${projectName ? ` del proyecto ${projectName}` : ''}. Me gustaría recibir más información.`,
      )}`
    : null;

  const handleWhatsappClick = () => {
    if (whatsappUrl) window.open(whatsappUrl, '_blank');
  };

  return createPortal(
    <div className="unit-drawer" ref={drawerRef}>
      <div className="unit-drawer-scroll">
        <div className="unit-drawer-header">
          <div className="unit-drawer-header-left">
            <h2 className="unit-drawer-title">Lote {lote.numero || lote.id || '—'}</h2>
            {barrio?.nombre && (
              <span className="unit-drawer-subtitle">
                <span
                  className="lote-barrio-dot"
                  style={{ background: barrio.color || 'rgba(255,255,255,0.4)', verticalAlign: 'middle', marginRight: 6 }}
                />
                {barrio.nombre}
              </span>
            )}
          </div>
          <button className="unit-drawer-close" onClick={onClose} title="Volver a la lista">✕</button>
        </div>

        <div className="unit-drawer-body">
          <div className="unit-drawer-specs">
            <div className="unit-drawer-row">
              <span className="unit-drawer-label">Estado</span>
              <span className="unit-drawer-value">{ESTADO_LABELS[lote.estado] || lote.estado || '—'}</span>
            </div>
            <div className="unit-drawer-row">
              <span className="unit-drawer-label">Sup. total</span>
              <span className="unit-drawer-value">{lote.superficieTotal ?? '—'} m²</span>
            </div>
            <div className="unit-drawer-row unit-drawer-row-total">
              <span className="unit-drawer-label">Sup. construible</span>
              <span className="unit-drawer-value">{lote.superficieConstruible ?? '—'} m²</span>
            </div>
          </div>
        </div>

        <div className="unit-drawer-actions">
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
    </div>,
    document.body,
  );
}
