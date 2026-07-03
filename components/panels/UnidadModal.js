'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import LazyImage from '../ui/LazyImage';
import Icon from '../ui/Icon';
import CloseButton from '../ui/CloseButton';
import { getInitialLon } from '@/lib/panorama';

const PanoramaViewer = dynamic(() => import('./PanoramaViewer'), { ssr: false });

const ESTADO_LABELS = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' };

/**
 * UnidadModal — right-side floating panel showing unit details.
 * Non-blocking: the rest of the page remains fully interactive.
 * Closes when clicking anywhere outside the panel.
 *
 * Standardized field names:
 *   id, piso, ambientes, superficie_cubierta, superficie_semicubierta,
 *   superficie_amenities, superficie_total, imagen_plano, imagen_panoramica
 */

export default function UnidadModal({
  unit,
  onClose,
  whatsappNumber,
  projectName,
  // Whole panoramaSettings node — the viewer's initial heading, yaw/pitch
  // clamps and per-image offsets are all derived from it via lib/panorama.
  panoramaSettings = null,
  // Hide the "Panorámica" CTA — used in contexts where the panorama is
  // already the main view (e.g. the /view/[id]/panoramas route), so the
  // button would be redundant.
  hidePanoramaButton = false,
  // Editor-only: enables the panorama viewer's "save orientation" control.
  // Called with (unit, lon) when the operator saves a calibration.
  calibrationEnabled = false,
  onSaveCalibration,
}) {
  const [mounted, setMounted] = useState(false);
  const [showPanorama, setShowPanorama] = useState(false);
  const drawerRef = useRef(null);
  // Read inside the keydown handler without re-running the focus effect when
  // the panorama toggles (see the dialog-a11y effect below).
  const showPanoramaRef = useRef(showPanorama);
  useEffect(() => {
    showPanoramaRef.current = showPanorama;
  }, [showPanorama]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on click outside.
  // The opening click has fully propagated by the time this effect runs (post-commit),
  // so the new listener won't receive it.
  useEffect(() => {
    if (!mounted || !unit) return;
    const handleClickOutside = (e) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) {
        // Ignore interactions inside portaled overlays (panorama viewer lives
        // outside the drawer DOM tree, so its drag events would otherwise close us).
        if (e.target.closest('.pano-overlay')) return;
        onClose();
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [mounted, unit, onClose]);

  // Dialog accessibility (ACC-3): the drawer is a non-blocking dialog — pointer
  // users keep interacting with the 3D scene and click-outside closes it — but
  // keyboard/AT users get modal semantics. On open we move focus in; while open
  // we trap Tab and close on Escape; on close we restore focus to the trigger.
  // When the panorama overlay is up it owns Escape/focus, so we no-op.
  useEffect(() => {
    if (!mounted || !unit) return;
    const node = drawerRef.current;
    if (!node) return;

    const SELECTOR =
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(node.querySelectorAll(SELECTOR)).filter((el) => el.offsetParent !== null);

    const previouslyFocused = document.activeElement;
    (focusables()[0] || node).focus();

    const handleKey = (e) => {
      if (showPanoramaRef.current) return;
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

  // Hide-empty rule: a field with no assigned value shows neither label nor
  // value (no "—" placeholders). Superficies get the m² suffix only when set.
  const hasVal = (v) => v != null && String(v).trim() !== '';
  const specs = [
    { label: 'Ambientes', value: unit.ambientes },
    { label: 'Orientación', value: unit.orientacion },
    { label: 'Sup. cubierta', value: hasVal(unit.superficie_cubierta) ? `${unit.superficie_cubierta} m²` : '' },
    { label: 'Sup. semicubierta', value: hasVal(unit.superficie_semicubierta) ? `${unit.superficie_semicubierta} m²` : '' },
    { label: 'Sup. amenities', value: hasVal(unit.superficie_amenities) ? `${unit.superficie_amenities} m²` : '' },
    { label: 'Sup. total', value: hasVal(unit.superficie_total) ? `${unit.superficie_total} m²` : '', total: true },
  ].filter((s) => hasVal(s.value));

  return createPortal(
    <>
      <div
        className="unit-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unit-drawer-title"
        tabIndex={-1}
      >
        {/* Scrollable content */}
        <div className="unit-drawer-scroll">
          {/* Title — full width on mobile */}
          <div className="unit-drawer-header">
            <div className="unit-drawer-header-left">
              <h2 className="unit-drawer-title" id="unit-drawer-title">Unidad {unit.id || '—'}</h2>
              {hasVal(unit.piso) && (
                <span className="unit-drawer-subtitle">Piso {unit.piso}</span>
              )}
            </div>
            <CloseButton onClick={onClose} />
          </div>

          {/* Estado — availability badge, hidden when unset */}
          {ESTADO_LABELS[unit.estado] && (
            <div className="unit-drawer-estado">
              <span className={`estado-badge estado-badge-${unit.estado}`}>
                {ESTADO_LABELS[unit.estado]}
              </span>
            </div>
          )}

          {/* Precio — hidden entirely when the scene leaves it empty */}
          {hasVal(unit.precio) && (
            <div className="unit-drawer-price">
              <span className="unit-drawer-price-label">Precio</span>
              <span className="unit-drawer-price-value">{unit.precio}</span>
            </div>
          )}

          {/* Body — horizontal on mobile: specs left, plan right */}
          <div className="unit-drawer-body">
            {/* Specs — empty fields are omitted (label + value) */}
            <div className="unit-drawer-specs">
              {specs.map((s) => (
                <div
                  key={s.label}
                  className={`unit-drawer-row${s.total ? ' unit-drawer-row-total' : ''}`}
                >
                  <span className="unit-drawer-label">{s.label}</span>
                  <span className="unit-drawer-value">{s.value}</span>
                </div>
              ))}
            </div>

            {/* Floor plan */}
            <div className="unit-drawer-plan">
              {unit.imagen_plano ? (
                <LazyImage
                  src={unit.imagen_plano}
                  alt={`Plano ${unit.id}`}
                  wrapperClassName="lazy-img-plan"
                />
              ) : (
                <div className="unit-drawer-plan-empty">
                  <span aria-hidden="true"><Icon name="image" /></span>
                  <p>Sin plano</p>
                </div>
              )}
            </div>
          </div>

          {/* Actions — row on mobile */}
          <div className="unit-drawer-actions">
            {!hidePanoramaButton && hasPanorama && (
              <button
                className="unit-drawer-btn unit-drawer-btn-panorama"
                onClick={() => setShowPanorama(true)}
                title="Ver vista panorámica 360°"
                aria-label="Ver vista panorámica 360°"
              >
                <Icon name="globe" /> Ver panorámica 360°
              </button>
            )}
            <button
              className={`unit-drawer-btn unit-drawer-btn-whatsapp${!whatsappUrl ? ' disabled' : ''}`}
              onClick={handleWhatsappClick}
              disabled={!whatsappUrl}
              title={whatsappUrl ? 'Abrir WhatsApp' : 'Número de WhatsApp no configurado'}
            >
              Consultar por WhatsApp
            </button>
          </div>
        </div>
      </div>

      {/* 360° Panorama Viewer */}
      {showPanorama && (
        <PanoramaViewer
          url={unit.imagen_panoramica}
          unitId={unit.id}
          initialLon={getInitialLon(unit, panoramaSettings)}
          // While calibrating, ignore the yaw clamp so the operator can rotate
          // freely to correct even a badly-misoriented image.
          yawMin={calibrationEnabled ? null : (panoramaSettings?.yawMin ?? null)}
          yawMax={calibrationEnabled ? null : (panoramaSettings?.yawMax ?? null)}
          pitchMin={panoramaSettings?.pitchMin ?? -85}
          pitchMax={panoramaSettings?.pitchMax ?? 85}
          calibrationEnabled={calibrationEnabled}
          onSaveCalibration={(lon) => onSaveCalibration?.(unit, lon)}
          onClose={() => setShowPanorama(false)}
        />
      )}
    </>,
    document.body
  );
}
