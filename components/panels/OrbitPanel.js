'use client';

import { useState, useCallback, useEffect } from 'react';
import FloatingPanel from './FloatingPanel';

/**
 * Single control row: label + range slider + number input.
 */
function ControlRow({ label, labelClass, value, min, max, step, onChange }) {
  return (
    <div className="transform-row">
      <span className={`transform-label ${labelClass}`}>{label}</span>
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
};

/**
 * Orbit Controls Panel — adjusts zoom min/max and pitch/yaw limits.
 * Rendered inside RightPanelStack with controlled collapse.
 */
export default function OrbitPanel({ scene, onOrbitChange, onApplyOrbit, collapsed, onToggle }) {
  const orbit = scene?.orbit;

  // Local state for responsive UI
  const [local, setLocal] = useState(null);

  // Sync from Firebase when scene data arrives/changes
  useEffect(() => {
    if (orbit) {
      setLocal({ ...DEFAULT_ORBIT, ...orbit });
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
        onApplyOrbit?.(next);

        return next;
      });
    },
    [onOrbitChange, onApplyOrbit]
  );

  if (!local) return null;

  return (
    <FloatingPanel
      title="Camera"
      icon="📷"
      position=""
      collapsed={collapsed}
      onToggle={onToggle}
    >
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
        />
        <ControlRow
          label="Max"
          labelClass="label-zoom"
          value={local.zoomMax}
          min={1}
          max={5000}
          step={10}
          onChange={(v) => updateField('zoomMax', v)}
        />
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
        />
        <ControlRow
          label="Max"
          labelClass="label-pitch"
          value={local.pitchMax}
          min={0}
          max={90}
          step={1}
          onChange={(v) => updateField('pitchMax', v)}
        />
      </div>

      <div className="section-divider" />

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
        />
        <ControlRow
          label="Max"
          labelClass="label-yaw"
          value={local.yawMax}
          min={0}
          max={180}
          step={1}
          onChange={(v) => updateField('yawMax', v)}
        />
      </div>
    </FloatingPanel>
  );
}
