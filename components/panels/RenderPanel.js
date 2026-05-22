'use client';

import { useState, useCallback, useEffect } from 'react';
import FloatingPanel from './FloatingPanel';
import { SubAccordion } from '@/components/ui/AssetAccordion';
import HelpTooltip from '@/components/ui/HelpTooltip';
import TransformRow from '@/components/ui/TransformRow';

/**
 * RenderPanel — visual / look-and-feel settings that don't touch asset
 * files: ambient lighting, environment tint, saturation, and background
 * blur. Split out from SceneEditorPanel so the "Assets" section can stay
 * focused on file management.
 */
const DEFAULT_GLB = {
  revealType: 'none',
  revealDuration: 2,
  revealEasing: 'easeOut',
};

const DEFAULT_SPLAT_ANIM = {
  animationType: 'radialReveal',
  animationDuration: 2.5,
  animationEasing: 'easeOut',
  radialClip: true,
  radialClipDuration: 2.5,
  radialClipEasing: 'easeOut',
};

const EASING_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease In' },
  { value: 'easeOut', label: 'Ease Out' },
  { value: 'easeInOut', label: 'Ease In-Out' },
  { value: 'easeOutCubic', label: 'Ease Out Cubic' },
  { value: 'easeOutBack', label: 'Ease Out Back' },
];

