'use client';

import { useState, useCallback, useEffect } from 'react';
import FloatingPanel from './FloatingPanel';
import HelpTooltip from '@/components/ui/HelpTooltip';
import { SubAccordion } from '@/components/ui/AssetAccordion';

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
 * Card for capturing / clearing an initial camera position. Used for both
 * the desktop and the mobile slot inside the "Posición inicial" group.
 */
function InitialCameraCard({ label, value, flash, onCapture, onClear }) {
  return (
    <div className="initial-camera-card">
      <div className="initial-camera-card-label">{label}</div>
      <div className="initial-camera-row">
        <button
          className={`initial-camera-btn${flash ? ' saved' : ''}`}
          onClick={onCapture}
        >
          {flash ? '✓ Guardado' : 'Capturar posición actual'}
        </button>
        {value && (
          <button
            className="initial-camera-clear"
            onClick={onClear}
            title="Borrar posición inicial"
          >
            ✕
          </button>
        )}
      </div>
      {value && (
        <div className="initial-camera-info">
          <span>Zoom: {value.zoom}</span>
          <span>Pitch: {value.pitch}°</span>
          <span>Yaw: {value.yaw}°</span>
        </div>
      )}
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
  const [openSection, setOpenSection] = useState('initial');

  const toggleSection = useCallback((id) => {
    setOpenSection((prev) => (prev === id ? null : id));
  }, []);

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
      onApplyOrbit?.({ ...local, ...FREE_CAMERA });
    } else {
      onApplyOrbit?.(local);
    }
  }, [local, onApplyOrbit]);

  // Mobile zoom override toggle — derived from data, but the user can flip it
  // explicitly. Turning it off clears mobile.zoomMin/Max so mobile falls back
  // to the desktop limits.
  const mobileZoomOverridden = local
    ? local.mobile?.zoomMin !== undefined || local.mobile?.zoomMax !== undefined
    : false;
  const [mobileZoomEnabled, setMobileZoomEnabled] = useState(mobileZoomOverridden);
  useEffect(() => { setMobileZoomEnabled(mobileZoomOverridden); }, [mobileZoomOverridden]);

  const handleMobileZoomToggle = useCallback((checked) => {
    setMobileZoomEnabled(checked);
    if (!checked) {
      // Clear mobile-specific zoom values so it falls back to desktop.
      setLocal((prev) => {
        if (!prev) return prev;
        const nextMobile = { ...prev.mobile };
        delete nextMobile.zoomMin;
        delete nextMobile.zoomMax;
        const next = { ...prev, mobile: nextMobile };
        onOrbitChange?.(next);
        onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);
        return next;
      });
    }
  }, [onOrbitChange, onApplyOrbit, freeCam]);

  // ── Initial camera handlers ──
  const captureDesktopInitial = useCallback(() => {
    if (!viewerRef?.current) return;
    const state = viewerRef.current.getCameraState();
    if (!state) return;
    const next = { ...local, initialCamera: state };
    setLocal(next);
    onOrbitChange?.(next);
    onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1200);
  }, [local, viewerRef, onOrbitChange, onApplyOrbit, freeCam]);

  const clearDesktopInitial = useCallback(() => {
    const next = { ...local };
    delete next.initialCamera;
    setLocal(next);
    onOrbitChange?.(next);
    onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);
  }, [local, onOrbitChange, onApplyOrbit, freeCam]);

  const captureMobileInitial = useCallback(() => {
    if (!viewerRef?.current) return;
    const state = viewerRef.current.getCameraState();
    if (!state) return;
    const next = { ...local, mobile: { ...local.mobile, initialCamera: state } };
    setLocal(next);
    onOrbitChange?.(next);
    onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);
    setMobileSaveFlash(true);
    setTimeout(() => setMobileSaveFlash(false), 1200);
  }, [local, viewerRef, onOrbitChange, onApplyOrbit, freeCam]);

  const clearMobileInitial = useCallback(() => {
    const nextMobile = { ...local.mobile };
    delete nextMobile.initialCamera;
    const next = { ...local, mobile: nextMobile };
    setLocal(next);
    onOrbitChange?.(next);
    onApplyOrbit?.(freeCam ? { ...next, ...FREE_CAMERA } : next);
  }, [local, onOrbitChange, onApplyOrbit, freeCam]);

  if (!local) return null;

  return (
    <FloatingPanel
      title="Camera"
      icon="📷"
      position=""
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {/* ═══ 1. Posición inicial ═══ */}
      <SubAccordion
        title="Posición inicial"
        icon="📍"
        open={openSection === 'initial'}
        onToggle={() => toggleSection('initial')}
      >
        <InitialCameraCard
          label="Desktop"
          value={local.initialCamera}
          flash={saveFlash}
          onCapture={captureDesktopInitial}
          onClear={clearDesktopInitial}
        />
        <InitialCameraCard
          label="Mobile"
          value={local.mobile?.initialCamera}
          flash={mobileSaveFlash}
          onCapture={captureMobileInitial}
          onClear={clearMobileInitial}
        />
        <div className="initial-camera-help">
          Al cargar la escena, la cámara se posiciona automáticamente en estos valores.
        </div>
      </SubAccordion>

      {/* ═══ 2. Límites de cámara ═══ */}
      <SubAccordion
        title="Límites de cámara"
        icon="🔒"
        open={openSection === 'limits'}
        onToggle={() => toggleSection('limits')}
      >
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

          {/* Mobile override toggle */}
          <label className="mobile-override-toggle">
            <input
              type="checkbox"
              checked={mobileZoomEnabled}
              onChange={(e) => handleMobileZoomToggle(e.target.checked)}
            />
            <span>Usar valores distintos en mobile</span>
            <HelpTooltip text="Si está activo, mobile usa los valores de zoom de abajo. Si no, hereda los de desktop." />
          </label>

          {mobileZoomEnabled && (
            <div className="mobile-override-block">
              <div className="mobile-override-label">📱 Mobile</div>
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
            </div>
          )}
        </div>

        <div className="section-divider" />

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
        </div>

        <div className="section-divider" />

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
      </SubAccordion>

      {/* ═══ 3. Comportamiento ═══ */}
      <SubAccordion
        title="Comportamiento"
        icon="🎛️"
        open={openSection === 'behavior'}
        onToggle={() => toggleSection('behavior')}
      >
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

        <div className="transform-section">
          <div className="transform-section-title">↕️ Pitch Snap</div>
          <div className="transform-row">
            <span className="transform-label label-pitch">On</span>
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

        <div className="section-divider" />

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
      </SubAccordion>
    </FloatingPanel>
  );
}
