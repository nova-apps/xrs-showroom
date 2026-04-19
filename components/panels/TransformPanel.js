'use client';

import HelpTooltip from '@/components/ui/HelpTooltip';
import { useCallback } from 'react';

/**
 * Single transform row: label + range slider + number input + optional help tooltip.
 */
function TransformRow({ label, labelClass, value, min, max, step, onChange, help }) {
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? step : -step;
    const precision = Math.max(0, -Math.floor(Math.log10(step)));
    onChange(parseFloat((value + delta).toFixed(precision)));
  }, [value, step, onChange]);

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
        tabIndex={-1}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <input
        type="number"
        step={step}
        value={Math.round(value * 100) / 100}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        onWheel={handleWheel}
      />
    </div>
  );
}

// Define transform configs per asset type
const ASSET_CONFIGS = {
  glb: {
    title: 'Maqueta 3D',
    icon: '🧊',
    position: { min: -500, max: 500, step: 0.5, defaults: { x: 0, y: 0, z: 0 } },
    scale: { min: 0.1, max: 2, step: 0.001, perAxis: true, defaults: { x: 1, y: 1, z: 1 } },
    rotation: { min: -180, max: 180, step: 1, defaults: { x: 0, y: 0, z: 0 } },
  },
  colliders: {
    title: 'Colliders',
    icon: '🧱',
    position: { min: -500, max: 500, step: 0.5, defaults: { x: 0, y: 0, z: 0 } },
    scale: { min: 0.1, max: 2, step: 0.001, perAxis: true, defaults: { x: 1, y: 1, z: 1 } },
    rotation: { min: -180, max: 180, step: 1, defaults: { x: 0, y: 0, z: 0 } },
  },
  sog: {
    title: 'Splat SOG',
    icon: '✨',
    position: { min: -500, max: 500, step: 0.5, defaults: { x: 0, y: 0, z: 0 } },
    scale: { min: 0.1, max: 2, step: 0.001, perAxis: true, defaults: { x: 1, y: 1, z: 1 } },
    rotation: { min: -180, max: 180, step: 1, defaults: { x: 0, y: 0, z: 0 } },
  },
  skybox: {
    title: 'Skybox',
    icon: '🌐',
    custom: [
      { key: 'radius', label: 'R', labelClass: 'label-r', min: 10, max: 50000, step: 10, default: 400, help: 'Radio de la esfera del skybox' },
      { key: 'blur', label: 'B', labelClass: 'label-b', min: 0, max: 80, step: 1, default: 3, help: 'Desenfoque del skybox' },
    ],
    rotation: { min: -180, max: 180, step: 1, defaults: { x: 0, y: 0, z: 0 } },
  },
  floor: {
    title: 'Floor',
    icon: '🟫',
    position: { min: -500, max: 500, step: 0.5, defaults: { x: 0, y: -0.5, z: 0 } },
    custom: [
      { key: 'scale', label: 'S', labelClass: 'label-s', min: 10, max: 50000, step: 10, default: 1050, help: 'Tamaño del plano' },
      { key: 'blur', label: 'B', labelClass: 'label-b', min: 0, max: 80, step: 1, default: 3, help: 'Desenfoque de la textura' },
    ],
  },
  mask: {
    title: 'Máscara',
    icon: '⭕',
    position: { min: -500, max: 500, step: 0.5, defaults: { x: 0, y: 0, z: 0 } },
    custom: [
      { key: 'radius', label: 'R', labelClass: 'label-r', min: 1, max: 500, step: 1, default: 50, help: 'Radio de la máscara esférica' },
      { key: 'falloff', label: 'F', labelClass: 'label-b', min: 0, max: 100, step: 1, default: 10, help: 'Suavidad del borde (falloff)' },
    ],
  },
};

/**
 * Floating transform panel that shows controls for the currently selected asset.
 * Rendered on the top-right of the viewer, below the gizmo toolbar.
 */
export default function TransformPanel({ activeSection, local, updateField }) {
  const config = ASSET_CONFIGS[activeSection];
  if (!config || !local) return null;

  const data = local[activeSection] || {};

  return (
    <div className="transform-panel">
      <div className="transform-panel-header">
        <span className="transform-panel-icon">{config.icon}</span>
        {config.title}
      </div>
      <div className="transform-panel-body">
        {/* Position */}
        {config.position && (
          <>
            <div className="asset-transform-title">Posición</div>
            <TransformRow label="X" labelClass="label-x" value={data.position?.x ?? config.position.defaults.x} min={config.position.min} max={config.position.max} step={config.position.step} onChange={(v) => updateField(activeSection, 'position.x', v)} />
            <TransformRow label="Y" labelClass="label-y" value={data.position?.y ?? config.position.defaults.y} min={config.position.min} max={config.position.max} step={config.position.step} onChange={(v) => updateField(activeSection, 'position.y', v)} />
            <TransformRow label="Z" labelClass="label-z" value={data.position?.z ?? config.position.defaults.z} min={config.position.min} max={config.position.max} step={config.position.step} onChange={(v) => updateField(activeSection, 'position.z', v)} />
          </>
        )}

        {/* Scale (per-axis) */}
        {config.scale && (
          <>
            <div className="asset-transform-title">Escala</div>
            {config.scale.perAxis ? (
              <>
                <TransformRow label="Sx" labelClass="label-x" value={data.scale?.x ?? data.scale ?? config.scale.defaults.x} min={config.scale.min} max={config.scale.max} step={config.scale.step} onChange={(v) => updateField(activeSection, 'scale.x', v)} />
                <TransformRow label="Sy" labelClass="label-y" value={data.scale?.y ?? data.scale ?? config.scale.defaults.y} min={config.scale.min} max={config.scale.max} step={config.scale.step} onChange={(v) => updateField(activeSection, 'scale.y', v)} />
                <TransformRow label="Sz" labelClass="label-z" value={data.scale?.z ?? data.scale ?? config.scale.defaults.z} min={config.scale.min} max={config.scale.max} step={config.scale.step} onChange={(v) => updateField(activeSection, 'scale.z', v)} />
              </>
            ) : (
              <TransformRow label="S" labelClass="label-s" value={data.scale ?? config.scale.default} min={config.scale.min} max={config.scale.max} step={config.scale.step} onChange={(v) => updateField(activeSection, 'scale', v)} />
            )}
          </>
        )}

        {/* Rotation */}
        {config.rotation && (
          <>
            <div className="asset-transform-title">Rotación</div>
            <TransformRow label="Rx" labelClass="label-x" value={data.rotation?.x ?? config.rotation.defaults.x} min={config.rotation.min} max={config.rotation.max} step={config.rotation.step} onChange={(v) => updateField(activeSection, 'rotation.x', v)} />
            <TransformRow label="Ry" labelClass="label-y" value={data.rotation?.y ?? config.rotation.defaults.y} min={config.rotation.min} max={config.rotation.max} step={config.rotation.step} onChange={(v) => updateField(activeSection, 'rotation.y', v)} />
            <TransformRow label="Rz" labelClass="label-z" value={data.rotation?.z ?? config.rotation.defaults.z} min={config.rotation.min} max={config.rotation.max} step={config.rotation.step} onChange={(v) => updateField(activeSection, 'rotation.z', v)} />
          </>
        )}

        {/* Custom fields */}
        {config.custom && (
          <>
            <div className="asset-transform-title">Ajustes</div>
            {config.custom.map((c) => (
              <TransformRow key={c.key} label={c.label} labelClass={c.labelClass} value={data[c.key] ?? c.default} min={c.min} max={c.max} step={c.step} onChange={(v) => updateField(activeSection, c.key, v)} help={c.help} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
