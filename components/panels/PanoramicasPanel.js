'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import FloatingPanel from './FloatingPanel';

/**
 * PanoramicasPanel — scene-level settings for panorama viewing.
 *
 * Exposes:
 *   - northOffset (degrees): compass bearing of the panorama's center column.
 *     Used with each unit's `orientacion` to set the initial heading.
 *   - yawMin / yawMax (degrees, -180..180): horizontal rotation clamp.
 *     Leave blank = unlimited (free 360° spin).
 *   - pitchMin / pitchMax (degrees, -90..90): vertical rotation clamp.
 *     Defaults ±85.
 *
 * Math (compass clockwise N=0, E=90; lon CCW in three.js):
 *     lon_initial = northOffset - orientacionDeg(unit.orientacion)
 */

const FIELDS = [
  { key: 'northOffset', label: 'Offset al norte',  min: -180, max: 360, default: 0,   nullable: false,
    hint: 'Compass del centro de la imagen panorámica. 0 = Norte, 90 = Este.' },
  { key: 'yawMin',      label: 'Yaw mínimo',       min: -180, max: 180, default: null, nullable: true,
    hint: 'Cuánto puede girar a la izquierda desde el heading inicial (ej. -45). Vacío = sin límite.' },
  { key: 'yawMax',      label: 'Yaw máximo',       min: -180, max: 180, default: null, nullable: true,
    hint: 'Cuánto puede girar a la derecha desde el heading inicial (ej. +45).' },
  { key: 'pitchMin',    label: 'Pitch mínimo',     min: -90,  max: 90,  default: -85,  nullable: false,
    hint: 'Cuánto se puede mirar hacia abajo (por defecto -85°).' },
  { key: 'pitchMax',    label: 'Pitch máximo',     min: -90,  max: 90,  default: 85,   nullable: false,
    hint: 'Cuánto se puede mirar hacia arriba (por defecto 85°).' },
];

export default function PanoramicasPanel({
  scene,
  sceneId,
  onPanoramaSettingsChange,
  collapsed,
  onToggle,
}) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, f.default])),
  );
  const debounceTimer = useRef(null);

  // Sync from scene; missing fields fall back to defaults.
  useEffect(() => {
    const ps = scene?.panoramaSettings || {};
    setValues(
      Object.fromEntries(FIELDS.map((f) => {
        const raw = ps[f.key];
        if (raw === null || raw === undefined || raw === '') {
          return [f.key, f.default];
        }
        const num = Number(raw);
        return [f.key, Number.isFinite(num) ? num : f.default];
      })),
    );
  }, [scene?.panoramaSettings]);

  const handleFieldChange = useCallback((field, raw) => {
    const next = { ...values };
    if (raw === '' && field.nullable) {
      next[field.key] = null;
    } else {
      const num = Number(raw);
      next[field.key] = Number.isFinite(num) ? num : (field.nullable ? null : field.default);
    }
    setValues(next);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      // Merge over the current settings — `next` only holds the scalar FIELDS,
      // and the DB write replaces the whole node, so spreading preserves the
      // per-image calibration map (imageOffsets) and any other keys.
      onPanoramaSettingsChange?.({ ...(scene?.panoramaSettings || {}), ...next });
    }, 400);
  }, [values, onPanoramaSettingsChange, scene?.panoramaSettings]);

  // Per-image calibrations (set from the unit panorama viewer in the editor).
  const calibratedCount = Object.keys(scene?.panoramaSettings?.imageOffsets || {}).length;
  const handleResetCalibrations = useCallback(() => {
    if (calibratedCount === 0) return;
    if (!window.confirm(`¿Borrar la orientación guardada de ${calibratedCount} imagen(es)? Volverán a usar el offset al norte.`)) return;
    onPanoramaSettingsChange?.({ ...(scene?.panoramaSettings || {}), imageOffsets: {} });
  }, [calibratedCount, onPanoramaSettingsChange, scene?.panoramaSettings]);

  return (
    <FloatingPanel
      title="Panorámicas"
      icon="🌐"
      position=""
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {sceneId && (
        <div className="transform-section">
          <a
            href={`/view/${sceneId}/panoramas`}
            target="_blank"
            rel="noopener noreferrer"
            className="pano-open-btn"
          >
            <span>🌐</span>
            <span>Abrir vista panorámica</span>
            <span className="pano-open-btn-ext">↗</span>
          </a>
          <span className="whatsapp-hint">
            Recorrido por unidades en panorámica 360°. Se abre en una pestaña nueva.
          </span>
        </div>
      )}

      {FIELDS.map((field) => (
        <div key={field.key} className="transform-section">
          <div className="transform-section-title">{field.label}</div>
          <div className="whatsapp-config">
            <div className="pano-offset-row">
              <input
                type="number"
                className="whatsapp-input"
                min={field.min}
                max={field.max}
                step={1}
                value={values[field.key] ?? ''}
                placeholder={field.nullable ? 'sin límite' : ''}
                onChange={(e) => handleFieldChange(field, e.target.value)}
              />
              <span className="pano-offset-suffix">°</span>
            </div>
            <span className="whatsapp-hint">{field.hint}</span>
          </div>
        </div>
      ))}

      <div className="transform-section">
        <div className="transform-section-title">Calibración por imagen</div>
        <div className="whatsapp-config">
          <span className="whatsapp-hint">
            El offset al norte es el valor por defecto. Si una imagen aparece girada,
            abrí una unidad que la use → <strong>Panorámica</strong> → arrastrá hasta
            dejarla bien y tocá <strong>Guardar orientación</strong>. Se corrige por
            imagen, así que todas las unidades que la comparten quedan iguales.
          </span>
          <div className="pano-calib-summary">
            <span>{calibratedCount} imagen{calibratedCount === 1 ? '' : 'es'} calibrada{calibratedCount === 1 ? '' : 's'}</span>
            {calibratedCount > 0 && (
              <button type="button" className="pano-calib-reset" onClick={handleResetCalibrations}>
                Restablecer
              </button>
            )}
          </div>
        </div>
      </div>
    </FloatingPanel>
  );
}
