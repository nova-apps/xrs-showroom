'use client';

/**
 * 3D Viewer — Three.js + Spark Gaussian Splats.
 * Optimized renderer for SOG: no logDepthBuf, no MSAA, capped pixel ratio.
 * 
 * This component manages the entire 3D scene lifecycle:
 * - Renderer, scene, camera, controls
 * - GLB loading with Draco/MeshOpt/KTX2
 * - SOG loading with Spark SplatMesh
 * - Skybox (equirectangular sphere) + Floor (plane)
 * - Transform application from props
 * - FPS counter
 */

import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { detectGPU, getQualityProfile } from '@/lib/utils';
import { Optimizer } from '@/lib/optimizer';
import {
  handlePitchSnap,
  handleClickZoom,
  handleFocusAnimation,
  handleGlbReveal,
  handleSplatFade,
  handleSplatClip,
  onCanvasPointerDown,
  onCanvasPointerUp,
  EASING_FNS,
} from './animations';
import { handleAdaptiveQuality, applyQualityLevel } from './quality';
import { sanitizeMatKey, applyMaterialOverridesToModel, syncCameraRotation, disposeObject } from './helpers';

const DEG2RAD = Math.PI / 180;
const HALF_PI = Math.PI / 2;

const Viewer3D = forwardRef(function Viewer3D({ scene: sceneData, onReady }, ref) {
  const containerRef = useRef(null);
  const stateRef = useRef({
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    animationId: null,
    sparkRenderer: null,
    glbModel: null,
    collidersModel: null,
    splatMesh: null,
    skyboxMesh: null,
    floorMesh: null,
    skyboxRawTexture: null,
    floorRawTexture: null,
    pmremGenerator: null,
    envMap: null,
    THREE: null,
    qualityProfile: null,
    optimizer: null,
    clock: null,
    // Store transforms so they can be applied after models load
    pendingTransforms: { glb: null, colliders: null, sog: null, skybox: null, floor: null, mask: null },
    // Spherical mask for floor/splat fade
    maskHelper: null,
    maskUniforms: {
      uMaskEnabled: { value: 0.0 },
      uMaskCenter: { value: null }, // initialized as Vector3 after THREE loads
      uMaskRadius: { value: 50.0 },
      uMaskFalloff: { value: 10.0 },
    },
    // Ambient light reference
    ambientLight: null,
    // Store material overrides so they can be applied after GLB loads
    pendingMaterialOverrides: null,
    // Store the GLB model bounding-box center for orbit target
    glbCenter: null,
    // Store last orbit settings so they can be re-applied after GLB loads
    pendingOrbit: null,
    // Model-specific environment map (separate from skybox env)
    modelEnvMap: null,
    // TransformControls gizmo
    transformControls: null,
    gizmoTarget: null, // which asset type the gizmo is attached to
    onGizmoChange: null, // callback for when gizmo changes a transform
    onGizmoDragEnd: null, // callback when gizmo drag ends (for history)
    onCameraRotation: null, // callback for syncing camera orientation to ViewCube
    onCameraInfo: null, // callback for camera info panel (pitch, yaw, zoom)
    _lastCameraRot: null, // cache to avoid redundant calls
    // Pitch snap animation state machine
    pitchSnap: { state: 'idle', originalMinPolar: 0 },
    // Click zoom animation state machine
    clickZoom: { state: 'idle', originalFov: 45 },
    // Camera Focus animation state (spherical coords)
    focusTarget: { state: 'idle', targetPhi: 0, targetTheta: 0, targetRadius: 0, onComplete: null, lerpOverride: null },
    // Adaptive quality auto-adjustment
    adaptiveQuality: {
      enabled: true,
      frameTimes: [],        // timestamps of recent frames
      lastCheck: 0,
      currentLevel: -1,      // -1 = auto-detect from profile, 0=low, 1=medium, 2=high, 3=ultra
      degradeThreshold: 22,  // FPS below this → degrade
      upgradeThreshold: 50,  // FPS above this → upgrade
      checkInterval: 2500,   // ms between checks
      lastDegradeTime: 0,
      lastUpgradeTime: 0,
      degradeCooldown: 2000, // wait 2s before degrading again
      upgradeCooldown: 5000, // wait 5s before upgrading (slow recovery)
      originalPixelRatio: 1,
      originalAnisotropy: 8,
    },
    // Instancing stats
    instancingStats: null,
    // Splat fade-in animation state
    splatFade: { active: false, startTime: 0, duration: 2.5, easing: 'easeOut' },
    // Splat loader settings (persisted)
    splatSettings: null,
    // GLB reveal animation state
    glbReveal: { active: false, startTime: 0, duration: 2, easing: 'easeOut', mode: 'none', minY: 0, maxY: 1, clippingPlane: null, materials: [] },
    // GLB reveal settings (persisted)
    glbSettings: null,
    // Tint overlay mesh (fullscreen quad with stencil test)
    tintMesh: null,
  });

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    applyTransform: (type, transforms) => {
      applyTransformToObject(type, transforms);
    },
    applyOrbit: (orbit) => {
      applyOrbitToControls(orbit);
    },
    setPixelRatio: (ratio) => {
      const s = stateRef.current;
      if (s.renderer) {
        const clamped = Math.min(Math.max(ratio, 0.5), window.devicePixelRatio || 2);
        s.renderer.setPixelRatio(clamped);
        console.log(`[Viewer] Pixel ratio set to ${clamped}`);
      }
    },
    loadGlb: (url, settings) => loadGlbModel(url, settings),
    setGlbSettings: (settings) => { stateRef.current.glbSettings = settings; },
    loadColliders: (url) => loadCollidersModel(url),
    loadSog: (url, settings) => loadSogModel(url, settings),
    setSplatSettings: (settings) => { stateRef.current.splatSettings = settings; },
    loadSkyboxTexture: (url) => loadSkyboxTexture(url),
    loadFloorTexture: (url) => loadFloorTexture(url),
    loadModelHdri: (url) => loadModelHdri(url),
    removeGlb: () => removeGlb(),
    removeColliders: () => removeColliders(),
    removeSog: () => removeSog(),
    removeSkyboxTexture: () => removeSkyboxTex(),
    removeFloorTexture: () => removeFloorTex(),
    removeModelHdri: () => removeModelHdri(),
    setCameraView: (viewName) => {
      const s = stateRef.current;
      const THREE = s.THREE;
      if (!THREE || !s.camera || !s.controls) return;

      const target = s.glbCenter || s.controls.target.clone();
      // Calculate distance from current camera to target
      const dist = s.camera.position.distanceTo(target);

      const positions = {
        top:    new THREE.Vector3(target.x, target.y + dist, target.z + 0.001),
        bottom: new THREE.Vector3(target.x, target.y - dist, target.z + 0.001),
        front:  new THREE.Vector3(target.x, target.y, target.z + dist),
        back:   new THREE.Vector3(target.x, target.y, target.z - dist),
        left:   new THREE.Vector3(target.x - dist, target.y, target.z),
        right:  new THREE.Vector3(target.x + dist, target.y, target.z),
      };

      const pos = positions[viewName];
      if (!pos) return;

      // Use focus animation for smooth transition
      const offset = pos.clone().sub(target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      sph.makeSafe();

      s.focusTarget.targetPhi = sph.phi;
      s.focusTarget.targetTheta = sph.theta;
      s.focusTarget.targetRadius = sph.radius;
      s.focusTarget.onComplete = null;
      s.focusTarget.lerpOverride = 0.12;
      s.focusTarget.state = 'animating';
    },
    setLighting: (lighting) => {
      const s = stateRef.current;
      if (!s.ambientLight || !s.THREE) return;
      if (lighting.ambientIntensity !== undefined) {
        s.ambientLight.intensity = lighting.ambientIntensity;
      }
      if (lighting.ambientColor !== undefined) {
        s.ambientLight.color.set(lighting.ambientColor);
      }
      if (lighting.envMapIntensity !== undefined && s.scene) {
        s.scene.environmentIntensity = lighting.envMapIntensity;
      }
    },
    setTint: (tint) => {
      const s = stateRef.current;
      if (!s.tintMesh || !s.THREE) return;
      const enabled = tint?.enabled !== false;
      const color = tint?.color || '#000000';
      const opacity = tint?.opacity ?? 0;
      s.tintMesh.visible = enabled && opacity > 0;
      s.tintMesh.material.uniforms.uTintColor.value.set(color);
      s.tintMesh.material.uniforms.uTintOpacity.value = opacity;
    },
    setGizmoMode: (mode, assetType) => {
      const s = stateRef.current;
      if (!s.transformControls) return;

      // Find the target object
      const targets = {
        glb: s.glbModel,
        colliders: s.collidersModel,
        sog: s.splatMesh,
      };
      const obj = targets[assetType];
      if (!obj) return;

      s.transformControls.setMode(mode); // 'translate' | 'rotate' | 'scale'
      s.transformControls.attach(obj);
      s.gizmoTarget = assetType;
    },
    detachGizmo: () => {
      const s = stateRef.current;
      if (s.transformControls) {
        s.transformControls.detach();
        s.gizmoTarget = null;
      }
    },
    setGizmoChangeCallback: (cb) => {
      stateRef.current.onGizmoChange = cb;
    },
    setGizmoDragEndCallback: (cb) => {
      stateRef.current.onGizmoDragEnd = cb;
    },
    setCameraRotationCallback: (cb) => {
      stateRef.current.onCameraRotation = cb;
    },
    setCameraInfoCallback: (cb) => {
      stateRef.current.onCameraInfo = cb;
    },
    setCameraFromRotation: (rx, ry) => {
      const s = stateRef.current;
      const THREE = s.THREE;
      if (!THREE || !s.camera || !s.controls) return;
      // Reverse the mapping: CSS rotation → spherical
      const phi = (rx + 90) * Math.PI / 180;
      const theta = -ry * Math.PI / 180;
      const offset = new THREE.Vector3().subVectors(s.camera.position, s.controls.target);
      const radius = offset.length();
      const sph = new THREE.Spherical(radius, phi, theta);
      sph.makeSafe();
      offset.setFromSpherical(sph);
      s.camera.position.copy(s.controls.target).add(offset);
      s.camera.lookAt(s.controls.target);
      // Sync OrbitControls internal state — disable damping so update() fully adopts the position
      const savedDamping = s.controls.enableDamping;
      s.controls.enableDamping = false;
      s.controls.update();
      s.controls.enableDamping = savedDamping;
    },
    getAllAssetStats: () => {
      const s = stateRef.current;
      const stats = { glb: 0, colliders: 0, sog: 0 };
      const calcTris = (model) => {
        if (!model) return 0;
        let tris = 0;
        model.traverse((child) => {
          if (child.isMesh && child.geometry) {
            const pos = child.geometry.attributes.position;
            const idx = child.geometry.getIndex();
            tris += idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
          }
        });
        return Math.round(tris);
      };
      if (s.glbModel) stats.glb = calcTris(s.glbModel);
      if (s.collidersModel) stats.colliders = calcTris(s.collidersModel);
      if (s.splatMesh) {
        if (s.splatMesh.splatCount) stats.sog = s.splatMesh.splatCount * 2;
        else if (s.splatMesh.geometry?.attributes?.position) {
          stats.sog = Math.round((s.splatMesh.geometry.attributes.position.count / 4) * 2);
        } else {
          stats.sog = calcTris(s.splatMesh);
        }
      }
      return stats;
    },
    getModelStats: () => {
      const s = stateRef.current;
      if (!s.glbModel) return null;
      let meshCount = 0, totalVertices = 0, totalTriangles = 0;
      let textureCount = 0, maxTexSize = 0, nonPOT = 0;
      const textures = new Set();
      // Compression detection from stored GLTF extensions
      const ext = s.glbModel.userData._extensions || {};
      const innerModel = s.glbModel.getObjectByName('__glb_pivot_wrapper__') ? s.glbModel.children[0] : s.glbModel;
      const extensions = (innerModel?.userData?._extensions) || ext;
      s.glbModel.traverse((child) => {
        if (child.isMesh) {
          meshCount++;
          const geom = child.geometry;
          if (geom) {
            const pos = geom.attributes.position;
            if (pos) totalVertices += pos.count;
            const idx = geom.getIndex();
            totalTriangles += idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
          }
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) {
            for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
              const tex = mat[key];
              if (tex && !textures.has(tex.uuid)) {
                textures.add(tex.uuid);
                textureCount++;
                const w = tex.image?.width || tex.image?.naturalWidth || 0;
                const h = tex.image?.height || tex.image?.naturalHeight || 0;
                const size = Math.max(w, h);
                if (size > maxTexSize) maxTexSize = size;
                if (w && h && ((w & (w - 1)) !== 0 || (h & (h - 1)) !== 0)) nonPOT++;
              }
            }
          }
        }
      });
      return {
        meshCount, totalVertices: Math.round(totalVertices), totalTriangles: Math.round(totalTriangles),
        textureCount, maxTexSize, nonPOT,
        draco: !!extensions.draco, meshopt: !!extensions.meshopt, ktx2: !!extensions.ktx2,
      };
    },
    optimizeModel: async (options, onProgress) => {
      const s = stateRef.current;
      if (!s.glbModel || !s.THREE) return null;
      const { Optimizer } = await import('@/lib/optimizer');
      const opt = new Optimizer(s.THREE);
      const results = {};
      const steps = [];
      if (options.resizeTextures) steps.push('resizeTextures');
      if (options.forcePOT) steps.push('forcePOT');
      if (options.stripGeometry) steps.push('stripGeometry');
      const total = steps.length;
      for (let i = 0; i < steps.length; i++) {
        onProgress?.((i / total) * 100);
        // Yield to let UI update
        await new Promise((r) => setTimeout(r, 50));
        switch (steps[i]) {
          case 'resizeTextures':
            results.resized = opt.resizeTextures(s.glbModel, options.maxTextureSize || 2048);
            break;
          case 'forcePOT':
            results.pot = opt.forcePOT(s.glbModel);
            break;
          case 'stripGeometry':
            results.stripped = opt.stripGeometry(s.glbModel);
            break;
        }
      }
      onProgress?.(100);
      return results;
    },
    analyzeGlbFile: async (file) => {
      const s = stateRef.current;
      const THREE = s.THREE;
      if (!THREE) return null;
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
      const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
      const gltfLoader = new GLTFLoader();
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
      dracoLoader.setDecoderConfig({ type: 'wasm' });
      gltfLoader.setDRACOLoader(dracoLoader);
      gltfLoader.setMeshoptDecoder(MeshoptDecoder);
      if (s.renderer) {
        const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
        const ktx2 = new KTX2Loader();
        ktx2.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/');
        ktx2.detectSupport(s.renderer);
        gltfLoader.setKTX2Loader(ktx2);
      }
      const buffer = await file.arrayBuffer();
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.parse(buffer, '', resolve, reject);
      });
      const model = gltf.scene;
      const extUsed = gltf.parser?.json?.extensionsUsed || [];
      let meshCount = 0, totalVertices = 0, totalTriangles = 0;
      let textureCount = 0, maxTexSize = 0, nonPOT = 0;
      const textures = new Set();
      model.traverse((child) => {
        if (child.isMesh) {
          meshCount++;
          const geom = child.geometry;
          if (geom) {
            const pos = geom.attributes.position;
            if (pos) totalVertices += pos.count;
            const idx = geom.getIndex();
            totalTriangles += idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
          }
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) {
            for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
              const tex = mat[key];
              if (tex && !textures.has(tex.uuid)) {
                textures.add(tex.uuid);
                textureCount++;
                const w = tex.image?.width || tex.image?.naturalWidth || 0;
                const h = tex.image?.height || tex.image?.naturalHeight || 0;
                if (Math.max(w, h) > maxTexSize) maxTexSize = Math.max(w, h);
                if (w && h && ((w & (w - 1)) !== 0 || (h & (h - 1)) !== 0)) nonPOT++;
              }
            }
          }
        }
      });
      dracoLoader.dispose();
      // Dispose parsed model (we only needed stats)
      model.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => m.dispose());
        }
      });
      return {
        meshCount, totalVertices: Math.round(totalVertices), totalTriangles: Math.round(totalTriangles),
        textureCount, maxTexSize, nonPOT,
        draco: extUsed.includes('KHR_draco_mesh_compression'),
        meshopt: extUsed.includes('EXT_meshopt_compression'),
        ktx2: extUsed.includes('KHR_texture_basisu'),
      };
    },
    optimizeAndExportGlb: async (file, options, onProgress) => {
      const s = stateRef.current;
      const THREE = s.THREE;
      if (!THREE) return null;
      onProgress?.(5);
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
      const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const gltfLoader = new GLTFLoader();
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
      dracoLoader.setDecoderConfig({ type: 'wasm' });
      gltfLoader.setDRACOLoader(dracoLoader);
      gltfLoader.setMeshoptDecoder(MeshoptDecoder);
      if (s.renderer) {
        const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
        const ktx2 = new KTX2Loader();
        ktx2.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/');
        ktx2.detectSupport(s.renderer);
        gltfLoader.setKTX2Loader(ktx2);
      }
      onProgress?.(15);
      const buffer = await file.arrayBuffer();
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.parse(buffer, '', resolve, reject);
      });
      onProgress?.(40);
      const model = gltf.scene;
      const { Optimizer } = await import('@/lib/optimizer');
      const opt = new Optimizer(THREE);
      if (options.resizeTextures) {
        opt.resizeTextures(model, options.maxTextureSize || 2048);
      }
      onProgress?.(60);
      if (options.forcePOT) {
        opt.forcePOT(model);
      }
      if (options.stripGeometry) {
        opt.stripGeometry(model);
      }
      onProgress?.(75);
      // Export to GLB
      const exporter = new GLTFExporter();
      const glbBuffer = await exporter.parseAsync(model, { binary: true });
      onProgress?.(95);
      dracoLoader.dispose();
      model.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => m.dispose());
        }
      });
      const optimizedFile = new File([glbBuffer], file.name, { type: 'model/gltf-binary' });
      onProgress?.(100);
      return optimizedFile;
    },
    getGlbModel: () => stateRef.current.glbModel,
    getCollidersModel: () => stateRef.current.collidersModel,
    focusOnCollider: (name, onComplete) => focusCameraOnCollider(name, onComplete),
    setCollidersVisible: (visible) => {
      const s = stateRef.current;
      if (s.collidersModel) {
        s.collidersModel.visible = visible;
      }
    },
    setAssetVisible: (assetType, visible) => {
      const s = stateRef.current;
      const THREE = s.THREE;
      switch (assetType) {
        case 'glb':
          if (s.glbModel) s.glbModel.visible = visible;
          break;
        case 'colliders':
          if (s.collidersModel) s.collidersModel.visible = visible;
          break;
        case 'sog':
          if (s.splatMesh) s.splatMesh.visible = visible;
          break;
        case 'skybox':
          if (s.skyboxMesh) s.skyboxMesh.visible = visible;
          // Also toggle scene.background for HDR
          if (s.scene && THREE) {
            if (visible) {
              // Restore HDR background if we have a raw texture with equirect mapping
              if (s.skyboxRawTexture?.mapping === THREE.EquirectangularReflectionMapping) {
                s.scene.background = s.skyboxRawTexture;
              }
            } else {
              s.scene.background = new THREE.Color(0x08080e);
            }
          }
          break;
        case 'floor':
          if (s.floorMesh) s.floorMesh.visible = visible;
          break;
        case 'mask':
          if (s.maskHelper) s.maskHelper.visible = visible;
          break;
      }
    },
    applyMaterialOverrides: (overrides) => {
      const s = stateRef.current;
      if (!overrides) return;
      // Always store for later (in case GLB reloads)
      s.pendingMaterialOverrides = overrides;
      // Apply immediately if model already loaded
      if (s.glbModel) {
        applyMaterialOverridesToModel(s.glbModel, overrides);
      }
    },
    getRendererInfo: () => {
      const s = stateRef.current;
      if (!s.renderer) return null;
      const gl = s.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        memory: { ...s.renderer.info.memory },
        render: { ...s.renderer.info.render },
        gpuName: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
        qualityProfile: s.qualityProfile?.name || 'unknown',
        adaptiveLevel: s.adaptiveQuality?.currentLevel ?? -1,
        adaptiveLevelName: ['low', 'medium', 'high', 'ultra'][s.adaptiveQuality?.currentLevel] || 'auto',
        adaptiveEnabled: s.adaptiveQuality?.enabled !== false,
      };
    },
    getInstancingStats: () => stateRef.current.instancingStats,
    setAdaptiveQualityEnabled: (enabled) => {
      if (stateRef.current.adaptiveQuality) {
        stateRef.current.adaptiveQuality.enabled = enabled;
      }
    },
    loadGlbWithProgress: (url, _onProgress) => loadGlbModel(url),
    loadGlbProgressive: async (proxyUrl, fullUrl, _onProgress) => {
      // 1. Load proxy GLB immediately (tiny, ~200KB) — instant preview
      if (proxyUrl) {
        await loadGlbModel(proxyUrl);
        const s = stateRef.current;
        if (s.glbModel) {
          s.glbModel.userData._isProxy = true;
          console.log('[Viewer] ⚡ Proxy GLB loaded, loading full model in background...');
        }
      }
      // 2. Load full model in background
      await loadGlbModel(fullUrl);
      const s = stateRef.current;
      if (s.glbModel) {
        s.glbModel.userData._isProxy = false;
        console.log('[Viewer] ✓ Full GLB loaded (proxy swapped)');
      }
    },
    getCameraState: () => {
      const s = stateRef.current;
      const THREE = s.THREE;
      if (!THREE || !s.camera || !s.controls) return null;
      const offset = new THREE.Vector3().subVectors(s.camera.position, s.controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      return {
        pitch: Math.round((90 - (sph.phi * 180 / Math.PI)) * 10) / 10,
        yaw: Math.round(-(sph.theta * 180 / Math.PI) * 10) / 10,
        zoom: Math.round(sph.radius * 100) / 100,
      };
    },
    setInitialCameraPosition: (initialCamera) => {
      const s = stateRef.current;
      const THREE = s.THREE;
      if (!THREE || !s.camera || !s.controls || !initialCamera) return;
      // Convert pitch/yaw/zoom back to spherical
      const phi = (90 - initialCamera.pitch) * DEG2RAD;
      const theta = -initialCamera.yaw * DEG2RAD;
      const radius = initialCamera.zoom;
      const sph = new THREE.Spherical(radius, phi, theta);
      sph.makeSafe();
      s.focusTarget.targetPhi = sph.phi;
      s.focusTarget.targetTheta = sph.theta;
      s.focusTarget.targetRadius = sph.radius;
      s.focusTarget.onComplete = null;
      s.focusTarget.lerpOverride = 0.08;
      s.focusTarget.state = 'animating';
    },
  }));

  /* ─── Orbit Controls Application ─── */
  const applyOrbitToControls = useCallback((orbit) => {
    const s = stateRef.current;
    if (!s.controls || !orbit) return;

    // Always store the latest orbit for re-application after GLB loads
    s.pendingOrbit = orbit;

    // Reset pitch snap state when orbit settings change
    s.pitchSnap.state = 'idle';
    // Reset click zoom state when orbit settings change
    s.clickZoom.state = 'idle';
    s.controls.enableRotate = true;
    s.controls.enablePan = true;
    s.controls.enableZoom = true;

    // Orbit target — use GLB model center if available, otherwise scene origin
    if (s.glbCenter) {
      s.controls.target.copy(s.glbCenter);
    }

    // Zoom / distance limits
    s.controls.minDistance = orbit.zoomMin ?? 0.5;
    s.controls.maxDistance = orbit.zoomMax ?? Infinity;

    // Pitch (vertical angle) — OrbitControls uses polar angle (0 = top, PI = bottom)
    // pitchMax=90° → looking from top → minPolarAngle = 0°
    // pitchMin=-90° → looking from bottom → maxPolarAngle = 180°
    const pitchMin = orbit.pitchMin ?? -90;
    const pitchMax = orbit.pitchMax ?? 90;
    s.controls.minPolarAngle = HALF_PI - (pitchMax * DEG2RAD);
    s.controls.maxPolarAngle = HALF_PI - (pitchMin * DEG2RAD);

    // Yaw (horizontal angle) — OrbitControls uses azimuthal angle
    const yawMin = orbit.yawMin ?? -Infinity;
    const yawMax = orbit.yawMax ?? Infinity;
    if (yawMin <= -180 && yawMax >= 180) {
      // Full rotation — no limits
      s.controls.minAzimuthAngle = -Infinity;
      s.controls.maxAzimuthAngle = Infinity;
    } else {
      s.controls.minAzimuthAngle = yawMin * DEG2RAD;
      s.controls.maxAzimuthAngle = yawMax * DEG2RAD;
    }

    s.controls.update();

    // Antialiasing (pixel ratio)
    if (typeof orbit.pixelRatio === 'number' && s.renderer) {
      const clamped = Math.min(Math.max(orbit.pixelRatio, 0.5), window.devicePixelRatio || 2);
      s.renderer.setPixelRatio(clamped);
    }
  }, []);

  /* ─── Spherical Mask Shader Injection ─── */
  const _patchMaterialWithMask = useCallback((s, material) => {
    if (material.userData._maskPatched) return;
    const uniforms = s.maskUniforms;

    material.transparent = true;
    material.depthWrite = false;
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uMaskEnabled = uniforms.uMaskEnabled;
      shader.uniforms.uMaskCenter = uniforms.uMaskCenter;
      shader.uniforms.uMaskRadius = uniforms.uMaskRadius;
      shader.uniforms.uMaskFalloff = uniforms.uMaskFalloff;

      // Inject varying into vertex shader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
varying vec3 vMaskWorldPos;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vMaskWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
      );

      // Inject alpha fade into fragment shader
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
uniform float uMaskEnabled;
uniform vec3 uMaskCenter;
uniform float uMaskRadius;
uniform float uMaskFalloff;
varying vec3 vMaskWorldPos;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
if (uMaskEnabled > 0.5) {
  float maskDist = distance(vMaskWorldPos, uMaskCenter);
  float maskAlpha = 1.0 - smoothstep(uMaskRadius - uMaskFalloff, uMaskRadius, maskDist);
  gl_FragColor.a *= maskAlpha;
  if (gl_FragColor.a < 0.001) discard;
}`
      );
    };
    material.userData._maskPatched = true;
    material.needsUpdate = true;
  }, []);

  /* ─── Transform Application ─── */
  const applyTransformToObject = useCallback(async (type, transforms) => {
    const s = stateRef.current;
    if (!transforms) return;

    // Always store the latest transforms
    s.pendingTransforms[type] = transforms;

    // Helper to apply scale — supports both uniform (number) and per-axis (object)
    const applyScale = (obj, scale) => {
      const clamp = (v) => Math.max(0.01, v ?? 1);
      if (typeof scale === 'object' && scale !== null) {
        obj.scale.set(clamp(scale.x), clamp(scale.y), clamp(scale.z));
      } else if (typeof scale === 'number') {
        obj.scale.setScalar(clamp(scale));
      }
    };

    if (type === 'glb' && s.glbModel) {
      const pos = transforms.position || {};
      s.glbModel.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
      applyScale(s.glbModel, transforms.scale);
      const rot = transforms.rotation || {};
      s.glbModel.rotation.set(
        (rot.x ?? 0) * DEG2RAD,
        (rot.y ?? 0) * DEG2RAD,
        (rot.z ?? 0) * DEG2RAD
      );
    }

    if (type === 'colliders' && s.collidersModel) {
      const pos = transforms.position || {};
      s.collidersModel.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
      applyScale(s.collidersModel, transforms.scale);
      const rot = transforms.rotation || {};
      s.collidersModel.rotation.set(
        (rot.x ?? 0) * DEG2RAD,
        (rot.y ?? 0) * DEG2RAD,
        (rot.z ?? 0) * DEG2RAD
      );
    }

    if (type === 'sog' && s.splatMesh) {
      const pos = transforms.position || {};
      s.splatMesh.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
      applyScale(s.splatMesh, transforms.scale);
      const rot = transforms.rotation || {};
      s.splatMesh.rotation.set(
        (rot.x ?? 0) * DEG2RAD,
        (rot.y ?? 0) * DEG2RAD,
        (rot.z ?? 0) * DEG2RAD
      );
    }

    if (type === 'skybox' && s.skyboxMesh) {
      const THREE = s.THREE;
      const DEG = Math.PI / 180;
      const radius = transforms.radius ?? 400;
      // Scale is handled by render loop (skybox zoom sync), but store baseline
      s.skyboxMesh.scale.setScalar(radius / 400);

      // Position offset is applied in the render loop on top of orbit target

      // Rotation
      const rot = transforms.rotation ?? {};
      s.skyboxMesh.rotation.set(
        (rot.x ?? 0) * DEG,
        (rot.y ?? 0) * DEG,
        (rot.z ?? 0) * DEG
      );

      // Debounced blur to avoid excessive canvas redraws during slider drag
      if (typeof transforms.blur === 'number' && s.skyboxRawTexture) {
        clearTimeout(s._skyboxBlurTimer);
        s._skyboxBlurTimer = setTimeout(async () => {
          const { blurTexture } = await import('@/lib/utils');
          const blurred = blurTexture(THREE, s.skyboxRawTexture, transforms.blur);
          if (s.skyboxMesh.material.map) s.skyboxMesh.material.map.dispose();
          s.skyboxMesh.material.color.set(0xffffff);
          s.skyboxMesh.material.map = blurred;
          s.skyboxMesh.material.needsUpdate = true;
        }, 80);
      }
    }

    if (type === 'floor' && s.floorMesh) {
      const THREE = s.THREE;
      const pos = transforms.position || {};
      s.floorMesh.position.set(pos.x ?? 0, pos.y ?? -0.5, pos.z ?? 0);
      s.floorMesh.scale.setScalar((transforms.scale ?? 1050) / 800);
      const rotY = (transforms.rotation ?? 0) * (Math.PI / 180);
      s.floorMesh.rotation.set(-Math.PI / 2, 0, rotY);

      if (typeof transforms.blur === 'number' && s.floorRawTexture) {
        const { blurTexture } = await import('@/lib/utils');
        const blurred = blurTexture(THREE, s.floorRawTexture, transforms.blur);
        if (s.floorMesh.material.map) s.floorMesh.material.map.dispose();
        s.floorMesh.material.color.set(0xffffff);
        s.floorMesh.material.map = blurred;
        s.floorMesh.material.needsUpdate = true;
      }
    }

    if (type === 'mask') {
      const THREE = s.THREE;
      const pos = transforms.position || {};
      const enabled = transforms.enabled !== false;
      const radius = transforms.radius ?? 50;
      const falloff = transforms.falloff ?? 10;

      // Update shared uniforms — these are referenced by floor shader
      s.maskUniforms.uMaskEnabled.value = enabled ? 1.0 : 0.0;
      s.maskUniforms.uMaskCenter.value.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
      s.maskUniforms.uMaskRadius.value = radius;
      s.maskUniforms.uMaskFalloff.value = falloff;

      // Update wireframe helper
      if (s.maskHelper) {
        s.maskHelper.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
        // Recreate sphere geometry if radius changed
        const currentRadius = s.maskHelper.geometry.parameters?.radius;
        if (currentRadius !== radius) {
          s.maskHelper.geometry.dispose();
          s.maskHelper.geometry = new THREE.SphereGeometry(radius, 32, 16);
        }
        s.maskHelper.visible = false;
      }

      // Apply shader injection to floor material if not yet patched
      if (s.floorMesh && !s.floorMesh.material.userData._maskPatched) {
        _patchMaterialWithMask(s, s.floorMesh.material);
      }
    }
  }, []);

  /* ─── GLB Loading ─── */
  const loadGlbModel = useCallback(async (url, settings) => {
    const s = stateRef.current;
    const THREE = s.THREE;
    if (!THREE || !url) return;

    // Merge passed settings with stored settings
    const glbCfg = { ...s.glbSettings, ...settings };

    // Remove previous
    removeGlb();

    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
      const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
      const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');

      const gltfLoader = new GLTFLoader();

      // Draco
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
      dracoLoader.setDecoderConfig({ type: 'wasm' });
      gltfLoader.setDRACOLoader(dracoLoader);

      // MeshOpt
      gltfLoader.setMeshoptDecoder(MeshoptDecoder);

      // KTX2
      if (s.renderer) {
        const ktx2Loader = new KTX2Loader();
        ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/');
        ktx2Loader.detectSupport(s.renderer);
        gltfLoader.setKTX2Loader(ktx2Loader);
      }

      console.log('[Viewer] Loading GLB:', url);

      // Fetch as ArrayBuffer to bypass COEP restrictions on cross-origin URLs
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();

      // Parse the buffer instead of loading from URL
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.parse(buffer, '', resolve, reject);
      });

      const model = gltf.scene;
      model.userData._loaded = true;

      // Store GLTF extension info for compression detection
      const extUsed = gltf.parser?.json?.extensionsUsed || [];
      model.userData._extensions = {
        draco: extUsed.includes('KHR_draco_mesh_compression'),
        meshopt: extUsed.includes('EXT_meshopt_compression'),
        ktx2: extUsed.includes('KHR_texture_basisu'),
      };

      // Disable shadows (splat-optimized) and set render order so GLB
      // always draws BEFORE the SOG splat (which composites on top).
      // Transparent materials (glass, railings) need special handling:
      //   - Opaque meshes:      renderOrder = -2 (draw first)
      //   - Transparent meshes:  renderOrder = -1, depthWrite = false
      //     (draw after opaques, before SOG, with correct alpha blending)
      model.renderOrder = -2;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
          child.frustumCulled = true;

          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];

          // Detect transparency: either already flagged, or glass by name
          const meshName = (child.name || '').toLowerCase();
          const hasTransparent = mats.some((m) => {
            const matName = (m.name || '').toLowerCase();
            const isGlassByName =
              meshName.includes('glass') || matName.includes('glass') ||
              meshName.includes('vidrio') || matName.includes('vidrio');
            return (
              m.transparent ||
              (m.opacity !== undefined && m.opacity < 1) ||
              (m.transmission !== undefined && m.transmission > 0) ||
              isGlassByName
            );
          });

          if (hasTransparent) {
            // Transparent / glass mesh — convert to MeshPhysicalMaterial for realistic reflections
            child.renderOrder = -1;
            const newMats = mats.map((m) => {
              // Preserve original color tint if available
              const origColor = m.color ? m.color.clone() : new THREE.Color(0xffffff);
              const phys = new THREE.MeshPhysicalMaterial({
                color: origColor,
                transparent: true,
                opacity: 1.0,
                roughness: 0.02,
                metalness: 0.0,
                envMapIntensity: 2.5,
                depthWrite: false,
                transmission: 0.6,
                thickness: 0.8,
                ior: 1.52,
                reflectivity: 0.9,
                specularIntensity: 1.0,
                specularColor: new THREE.Color(0xffffff),
                clearcoat: 0.3,
                clearcoatRoughness: 0.0,
                side: m.side,
              });
              // Explicitly set the environment map if available
              if (s.modelEnvMap) {
                phys.envMap = s.modelEnvMap;
              } else if (s.envMap) {
                phys.envMap = s.envMap;
              } else if (s.scene?.environment) {
                phys.envMap = s.scene.environment;
              }
              phys.name = m.name;
              m.dispose();
              return phys;
            });
            child.material = newMats.length === 1 ? newMats[0] : newMats;
            console.log(`[Viewer] Glass material applied: mesh="${child.name}", mat="${newMats.map(m => m.name).join(', ')}"`);
          } else {
            // Opaque mesh — keep original material, env map will provide reflections
            child.renderOrder = -2;
            for (const m of mats) {
              if (m.envMapIntensity !== undefined) {
                m.envMapIntensity = 1.5;
              }
              m.needsUpdate = true;
            }
          }
        }
      });

      // ─── DEBUG: Log all material properties for transparency diagnosis ───
      console.group('[Viewer] GLB Material Debug');
      model.traverse((child) => {
        if (child.isMesh) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            console.log(`  Mesh: "${child.name}" | Material: "${m.name}" | Type: ${m.type}`, {
              transparent: m.transparent,
              opacity: m.opacity,
              alphaTest: m.alphaTest,
              alphaMap: !!m.alphaMap,
              transmission: m.transmission,
              blending: m.blending,
              side: m.side,
              depthWrite: m.depthWrite,
              renderOrder: child.renderOrder,
              color: m.color?.getHexString?.(),
            });
          }
        }
      });
      console.groupEnd();

      // ─── Recenter pivot to bottom-center of bounding box ───
      // Wrap the model in a container so the pivot sits at floor-center.
      // Scaling will grow from the floor plane.
      const bbox = new THREE.Box3().setFromObject(model);
      const center = bbox.getCenter(new THREE.Vector3());
      const pivotOffset = new THREE.Vector3(center.x, bbox.min.y, center.z);

      // Offset the inner model so origin = bottom-center
      model.position.sub(pivotOffset);

      const wrapper = new THREE.Group();
      wrapper.name = '__glb_pivot_wrapper__';
      wrapper.position.copy(pivotOffset);
      wrapper.add(model);

      // Optimize
      if (!s.optimizer) s.optimizer = new Optimizer(THREE);
      await s.optimizer.optimize(wrapper);

      // Re-compute bounding volumes after pivot wrapper applied
      // This is critical for frustum culling to work correctly
      wrapper.traverse((child) => {
        if (child.isMesh && child.geometry) {
          child.geometry.computeBoundingBox();
          child.geometry.computeBoundingSphere();
        }
      });

      // Apply instancing for repeated geometries
      try {
        const { applyInstancing } = await import('@/lib/instancing');
        const instResult = applyInstancing(wrapper, THREE);
        s.instancingStats = instResult;
        if (instResult.drawCallsSaved > 0) {
          console.log(`[Viewer] ✓ Instanced: ${instResult.meshesInstanced} meshes → ${instResult.groupsCreated} groups (saved ${instResult.drawCallsSaved} draw calls)`);
        }
      } catch (instErr) {
        console.warn('[Viewer] Instancing skipped:', instErr.message);
      }

      s.scene.add(wrapper);
      s.glbModel = wrapper;

      // Apply pending transforms if they exist
      if (s.pendingTransforms.glb) {
        applyTransformToObject('glb', s.pendingTransforms.glb);
      }

      // Apply pending material overrides if they exist
      if (s.pendingMaterialOverrides) {
        applyMaterialOverridesToModel(model, s.pendingMaterialOverrides);
      }

      // Fit camera
      fitCamera(model);

      // ─── GLB Reveal Animation ───
      const revealMode = glbCfg.revealType || 'none';
      const revealDuration = glbCfg.revealDuration ?? 2;
      const revealEasing = glbCfg.revealEasing || 'easeOut';

      if (revealMode !== 'none' && revealDuration > 0) {
        // Use world bounding box for Y range
        const worldBox = new THREE.Box3().setFromObject(wrapper);
        const minY = worldBox.min.y;
        const maxY = worldBox.max.y;
        const range = maxY - minY;

        if (revealMode === 'clip') {
          const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), minY);
          wrapper.traverse((child) => {
            if (child.isMesh) {
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              for (const m of mats) {
                m.clippingPlanes = [plane];
                m.clipShadows = true;
                m.needsUpdate = true;
              }
            }
          });
          s.glbReveal = {
            active: true,
            startTime: performance.now(),
            duration: revealDuration,
            easing: revealEasing,
            mode: 'clip',
            minY,
            maxY,
            range,
            clippingPlane: plane,
            materials: [],
          };
        } else if (revealMode === 'dissolve') {
          const revealMats = [];
          wrapper.traverse((child) => {
            if (child.isMesh) {
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              for (const m of mats) {
                m.userData._origOnBeforeCompile = m.onBeforeCompile;
                m.onBeforeCompile = (shader) => {
                  shader.uniforms.uRevealY = { value: minY };
                  shader.uniforms.uRevealEdge = { value: range * 0.08 };

                  shader.vertexShader = shader.vertexShader.replace(
                    '#include <clipping_planes_pars_vertex>',
                    `#include <clipping_planes_pars_vertex>
                    varying vec3 vRevealWorldPos;
                    `
                  );
                  shader.vertexShader = shader.vertexShader.replace(
                    '#include <worldpos_vertex>',
                    `#include <worldpos_vertex>
                    vRevealWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
                    `
                  );

                  shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <clipping_planes_pars_fragment>',
                    `#include <clipping_planes_pars_fragment>
                    varying vec3 vRevealWorldPos;
                    uniform float uRevealY;
                    uniform float uRevealEdge;
                    float revealHash(vec3 p) {
                      p = fract(p * vec3(443.8975, 397.2973, 491.1871));
                      p += dot(p, p.yxz + 19.19);
                      return fract((p.x + p.y) * p.z);
                    }
                    `
                  );
                  shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <clipping_planes_fragment>',
                    `#include <clipping_planes_fragment>
                    {
                      float edgeNoise = revealHash(vRevealWorldPos * 8.0) * uRevealEdge;
                      if (vRevealWorldPos.y > uRevealY + edgeNoise) discard;
                    }
                    `
                  );
                  m.userData._revealShader = shader;
                };
                m.needsUpdate = true;
                revealMats.push(m);
              }
            }
          });
          s.glbReveal = {
            active: true,
            startTime: performance.now(),
            duration: revealDuration,
            easing: revealEasing,
            mode: 'dissolve',
            minY,
            maxY,
            range,
            clippingPlane: null,
            materials: revealMats,
          };
        }
        console.log(`[Viewer] GLB reveal starting (${revealMode}, ${revealDuration}s, Y=${minY.toFixed(1)}→${maxY.toFixed(1)})`);
      }

      console.log('[Viewer] ✓ GLB loaded');
      dracoLoader.dispose();
    } catch (err) {
      console.error('[Viewer] GLB load failed:', err);
    }
  }, []);

  /* ─── Colliders Loading ─── */
  const loadCollidersModel = useCallback(async (url) => {
    const s = stateRef.current;
    const THREE = s.THREE;
    if (!THREE || !url) return;

    removeColliders();

    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');

      const gltfLoader = new GLTFLoader();
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
      dracoLoader.setDecoderConfig({ type: 'wasm' });
      gltfLoader.setDRACOLoader(dracoLoader);

      console.log('[Viewer] Loading Colliders:', url);

      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();

      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.parse(buffer, '', resolve, reject);
      });

      const model = gltf.scene;
      
      console.log('[Viewer] Nombres de Collider Meshes:');
      model.traverse((child) => {
        if (child.isMesh) {
          console.log(` - Mesh name: "${child.name}"`);
          child.castShadow = false;
          child.receiveShadow = false;
          child.frustumCulled = false;
        }
      });

      s.scene.add(model);
      s.collidersModel = model;

      // Apply pending transforms if they exist
      if (s.pendingTransforms.colliders) {
        applyTransformToObject('colliders', s.pendingTransforms.colliders);
      }

      console.log('[Viewer] ✓ Colliders loaded');
      dracoLoader.dispose();
    } catch (err) {
      console.error('[Viewer] Colliders load failed:', err);
    }
  }, []);

  /* ─── SOG Loading ─── */
  const loadSogModel = useCallback(async (url, settings) => {
    const s = stateRef.current;
    if (!s.THREE || !url) return;

    // Merge passed settings with stored settings
    const cfg = { ...s.splatSettings, ...settings };

    // Skip SOG on mobile — too heavy for constrained VRAM
    if (s.qualityProfile && !s.qualityProfile.enableSplats) {
      console.log('[Viewer] SOG skipped (mobile quality profile — enableSplats=false)');
      return;
    }

    removeSog();

    try {
      const spark = await import('@sparkjsdev/spark');
      const { SparkRenderer, SplatMesh } = spark;
      const { DynoFloat, dynoBlock, splitGsplat, combineGsplat, mul, mix, min, vec3, split: splitVec, Gsplat, length: dynoLength, smoothstep, sub, dynoConst } = spark.dyno;

      // Ensure SparkRenderer exists in the scene (required by Spark 2.0)
      if (!s.sparkRenderer) {
        const sparkR = new SparkRenderer({ renderer: s.renderer });
        s.scene.add(sparkR);
        s.sparkRenderer = sparkR;
        console.log('[Viewer] SparkRenderer created (Spark 2.0)');
      }

      console.log('[Viewer] Loading SOG:', url);

      // Prefetch bytes for streaming progress
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) throw new Error('Received HTML instead of SOG');

      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Validate SOG magic bytes (ZIP: PK\x03\x04)
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
        throw new Error('Invalid SOG file (not a ZIP container)');
      }

      const useLod = cfg.lod !== false;
      const useExtSplats = cfg.extSplats !== undefined
        ? cfg.extSplats
        : (s.qualityProfile?.enableExtSplats !== false);

      // Animation config
      const animType = cfg.animationType || 'radialReveal';
      const animDuration = cfg.animationDuration ?? 2.5;
      const animEasing = cfg.animationEasing || 'easeOut';
      const wantAnim = animType !== 'none' && animDuration > 0;

      // ── Dyno uniforms ──
      // Point→splat animation
      const splatSizeU = new DynoFloat({ value: wantAnim ? 0.01 : 1 });
      const splatShapeU = new DynoFloat({ value: wantAnim ? 0 : 1 });
      // Radial clip mask (independent)
      const wantClip = cfg.radialClip === true;
      const clipRadiusU = new DynoFloat({ value: wantClip ? 0 : 99999 });
      const clipEdgeU = new DynoFloat({ value: 0.5 });

      // Dyno modifier: point→splat + radial clip
      const splatModifier = dynoBlock(
        { gsplat: Gsplat },
        { gsplat: Gsplat },
        ({ gsplat }) => {
          const { scales, center, opacity } = splitGsplat(gsplat).outputs;

          // ── Point → Splat (size + shape) ──
          const { x: sx, y: sy, z: sz } = splitVec(scales).outputs;
          const minAxis = min(min(sx, sy), sz);
          const shaped = mix(vec3(minAxis), scales, splatShapeU);
          const sized = mul(shaped, splatSizeU);

          // ── Radial clip mask ──
          const dist = dynoLength(center);
          const fadeStart = sub(clipRadiusU, clipEdgeU);
          const clipFactor = sub(dynoConst('float', 1), smoothstep(fadeStart, clipRadiusU, dist));
          const clippedOpacity = mul(opacity, clipFactor);

          return { gsplat: combineGsplat({ gsplat, scales: sized, opacity: clippedOpacity }) };
        }
      );

      // Radial clip config (independent from point→splat)
      const clipDuration = cfg.radialClipDuration ?? cfg.animationDuration ?? 2.5;
      const clipEasing = cfg.radialClipEasing ?? cfg.animationEasing ?? 'easeOut';

      const splatMesh = new SplatMesh({
        fileBytes: bytes.buffer,
        fileName: 'splat.sog',
        lod: useLod,
        extSplats: useExtSplats,
        objectModifier: splatModifier,
        onLoad: () => {
          console.log(`[Viewer] ✓ SOG splat loaded (LoD=${useLod}, ExtSplats=${useExtSplats})`);

          // Estimate max radius by sampling splat centers
          let maxRadius = 10;
          try {
            const mesh = s.splatMesh;
            const splats = mesh?.packedSplats || mesh?.extSplats;
            if (splats && typeof splats.getNumSplats === 'function' && typeof splats.getSplat === 'function') {
              const ns = splats.getNumSplats();
              const step = Math.max(1, Math.floor(ns / 3000));
              let maxDist2 = 0;
              for (let i = 0; i < ns; i += step) {
                const sp = splats.getSplat(i);
                const c = sp?.center;
                if (c) {
                  const d2 = c.x * c.x + c.y * c.y + c.z * c.z;
                  if (d2 > maxDist2) maxDist2 = d2;
                }
              }
              if (maxDist2 > 0) maxRadius = Math.sqrt(maxDist2) * 1.15;
            }
          } catch (_) { /* fallback stays 10 */ }

          // Point→splat animation
          if (wantAnim) {
            s.splatFade = {
              active: true,
              startTime: performance.now(),
              duration: animDuration,
              easing: animEasing,
              splatSizeU,
              splatShapeU,
            };
            console.log(`[Viewer] Splat point→splat starting (${animDuration}s)`);
          }

          // Radial clip animation (independent)
          if (wantClip) {
            s.splatClip = {
              active: true,
              startTime: performance.now(),
              duration: clipDuration,
              easing: clipEasing,
              clipRadiusU,
              clipEdgeU,
              maxRadius,
            };
            console.log(`[Viewer] Splat radial clip starting (${clipDuration}s, maxR=${maxRadius.toFixed(2)})`);
          }
        },
      });

      // Store uniform references on stateRef
      s.splatSizeU = splatSizeU;
      s.splatShapeU = splatShapeU;
      s.clipRadiusU = clipRadiusU;
      s.clipEdgeU = clipEdgeU;

      // Hide immediately before first render if any animation
      if (wantAnim || wantClip) {
        splatMesh.opacity = 0;
      }

      // Render SOG after GLB so it composites on top
      splatMesh.renderOrder = 10;
      s.scene.add(splatMesh);
      s.splatMesh = splatMesh;

      // Apply pending transforms if they exist
      if (s.pendingTransforms.sog) {
        applyTransformToObject('sog', s.pendingTransforms.sog);
      }
    } catch (err) {
      console.error('[Viewer] SOG load failed:', err);
    }
  }, []);

  /* ─── Skybox Texture ─── */
  const loadSkyboxTexture = useCallback(async (url) => {
    const s = stateRef.current;
    const THREE = s.THREE;
    if (!THREE || !url) return;

    try {
      // Detect HDR by URL extension (before query params)
      const isHDR = /\.hdr(\?|$)/i.test(url);

      let tex;
      let envSourceTex;

      if (isHDR) {
        // ─── HDR via RGBELoader ───
        const { RGBELoader } = await import('three/examples/jsm/loaders/RGBELoader.js');
        const rgbeLoader = new RGBELoader();

        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();

        tex = await new Promise((resolve, reject) => {
          rgbeLoader.parse(buffer, '', (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            resolve(texture);
          }, reject);
        });

        s.skyboxRawTexture = tex;

        // Render HDR on sphere mesh (same as LDR) for zoom parallax support
        if (s.skyboxMesh) {
          s.skyboxMesh.visible = true;
          if (s.skyboxMesh.material.map) s.skyboxMesh.material.map.dispose();
          s.skyboxMesh.material.color.set(0xffffff);
          s.skyboxMesh.material.map = tex;
          s.skyboxMesh.material.needsUpdate = true;
        }
        // Ensure scene.background is dark (sphere mesh provides the visual background)
        s.scene.background = new THREE.Color(0x08080e);

        envSourceTex = tex;
        console.log('[Viewer] ✓ HDR skybox loaded');
      } else {
        // ─── LDR (jpg/png/webp) via Image element ───
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);

        const image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = blobUrl;
        });

        tex = new THREE.Texture(image);
        tex.needsUpdate = true;
        tex.colorSpace = THREE.SRGBColorSpace;
        s.skyboxRawTexture = tex;

        const { blurTexture } = await import('@/lib/utils');
        const blurred = blurTexture(THREE, tex, 0);

        // Show sphere mesh for LDR textures
        if (s.skyboxMesh) {
          s.skyboxMesh.visible = true;
          if (s.skyboxMesh.material.map) s.skyboxMesh.material.map.dispose();
          s.skyboxMesh.material.color.set(0xffffff);
          s.skyboxMesh.material.map = blurred;
          s.skyboxMesh.material.needsUpdate = true;
        }
        // Clear scene.background in case HDR was loaded before
        s.scene.background = new THREE.Color(0x08080e);

        // Create env source texture from the image
        envSourceTex = new THREE.Texture(image);
        envSourceTex.mapping = THREE.EquirectangularReflectionMapping;
        envSourceTex.colorSpace = THREE.SRGBColorSpace;
        envSourceTex.needsUpdate = true;

        URL.revokeObjectURL(blobUrl);
        console.log('[Viewer] ✓ Skybox texture loaded');
      }

      // ─── Generate environment map for PBR reflections (skip on mobile) ───
      if (s.pmremGenerator && s.qualityProfile?.enableEnvMap && envSourceTex) {
        if (s.envMap) {
          s.envMap.dispose();
          s.envMap = null;
        }
        const envRT = s.pmremGenerator.fromEquirectangular(envSourceTex);
        s.envMap = envRT.texture;
        // Only set scene.environment if no model-specific HDRI is loaded
        if (!s.modelEnvMap) {
          s.scene.environment = s.envMap;

          // Update glass/physical materials with the skybox env map
          if (s.glbModel) {
            s.glbModel.traverse((child) => {
              if (!child.isMesh) return;
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              for (const mat of mats) {
                if (mat.isMeshPhysicalMaterial && mat.transmission > 0) {
                  mat.envMap = s.envMap;
                  mat.needsUpdate = true;
                }
              }
            });
          }
        }
        if (!isHDR) envSourceTex.dispose();
        console.log('[Viewer] ✓ Environment map generated for PBR reflections');
      } else if (s.qualityProfile && !s.qualityProfile.enableEnvMap) {
        console.log('[Viewer] Environment map skipped (mobile quality profile)');
      }
    } catch (err) {
      console.error('[Viewer] Skybox texture failed:', err);
    }
  }, []);

  /* ─── Floor Texture ─── */
  const loadFloorTexture = useCallback(async (url) => {
    const s = stateRef.current;
    const THREE = s.THREE;
    if (!THREE || !url) return;

    try {
      // Fetch as blob, then load as HTMLImageElement
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = blobUrl;
      });

      const tex = new THREE.Texture(image);
      tex.needsUpdate = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      s.floorRawTexture = tex;

      const { blurTexture } = await import('@/lib/utils');
      const blurred = blurTexture(THREE, tex, 0);

      if (s.floorMesh) {
        if (s.floorMesh.material.map) s.floorMesh.material.map.dispose();
        s.floorMesh.material.color.set(0xffffff);
        s.floorMesh.material.map = blurred;
        s.floorMesh.material.needsUpdate = true;
      }

      URL.revokeObjectURL(blobUrl);
      console.log('[Viewer] ✓ Floor texture loaded');
    } catch (err) {
      console.error('[Viewer] Floor texture failed:', err);
    }
  }, []);

  /* ─── Remove helpers ─── */
  const removeGlb = useCallback(() => {
    const s = stateRef.current;
    if (s.glbModel) {
      s.scene.remove(s.glbModel);
      disposeObject(s.glbModel);
      s.glbModel = null;
    }
  }, []);

  const removeColliders = useCallback(() => {
    const s = stateRef.current;
    if (s.collidersModel) {
      s.scene.remove(s.collidersModel);
      disposeObject(s.collidersModel);
      s.collidersModel = null;
    }
  }, []);

  const removeSog = useCallback(() => {
    const s = stateRef.current;
    if (s.splatMesh) {
      s.scene.remove(s.splatMesh);
      if (s.splatMesh.dispose) s.splatMesh.dispose();
      s.splatMesh = null;
    }
  }, []);

  const removeSkyboxTex = useCallback(() => {
    const s = stateRef.current;
    const THREE = s.THREE;
    if (s.skyboxMesh?.material?.map) {
      s.skyboxMesh.material.map.dispose();
      s.skyboxMesh.material.map = null;
      s.skyboxMesh.material.needsUpdate = true;
    }
    // Restore sphere mesh visibility and default background
    if (s.skyboxMesh) s.skyboxMesh.visible = true;
    if (s.scene && THREE) s.scene.background = new THREE.Color(0x08080e);
    // Remove skybox environment map
    if (s.envMap) {
      s.envMap.dispose();
      s.envMap = null;
      // Only clear scene.environment if no model-specific HDRI
      if (!s.modelEnvMap) {
        s.scene.environment = null;
      }
    }
    s.skyboxRawTexture = null;
  }, []);

  const removeFloorTex = useCallback(() => {
    const s = stateRef.current;
    if (s.floorMesh?.material?.map) {
      s.floorMesh.material.map.dispose();
      s.floorMesh.material.map = null;
      s.floorMesh.material.needsUpdate = true;
    }
    s.floorRawTexture = null;
  }, []);

  /* ─── Model HDRI (environment map only, separate from skybox) ─── */
  const loadModelHdri = useCallback(async (url) => {
    const s = stateRef.current;
    const THREE = s.THREE;
    if (!THREE || !url) return;

    try {
      const isHDR = /\.hdr(\?|$)/i.test(url);
      let envSourceTex;

      if (isHDR) {
        const { RGBELoader } = await import('three/examples/jsm/loaders/RGBELoader.js');
        const rgbeLoader = new RGBELoader();
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();

        envSourceTex = await new Promise((resolve, reject) => {
          rgbeLoader.parse(buffer, '', (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            resolve(texture);
          }, reject);
        });
      } else {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);

        const image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = blobUrl;
        });

        envSourceTex = new THREE.Texture(image);
        envSourceTex.mapping = THREE.EquirectangularReflectionMapping;
        envSourceTex.colorSpace = THREE.SRGBColorSpace;
        envSourceTex.needsUpdate = true;
        URL.revokeObjectURL(blobUrl);
      }

      // Generate PMREM env map for model reflections
      if (s.pmremGenerator && envSourceTex) {
        if (s.modelEnvMap) {
          s.modelEnvMap.dispose();
          s.modelEnvMap = null;
        }
        const envRT = s.pmremGenerator.fromEquirectangular(envSourceTex);
        s.modelEnvMap = envRT.texture;
        s.scene.environment = s.modelEnvMap;
        if (!isHDR) envSourceTex.dispose();

        // Update all glass/physical materials with the new env map
        if (s.glbModel) {
          s.glbModel.traverse((child) => {
            if (!child.isMesh) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
              if (mat.isMeshPhysicalMaterial && mat.transmission > 0) {
                mat.envMap = s.modelEnvMap;
                mat.needsUpdate = true;
              }
            }
          });
        }
        console.log('[Viewer] ✓ Model HDRI environment map loaded');
      }
    } catch (err) {
      console.error('[Viewer] Model HDRI failed:', err);
    }
  }, []);

  const removeModelHdri = useCallback(() => {
    const s = stateRef.current;
    if (s.modelEnvMap) {
      s.modelEnvMap.dispose();
      s.modelEnvMap = null;
    }
    // Fall back to skybox env map if available, otherwise clear
    if (s.envMap) {
      s.scene.environment = s.envMap;
    } else {
      s.scene.environment = null;
    }
    console.log('[Viewer] Model HDRI removed');
  }, []);

  /* ─── Focus Camera on Collider ─── */
  const focusCameraOnCollider = useCallback((name, onComplete) => {
    const s = stateRef.current;
    const THREE = s.THREE;
    if (!THREE || !s.collidersModel || !s.camera || !s.controls) return;

    const sanitizedName = name.replace(/-/g, '').toLowerCase();

    let targetMesh = null;
    s.collidersModel.traverse((child) => {
      if (child.isMesh) {
        const meshName = (child.name || '').replace(/-/g, '').toLowerCase();
        if (meshName === sanitizedName) {
          targetMesh = child;
        }
      }
    });

    if (!targetMesh) {
      console.warn(`[Viewer] Collider mesh "${name}" not found`);
      return;
    }

    const box = new THREE.Box3().setFromObject(targetMesh);
    const colliderCenter = new THREE.Vector3();
    box.getCenter(colliderCenter);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Orbit target stays on the GLB model center
    const orbitTarget = s.glbCenter ? s.glbCenter.clone() : s.controls.target.clone();

    // Compute the desired camera position in spherical coordinates relative to orbit target
    // Direction: from orbit target toward the collider
    const dir = new THREE.Vector3().subVectors(colliderCenter, orbitTarget);
    if (dir.lengthSq() < 0.001) {
      dir.copy(new THREE.Vector3().subVectors(s.camera.position, orbitTarget));
    }

    const desiredRadius = dir.length() + maxDim * 2.5 + 2.0;
    const sph = new THREE.Spherical().setFromVector3(dir);

    // Clamp phi (polar / pitch) to orbit limits
    sph.phi = THREE.MathUtils.clamp(
      sph.phi,
      s.controls.minPolarAngle,
      s.controls.maxPolarAngle
    );

    // Clamp theta (azimuthal / yaw) to orbit limits
    if (isFinite(s.controls.minAzimuthAngle) && isFinite(s.controls.maxAzimuthAngle)) {
      sph.theta = THREE.MathUtils.clamp(
        sph.theta,
        s.controls.minAzimuthAngle,
        s.controls.maxAzimuthAngle
      );
    }

    // Clamp radius to orbit zoom limits
    sph.radius = THREE.MathUtils.clamp(
      desiredRadius,
      s.controls.minDistance,
      s.controls.maxDistance
    );

    sph.makeSafe();

    s.focusTarget.targetPhi = sph.phi;
    s.focusTarget.targetTheta = sph.theta;
    s.focusTarget.targetRadius = sph.radius;
    s.focusTarget.onComplete = onComplete || null;
    s.focusTarget.state = 'animating';
  }, []);

  /* ─── Fit Camera ─── */
  const fitCamera = useCallback((object) => {
    const s = stateRef.current;
    const THREE = s.THREE;
    if (!THREE) return;

    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = s.camera.fov * DEG2RAD;
    let dist = maxDim / (2 * Math.tan(fov / 2));
    dist *= 1.5;

    // Store GLB center as the orbit target
    s.glbCenter = center.clone();
    console.log('[Viewer] GLB center (orbit target):', center.x.toFixed(2), center.y.toFixed(2), center.z.toFixed(2));

    s.camera.position.copy(center);
    s.camera.position.x += dist * 0.6;
    s.camera.position.y += dist * 0.4;
    s.camera.position.z += dist * 0.8;
    s.camera.lookAt(center);
    s.controls.target.copy(center);
    s.controls.update();

    // Re-apply pending orbit settings now that we have the GLB center
    if (s.pendingOrbit) {
      applyOrbitToControls(s.pendingOrbit);
    }
  }, [applyOrbitToControls]);

  /* ─── Initialize Three.js ─── */
  useEffect(() => {
    let mounted = true;

    async function init() {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      const { TransformControls } = await import('three/examples/jsm/controls/TransformControls.js');

      if (!mounted || !containerRef.current) return;

      const s = stateRef.current;
      s.THREE = THREE;
      s.clock = new THREE.Clock();

      const container = containerRef.current;
      const gpu = detectGPU();
      const quality = getQualityProfile();
      s.qualityProfile = quality;

      // ─── Renderer (optimized for splats, adaptive quality) ───
      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        logarithmicDepthBuffer: false,
        powerPreference: 'high-performance',
        alpha: false,
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(quality.pixelRatio);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.shadowMap.enabled = false;
      renderer.localClippingEnabled = true;
      container.appendChild(renderer.domElement);
      s.renderer = renderer;

      // ─── PMREM Generator (skip on mobile to save VRAM) ───
      if (quality.enablePMREM) {
        s.pmremGenerator = new THREE.PMREMGenerator(renderer);
        s.pmremGenerator.compileEquirectangularShader();
      } else {
        s.pmremGenerator = null;
        console.log('[Viewer] PMREM disabled (mobile quality profile)');
      }

      // ─── Scene ───
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x08080e);
      s.scene = scene;

      // ─── Camera ───
      const aspect = container.clientWidth / container.clientHeight;
      const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, quality.cameraFar);
      camera.position.set(3, 2, 5);
      s.camera = camera;

      // ─── WebGL Context Loss Recovery ───
      renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        console.error('[Viewer] WebGL context lost! Stopping render loop.');
        if (s.animationId) {
          cancelAnimationFrame(s.animationId);
          s.animationId = null;
        }
      });
      renderer.domElement.addEventListener('webglcontextrestored', () => {
        console.log('[Viewer] WebGL context restored, restarting render loop.');
        function tick() {
          s.animationId = requestAnimationFrame(tick);
          const gizmoDragging = s.transformControls?.dragging;
          if (!gizmoDragging) {
            s.controls?.update();
            handlePitchSnap(s);
            handleClickZoom(s);
            handleFocusAnimation(s);
          }
          syncCameraRotation(s);
          // ─── Skybox Zoom Sync ───
          if (s.skyboxMesh && s.controls && s.camera) {
            const _d = Math.max(0.5, s.camera.position.distanceTo(s.controls.target));
            const _br = s.pendingTransforms?.skybox?.radius ?? 400;
            const _zf = Math.pow(_d / 20, 0.6);
            const _maxScale = (s.camera.far * 0.8) / 400;
            const _minScale = (_d * 2.5) / 400;
            const _rawScale = Math.max((_br / 400) * Math.max(0.15, _zf), _minScale);
            s.skyboxMesh.scale.setScalar(Math.min(_rawScale, _maxScale));
            const _blendT = Math.min(1, Math.max(0, (_d - 30) / 120));
            const _sp = s.pendingTransforms?.skybox?.position;
            const _bx = s.controls.target.x + (_sp?.x ?? 0);
            const _by = s.controls.target.y + (_sp?.y ?? 0);
            const _bz = s.controls.target.z + (_sp?.z ?? 0);
            s.skyboxMesh.position.set(
              _bx + (s.camera.position.x - _bx) * _blendT,
              _by + (s.camera.position.y - _by) * _blendT,
              _bz + (s.camera.position.z - _bz) * _blendT
            );
          }
          s.renderer?.render(s.scene, s.camera);
        }
        tick();
      });

      // ─── Controls ───
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.5;
      controls.maxDistance = Infinity;
      controls.target.set(0, 0, 0);
      s.controls = controls;

      // Cancel any pending camera animation when user starts orbiting
      controls.addEventListener('start', () => {
        if (s.focusTarget.state !== 'idle') {
          s.focusTarget.state = 'idle';
          s.focusTarget.lerpOverride = null;
        }
      });

      // ─── Transform Gizmo ───
      const tc = new TransformControls(camera, renderer.domElement);
      tc.setSize(0.8);
      let gizmoDragBefore = null;
      tc.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
        const obj = tc.object;
        if (!obj || !s.gizmoTarget) return;
        const RAD2DEG = 180 / Math.PI;
        if (event.value) {
          // Cancel any pending camera animation
          s.focusTarget.state = 'idle';
          s.focusTarget.lerpOverride = null;
          // Drag started — capture "before" state
          gizmoDragBefore = {
            position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
            scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
            rotation: { x: obj.rotation.x * RAD2DEG, y: obj.rotation.y * RAD2DEG, z: obj.rotation.z * RAD2DEG },
          };
        } else {
          // Drag ended — fire callback with before/after
          if (gizmoDragBefore && s.onGizmoDragEnd) {
            const after = {
              position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
              scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
              rotation: { x: obj.rotation.x * RAD2DEG, y: obj.rotation.y * RAD2DEG, z: obj.rotation.z * RAD2DEG },
            };
            s.onGizmoDragEnd(s.gizmoTarget, gizmoDragBefore, after);
            gizmoDragBefore = null;
          }
        }
      });
      tc.addEventListener('objectChange', () => {
        const obj = tc.object;
        if (!obj || !s.onGizmoChange || !s.gizmoTarget) return;
        const RAD2DEG = 180 / Math.PI;

        // Dampen scale: reduce sensitivity to 25% of default
        if (tc.mode === 'scale' && gizmoDragBefore) {
          const bs = gizmoDragBefore.scale;
          const damp = 0.08;
          obj.scale.x = Math.max(0.01, bs.x + (obj.scale.x - bs.x) * damp);
          obj.scale.y = Math.max(0.01, bs.y + (obj.scale.y - bs.y) * damp);
          obj.scale.z = Math.max(0.01, bs.z + (obj.scale.z - bs.z) * damp);
        }

        s.onGizmoChange(s.gizmoTarget, {
          position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
          scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
          rotation: { x: obj.rotation.x * RAD2DEG, y: obj.rotation.y * RAD2DEG, z: obj.rotation.z * RAD2DEG },
        });
      });
      scene.add(tc.getHelper());
      s.transformControls = tc;

      // ─── Click Zoom — press to zoom in, release to zoom out ───
      const _czOnDown = () => onCanvasPointerDown(s);
      const _czOnUp = () => onCanvasPointerUp(s);
      renderer.domElement.addEventListener('pointerdown', _czOnDown);
      renderer.domElement.addEventListener('pointerup', _czOnUp);
      // Also handle pointer leaving the canvas while pressed
      renderer.domElement.addEventListener('pointerleave', _czOnUp);
      s._clickZoomCleanup = () => {
        renderer.domElement.removeEventListener('pointerdown', _czOnDown);
        renderer.domElement.removeEventListener('pointerup', _czOnUp);
        renderer.domElement.removeEventListener('pointerleave', _czOnUp);
      };

      // ─── Lighting (minimal — HDRI env map provides reflections) ───
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);
      s.ambientLight = ambientLight;

      // ─── Default Skybox Sphere ───
      const skyGeo = new THREE.SphereGeometry(400, quality.skyboxSegments[0], quality.skyboxSegments[1]);
      const skyMat = new THREE.MeshBasicMaterial({
        color: 0x111122,
        side: THREE.BackSide,
        depthWrite: false,
      });
      const skybox = new THREE.Mesh(skyGeo, skyMat);
      skybox.renderOrder = -1;
      scene.add(skybox);
      s.skyboxMesh = skybox;

      // ─── Default Floor Plane ───
      const floorGeo = new THREE.PlaneGeometry(800, 800);
      const floorMat = new THREE.MeshBasicMaterial({
        color: 0x1a1a2e,
        side: THREE.DoubleSide,
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, -0.5, 0);
      floor.renderOrder = -1;
      scene.add(floor);
      s.floorMesh = floor;

      // ─── Spherical Mask Helper (wireframe) ───
      s.maskUniforms.uMaskCenter.value = new THREE.Vector3(0, 0, 0);
      const maskGeo = new THREE.SphereGeometry(50, 32, 16);
      const maskMat = new THREE.MeshBasicMaterial({
        color: 0x00ccff,
        wireframe: true,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      });
      const maskHelper = new THREE.Mesh(maskGeo, maskMat);
      maskHelper.visible = false;
      maskHelper.renderOrder = 100;
      scene.add(maskHelper);
      s.maskHelper = maskHelper;

      // Patch floor material with mask shader
      _patchMaterialWithMask(s, floorMat);

      // ─── Tint Overlay Quad (depth-masked, excludes GLB) ───
      // The GLB writes to the depth buffer; skybox, floor and SOG don’t.
      // By rendering a fullscreen quad at depth 0.9999 with depthTest=true,
      // the quad is rejected wherever the GLB wrote closer depth values,
      // effectively masking the tint off the maqueta.
      const tintGeo = new THREE.PlaneGeometry(2, 2);
      const tintMat = new THREE.ShaderMaterial({
        uniforms: {
          uTintColor: { value: new THREE.Color(0x000000) },
          uTintOpacity: { value: 0.0 },
        },
        vertexShader: `
          void main() {
            // Render in clip-space at z=0.9999 (near far plane)
            gl_Position = vec4(position.xy, 0.9999, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uTintColor;
          uniform float uTintOpacity;
          void main() {
            gl_FragColor = vec4(uTintColor, uTintOpacity);
          }
        `,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });
      const tintQuad = new THREE.Mesh(tintGeo, tintMat);
      tintQuad.frustumCulled = false;
      tintQuad.renderOrder = 999;
      tintQuad.visible = false;
      scene.add(tintQuad);
      s.tintMesh = tintQuad;

      // ─── Resize ───
      const resizeObserver = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
      resizeObserver.observe(container);

      // ─── Initialize adaptive quality baseline ───
      s.adaptiveQuality.originalPixelRatio = quality.pixelRatio;
      s.adaptiveQuality.originalAnisotropy = quality.anisotropy;
      // Auto-detect initial level from quality profile
      const levelMap = { ultra: 3, high: 2, medium: 1, low: 0 };
      s.adaptiveQuality.currentLevel = levelMap[quality.name] ?? 2;

      // ─── Render Loop ───
      function tick() {
        s.animationId = requestAnimationFrame(tick);
        // Track frame time for adaptive quality
        s.adaptiveQuality.frameTimes.push(performance.now());
        // Skip camera state machines while gizmo is being dragged
        const gizmoDragging = s.transformControls?.dragging;
        if (!gizmoDragging) {
          controls.update();
          handlePitchSnap(s);
          handleClickZoom(s);
          handleFocusAnimation(s);
        }
        handleAdaptiveQuality(s);
        handleGlbReveal(s);
        handleSplatFade(s);
        handleSplatClip(s);
        syncCameraRotation(s);
        // ─── Skybox Zoom Sync — scale + position tracks camera distance ───
        if (s.skyboxMesh) {
          const dist = Math.max(0.5, camera.position.distanceTo(controls.target));
          const baseRadius = s.pendingTransforms?.skybox?.radius ?? 400;
          const baseScale = baseRadius / 400;
          // Power curve: skybox scales at ~60% of camera dolly rate → natural parallax
          const zoomFactor = Math.pow(dist / 20, 0.6);
          // Clamp sphere radius so it never exceeds the camera far plane
          const maxScale = (camera.far * 0.8) / 400;
          const minScale = (dist * 2.5) / 400;
          const rawScale = Math.max(baseScale * Math.max(0.15, zoomFactor), minScale);
          s.skyboxMesh.scale.setScalar(Math.min(rawScale, maxScale));
          // Blend skybox center from orbit target → camera position as zoom increases
          // This prevents the back of the sphere from exceeding the far plane
          const blendStart = 30;
          const blendEnd = 150;
          const blendT = Math.min(1, Math.max(0, (dist - blendStart) / (blendEnd - blendStart)));
          const skyPos = s.pendingTransforms?.skybox?.position;
          const baseX = controls.target.x + (skyPos?.x ?? 0);
          const baseY = controls.target.y + (skyPos?.y ?? 0);
          const baseZ = controls.target.z + (skyPos?.z ?? 0);
          s.skyboxMesh.position.set(
            baseX + (camera.position.x - baseX) * blendT,
            baseY + (camera.position.y - baseY) * blendT,
            baseZ + (camera.position.z - baseZ) * blendT
          );
        }
        renderer.render(scene, camera);
      }
      tick();

      console.log(`[Viewer] Initialized (${renderer.domElement.width}×${renderer.domElement.height}, PR=${renderer.getPixelRatio()})`);
      onReady?.();

      // Cleanup ref
      s._resizeObserver = resizeObserver;
    }

    init();

    return () => {
      mounted = false;
      const s = stateRef.current;
      if (s.animationId) cancelAnimationFrame(s.animationId);
      s._resizeObserver?.disconnect();
      s._clickZoomCleanup?.();
      if (s.transformControls) {
        s.transformControls.detach();
        s.transformControls.dispose();
        s.transformControls = null;
      }
      s.controls?.dispose();
      if (s.sparkRenderer) {
        s.sparkRenderer.dispose();
        s.sparkRenderer = null;
      }
      if (s.pmremGenerator) {
        s.pmremGenerator.dispose();
        s.pmremGenerator = null;
      }
      if (s.envMap) {
        s.envMap.dispose();
        s.envMap = null;
      }
      if (s.renderer) {
        s.renderer.domElement.remove();
        s.renderer.dispose();
      }
      s.renderer = null;
    };
  }, [onReady]);

  return <div ref={containerRef} className="viewer-canvas-container" />;
});

export default Viewer3D;

