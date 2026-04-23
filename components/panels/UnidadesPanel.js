'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import FloatingPanel from './FloatingPanel';
import UnidadesCargaModal from './UnidadesCargaModal';
import AmenitiesModal from './AmenitiesModal';
import { updateScene } from '@/lib/scenes';

/**
 * Configuración Panel — manages Unidades and Amenities data entry.
 * Houses buttons to open each respective data management modal.
 *
 * Rendered inside RightPanelStack with controlled collapse.
 */
export default function UnidadesPanel({
  scene,
  sceneId,
  onUnidadesChange,
  onAmenitiesChange,
  collapsed,
  onToggle,
}) {
  const [showUnidadesModal, setShowUnidadesModal] = useState(false);
  const [showAmenitiesModal, setShowAmenitiesModal] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const whatsappTimer = useRef(null);

  const unidadItems = scene?.unidades?.items || [];
  const amenityItems = scene?.amenities?.items || [];

  // Sync WhatsApp number from scene data
  useEffect(() => {
    if (scene?.whatsappNumber !== undefined) {
      setWhatsappNumber(scene.whatsappNumber || '');
    }
  }, [scene?.whatsappNumber]);

  const handleWhatsappChange = useCallback((value) => {
    setWhatsappNumber(value);
    if (!sceneId) return;
    if (whatsappTimer.current) clearTimeout(whatsappTimer.current);
    whatsappTimer.current = setTimeout(() => {
      updateScene(sceneId, { whatsappNumber: value }).catch(console.error);
    }, 800);
  }, [sceneId]);

  const handleUnidadesSave = useCallback(async (newItems) => {
    await onUnidadesChange?.({ items: newItems });
  }, [onUnidadesChange]);

  const handleAmenitiesSave = useCallback(async (newItems) => {
    await onAmenitiesChange?.({ items: newItems });
  }, [onAmenitiesChange]);

  return (
    <>
      <FloatingPanel
        title="Configuración"
        icon="⚙️"
        position=""
        collapsed={collapsed}
        onToggle={onToggle}
      >
        {/* Unidades section */}
        <div className="transform-section">
          <div className="transform-section-title">📋 Unidades</div>

          <div className="unidades-summary">
            <div className="unidades-summary-count">
              <span className="unidades-summary-number">{unidadItems.length}</span>
              <span className="unidades-summary-label">
                {unidadItems.length === 1 ? 'unidad' : 'unidades'}
              </span>
            </div>

            <button
              className="unidades-manage-btn"
              onClick={() => setShowUnidadesModal(true)}
            >
              {unidadItems.length > 0 ? 'Editar' : '➕ Cargar'}
            </button>
          </div>
        </div>

        {/* Amenities section */}
        <div className="transform-section">
          <div className="transform-section-title">🏊 Amenities</div>

          <div className="unidades-summary">
            <div className="unidades-summary-count">
              <span className="unidades-summary-number">{amenityItems.length}</span>
              <span className="unidades-summary-label">
                {amenityItems.length === 1 ? 'amenity' : 'amenities'}
              </span>
            </div>

            <button
              className="unidades-manage-btn"
              onClick={() => setShowAmenitiesModal(true)}
            >
              {amenityItems.length > 0 ? 'Editar' : '➕ Cargar'}
            </button>
          </div>
        </div>

        {/* WhatsApp number section */}
        <div className="transform-section">
          <div className="transform-section-title">📱 WhatsApp</div>
          <div className="whatsapp-config">
            <label className="whatsapp-config-label" htmlFor="whatsapp-number">
              Número de contacto
            </label>
            <div className="whatsapp-input-row">
              <span className="whatsapp-prefix">+</span>
              <input
                id="whatsapp-number"
                type="tel"
                className="whatsapp-input"
                placeholder="5491123456789"
                value={whatsappNumber}
                onChange={(e) => handleWhatsappChange(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
            <span className="whatsapp-hint">Código de país + número, sin espacios ni guiones</span>
          </div>
        </div>
      </FloatingPanel>

      {/* Units data management modal */}
      {showUnidadesModal && (
        <UnidadesCargaModal
          items={unidadItems}
          onSave={handleUnidadesSave}
          onClose={() => setShowUnidadesModal(false)}
        />
      )}

      {/* Amenities data management modal */}
      {showAmenitiesModal && (
        <AmenitiesModal
          items={amenityItems}
          sceneId={sceneId}
          onSave={handleAmenitiesSave}
          onClose={() => setShowAmenitiesModal(false)}
        />
      )}
    </>
  );
}