export default function RenderPanel({
  scene,
  onLightingChange,
  onApplyLighting,
  onTintChange,
  onApplyTint,
  onSaturationChange,
  onApplySaturation,
  bgBlur,
  onBgBlurChange,
  glbSettings,
  onGlbSettingsChange,
  splatSettings,
  onSplatSettingsChange,
  collapsed,
  onToggle,
}) {
  const [openSection, setOpenSection] = useState('lighting');
  const toggleSection = useCallback(
    (id) => setOpenSection((prev) => (prev === id ? null : id)),
    []
  );

  // ─── GLB reveal animation ───
  const [localGlb, setLocalGlb] = useState(() => ({ ...DEFAULT_GLB, ...glbSettings }));
  useEffect(() => {
    if (glbSettings) setLocalGlb((prev) => ({ ...prev, ...glbSettings }));
  }, [glbSettings]);
  const updateGlbField = useCallback(
    (field, value) => {
      setLocalGlb((prev) => {
        const next = { ...prev, [field]: value };
        onGlbSettingsChange?.(next);
        return next;
      });
    },
    [onGlbSettingsChange]
  );

  // ─── Splat animation + radial mask ───
  const [localSplat, setLocalSplat] = useState(() => ({ ...DEFAULT_SPLAT_ANIM, ...splatSettings }));
  useEffect(() => {
    if (splatSettings) setLocalSplat((prev) => ({ ...prev, ...splatSettings }));
  }, [splatSettings]);
  const updateSplatField = useCallback(
    (field, value) => {
      setLocalSplat((prev) => {
        const next = { ...prev, [field]: value };
        onSplatSettingsChange?.(next);
        return next;
      });
    },
    [onSplatSettingsChange]
  );

  // ─── Lighting ───
  const lighting = scene?.lighting;
  const [localLighting, setLocalLighting] = useState({
    ambientIntensity: 0.6,
    ambientColor: '#ffffff',
    envMapIntensity: 1.0,
  });

  useEffect(() => {
    if (lighting) {
      setLocalLighting({
        ambientIntensity: lighting.ambientIntensity ?? 0.6,
        ambientColor: lighting.ambientColor ?? '#ffffff',
        envMapIntensity: lighting.envMapIntensity ?? 1.0,
      });
    }
  }, [lighting]);

  const updateLightingField = useCallback(
    (field, value) => {
      setLocalLighting((prev) => {
        const next = { ...prev, [field]: value };
        onLightingChange?.(next);
        onApplyLighting?.(next);
        return next;
      });
    },
    [onLightingChange, onApplyLighting]
  );

  // ─── Tint ───
  const tint = scene?.tint;
  const [localTint, setLocalTint] = useState({
    enabled: false,
    color: '#000000',
    opacity: 0.3,
    targetOpacity: 0,
  });

  useEffect(() => {
    if (tint) {
      setLocalTint({
        enabled: tint.enabled !== false,
        color: tint.color || '#000000',
        opacity: tint.opacity ?? 0.3,
        targetOpacity: tint.targetOpacity ?? 0,
      });
    }
  }, [tint]);

  const updateTintField = useCallback(
    (field, value) => {
      setLocalTint((prev) => {
        const next = { ...prev, [field]: value };
        onTintChange?.(next);
        onApplyTint?.(next);
        return next;
      });
    },
    [onTintChange, onApplyTint]
  );

  // ─── Saturation ───
  const saturation = scene?.saturation;
  const [localSaturation, setLocalSaturation] = useState({ enabled: false, value: 0.3 });

  useEffect(() => {
    if (saturation) {
      setLocalSaturation({
        enabled: saturation.enabled === true,
        value: saturation.value ?? 0.3,
      });
    }
  }, [saturation]);

  const updateSaturationField = useCallback(
    (field, value) => {
      setLocalSaturation((prev) => {
        const next = { ...prev, [field]: value };
        onSaturationChange?.(next);
        onApplySaturation?.(next);
        return next;
      });
    },
    [onSaturationChange, onApplySaturation]
  );

  return (
    <FloatingPanel
      title="Render y visuales"
      icon="🎨"
      position=""
      collapsed={collapsed}
      onToggle={onToggle}
    >
      <SubAccordion
        title="Iluminación"
        icon="💡"
        open={openSection === 'lighting'}
        onToggle={() => toggleSection('lighting')}
      >
        <div className="asset-transform-section">
          <TransformRow
            label="Int"
            labelClass="label-s"
            value={localLighting.ambientIntensity}
            min={0}
            max={5}
            step={0.05}
            onChange={(v) => updateLightingField('ambientIntensity', v)}
            help="Intensidad de la luz ambiental"
          />
          <TransformRow
            label="Env"
            labelClass="label-s"
            value={localLighting.envMapIntensity}
            min={0}
            max={10}
            step={0.1}
            onChange={(v) => updateLightingField('envMapIntensity', v)}
            help="Intensidad del mapa de entorno (reflejos HDRI)"
          />
          <div className="transform-row">
            <span className="transform-label label-s">Color</span>
            <HelpTooltip text="Color de la luz ambiental" />
            <input
              type="color"
              value={localLighting.ambientColor}
              onChange={(e) => updateLightingField('ambientColor', e.target.value)}
              style={{ flex: 1, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }}
            />
          </div>
        </div>
      </SubAccordion>

      <SubAccordion
        title="Tint del entorno"
        icon="🌗"
        open={openSection === 'tint'}
        onToggle={() => toggleSection('tint')}
      >
        <div className="asset-transform-section">
          <label className="hdri-checkbox-row">
            <input
              type="checkbox"
              checked={localTint.enabled}
              onChange={(e) => updateTintField('enabled', e.target.checked)}
            />
            <span>Activar tint</span>
            <HelpTooltip text="Capa de color semitransparente sobre el entorno (skybox, floor, splat). No afecta la maqueta 3D." />
          </label>
          {localTint.enabled && (
            <>
              <div className="transform-row">
                <span className="transform-label label-s">Color</span>
                <HelpTooltip text="Color del tint del entorno" />
                <input
                  type="color"
                  value={localTint.color}
                  onChange={(e) => updateTintField('color', e.target.value)}
                  style={{ flex: 1, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }}
                />
              </div>
              <TransformRow
                label="Op"
                labelClass="label-s"
                value={localTint.opacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => updateTintField('opacity', v)}
                help="Opacidad del tint (0 = transparente, 1 = sólido)"
              />
              <TransformRow
                label="Post"
                labelClass="label-s"
                value={localTint.targetOpacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => updateTintField('targetOpacity', v)}
                help="Opacidad objetivo del tint después de la animación de entrada del SOG"
              />
            </>
          )}
        </div>
      </SubAccordion>

      <SubAccordion
        title="Saturación del entorno"
        icon="🌫️"
        open={openSection === 'saturation'}
        onToggle={() => toggleSection('saturation')}
      >
        <div className="asset-transform-section">
          <label className="hdri-checkbox-row">
            <input
              type="checkbox"
              checked={localSaturation.enabled}
              onChange={(e) => updateSaturationField('enabled', e.target.checked)}
            />
            <span>Desaturar entorno</span>
            <HelpTooltip text="Baja la saturación del skybox, floor y splat. La maqueta 3D queda con su color original." />
          </label>
          {localSaturation.enabled && (
            <TransformRow
              label="Sat"
              labelClass="label-s"
              value={localSaturation.value}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateSaturationField('value', v)}
              help="0 = blanco y negro, 1 = color original"
            />
          )}
        </div>
      </SubAccordion>

      <SubAccordion
        title="Blur del fondo"
        icon="〰️"
        open={openSection === 'blur'}
        onToggle={() => toggleSection('blur')}
      >
        <div className="asset-transform-section">
          <TransformRow
            label="Blur"
            labelClass=""
            value={bgBlur ?? 0}
            min={0}
            max={15}
            step={0.1}
            onChange={(v) => onBgBlurChange?.(v)}
            help="Desenfoca skybox, floor y splat con un blur post-proceso. La maqueta 3D queda nítida. 0 desactiva todo el post-proceso (sin costo extra)."
          />
        </div>
      </SubAccordion>

      <SubAccordion
        title="Animaciones de entrada"
        icon="🎬"
        open={openSection === 'animations'}
        onToggle={() => toggleSection('animations')}
      >
        {/* ─── GLB reveal ─── */}
        <div className="asset-transform-section">
          <div className="asset-transform-title">Maqueta 3D (GLB)</div>
          <div className="splat-setting-row">
            <span className="splat-setting-label">Tipo</span>
            <select
              className="splat-select"
              value={localGlb.revealType}
              onChange={(e) => updateGlbField('revealType', e.target.value)}
            >
              <option value="none">Sin animación</option>
              <option value="clip">Clipping Plane</option>
              <option value="dissolve">Dissolve (ruido)</option>
            </select>
          </div>
          {localGlb.revealType !== 'none' && (
            <>
              <TransformRow
                label="Dur"
                labelClass=""
                value={localGlb.revealDuration}
                min={0.5}
                max={8}
                step={0.1}
                onChange={(v) => updateGlbField('revealDuration', v)}
                help="Duración de la animación en segundos"
              />
              <div className="splat-setting-row">
                <span className="splat-setting-label">Easing</span>
                <select
                  className="splat-select"
                  value={localGlb.revealEasing}
                  onChange={(e) => updateGlbField('revealEasing', e.target.value)}
                >
                  {EASING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {/* ─── Splat reveal ─── */}
        <div className="asset-transform-section">
          <div className="asset-transform-title">Splat SOG</div>
          <div className="splat-setting-row">
            <span className="splat-setting-label">Tipo</span>
            <select
              className="splat-select"
              value={localSplat.animationType}
              onChange={(e) => updateSplatField('animationType', e.target.value)}
            >
              <option value="none">Sin animación</option>
              <option value="radialReveal">Radial progresivo</option>
            </select>
          </div>
          {localSplat.animationType !== 'none' && (
            <>
              <TransformRow
                label="Dur"
                labelClass=""
                value={localSplat.animationDuration}
                min={0.5}
                max={8}
                step={0.1}
                onChange={(v) => updateSplatField('animationDuration', v)}
                help="Duración de la animación punto → splat en segundos"
              />
              <div className="splat-setting-row">
                <span className="splat-setting-label">Easing</span>
                <select
                  className="splat-select"
                  value={localSplat.animationEasing}
                  onChange={(e) => updateSplatField('animationEasing', e.target.value)}
                >
                  {EASING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </SubAccordion>

      <SubAccordion
        title="Máscara radial del splat"
        icon="🔍"
        open={openSection === 'radialMask'}
        onToggle={() => toggleSection('radialMask')}
      >
        <div className="asset-transform-section">
          <div className="splat-setting-row">
            <label className="splat-checkbox-label">
              <input
                type="checkbox"
                checked={localSplat.radialClip === true}
                onChange={(e) => updateSplatField('radialClip', e.target.checked)}
              />
              Activar recorte radial
            </label>
            <HelpTooltip text="Revela los splats desde el centro hacia afuera con una esfera de recorte animada." />
          </div>
          {localSplat.radialClip === true && (
            <>
              <TransformRow
                label="Dur"
                labelClass=""
                value={localSplat.radialClipDuration}
                min={0.5}
                max={8}
                step={0.1}
                onChange={(v) => updateSplatField('radialClipDuration', v)}
                help="Duración de la expansión radial en segundos"
              />
              <div className="splat-setting-row">
                <span className="splat-setting-label">Easing</span>
                <select
                  className="splat-select"
                  value={localSplat.radialClipEasing}
                  onChange={(e) => updateSplatField('radialClipEasing', e.target.value)}
                >
                  {EASING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </SubAccordion>
    </FloatingPanel>
  );
}
