'use client';

import { useState, useCallback, useEffect } from 'react';
import FloatingPanel from './FloatingPanel';
import ModelChecker from './ModelChecker';
import FileUploader from '@/components/ui/FileUploader';
import HelpTooltip from '@/components/ui/HelpTooltip';
import SatelliteGenerator from '@/components/ui/SatelliteGenerator';
import GizmoToolbar from '@/components/ui/GizmoToolbar';
import TransformRow from '@/components/ui/TransformRow';
import { AssetAccordion, SubAccordion } from '@/components/ui/AssetAccordion';

export default function SceneEditorPanel({
  scene,
  uploadProgress,
  onUpload,
  onRemove,
  onTransformChange,
  onApplyTransform,
  onVisibilityChange,
  visibility,
  collapsed,
  onToggle,
  materialsContent,
  onLightingChange,
  onApplyLighting,
  onActiveSectionChange,
  viewerRef,
  viewerReady,
  onHdriFromSkybox,
  hdriFromSkybox,
  gizmoMode,
  onGizmoMode,
  onSaveSatelliteUrl,
  glbSettings,
  onGlbSettingsChange,
  splatSettings,
  onSplatSettingsChange,
  onTintChange,
  onApplyTint,
}) {
  // Pre-upload optimization state
  const [preUpload, setPreUpload] = useState(null); // { file, stats }
  const [preOpts, setPreOpts] = useState({ resizeTextures: false, maxTextureSize: 2048, forcePOT: false, stripGeometry: false });
  const [preProgress, setPreProgress] = useState(0);
  const [preWorking, setPreWorking] = useState(false);

  // General asset stats state
  const [assetStats, setAssetStats] = useState({ glb: 0, colliders: 0, sog: 0 });

  // Local GLB settings state
  const DEFAULT_GLB = {
    revealType: 'none',
    revealDuration: 2,
    revealEasing: 'easeOut',
  };
  const [localGlb, setLocalGlb] = useState(() => ({ ...DEFAULT_GLB, ...glbSettings }));

  useEffect(() => {
    if (glbSettings) {
      setLocalGlb((prev) => ({ ...prev, ...glbSettings }));
    }
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

  // Local splat settings state
  const DEFAULT_SPLAT = {
    lod: true,
    extSplats: true,
    animationType: 'radialReveal',
    animationDuration: 2.5,
    animationEasing: 'easeOut',
    radialClip: true,
    radialClipDuration: 2.5,
    radialClipEasing: 'easeOut',
  };
  const [localSplat, setLocalSplat] = useState(() => ({ ...DEFAULT_SPLAT, ...splatSettings }));

  useEffect(() => {
    if (splatSettings) {
      setLocalSplat((prev) => ({ ...prev, ...splatSettings }));
    }
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

  useEffect(() => {
    if (!viewerReady || !viewerRef?.current) return;
    const updateStats = () => {
      if (viewerRef.current.getAllAssetStats) {
        setAssetStats(viewerRef.current.getAllAssetStats());
      }
    };
    updateStats();
    const timer = setInterval(updateStats, 2000);
    return () => clearInterval(timer);
  }, [viewerReady, viewerRef, scene?.assets]);

  const handleGlbFile = useCallback(async (file) => {
    if (!viewerRef?.current) { onUpload('glb', file); return; }
    setPreWorking(true);
    setPreProgress(0);
    try {
      const stats = await viewerRef.current.analyzeGlbFile(file);
      const needsOpt = stats && (stats.maxTexSize > 2048 || stats.nonPOT > 0 || stats.totalTriangles > 500000 || stats.totalVertices > 300000);
      if (needsOpt) {
        setPreUpload({ file, stats });
        // Auto-check relevant options
        setPreOpts({
          resizeTextures: stats.maxTexSize > 2048,
          maxTextureSize: 2048,
          forcePOT: stats.nonPOT > 0,
          stripGeometry: false,
        });
      } else {
        onUpload('glb', file);
      }
    } catch (err) {
      console.error('[PreUpload] Analysis failed, uploading as-is:', err);
      onUpload('glb', file);
    }
    setPreWorking(false);
  }, [viewerRef, onUpload]);

  const preUploadOptimize = useCallback(async () => {
    if (!preUpload || !viewerRef?.current) return;
    setPreWorking(true);
    setPreProgress(0);
    try {
      const optimizedFile = await viewerRef.current.optimizeAndExportGlb(
        preUpload.file, preOpts, (p) => setPreProgress(p)
      );
      setPreUpload(null);
      onUpload('glb', optimizedFile);
    } catch (err) {
      console.error('[PreUpload] Optimize failed:', err);
    }
    setPreWorking(false);
    setPreProgress(0);
  }, [preUpload, preOpts, viewerRef, onUpload]);

  const preUploadSkip = useCallback(() => {
    if (!preUpload) return;
    onUpload('glb', preUpload.file);
    setPreUpload(null);
  }, [preUpload, onUpload]);

  // Skybox image optimization on upload
  const handleSkyboxFile = useCallback(async (file) => {
    // Skip HDR files — can't optimize those in-browser
    if (/\.hdr$/i.test(file.name)) {
      onUpload('skybox', file);
      return;
    }
    const MAX_SKYBOX_SIZE = 4096;
    const MAX_FILE_MB = 2;
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = URL.createObjectURL(file);
      });
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const fileMB = file.size / (1024 * 1024);
      const needsResize = w > MAX_SKYBOX_SIZE || h > MAX_SKYBOX_SIZE || fileMB > MAX_FILE_MB;
      URL.revokeObjectURL(img.src);

      if (!needsResize) {
        onUpload('skybox', file);
        return;
      }

      // Resize to fit within MAX_SKYBOX_SIZE
      const ratio = Math.min(MAX_SKYBOX_SIZE / w, MAX_SKYBOX_SIZE / h, 1);
      const nw = Math.round(w * ratio);
      const nh = Math.round(h * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, nw, nh);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
      const ext = file.name.replace(/\.[^.]+$/, '.webp');
      const optimizedFile = new File([blob], ext, { type: 'image/webp' });

      const savedMB = (file.size - optimizedFile.size) / (1024 * 1024);
      console.log(`[Skybox] Optimized: ${w}x${h} → ${nw}x${nh}, ${fileMB.toFixed(1)}MB → ${(optimizedFile.size / (1024 * 1024)).toFixed(1)}MB (saved ${savedMB.toFixed(1)}MB)`);
      onUpload('skybox', optimizedFile);
    } catch (err) {
      console.error('[Skybox] Optimization failed, uploading as-is:', err);
      onUpload('skybox', file);
    }
  }, [onUpload]);

  // Track which inner accordion section is open (null = all closed)
  const [openSection, setOpenSection] = useState(null);

  const toggleSection = useCallback((sectionId) => {
    setOpenSection((prev) => prev === sectionId ? null : sectionId);
  }, []);

  useEffect(() => {
    onActiveSectionChange?.(openSection);
  }, [openSection, onActiveSectionChange]);

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
          if (typeof obj[parts[i]] === 'number') {
            const v = obj[parts[i]];
            obj[parts[i]] = { x: v, y: v, z: v };
          } else if (!obj[parts[i]]) {
            obj[parts[i]] = {};
          }
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

  // Local lighting state
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

  // Local tint state
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
        title="Maqueta 3D"
        icon="🧊"
        open={openSection === 'glb'}
        onToggle={() => toggleSection('glb')}
        visible={visibility?.glb !== false}
        onVisibilityToggle={scene.assets?.glb ? (v) => onVisibilityChange?.('glb', v) : undefined}
        selected={openSection === 'glb'}
        tris={assetStats.glb}
      >
        <FileUploader
          label="Archivo"
          icon=""
          accept=".glb,.gltf"
          currentFile={scene.assets?.glb}
          uploadProgress={uploadProgress?.glb}
          onUpload={handleGlbFile}
          onRemove={() => onRemove('glb')}
        />

        {/* ─── Proxy GLB for progressive loading ─── */}
        <div className="asset-transform-section">
          <div className="asset-transform-title">
            Preview rápido
            <HelpTooltip text="GLB reducido (~200KB) que carga en menos de 1s como preview mientras el modelo completo descarga en background." />
          </div>
          <FileUploader
            label="Proxy"
            icon=""
            accept=".glb,.gltf"
            currentFile={scene.assets?.glb_proxy}
            uploadProgress={uploadProgress?.glb_proxy}
            onUpload={(file) => onUpload('glb_proxy', file)}
            onRemove={() => onRemove('glb_proxy')}
          />
        </div>

        {/* ─── Pre-upload optimization panel ─── */}
        {(preUpload || preWorking) && (
          <div className="pre-upload-panel">
            {preWorking && !preUpload ? (
              <div className="pre-upload-analyzing">Analizando modelo...</div>
            ) : preUpload && (
              <>
                <div className="pre-upload-title">Optimizar antes de subir</div>
                <div className="model-checker-stats">
                  <span>{(preUpload.stats.totalTriangles / 1000).toFixed(0)}K tris</span>
                  <span>{(preUpload.stats.totalVertices / 1000).toFixed(0)}K verts</span>
                  <span>{preUpload.stats.textureCount} tex</span>
                  {preUpload.stats.maxTexSize > 0 && <span>max {preUpload.stats.maxTexSize}px</span>}
                </div>
                <div className="model-checker-options">
                  <label className="model-checker-option">
                    <input type="checkbox" checked={preOpts.resizeTextures} onChange={(e) => setPreOpts((p) => ({ ...p, resizeTextures: e.target.checked }))} />
                    <span>Reducir texturas a</span>
                    <select value={preOpts.maxTextureSize} onChange={(e) => setPreOpts((p) => ({ ...p, maxTextureSize: parseInt(e.target.value) }))}>
                      <option value={2048}>2048px</option>
                      <option value={1024}>1024px</option>
                      <option value={512}>512px</option>
                    </select>
                  </label>
                  <label className="model-checker-option">
                    <input type="checkbox" checked={preOpts.forcePOT} onChange={(e) => setPreOpts((p) => ({ ...p, forcePOT: e.target.checked }))} />
                    <span>Forzar texturas POT</span>
                  </label>
                  <label className="model-checker-option">
                    <input type="checkbox" checked={preOpts.stripGeometry} onChange={(e) => setPreOpts((p) => ({ ...p, stripGeometry: e.target.checked }))} />
                    <span>Eliminar atributos no usados</span>
                  </label>
                </div>
                <div className="pre-upload-actions">
                  <button className="model-checker-apply" onClick={preUploadOptimize} disabled={preWorking}>
                    {preWorking && <span className="model-checker-progress" style={{ width: `${preProgress}%` }} />}
                    <span className="model-checker-apply-text">{preWorking ? `${Math.round(preProgress)}%` : 'Optimizar y subir'}</span>
                  </button>
                  <button className="pre-upload-skip" onClick={preUploadSkip} disabled={preWorking}>Subir sin optimizar</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── Model checker (post-upload) ─── */}
        <ModelChecker viewerRef={viewerRef} viewerReady={viewerReady} hasGlb={!!scene.assets?.glb} />

        {/* ─── HDRI del modelo ─── */}
        <div className="asset-transform-section">
          <div className="asset-transform-title">HDRI del modelo</div>
          <label className="hdri-checkbox-row">
            <input
              type="checkbox"
              checked={!!hdriFromSkybox}
              onChange={(e) => onHdriFromSkybox?.(e.target.checked)}
            />
            <span>Usar imagen del Skybox</span>
          </label>
          {!hdriFromSkybox && (
            <FileUploader
              label="HDRI"
              icon=""
              accept=".hdr,.jpg,.jpeg,.png,.webp"
              currentFile={scene.assets?.modelHdri}
              uploadProgress={uploadProgress?.modelHdri}
              onUpload={(file) => onUpload('modelHdri', file)}
              onRemove={() => onRemove('modelHdri')}
            />
          )}
        </div>

        {/* ─── Materials (collapsible sub-accordion) ─── */}
        <SubAccordion title="Materiales" icon="🎨">
          {materialsContent}
        </SubAccordion>

        {/* ─── GLB Reveal Animation ─── */}
        <div className="asset-transform-section">
          <div className="asset-transform-title">Animación de entrada</div>
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
                  <option value="linear">Linear</option>
                  <option value="easeIn">Ease In</option>
                  <option value="easeOut">Ease Out</option>
                  <option value="easeInOut">Ease In-Out</option>
                  <option value="easeOutCubic">Ease Out Cubic</option>
                  <option value="easeOutBack">Ease Out Back</option>
                </select>
              </div>
            </>
          )}
        </div>

        {/* ─── Transform ─── */}
        {local && (
          <SubAccordion title="Transform" icon="📐">
            <div className="asset-transform-section">
              <GizmoToolbar activeMode={gizmoMode} onModeChange={onGizmoMode} />
              <div className="asset-transform-title">Posición</div>
              <TransformRow label="X" labelClass="label-x" value={local.glb?.position?.x ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('glb', 'position.x', v)} />
              <TransformRow label="Y" labelClass="label-y" value={local.glb?.position?.y ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('glb', 'position.y', v)} />
              <TransformRow label="Z" labelClass="label-z" value={local.glb?.position?.z ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('glb', 'position.z', v)} />
              <div className="asset-transform-title">Escala</div>
              <TransformRow label="Sx" labelClass="label-x" value={local.glb?.scale?.x ?? local.glb?.scale ?? 1} min={0.1} max={2} step={0.001} onChange={(v) => updateField('glb', 'scale.x', v)} />
              <TransformRow label="Sy" labelClass="label-y" value={local.glb?.scale?.y ?? local.glb?.scale ?? 1} min={0.1} max={2} step={0.001} onChange={(v) => updateField('glb', 'scale.y', v)} />
              <TransformRow label="Sz" labelClass="label-z" value={local.glb?.scale?.z ?? local.glb?.scale ?? 1} min={0.1} max={2} step={0.001} onChange={(v) => updateField('glb', 'scale.z', v)} />
              <div className="asset-transform-title">Rotación</div>
              <TransformRow label="Rx" labelClass="label-x" value={local.glb?.rotation?.x ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('glb', 'rotation.x', v)} />
              <TransformRow label="Ry" labelClass="label-y" value={local.glb?.rotation?.y ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('glb', 'rotation.y', v)} />
              <TransformRow label="Rz" labelClass="label-z" value={local.glb?.rotation?.z ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('glb', 'rotation.z', v)} />
            </div>
          </SubAccordion>
        )}
      </AssetAccordion>

      {/* ─── Colliders ─── */}
      <AssetAccordion
        title="Colliders"
        icon="🧱"
        open={openSection === 'colliders'}
        onToggle={() => toggleSection('colliders')}
        visible={visibility?.colliders !== false}
        onVisibilityToggle={scene.assets?.colliders ? (v) => onVisibilityChange?.('colliders', v) : undefined}
        selected={openSection === 'colliders'}
        tris={assetStats.colliders}
      >
        <FileUploader
          label="Archivo"
          icon=""
          accept=".glb,.gltf"
          currentFile={scene.assets?.colliders}
          uploadProgress={uploadProgress?.colliders}
          onUpload={(file) => onUpload('colliders', file)}
          onRemove={() => onRemove('colliders')}
        />
        {local && (
          <SubAccordion title="Transform" icon="📐">
            <div className="asset-transform-section">
              <GizmoToolbar activeMode={gizmoMode} onModeChange={onGizmoMode} />
              <div className="asset-transform-title">Posición</div>
              <TransformRow label="X" labelClass="label-x" value={local.colliders?.position?.x ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('colliders', 'position.x', v)} />
              <TransformRow label="Y" labelClass="label-y" value={local.colliders?.position?.y ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('colliders', 'position.y', v)} />
              <TransformRow label="Z" labelClass="label-z" value={local.colliders?.position?.z ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('colliders', 'position.z', v)} />
              <div className="asset-transform-title">Escala</div>
              <TransformRow label="Sx" labelClass="label-x" value={local.colliders?.scale?.x ?? local.colliders?.scale ?? 1} min={0.1} max={2} step={0.001} onChange={(v) => updateField('colliders', 'scale.x', v)} />
              <TransformRow label="Sy" labelClass="label-y" value={local.colliders?.scale?.y ?? local.colliders?.scale ?? 1} min={0.1} max={2} step={0.001} onChange={(v) => updateField('colliders', 'scale.y', v)} />
              <TransformRow label="Sz" labelClass="label-z" value={local.colliders?.scale?.z ?? local.colliders?.scale ?? 1} min={0.1} max={2} step={0.001} onChange={(v) => updateField('colliders', 'scale.z', v)} />
              <div className="asset-transform-title">Rotación</div>
              <TransformRow label="Rx" labelClass="label-x" value={local.colliders?.rotation?.x ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('colliders', 'rotation.x', v)} />
              <TransformRow label="Ry" labelClass="label-y" value={local.colliders?.rotation?.y ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('colliders', 'rotation.y', v)} />
              <TransformRow label="Rz" labelClass="label-z" value={local.colliders?.rotation?.z ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('colliders', 'rotation.z', v)} />
            </div>
          </SubAccordion>
        )}
      </AssetAccordion>

      {/* ─── SOG Splat ─── */}
      <AssetAccordion
        title="Splat SOG"
        icon="✨"
        open={openSection === 'sog'}
        onToggle={() => toggleSection('sog')}
        visible={visibility?.sog !== false}
        onVisibilityToggle={scene.assets?.sog ? (v) => onVisibilityChange?.('sog', v) : undefined}
        selected={openSection === 'sog'}
        tris={assetStats.sog}
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
          <SubAccordion title="Transform" icon="📐">
            <div className="asset-transform-section">
              <GizmoToolbar activeMode={gizmoMode} onModeChange={onGizmoMode} />
              <div className="asset-transform-title">Posición</div>
              <TransformRow label="X" labelClass="label-x" value={local.sog?.position?.x ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('sog', 'position.x', v)} />
              <TransformRow label="Y" labelClass="label-y" value={local.sog?.position?.y ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('sog', 'position.y', v)} />
              <TransformRow label="Z" labelClass="label-z" value={local.sog?.position?.z ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('sog', 'position.z', v)} />
              <div className="asset-transform-title">Escala</div>
              <TransformRow label="Sx" labelClass="label-x" value={local.sog?.scale?.x ?? local.sog?.scale ?? 1} min={0.1} max={2} step={0.001} onChange={(v) => updateField('sog', 'scale.x', v)} />
              <TransformRow label="Sy" labelClass="label-y" value={local.sog?.scale?.y ?? local.sog?.scale ?? 1} min={0.1} max={2} step={0.001} onChange={(v) => updateField('sog', 'scale.y', v)} />
              <TransformRow label="Sz" labelClass="label-z" value={local.sog?.scale?.z ?? local.sog?.scale ?? 1} min={0.1} max={2} step={0.001} onChange={(v) => updateField('sog', 'scale.z', v)} />
              <div className="asset-transform-title">Rotación</div>
              <TransformRow label="Rx" labelClass="label-x" value={local.sog?.rotation?.x ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('sog', 'rotation.x', v)} />
              <TransformRow label="Ry" labelClass="label-y" value={local.sog?.rotation?.y ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('sog', 'rotation.y', v)} />
              <TransformRow label="Rz" labelClass="label-z" value={local.sog?.rotation?.z ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('sog', 'rotation.z', v)} />
            </div>
          </SubAccordion>
        )}

        {/* ─── Splat Loader Settings ─── */}
        <div className="asset-transform-section">
          <div className="asset-transform-title">Loader — Spark 2.0</div>
          <div className="splat-setting-row">
            <label className="splat-checkbox-label">
              <input type="checkbox" checked={localSplat.lod} onChange={(e) => updateSplatField('lod', e.target.checked)} />
              Level of Detail (LoD)
            </label>
            <HelpTooltip text="Carga progresiva por nivel de detalle. Mejora tiempos de carga inicial." />
          </div>
          <div className="splat-setting-row">
            <label className="splat-checkbox-label">
              <input type="checkbox" checked={localSplat.extSplats} onChange={(e) => updateSplatField('extSplats', e.target.checked)} />
              Extended Splats
            </label>
            <HelpTooltip text="Duplica VRAM pero mejora la calidad visual. Desactivar en GPUs con poca memoria." />
          </div>

          <div className="asset-transform-title">Animación de entrada</div>
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
                  <option value="linear">Linear</option>
                  <option value="easeIn">Ease In</option>
                  <option value="easeOut">Ease Out</option>
                  <option value="easeInOut">Ease In-Out</option>
                  <option value="easeOutCubic">Ease Out Cubic</option>
                  <option value="easeOutBack">Ease Out Back</option>
                </select>
              </div>
            </>
          )}

          <div className="asset-transform-title">Máscara radial</div>
          <div className="splat-setting-row">
            <label className="splat-checkbox-label">
              <input type="checkbox" checked={localSplat.radialClip === true} onChange={(e) => updateSplatField('radialClip', e.target.checked)} />
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
                  <option value="linear">Linear</option>
                  <option value="easeIn">Ease In</option>
                  <option value="easeOut">Ease Out</option>
                  <option value="easeInOut">Ease In-Out</option>
                  <option value="easeOutCubic">Ease Out Cubic</option>
                  <option value="easeOutBack">Ease Out Back</option>
                </select>
              </div>
            </>
          )}
        </div>
      </AssetAccordion>

      {/* ─── Skybox ─── */}
      <AssetAccordion
        title="Skybox"
        icon="🌐"
        open={openSection === 'skybox'}
        onToggle={() => toggleSection('skybox')}
        visible={visibility?.skybox !== false}
        onVisibilityToggle={scene.assets?.skybox ? (v) => onVisibilityChange?.('skybox', v) : undefined}
        selected={openSection === 'skybox'}
      >
        <FileUploader
          label="Archivo"
          icon=""
          accept=".jpg,.jpeg,.png,.webp,.hdr"
          currentFile={scene.assets?.skybox}
          uploadProgress={uploadProgress?.skybox}
          onUpload={handleSkyboxFile}
          onRemove={() => onRemove('skybox')}
        />
        {local && (
          <SubAccordion title="Transform" icon="📐">
            <div className="asset-transform-section">
              <div className="asset-transform-title">Posición</div>
              <TransformRow label="X" labelClass="label-x" value={local.skybox?.position?.x ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('skybox', 'position.x', v)} />
              <TransformRow label="Y" labelClass="label-y" value={local.skybox?.position?.y ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('skybox', 'position.y', v)} />
              <TransformRow label="Z" labelClass="label-z" value={local.skybox?.position?.z ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('skybox', 'position.z', v)} />
              <div className="asset-transform-title">Ajustes</div>
              <TransformRow label="R" labelClass="label-r" value={local.skybox?.radius ?? 400} min={10} max={50000} step={10} onChange={(v) => updateField('skybox', 'radius', v)} help="Radio de la esfera del skybox" />
              <TransformRow label="B" labelClass="label-b" value={local.skybox?.blur ?? 0} min={0} max={80} step={1} onChange={(v) => updateField('skybox', 'blur', v)} help="Desenfoque del skybox" />
              <div className="asset-transform-title">Rotación</div>
              <TransformRow label="Rx" labelClass="label-x" value={local.skybox?.rotation?.x ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('skybox', 'rotation.x', v)} />
              <TransformRow label="Ry" labelClass="label-y" value={local.skybox?.rotation?.y ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('skybox', 'rotation.y', v)} />
              <TransformRow label="Rz" labelClass="label-z" value={local.skybox?.rotation?.z ?? 0} min={-180} max={180} step={1} onChange={(v) => updateField('skybox', 'rotation.z', v)} />
            </div>
          </SubAccordion>
        )}
      </AssetAccordion>

      {/* ─── Floor ─── */}
      <AssetAccordion
        title="Floor"
        icon="🟫"
        open={openSection === 'floor'}
        onToggle={() => toggleSection('floor')}
        visible={visibility?.floor !== false}
        onVisibilityToggle={(v) => onVisibilityChange?.('floor', v)}
        selected={openSection === 'floor'}
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
        <SatelliteGenerator
          onGenerated={(file) => onUpload('floor', file)}
          savedSatelliteUrl={scene?.satelliteUrl || ''}
          onSaveSatelliteUrl={onSaveSatelliteUrl}
        />
        {local && (
          <SubAccordion title="Transform" icon="📐">
            <div className="asset-transform-section">
              <div className="asset-transform-title">Posición</div>
              <TransformRow label="X" labelClass="label-x" value={local.floor?.position?.x ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('floor', 'position.x', v)} />
              <TransformRow label="Y" labelClass="label-y" value={local.floor?.position?.y ?? -0.5} min={-500} max={500} step={0.5} onChange={(v) => updateField('floor', 'position.y', v)} />
              <TransformRow label="Z" labelClass="label-z" value={local.floor?.position?.z ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('floor', 'position.z', v)} />
              <div className="asset-transform-title">Ajustes</div>
              <TransformRow label="S" labelClass="label-s" value={local.floor?.scale ?? 1050} min={10} max={50000} step={10} onChange={(v) => updateField('floor', 'scale', v)} help="Tamaño del plano" />
              <TransformRow label="B" labelClass="label-b" value={local.floor?.blur ?? 0} min={0} max={80} step={1} onChange={(v) => updateField('floor', 'blur', v)} help="Desenfoque de la textura" />
              <TransformRow label="R" labelClass="label-r" value={local.floor?.rotation ?? 0} min={0} max={360} step={1} onChange={(v) => updateField('floor', 'rotation', v)} help="Rotación en grados" />
              <div className="asset-transform-title">Máscara esférica</div>
              <label className="hdri-checkbox-row">
                <input
                  type="checkbox"
                  checked={local.mask?.enabled !== false}
                  onChange={(e) => updateField('mask', 'enabled', e.target.checked)}
                />
                <span>Activar máscara</span>
              </label>
              {local.mask?.enabled !== false && (
                <>
                  <TransformRow label="X" labelClass="label-x" value={local.mask?.position?.x ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('mask', 'position.x', v)} />
                  <TransformRow label="Y" labelClass="label-y" value={local.mask?.position?.y ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('mask', 'position.y', v)} />
                  <TransformRow label="Z" labelClass="label-z" value={local.mask?.position?.z ?? 0} min={-500} max={500} step={0.5} onChange={(v) => updateField('mask', 'position.z', v)} />
                  <TransformRow label="R" labelClass="label-r" value={local.mask?.radius ?? 50} min={1} max={500} step={1} onChange={(v) => updateField('mask', 'radius', v)} help="Radio de la máscara" />
                  <TransformRow label="F" labelClass="label-b" value={local.mask?.falloff ?? 10} min={0} max={100} step={1} onChange={(v) => updateField('mask', 'falloff', v)} help="Suavidad del borde" />
                </>
              )}
            </div>
          </SubAccordion>
        )}
      </AssetAccordion>

      {/* ─── Lighting ─── */}
      <AssetAccordion
        title="Iluminación"
        icon="💡"
        open={openSection === 'lighting'}
        onToggle={() => toggleSection('lighting')}
      >
        <div className="asset-transform-section">
          <TransformRow label="Int" labelClass="label-s" value={localLighting.ambientIntensity} min={0} max={5} step={0.05} onChange={(v) => updateLightingField('ambientIntensity', v)} help="Intensidad de la luz ambiental" />
          <TransformRow label="Env" labelClass="label-s" value={localLighting.envMapIntensity} min={0} max={10} step={0.1} onChange={(v) => updateLightingField('envMapIntensity', v)} help="Intensidad del mapa de entorno (reflejos HDRI)" />
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

        {/* ─── Tint Overlay ─── */}
        <div className="asset-transform-section">
          <div className="asset-transform-title">Tint del entorno</div>
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
      </AssetAccordion>
    </FloatingPanel>
  );
}
