'use client';

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import FloatingPanel from './FloatingPanel';
import TransformPanel from './TransformPanel';
import FileUploader from '@/components/ui/FileUploader';
import HelpTooltip from '@/components/ui/HelpTooltip';

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

/**
 * A single collapsible asset section (inner accordion).
 * Optionally shows a visibility eye toggle in the header.
 */
function AssetAccordion({ title, icon, open, onToggle, children, visible, onVisibilityToggle, selected }) {
  return (
    <div className={`asset-accordion ${open ? 'open' : ''} ${selected ? 'selected' : ''}`}>
      <div className="asset-accordion-header">
        <span className="asset-accordion-title" onClick={onToggle}>
          <span className="asset-accordion-icon">{icon}</span>
          {title}
        </span>
        <span className="asset-accordion-actions">
          {onVisibilityToggle && (
            <button
              className={`asset-eye-btn ${visible === false ? 'hidden-asset' : ''}`}
              onClick={(e) => { e.stopPropagation(); onVisibilityToggle(!visible); }}
              title={visible === false ? 'Mostrar' : 'Ocultar'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {visible === false ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          )}
          <span className="asset-accordion-chevron" onClick={onToggle}>▼</span>
        </span>
      </div>
      {open && <div className="asset-accordion-body">{children}</div>}
    </div>
  );
}

/**
 * Scene editor panel — upload/manage assets + transform controls for each asset.
 * Each asset type (GLB, SOG, Skybox, Floor) is a collapsible inner accordion.
 */
/**
 * Model optimization checker — auto-analyzes GLB on load.
 * Shows compression types used, optimization warnings, and runtime optimize options.
 */
function ModelChecker({ viewerRef, viewerReady, hasGlb }) {
  const [stats, setStats] = useState(null);
  const [showOptions, setShowOptions] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [opts, setOpts] = useState({
    resizeTextures: false,
    maxTextureSize: 2048,
    forcePOT: false,
    stripGeometry: false,
  });

  const refreshStats = useCallback(() => {
    if (viewerRef?.current) {
      const s = viewerRef.current.getModelStats();
      setStats(s);
    }
  }, [viewerRef]);

  // Auto-check when model loads or changes
  useEffect(() => {
    if (!hasGlb || !viewerReady || !viewerRef?.current) {
      setStats(null);
      setShowOptions(false);
      return;
    }
    const timer = setTimeout(refreshStats, 500);
    return () => clearTimeout(timer);
  }, [hasGlb, viewerReady, viewerRef, refreshStats]);

  const runOptimize = useCallback(async () => {
    if (!viewerRef?.current) return;
    setOptimizing(true);
    setProgress(0);
    try {
      await viewerRef.current.optimizeModel(opts, (p) => setProgress(p));
      refreshStats();
      setShowOptions(false);
    } catch (err) {
      console.error('[ModelChecker] Optimize failed:', err);
    }
    setOptimizing(false);
    setProgress(0);
  }, [viewerRef, opts, refreshStats]);

  if (!hasGlb || !viewerReady || !stats) return null;

  // Actionable warnings (can be fixed at runtime)
  const warnings = [];
  if (stats.totalTriangles > 500000) warnings.push(`Triángulos altos: ${(stats.totalTriangles / 1000).toFixed(0)}K (rec. <500K)`);
  if (stats.maxTexSize > 2048) warnings.push(`Texturas grandes: ${stats.maxTexSize}px (rec. ≤2048)`);
  if (stats.nonPOT > 0) warnings.push(`${stats.nonPOT} textura(s) no POT (potencia de 2)`);
  if (stats.totalVertices > 300000) warnings.push(`Vértices altos: ${(stats.totalVertices / 1000).toFixed(0)}K`);

  // Informational notes (require re-exporting the file)
  const notes = [];
  if (!stats.draco && !stats.meshopt) notes.push('Recomprimir con Draco o MeshOpt antes de subir');
  if (!stats.ktx2 && stats.textureCount > 0) notes.push('Convertir texturas a KTX2/Basis antes de subir');

  const compressionTags = [];
  if (stats.draco) compressionTags.push('Draco');
  if (stats.meshopt) compressionTags.push('MeshOpt');
  if (stats.ktx2) compressionTags.push('KTX2');

  const hasAnyOption = opts.resizeTextures || opts.forcePOT || opts.stripGeometry;

  return (
    <div className="model-checker">
      <div className="model-checker-result">
        <div className="model-checker-stats">
          <span>{(stats.totalTriangles / 1000).toFixed(0)}K tris</span>
          <span>{(stats.totalVertices / 1000).toFixed(0)}K verts</span>
          <span>{stats.meshCount} meshes</span>
          <span>{stats.textureCount} tex</span>
        </div>
        <div className="model-checker-compression">
          {compressionTags.length > 0 ? (
            compressionTags.map((tag) => <span key={tag} className="model-checker-tag ok">{tag}</span>)
          ) : (
            <span className="model-checker-tag none">Sin compresión</span>
          )}
        </div>
        {warnings.length > 0 && (
          <>
            <div className="model-checker-warnings">
              {warnings.map((w, i) => <div key={i} className="model-checker-warn">{w}</div>)}
            </div>
            <button className="model-checker-btn" onClick={() => setShowOptions((v) => !v)}>
              {showOptions ? 'Cerrar' : 'Optimizar'}
            </button>
          </>
        )}
        {notes.length > 0 && (
          <div className="model-checker-notes">
            {notes.map((n, i) => <div key={i} className="model-checker-note">{n}</div>)}
          </div>
        )}
        {warnings.length === 0 && notes.length === 0 && (
          <div className="model-checker-ok">Modelo optimizado</div>
        )}
        {showOptions && (
          <div className="model-checker-options">
            <label className="model-checker-option">
              <input type="checkbox" checked={opts.resizeTextures} onChange={(e) => setOpts((p) => ({ ...p, resizeTextures: e.target.checked }))} />
              <span>Reducir texturas a</span>
              <select value={opts.maxTextureSize} onChange={(e) => setOpts((p) => ({ ...p, maxTextureSize: parseInt(e.target.value) }))}>
                <option value={2048}>2048px</option>
                <option value={1024}>1024px</option>
                <option value={512}>512px</option>
              </select>
            </label>
            <label className="model-checker-option">
              <input type="checkbox" checked={opts.forcePOT} onChange={(e) => setOpts((p) => ({ ...p, forcePOT: e.target.checked }))} />
              <span>Forzar texturas POT (potencia de 2)</span>
            </label>
            <label className="model-checker-option">
              <input type="checkbox" checked={opts.stripGeometry} onChange={(e) => setOpts((p) => ({ ...p, stripGeometry: e.target.checked }))} />
              <span>Eliminar atributos no usados (uv2, color)</span>
            </label>
            <button className="model-checker-apply" onClick={runOptimize} disabled={!hasAnyOption || optimizing}>
              {optimizing && <span className="model-checker-progress" style={{ width: `${progress}%` }} />}
              <span className="model-checker-apply-text">{optimizing ? `${Math.round(progress)}%` : 'Aplicar'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

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
}) {
  // Pre-upload optimization state
  const [preUpload, setPreUpload] = useState(null); // { file, stats }
  const [preOpts, setPreOpts] = useState({ resizeTextures: false, maxTextureSize: 2048, forcePOT: false, stripGeometry: false });
  const [preProgress, setPreProgress] = useState(0);
  const [preWorking, setPreWorking] = useState(false);

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
    setOpenSection((prev) => {
      const next = prev === sectionId ? null : sectionId;
      onActiveSectionChange?.(next);
      return next;
    });
  }, [onActiveSectionChange]);

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

  if (!scene) return null;

  return (
    <>
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

        {/* ─── Materials ─── */}
        {materialsContent}
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
        {local && (
          <div className="asset-transform-section">
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
      </AssetAccordion>
    </FloatingPanel>
    {typeof document !== 'undefined' && document.getElementById('transform-panel-slot') &&
      createPortal(
        <TransformPanel activeSection={openSection} local={local} updateField={updateField} />,
        document.getElementById('transform-panel-slot')
      )
    }
    </>
  );
}
