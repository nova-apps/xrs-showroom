'use client';

/**
 * MaterialPanel — Floating panel that lists all materials from the loaded GLB model.
 * Each material is an accordion item showing its adjustable parameters.
 * Changes are applied in real-time to the Three.js material objects.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import FloatingPanel from './FloatingPanel';
import { usePresets } from '@/hooks/usePresets';

/**
 * Color picker + hex input row.
 */
function ColorRow({ label, hexValue, onChange }) {
  return (
    <div className="mat-param-row">
      <span className="mat-param-label">{label}</span>
      <input
        type="color"
        value={`#${hexValue}`}
        onChange={(e) => onChange(e.target.value.replace('#', ''))}
        className="mat-color-input"
      />
      <span className="mat-param-hex">#{hexValue}</span>
    </div>
  );
}

/**
 * Slider + number input row for numeric parameters.
 */
function ParamRow({ label, value, min, max, step, onChange }) {
  return (
    <div className="mat-param-row">
      <span className="mat-param-label">{label}</span>
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
        min={min}
        max={max}
        value={Math.round(value * 1000) / 1000}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}

/**
 * Toggle row for boolean parameters.
 */
function ToggleRow({ label, value, onChange }) {
  return (
    <div className="mat-param-row">
      <span className="mat-param-label">{label}</span>
      <label className="mat-toggle">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="mat-toggle-slider" />
      </label>
      <span className="mat-param-value-label">{value ? 'Sí' : 'No'}</span>
    </div>
  );
}

/**
 * Select row for enum-like parameters (e.g., side).
 */
function SelectRow({ label, value, options, onChange }) {
  return (
    <div className="mat-param-row">
      <span className="mat-param-label">{label}</span>
      <select
        className="mat-select"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * Properties that are serializable and should be saved to Firebase.
 * Excludes non-serializable values like texture maps, uuid, type, maps array.
 */
const SAVEABLE_KEYS = [
  'color', 'opacity', 'transparent', 'depthWrite', 'side', 'visible',
  'alphaTest', 'flatShading', 'metalness', 'roughness', 'transmission',
  'thickness', 'ior', 'clearcoat', 'clearcoatRoughness', 'sheen',
  'sheenRoughness', 'sheenColor', 'reflectivity', 'emissive', 'emissiveIntensity',
];

/**
 * Sanitize a material name for use as a Firebase RTDB key.
 * Firebase keys cannot contain: . # $ / [ ]
 */
function sanitizeKey(name) {
  return name.replace(/[.#$/\[\]]/g, '_');
}

/**
 * Extract a snapshot of editable properties from a Three.js material.
 */
function extractMaterialProps(mat) {
  const props = {
    name: mat.name || '(sin nombre)',
    type: mat.type,
    uuid: mat.uuid,
    // Common
    color: mat.color?.getHexString?.() || 'ffffff',
    opacity: mat.opacity ?? 1,
    transparent: !!mat.transparent,
    depthWrite: mat.depthWrite ?? true,
    side: mat.side ?? 0,
    visible: mat.visible ?? true,
    alphaTest: mat.alphaTest ?? 0,
    flatShading: !!mat.flatShading,
  };

  // Standard / Physical
  if (mat.metalness !== undefined) props.metalness = mat.metalness;
  if (mat.roughness !== undefined) props.roughness = mat.roughness;

  // Physical extras
  if (mat.type === 'MeshPhysicalMaterial') {
    props.transmission = mat.transmission ?? 0;
    props.thickness = mat.thickness ?? 0;
    props.ior = mat.ior ?? 1.5;
    props.clearcoat = mat.clearcoat ?? 0;
    props.clearcoatRoughness = mat.clearcoatRoughness ?? 0;
    props.sheen = mat.sheen ?? 0;
    props.sheenRoughness = mat.sheenRoughness ?? 0;
    props.sheenColor = mat.sheenColor?.getHexString?.() || '000000';
    props.attenuationDistance = mat.attenuationDistance ?? Infinity;
    props.reflectivity = mat.reflectivity ?? 0.5;
  }

  // Emissive
  if (mat.emissive) {
    props.emissive = mat.emissive.getHexString?.() || '000000';
    props.emissiveIntensity = mat.emissiveIntensity ?? 1;
  }

  // Maps (read-only indicators)
  props.maps = [];
  const mapNames = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
    'emissiveMap', 'alphaMap', 'displacementMap', 'bumpMap',
    'transmissionMap', 'thicknessMap', 'clearcoatMap'];
  for (const mn of mapNames) {
    if (mat[mn]) props.maps.push(mn);
  }

  return props;
}

/**
 * Apply saved overrides from Firebase to a Three.js material.
 */
function applySavedOverrides(mat, overrides) {
  if (!overrides || !mat) return;

  for (const [key, value] of Object.entries(overrides)) {
    switch (key) {
      case 'color':
        mat.color?.set?.(`#${value}`);
        break;
      case 'emissive':
        mat.emissive?.set?.(`#${value}`);
        break;
      case 'sheenColor':
        mat.sheenColor?.set?.(`#${value}`);
        break;
      case 'transparent':
        mat.transparent = value;
        break;
      case 'depthWrite':
        mat.depthWrite = value;
        break;
      case 'visible':
        mat.visible = value;
        break;
      case 'flatShading':
        mat.flatShading = value;
        break;
      case 'side':
        mat.side = value;
        break;
      default:
        if (mat[key] !== undefined) {
          mat[key] = value;
        }
        break;
    }
  }
  mat.needsUpdate = true;
}

/**
 * Extract only the saveable properties from material props snapshot.
 */
function extractSaveableProps(props) {
  const out = {};
  for (const key of SAVEABLE_KEYS) {
    if (props[key] !== undefined) {
      out[key] = props[key];
    }
  }
  return out;
}

/**
 * Single material accordion with all editable parameters.
 */
function MaterialAccordion({ matRef, initialProps, open, onToggle, onPropertyChange, presets }) {
  const [props, setProps] = useState(initialProps);

  const applyPreset = useCallback((preset) => {
    if (!preset?.properties || !matRef) return;
    const updates = preset.properties;
    const newProps = { ...props };

    for (const [key, value] of Object.entries(updates)) {
      // Apply to Three.js material
      switch (key) {
        case 'color': matRef.color?.set?.(`#${value}`); break;
        case 'emissive': matRef.emissive?.set?.(`#${value}`); break;
        case 'sheenColor': matRef.sheenColor?.set?.(`#${value}`); break;
        case 'transparent': matRef.transparent = value; break;
        case 'depthWrite': matRef.depthWrite = value; break;
        case 'visible': matRef.visible = value; break;
        case 'flatShading': matRef.flatShading = value; break;
        case 'side': matRef.side = value; break;
        default:
          if (matRef[key] !== undefined) matRef[key] = value;
          break;
      }
      newProps[key] = value;
    }
    matRef.needsUpdate = true;
    setProps(newProps);
    onPropertyChange?.(newProps);
  }, [matRef, props, onPropertyChange]);

  const update = useCallback((key, value) => {
    const mat = matRef;
    if (!mat) return;

    // Apply to the Three.js material
    switch (key) {
      case 'color':
        mat.color?.set?.(`#${value}`);
        break;
      case 'emissive':
        mat.emissive?.set?.(`#${value}`);
        break;
      case 'sheenColor':
        mat.sheenColor?.set?.(`#${value}`);
        break;
      case 'transparent':
        mat.transparent = value;
        break;
      case 'depthWrite':
        mat.depthWrite = value;
        break;
      case 'visible':
        mat.visible = value;
        break;
      case 'flatShading':
        mat.flatShading = value;
        break;
      case 'side':
        mat.side = value;
        break;
      default:
        if (mat[key] !== undefined) {
          mat[key] = value;
        }
        break;
    }
    mat.needsUpdate = true;

    setProps((prev) => {
      const next = { ...prev, [key]: value };
      // Notify parent to persist
      onPropertyChange?.(next);
      return next;
    });
  }, [matRef, onPropertyChange]);

  // Material type badge color
  const typeColors = {
    MeshStandardMaterial: '#51cf66',
    MeshPhysicalMaterial: '#339af0',
    MeshBasicMaterial: '#fcc419',
    MeshLambertMaterial: '#ff8844',
    MeshPhongMaterial: '#e0a040',
  };
  const badgeColor = typeColors[props.type] || '#8990a5';

  const SIDE_OPTIONS = [
    { value: 0, label: 'Front' },
    { value: 1, label: 'Back' },
    { value: 2, label: 'Double' },
  ];

  return (
    <div className={`mat-accordion ${open ? 'open' : ''}`}>
      <div className="mat-accordion-header" onClick={onToggle}>
        <span className="mat-accordion-title">
          <span
            className="mat-type-dot"
            style={{ background: badgeColor }}
          />
          {props.name}
        </span>
        <span className="mat-accordion-badge" style={{ color: badgeColor }}>
          {props.type.replace('Mesh', '').replace('Material', '')}
        </span>
        <span className="mat-accordion-chevron">▼</span>
      </div>

      {open && (
        <div className="mat-accordion-body">
          {/* ─── Preset Selector ─── */}
          {presets && presets.length > 0 && (
            <div className="mat-preset-row">
              <span className="mat-param-label">Preset</span>
              <select
                className="mat-select mat-preset-select"
                defaultValue=""
                onChange={(e) => {
                  const p = presets.find((pr) => pr.id === e.target.value);
                  if (p) applyPreset(p);
                  e.target.value = '';
                }}
              >
                <option value="" disabled>Aplicar preset…</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* ─── Appearance ─── */}
          <div className="mat-section-title">Apariencia</div>
          <ColorRow label="Color" hexValue={props.color} onChange={(v) => update('color', v)} />
          <ParamRow label="Opacidad" value={props.opacity} min={0} max={1} step={0.01} onChange={(v) => update('opacity', v)} />
          <ParamRow label="Alpha Test" value={props.alphaTest} min={0} max={1} step={0.01} onChange={(v) => update('alphaTest', v)} />
          <ToggleRow label="Transparente" value={props.transparent} onChange={(v) => update('transparent', v)} />
          <ToggleRow label="Depth Write" value={props.depthWrite} onChange={(v) => update('depthWrite', v)} />
          <ToggleRow label="Visible" value={props.visible} onChange={(v) => update('visible', v)} />
          <SelectRow label="Side" value={props.side} options={SIDE_OPTIONS} onChange={(v) => update('side', v)} />

          {/* ─── PBR ─── */}
          {props.metalness !== undefined && (
            <>
              <div className="mat-section-title">PBR</div>
              <ParamRow label="Metalness" value={props.metalness} min={0} max={1} step={0.01} onChange={(v) => update('metalness', v)} />
              <ParamRow label="Roughness" value={props.roughness} min={0} max={1} step={0.01} onChange={(v) => update('roughness', v)} />
              <ToggleRow label="Flat Shading" value={props.flatShading} onChange={(v) => update('flatShading', v)} />
            </>
          )}

          {/* ─── Physical ─── */}
          {props.transmission !== undefined && (
            <>
              <div className="mat-section-title">Physical</div>
              <ParamRow label="Transmission" value={props.transmission} min={0} max={1} step={0.01} onChange={(v) => update('transmission', v)} />
              <ParamRow label="Thickness" value={props.thickness} min={0} max={20} step={0.1} onChange={(v) => update('thickness', v)} />
              <ParamRow label="IOR" value={props.ior} min={1} max={2.5} step={0.01} onChange={(v) => update('ior', v)} />
              <ParamRow label="Clearcoat" value={props.clearcoat} min={0} max={1} step={0.01} onChange={(v) => update('clearcoat', v)} />
              <ParamRow label="CC Roughness" value={props.clearcoatRoughness} min={0} max={1} step={0.01} onChange={(v) => update('clearcoatRoughness', v)} />
              <ParamRow label="Sheen" value={props.sheen} min={0} max={1} step={0.01} onChange={(v) => update('sheen', v)} />
              <ParamRow label="Sheen Rough" value={props.sheenRoughness} min={0} max={1} step={0.01} onChange={(v) => update('sheenRoughness', v)} />
              <ColorRow label="Sheen Color" hexValue={props.sheenColor} onChange={(v) => update('sheenColor', v)} />
              <ParamRow label="Reflectivity" value={props.reflectivity} min={0} max={1} step={0.01} onChange={(v) => update('reflectivity', v)} />
            </>
          )}

          {/* ─── Emissive ─── */}
          {props.emissive !== undefined && (
            <>
              <div className="mat-section-title">Emisión</div>
              <ColorRow label="Emissive" hexValue={props.emissive} onChange={(v) => update('emissive', v)} />
              <ParamRow label="Intensidad" value={props.emissiveIntensity} min={0} max={10} step={0.1} onChange={(v) => update('emissiveIntensity', v)} />
            </>
          )}

          {/* ─── Texture Maps (read-only info) ─── */}
          {props.maps.length > 0 && (
            <>
              <div className="mat-section-title">Texturas</div>
              <div className="mat-maps-list">
                {props.maps.map((m) => (
                  <span key={m} className="mat-map-badge">{m}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Main MaterialPanel component.
 * Supports controlled collapse via collapsed/onToggle props (for RightPanelStack).
 */
export default function MaterialPanel({ viewerRef, viewerReady, savedMaterials, onMaterialsChange, collapsed, onToggle, inline }) {
  const [materials, setMaterials] = useState([]);
  const [openMat, setOpenMat] = useState(null);
  const matRefsMap = useRef(new Map());
  const { presets } = usePresets();
  // Track current props for all materials (for saving)
  const currentPropsRef = useRef(new Map());
  // Track whether saved overrides have been applied already
  const appliedOverridesRef = useRef(false);

  // Collect all current material properties and save to Firebase
  const collectAndSave = useCallback(() => {
    if (!onMaterialsChange) return;

    const allOverrides = {};
    for (const [uuid, props] of currentPropsRef.current) {
      const name = props.name;
      if (name && name !== '(sin nombre)') {
        allOverrides[sanitizeKey(name)] = extractSaveableProps(props);
      }
    }
    onMaterialsChange(allOverrides);
  }, [onMaterialsChange]);

  // Handle property change from a MaterialAccordion
  const handlePropertyChange = useCallback((uuid, updatedProps) => {
    currentPropsRef.current.set(uuid, updatedProps);
    collectAndSave();
  }, [collectAndSave]);

  // Extract materials from the GLB model
  const refreshMaterials = useCallback(() => {
    if (!viewerRef?.current) return;
    const model = viewerRef.current.getGlbModel?.();
    if (!model) {
      setMaterials([]);
      return;
    }

    const seen = new Map();
    model.traverse((child) => {
      if (child.isMesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (!seen.has(m.uuid)) {
            seen.set(m.uuid, m);
            matRefsMap.current.set(m.uuid, m);
          }
        }
      }
    });

    // Apply saved overrides from Firebase (only once per model load)
    if (savedMaterials && !appliedOverridesRef.current) {
      for (const [uuid, mat] of seen) {
        const matName = mat.name || '(sin nombre)';
        const key = sanitizeKey(matName);
        if (savedMaterials[key]) {
          applySavedOverrides(mat, savedMaterials[key]);
          console.log(`[Materials] Applied saved overrides for "${matName}"`);
        }
      }
      appliedOverridesRef.current = true;
    }

    const matList = [];
    for (const [uuid, mat] of seen) {
      const props = extractMaterialProps(mat);
      matList.push(props);
      currentPropsRef.current.set(uuid, props);
    }
    // Sort alphabetically by name
    matList.sort((a, b) => a.name.localeCompare(b.name));
    setMaterials(matList);
  }, [viewerRef, savedMaterials]);

  // Listen for GLB load events
  useEffect(() => {
    if (!viewerReady) return;

    // Delay to give GLB time to load
    const timer = setTimeout(refreshMaterials, 1500);

    // Also poll every 3s in case the model is loaded later
    const interval = setInterval(() => {
      const model = viewerRef?.current?.getGlbModel?.();
      if (model && materials.length === 0) {
        refreshMaterials();
      }
    }, 3000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [viewerReady, refreshMaterials, materials.length]);

  const toggleMat = useCallback((uuid) => {
    setOpenMat((prev) => (prev === uuid ? null : uuid));
  }, []);

  // Use controlled collapse if props provided (RightPanelStack), otherwise internal
  const isControlled = collapsed !== undefined;
  const isCollapsed = isControlled ? collapsed : false;
  const handleToggle = isControlled ? onToggle : undefined;

  const title = `Materiales${materials.length > 0 ? ` (${materials.length})` : ''}`;

  const content = materials.length === 0 ? (
    <div className="empty-state">
      <p>Cargando materiales…</p>
    </div>
  ) : (
    <div className="mat-panel-body">
      <button
        className="mat-refresh-btn-inline"
        onClick={refreshMaterials}
        title="Actualizar lista"
      >
        ↻ Actualizar
      </button>
      {materials.map((mat) => (
        <MaterialAccordion
          key={mat.uuid}
          matRef={matRefsMap.current.get(mat.uuid)}
          initialProps={mat}
          open={openMat === mat.uuid}
          onToggle={() => toggleMat(mat.uuid)}
          onPropertyChange={(updatedProps) => handlePropertyChange(mat.uuid, updatedProps)}
          presets={presets}
        />
      ))}
    </div>
  );

  if (inline) {
    return (
      <div className="asset-transform-section">
        <div className="asset-transform-title">{title}</div>
        {content}
      </div>
    );
  }

  return (
    <FloatingPanel
      title={title}
      icon="🎨"
      position=""
      collapsed={isCollapsed}
      onToggle={handleToggle}
    >
      {content}
    </FloatingPanel>
  );
}

