'use client';

import { useState, useCallback, useEffect } from 'react';
import FloatingPanel from './FloatingPanel';
import HelpTooltip from '@/components/ui/HelpTooltip';

/**
 * Single control row: label + range slider + number input.
 */
function ControlRow({ label, labelClass, value, min, max, step, onChange, help }) {
  return (
    <div className="transform-row">
      <span className={`transform-label ${labelClass}`}>{label}</span>
      {help && <HelpTooltip text={help} />}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <input
        type="number"
        step={step}
        value={Math.round(value * 100) / 100}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}

/**
 * Default orbit settings used when scene has no orbit data yet.
 */
export const DEFAULT_ORBIT = {
  zoomMin: 0.5,
  zoomMax: 500,
  pitchMin: -90,
  pitchMax: 90,
  yawMin: -180,
  yawMax: 180,
  pixelRatio: 1,
  pitchSnapEnabled: false,
  pitchSnapTarget: 90,
  clickZoomEnabled: false,
  clickZoomAmount: 30,
  focusSpeed: 25,
  mobile: {},
};

/**
 * Camera Panel — adjusts antialiasing, zoom min/max and pitch/yaw limits.
 * Rendered inside RightPanelStack with controlled collapse.
 */
const FREE_CAMERA = {
  zoomMin: 0.01,
  zoomMax: Infinity,
  pitchMin: -90,
  pitchMax: 90,
  yawMin: -180,
  yawMax: 180,
};

export default function OrbitPanel({ scene, onOrbitChange, onApplyOrbit, collapsed, onToggle, viewerRef }) {
  const orbit = scene?.orbit;

  // Local state for responsive UI
  const [local, setLocal] = useState(null);
  const [freeCam, setFreeCam] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [mobileSaveFlash, setMobileSaveFlash] = useState(false);

  // Sync from Firebase when scene data arrives/changes
  useEffect(() => {
    if (orbit) {
      setLocal({ ...DEFAULT_ORBIT, ...orbit, mobile: { ...DEFAULT_ORBIT.mobile, ...orbit?.mobile } });
    } else if (scene && !orbit) {
      setLocal({ ...DEFAULT_ORBIT });
    }
  }, [orbit, scene]);

  const updateField = useCallback(
    (field, value) => {
      setLocal((prev) => {
        if (!prev) return prev;
        const next = { ...prev, [field]: value };

        onOrbitChange?.(next);
        // In free cam, apply with free limits; otherwise apply saved limits
        onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);

        return next;
      });
    },
    [onOrbitChange, onApplyOrbit, freeCam]
  );

  const updateMobileField = useCallback(
    (field, value) => {
      setLocal((prev) => {
        if (!prev) return prev;
        const next = { ...prev, mobile: { ...prev.mobile, [field]: value } };
        onOrbitChange?.(next);
        onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);
        return next;
      });
    },
    [onOrbitChange, onApplyOrbit, freeCam]
  );

  const handleFreeCam = useCallback((checked) => {
    setFreeCam(checked);
    if (checked) {
      // Apply free camera to viewer only (no save)
      onApplyOrbit?.({ ...local, ...FREE_CAMERA });
    } else {
      // Restore saved orbit settings
      onApplyOrbit?.(local);
    }
  }, [local, onApplyOrbit]);

  if (!local) return null;

  return (
    <FloatingPanel
      title="Camera"
      icon="📷"
      position=""
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {/* ─── Free Camera ─── */}
      <div className="transform-section">
        <label className="hdri-checkbox-row">
          <input
            type="checkbox"
            checked={freeCam}
            onChange={(e) => handleFreeCam(e.target.checked)}
          />
          <span>Cámara libre (solo editor)</span>
        </label>
      </div>

      <div className="section-divider" />

      {/* ─── Initial Camera Position ─── */}
      <div className="transform-section">
        <div className="transform-section-title">📍 Posición Inicial</div>
        <div className="initial-camera-row">
          <button
            className={`initial-camera-btn${saveFlash ? ' saved' : ''}`}
            onClick={() => {
              if (!viewerRef?.current) return;
              const state = viewerRef.current.getCameraState();
              if (!state) return;
              const next = { ...local, initialCamera: state };
              setLocal(next);
              onOrbitChange?.(next);
              onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);
              setSaveFlash(true);
              setTimeout(() => setSaveFlash(false), 1200);
            }}
          >
            {saveFlash ? '✓ Guardado' : 'Capturar posición actual'}
          </button>
          {local.initialCamera && (
            <button
              className="initial-camera-clear"
              onClick={() => {
                const next = { ...local };
                delete next.initialCamera;
                setLocal(next);
                onOrbitChange?.(next);
                onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);
              }}
              title="Borrar posición inicial"
            >
              ✕
            </button>
          )}
        </div>
        {local.initialCamera && (
          <div className="initial-camera-info">
            <span>Zoom: {local.initialCamera.zoom}</span>
            <span>Pitch: {local.initialCamera.pitch}°</span>
            <span>Yaw: {local.initialCamera.yaw}°</span>
          </div>
        )}
        <div className="initial-camera-help">
          Al cargar la escena, la cámara se posiciona automáticamente aquí
        </div>
      </div>

      <div className="section-divider" />

      {/* ─── Antialiasing ─── */}
      <div className="transform-section">
        <div className="transform-section-title">🔲 Antialiasing</div>
        <ControlRow
          label="PR"
          labelClass="label-s"
          value={local.pixelRatio ?? 1}
          min={0.5}
          max={2}
          step={0.25}
          onChange={(v) => updateField('pixelRatio', v)}
          help="Pixel Ratio — controla la calidad de renderizado. Mayor valor = mejor nitidez, más consumo de GPU"
        />
      </div>

      <div className="section-divider" />

      {/* ─── Click Zoom ─── */}
      <div className="transform-section">
        <div className="transform-section-title">🔎 Click Zoom</div>
        <div className="transform-row">
          <span className="transform-label label-zoom">On</span>
          <HelpTooltip text="Al mantener presionado el click, la cámara hace un zoom sutil. Al soltar, vuelve suavemente a la posición original" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={local.clickZoomEnabled ?? false}
              onChange={(e) => updateField('clickZoomEnabled', e.target.checked)}
            />
            <span style={{ fontSize: 11, opacity: 0.7 }}>{local.clickZoomEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        {local.clickZoomEnabled && (
          <ControlRow
            label="%"
            labelClass="label-zoom"
            value={local.clickZoomAmount ?? 30}
            min={10}
            max={80}
            step={5}
            onChange={(v) => updateField('clickZoomAmount', v)}
            help="Porcentaje de acercamiento — cuánto se acerca la cámara al punto de enfoque (30% = sutil, 80% = muy cercano)"
          />
        )}
      </div>

      <div className="section-divider" />

      {/* ─── Focus Animation Speed ─── */}
      <div className="transform-section">
        <div className="transform-section-title">🎬 Animación de Foco</div>
        <ControlRow
          label="Vel"
          labelClass="label-s"
          value={local.focusSpeed ?? 25}
          min={5}
          max={100}
          step={5}
          onChange={(v) => updateField('focusSpeed', v)}
          help="Velocidad de la animación de cámara al seleccionar una unidad (5 = muy lenta, 100 = instantánea)"
        />
      </div>

      <div className="section-divider" />
      {/* ─── Zoom ─── */}
      <div className="transform-section">
        <div className="transform-section-title">🔍 Zoom (Distancia)</div>
        <ControlRow
          label="Min"
          labelClass="label-zoom"
          value={local.zoomMin}
          min={0.1}
          max={100}
          step={0.5}
          onChange={(v) => updateField('zoomMin', v)}
          help="Distancia mínima de la cámara al punto de enfoque"
        />
        <ControlRow
          label="Max"
          labelClass="label-zoom"
          value={local.zoomMax}
          min={1}
          max={5000}
          step={10}
          onChange={(v) => updateField('zoomMax', v)}
          help="Distancia máxima de la cámara al punto de enfoque"
        />
      </div>

      <div className="section-divider" />

      {/* ─── Mobile Overrides ─── */}
      <div className="transform-section">
        <div className="transform-section-title">📱 Mobile</div>

        {/* Mobile Zoom */}
        <ControlRow
          label="Min"
          labelClass="label-zoom"
          value={local.mobile?.zoomMin ?? local.zoomMin}
          min={0.1}
          max={100}
          step={0.5}
          onChange={(v) => updateMobileField('zoomMin', v)}
          help="Distancia mínima de la cámara en mobile"
        />
        <ControlRow
          label="Max"
          labelClass="label-zoom"
          value={local.mobile?.zoomMax ?? local.zoomMax}
          min={1}
          max={5000}
          step={10}
          onChange={(v) => updateMobileField('zoomMax', v)}
          help="Distancia máxima de la cámara en mobile"
        />

        {/* Mobile Initial Camera */}
        <div className="transform-section-title" style={{ marginTop: 8 }}>📍 Posición Inicial (Mobile)</div>
        <div className="initial-camera-row">
          <button
            className={`initial-camera-btn${mobileSaveFlash ? ' saved' : ''}`}
            onClick={() => {
              if (!viewerRef?.current) return;
              const state = viewerRef.current.getCameraState();
              if (!state) return;
              const next = { ...local, mobile: { ...local.mobile, initialCamera: state } };
              setLocal(next);
              onOrbitChange?.(next);
              onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);
              setMobileSaveFlash(true);
              setTimeout(() => setMobileSaveFlash(false), 1200);
            }}
          >
            {mobileSaveFlash ? '✓ Guardado' : 'Capturar posición actual'}
          </button>
          {local.mobile?.initialCamera && (
            <button
              className="initial-camera-clear"
              onClick={() => {
                const nextMobile = { ...local.mobile };
                delete nextMobile.initialCamera;
                const next = { ...local, mobile: nextMobile };
                setLocal(next);
                onOrbitChange?.(next);
                onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);
              }}
              title="Borrar posición inicial mobile"
            >
              ✕
            </button>
          )}
        </div>
        {local.mobile?.initialCamera && (
          <div className="initial-camera-info">
            <span>Zoom: {local.mobile.initialCamera.zoom}</span>
            <span>Pitch: {local.mobile.initialCamera.pitch}°</span>
            <span>Yaw: {local.mobile.initialCamera.yaw}°</span>
          </div>
        )}
        <div className="initial-camera-help">
          Overrides de cámara aplicados solo en dispositivos móviles
        </div>
      </div>

      <div className="section-divider" />

      {/* ─── Pitch (vertical angle) ─── */}
      <div className="transform-section">
        <div className="transform-section-title">↕️ Pitch (Vertical)</div>
        <ControlRow
          label="Min"
          labelClass="label-pitch"
          value={local.pitchMin}
          min={-90}
          max={0}
          step={1}
          onChange={(v) => updateField('pitchMin', v)}
          help="Ángulo vertical mínimo — limita cuánto puede mirar hacia abajo"
        />
        <ControlRow
          label="Max"
          labelClass="label-pitch"
          value={local.pitchMax}
          min={0}
          max={90}
          step={1}
          onChange={(v) => updateField('pitchMax', v)}
          help="Ángulo vertical máximo — limita cuánto puede mirar hacia arriba"
        />

        {/* Pitch Snap — inside the Pitch section */}
        <div className="transform-row">
          <span className="transform-label label-pitch">Snap</span>
          <HelpTooltip text="Al llegar al pitch máximo, la cámara se anima al ángulo indicado. Al volver a bajar, regresa suavemente al pitch máximo" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={local.pitchSnapEnabled ?? false}
              onChange={(e) => updateField('pitchSnapEnabled', e.target.checked)}
            />
            <span style={{ fontSize: 11, opacity: 0.7 }}>{local.pitchSnapEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        {local.pitchSnapEnabled && (
          <ControlRow
            label="Angl"
            labelClass="label-pitch"
            value={local.pitchSnapTarget ?? 90}
            min={0}
            max={90}
            step={1}
            onChange={(v) => updateField('pitchSnapTarget', v)}
            help="Ángulo al que se anima la cámara al alcanzar el pitch máximo (90 = vista cenital)"
          />
        )}
      </div>

      {/* ─── Yaw (horizontal angle) ─── */}
      <div className="transform-section">
        <div className="transform-section-title">↔️ Yaw (Horizontal)</div>
        <ControlRow
          label="Min"
          labelClass="label-yaw"
          value={local.yawMin}
          min={-180}
          max={0}
          step={1}
          onChange={(v) => updateField('yawMin', v)}
          help="Ángulo horizontal mínimo — limita la rotación hacia la izquierda"
        />
        <ControlRow
          label="Max"
          labelClass="label-yaw"
          value={local.yawMax}
          min={0}
          max={180}
          step={1}
          onChange={(v) => updateField('yawMax', v)}
          help="Ángulo horizontal máximo — limita la rotación hacia la derecha"
        />
      </div>
    </FloatingPanel>
  );
}
