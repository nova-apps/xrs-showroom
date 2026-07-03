'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import CloseButton from '../ui/CloseButton';

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

  // Dialog accessibility (ACC-3) — mirrors UnidadModal: move focus in on open,
  // trap Tab, close on Escape, restore focus on close. See UnidadModal for the
  // rationale on why this non-blocking drawer still gets modal keyboard semantics.
  useEffect(() => {
    if (!mounted || !lote) return;
    const node = drawerRef.current;
    if (!node) return;

    const SELECTOR =
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(node.querySelectorAll(SELECTOR)).filter((el) => el.offsetParent !== null);

    const previouslyFocused = document.activeElement;
    (focusables()[0] || node).focus();

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (!node.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
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
    <div
      className="unit-drawer"
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lote-drawer-title"
      tabIndex={-1}
    >
      <div className="unit-drawer-scroll">
        <div className="unit-drawer-header">
          <div className="unit-drawer-header-left">
            <h2 className="unit-drawer-title" id="lote-drawer-title">Lote {lote.numero || lote.id || '—'}</h2>
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
          <CloseButton onClick={onClose} />
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
