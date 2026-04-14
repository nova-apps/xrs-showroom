'use client';

import { useState, useCallback, useEffect } from 'react';
import FloatingPanel from './FloatingPanel';
import FileUploader from '@/components/ui/FileUploader';

/**
 * Single transform row: label + range slider + number input.
 */
function TransformRow({ label, labelClass, value, min, max, step, onChange }) {
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
 * A single collapsible asset section (inner accordion).
 */
function AssetAccordion({ title, icon, open, onToggle, children }) {
  return (
    <div className={`asset-accordion ${open ? 'open' : ''}`}>
      <div className="asset-accordion-header" onClick={onToggle}>
        <span className="asset-accordion-title">
          <span className="asset-accordion-icon">{icon}</span>
          {title}
        </span>
        <span className="asset-accordion-chevron">▼</span>
      </div>
      {open && <div className="asset-accordion-body">{children}</div>}
    </div>
  );
}

/**
 * Scene editor panel — upload/manage assets + transform controls for each asset.
 * Each asset type (GLB, SOG, Skybox, Floor) is a collapsible inner accordion.
 */
export default function SceneEditorPanel({
  scene,
  uploadProgress,
  onUpload,
  onRemove,
  onTransformChange,
  onApplyTransform,
  collapsed,
  onToggle,
}) {
  // Track which inner accordion section is open (null = all closed)
  const [openSection, setOpenSection] = useState(null);

  const toggleSection = useCallback((sectionId) => {
    setOpenSection((prev) => (prev === sectionId ? null : sectionId));
  }, []);

  // Local transform state for responsive UI
  const transforms = scene?.transforms;
  const [local, setLocal] = useState(null);

  useEffect(() => {
    if (transforms) {
      setLocal(JSON.parse(JSON.stringify(transforms)));
    }
  }, [transforms]);

  const updateField = useCallback(
    (type, path, value) => {
      setLocal((prev) => {
        if (!prev) return prev;
        const next = JSON.parse(JSON.stringify(prev));
        if (!next[type]) next[type] = {};
        const parts = path.split('.');
        let obj = next[type];
        for (let i = 0; i < parts.length - 1; i++) {
          if (!obj[parts[i]]) obj[parts[i]] = {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;

        onTransformChange?.(type, next[type]);
        onApplyTransform?.(type, next[type]);

        return next;
      });
    },
    [onTransformChange, onApplyTransform]
  );

  if (!scene) return null;

  return (
    <FloatingPanel
      title="Assets"
      icon="🎨"
      position=""
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {/* ─── GLB Model ─── */}
      <AssetAccordion
        title="Modelo GLB"
        icon="🧊"
        open={openSection === 'glb'}
        onToggle={() => toggleSection('glb')}
      >
        <FileUploader
          label="Archivo"
          icon=""
          accept=".glb,.gltf"
          currentFile={scene.assets?.glb}
          uploadProgress={uploadProgress?.glb}
          onUpload={(file) => onUpload('glb', file)}
          onRemove={() => onRemove('glb')}
        />
        {local && (
          <div className="asset-transform-section">
            <div className="asset-transform-title">Transform</div>
            <TransformRow label="X" labelClass="label-x" value={local.glb?.position?.x ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('glb', 'position.x', v)} />
            <TransformRow label="Y" labelClass="label-y" value={local.glb?.position?.y ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('glb', 'position.y', v)} />
            <TransformRow label="Z" labelClass="label-z" value={local.glb?.position?.z ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('glb', 'position.z', v)} />
            <TransformRow label="S" labelClass="label-s" value={local.glb?.scale ?? 1} min={-500} max={500} step={1} onChange={(v) => updateField('glb', 'scale', v)} />
            <TransformRow label="Rx" labelClass="label-x" value={local.glb?.rotation?.x ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('glb', 'rotation.x', v)} />
            <TransformRow label="Ry" labelClass="label-y" value={local.glb?.rotation?.y ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('glb', 'rotation.y', v)} />
            <TransformRow label="Rz" labelClass="label-z" value={local.glb?.rotation?.z ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('glb', 'rotation.z', v)} />
          </div>
        )}
      </AssetAccordion>

      {/* ─── SOG Splat ─── */}
      <AssetAccordion
        title="Splat SOG"
        icon="✨"
        open={openSection === 'sog'}
        onToggle={() => toggleSection('sog')}
      >
        <FileUploader
          label="Archivo"
          icon=""
          accept=".sog,.ply,.splat"
          currentFile={scene.assets?.sog}
          uploadProgress={uploadProgress?.sog}
          onUpload={(file) => onUpload('sog', file)}
          onRemove={() => onRemove('sog')}
        />
        {local && (
          <div className="asset-transform-section">
            <div className="asset-transform-title">Transform</div>
            <TransformRow label="X" labelClass="label-x" value={local.sog?.position?.x ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('sog', 'position.x', v)} />
            <TransformRow label="Y" labelClass="label-y" value={local.sog?.position?.y ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('sog', 'position.y', v)} />
            <TransformRow label="Z" labelClass="label-z" value={local.sog?.position?.z ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('sog', 'position.z', v)} />
            <TransformRow label="S" labelClass="label-s" value={local.sog?.scale ?? 1} min={-500} max={500} step={1} onChange={(v) => updateField('sog', 'scale', v)} />
            <TransformRow label="Rx" labelClass="label-x" value={local.sog?.rotation?.x ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('sog', 'rotation.x', v)} />
            <TransformRow label="Ry" labelClass="label-y" value={local.sog?.rotation?.y ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('sog', 'rotation.y', v)} />
            <TransformRow label="Rz" labelClass="label-z" value={local.sog?.rotation?.z ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('sog', 'rotation.z', v)} />
          </div>
        )}
      </AssetAccordion>

      {/* ─── Skybox ─── */}
      <AssetAccordion
        title="Skybox"
        icon="🌐"
        open={openSection === 'skybox'}
        onToggle={() => toggleSection('skybox')}
      >
        <FileUploader
          label="Archivo"
          icon=""
          accept=".jpg,.jpeg,.png,.webp"
          currentFile={scene.assets?.skybox}
          uploadProgress={uploadProgress?.skybox}
          onUpload={(file) => onUpload('skybox', file)}
          onRemove={() => onRemove('skybox')}
        />
        {local && (
          <div className="asset-transform-section">
            <div className="asset-transform-title">Ajustes</div>
            <TransformRow label="R" labelClass="label-r" value={local.skybox?.radius ?? 400} min={10} max={50000} step={10} onChange={(v) => updateField('skybox', 'radius', v)} />
            <TransformRow label="B" labelClass="label-b" value={local.skybox?.blur ?? 3} min={0} max={80} step={1} onChange={(v) => updateField('skybox', 'blur', v)} />
          </div>
        )}
      </AssetAccordion>

      {/* ─── Floor ─── */}
      <AssetAccordion
        title="Floor"
        icon="🟫"
        open={openSection === 'floor'}
        onToggle={() => toggleSection('floor')}
      >
        <FileUploader
          label="Archivo"
          icon=""
          accept=".jpg,.jpeg,.png,.webp"
          currentFile={scene.assets?.floor}
          uploadProgress={uploadProgress?.floor}
          onUpload={(file) => onUpload('floor', file)}
          onRemove={() => onRemove('floor')}
        />
        {local && (
          <div className="asset-transform-section">
            <div className="asset-transform-title">Transform</div>
            <TransformRow label="X" labelClass="label-x" value={local.floor?.position?.x ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('floor', 'position.x', v)} />
            <TransformRow label="Y" labelClass="label-y" value={local.floor?.position?.y ?? -0.5} min={-500} max={500} step={0.5} onChange={(v) => updateField('floor', 'position.y', v)} />
            <TransformRow label="Z" labelClass="label-z" value={local.floor?.position?.z ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('floor', 'position.z', v)} />
            <TransformRow label="S" labelClass="label-s" value={local.floor?.scale ?? 1050} min={10} max={50000} step={10} onChange={(v) => updateField('floor', 'scale', v)} />
            <TransformRow label="B" labelClass="label-b" value={local.floor?.blur ?? 3} min={0} max={80} step={1} onChange={(v) => updateField('floor', 'blur', v)} />
          </div>
        )}
      </AssetAccordion>
    </FloatingPanel>
  );
}
