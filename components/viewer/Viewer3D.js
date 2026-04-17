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
    pendingTransforms: { glb: null, colliders: null, sog: null, skybox: null, floor: null },
    // Store material overrides so they can be applied after GLB loads
    pendingMaterialOverrides: null,
    // Store the GLB model bounding-box center for orbit target
    glbCenter: null,
    // Store last orbit settings so they can be re-applied after GLB loads
    pendingOrbit: null,
    // Pitch snap animation state machine
    pitchSnap: { state: 'idle', originalMinPolar: 0 },
    // Click zoom animation state machine
    clickZoom: { state: 'idle', originalFov: 45 },
    // Camera Focus animation state (spherical coords)
    focusTarget: { state: 'idle', targetPhi: 0, targetTheta: 0, targetRadius: 0, onComplete: null },
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
    loadGlb: (url) => loadGlbModel(url),
    loadColliders: (url) => loadCollidersModel(url),
    loadSog: (url) => loadSogModel(url),
    loadSkyboxTexture: (url) => loadSkyboxTexture(url),
    loadFloorTexture: (url) => loadFloorTexture(url),
    removeGlb: () => removeGlb(),
    removeColliders: () => removeColliders(),
    removeSog: () => removeSog(),
    removeSkyboxTexture: () => removeSkyboxTex(),
    removeFloorTexture: () => removeFloorTex(),
    getGlbModel: () => stateRef.current.glbModel,
    getCollidersModel: () => stateRef.current.collidersModel,
    focusOnCollider: (name, onComplete) => focusCameraOnCollider(name, onComplete),
    setCollidersVisible: (visible) => {
      const s = stateRef.current;
      if (s.collidersModel) {
        s.collidersModel.visible = visible;
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
      };
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

  /* ─── Transform Application ─── */
  const applyTransformToObject = useCallback(async (type, transforms) => {
    const s = stateRef.current;
    if (!transforms) return;

    // Always store the latest transforms
    s.pendingTransforms[type] = transforms;

    if (type === 'glb' && s.glbModel) {
      const pos = transforms.position || {};
      s.glbModel.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
      if (typeof transforms.scale === 'number') {
        s.glbModel.scale.setScalar(transforms.scale);
      }
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
      if (typeof transforms.scale === 'number') {
        s.collidersModel.scale.setScalar(transforms.scale);
      }
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
      if (typeof transforms.scale === 'number') {
        s.splatMesh.scale.setScalar(transforms.scale);
      }
      const rot = transforms.rotation || {};
      s.splatMesh.rotation.set(
        (rot.x ?? 0) * DEG2RAD,
        (rot.y ?? 0) * DEG2RAD,
        (rot.z ?? 0) * DEG2RAD
      );
    }

    if (type === 'skybox' && s.skyboxMesh) {
      const THREE = s.THREE;
      const radius = transforms.radius ?? 400;
      s.skyboxMesh.scale.setScalar(radius / 400);

      if (typeof transforms.blur === 'number' && s.skyboxRawTexture) {
        const { blurTexture } = await import('@/lib/utils');
        const blurred = blurTexture(THREE, s.skyboxRawTexture, transforms.blur);
        if (s.skyboxMesh.material.map) s.skyboxMesh.material.map.dispose();
        s.skyboxMesh.material.color.set(0xffffff);
        s.skyboxMesh.material.map = blurred;
        s.skyboxMesh.material.needsUpdate = true;
      }
    }

    if (type === 'floor' && s.floorMesh) {
      const THREE = s.THREE;
      const pos = transforms.position || {};
      s.floorMesh.position.set(pos.x ?? 0, pos.y ?? -0.5, pos.z ?? 0);
      s.floorMesh.scale.setScalar((transforms.scale ?? 1050) / 800);

      if (typeof transforms.blur === 'number' && s.floorRawTexture) {
        const { blurTexture } = await import('@/lib/utils');
        const blurred = blurTexture(THREE, s.floorRawTexture, transforms.blur);
        if (s.floorMesh.material.map) s.floorMesh.material.map.dispose();
        s.floorMesh.material.color.set(0xffffff);
        s.floorMesh.material.map = blurred;
        s.floorMesh.material.needsUpdate = true;
      }
    }
  }, []);

  /* ─── GLB Loading ─── */
  const loadGlbModel = useCallback(async (url) => {
    const s = stateRef.current;
    const THREE = s.THREE;
    if (!THREE || !url) return;

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
          child.frustumCulled = false;

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
            // Transparent / glass mesh
            child.renderOrder = -1;
            for (const m of mats) {
              if (m.type === 'MeshPhysicalMaterial' || m.type === 'MeshStandardMaterial') {
                // Clear glass: low opacity + sharp env map reflections
                // (transmission-based glass uses a low-res buffer that causes blur)
                m.transparent = true;
                m.opacity = 0.15;
                m.roughness = 0.05;
                m.metalness = 0.1;
                m.envMapIntensity = 2.0;
                m.depthWrite = false;
                m.transmission = 0;  // disable transmission buffer
                if (m.color) m.color.set(0xffffff);
              } else {
                // Fallback: simple alpha transparency
                m.transparent = true;
                m.opacity = 0.3;
                m.depthWrite = false;
              }
              m.needsUpdate = true;
            }
            console.log(`[Viewer] Glass material applied: mesh="${child.name}", mat="${mats.map(m => m.name).join(', ')}"`);
          } else {
            // Opaque mesh — draw before transparent
            child.renderOrder = -2;
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

      // Optimize
      if (!s.optimizer) s.optimizer = new Optimizer(THREE);
      await s.optimizer.optimize(model);

      s.scene.add(model);
      s.glbModel = model;

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
  const loadSogModel = useCallback(async (url) => {
    const s = stateRef.current;
    if (!s.THREE || !url) return;

    // Skip SOG on mobile — too heavy for constrained VRAM
    if (s.qualityProfile && !s.qualityProfile.enableSplats) {
      console.log('[Viewer] SOG skipped (mobile quality profile — enableSplats=false)');
      return;
    }

    removeSog();

    try {
      const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');

      // Ensure SparkRenderer exists in the scene (required by Spark 2.0)
      if (!s.sparkRenderer) {
        const spark = new SparkRenderer({ renderer: s.renderer });
        s.scene.add(spark);
        s.sparkRenderer = spark;
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

      const useExtSplats = s.qualityProfile?.enableExtSplats !== false;
      const splatMesh = new SplatMesh({
        fileBytes: bytes.buffer,
        fileName: 'splat.sog',
        lod: true,
        extSplats: useExtSplats,
        onLoad: () => {
          console.log(`[Viewer] ✓ SOG splat loaded (LoD=true, ExtSplats=${useExtSplats})`);
        },
      });

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
      s.skyboxRawTexture = tex;

      const { blurTexture } = await import('@/lib/utils');
      const blurred = blurTexture(THREE, tex, 3);

      if (s.skyboxMesh) {
        if (s.skyboxMesh.material.map) s.skyboxMesh.material.map.dispose();
        s.skyboxMesh.material.color.set(0xffffff);
        s.skyboxMesh.material.map = blurred;
        s.skyboxMesh.material.needsUpdate = true;
      }

      // ─── Generate environment map for PBR reflections (skip on mobile) ───
      if (s.pmremGenerator && s.qualityProfile?.enableEnvMap) {
        // Dispose previous env map if any
        if (s.envMap) {
          s.envMap.dispose();
          s.envMap = null;
        }
        // Create an equirectangular texture for PMREM
        const envTex = new THREE.Texture(image);
        envTex.mapping = THREE.EquirectangularReflectionMapping;
        envTex.colorSpace = THREE.SRGBColorSpace;
        envTex.needsUpdate = true;

        const envRT = s.pmremGenerator.fromEquirectangular(envTex);
        s.envMap = envRT.texture;
        s.scene.environment = s.envMap;
        envTex.dispose();
        console.log('[Viewer] ✓ Environment map generated for PBR reflections');
      } else if (s.qualityProfile && !s.qualityProfile.enableEnvMap) {
        console.log('[Viewer] Environment map skipped (mobile quality profile)');
      }

      URL.revokeObjectURL(blobUrl);
      console.log('[Viewer] ✓ Skybox texture loaded');
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
      const blurred = blurTexture(THREE, tex, 3);

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
    if (s.skyboxMesh?.material?.map) {
      s.skyboxMesh.material.map.dispose();
      s.skyboxMesh.material.map = null;
      s.skyboxMesh.material.needsUpdate = true;
    }
    // Remove environment map
    if (s.envMap) {
      s.envMap.dispose();
      s.envMap = null;
      s.scene.environment = null;
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
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = false;
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
          s.controls?.update();
          handlePitchSnap(s);
          handleClickZoom(s);
          handleFocusAnimation(s);
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

      // ─── Lighting ───
      scene.add(new THREE.AmbientLight(0xffffff, 0.4));
      scene.add(new THREE.HemisphereLight(0x8899cc, 0x443322, 0.5));
      const key = new THREE.DirectionalLight(0xffffff, 1.2);
      key.position.set(5, 8, 5);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x4488ff, 0.3);
      fill.position.set(-3, 3, -4);
      scene.add(fill);

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
      floor.renderOrder = 0;
      scene.add(floor);
      s.floorMesh = floor;

      // ─── Resize ───
      const resizeObserver = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
      resizeObserver.observe(container);

      // ─── Render Loop ───
      function tick() {
        s.animationId = requestAnimationFrame(tick);
        controls.update();
        handlePitchSnap(s);
        handleClickZoom(s);
        handleFocusAnimation(s);
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

/* ─── Apply material overrides helper ─── */
function sanitizeMatKey(name) {
  return name.replace(/[.#$/\[\]]/g, '_');
}

function applyMaterialOverridesToModel(model, overrides) {
  if (!model || !overrides) return;
  let count = 0;
  model.traverse((child) => {
    if (child.isMesh) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        const key = sanitizeMatKey(mat.name || '');
        if (overrides[key]) {
          const saved = overrides[key];
          for (const [prop, value] of Object.entries(saved)) {
            switch (prop) {
              case 'color': mat.color?.set?.(`#${value}`); break;
              case 'emissive': mat.emissive?.set?.(`#${value}`); break;
              case 'sheenColor': mat.sheenColor?.set?.(`#${value}`); break;
              case 'transparent': mat.transparent = value; break;
              case 'depthWrite': mat.depthWrite = value; break;
              case 'visible': mat.visible = value; break;
              case 'flatShading': mat.flatShading = value; break;
              case 'side': mat.side = value; break;
              default:
                if (mat[prop] !== undefined) mat[prop] = value;
                break;
            }
          }
          mat.needsUpdate = true;
          count++;
        }
      }
    }
  });
  console.log(`[Viewer] Material overrides applied to ${count} materials`);
}

/* ─── Pitch Snap Animation ─── */
/**
 * State machine that animates the camera to a top-down view when the user
 * reaches pitchMax, and animates back to pitchMax when they try to tilt down.
 *
 * States:
 *   idle     → Normal operation; watching for polar angle to reach minPolarAngle
 *   to_top   → Animating polar angle toward 0 (top-down / pitch 90°)
 *   at_top   → At top-down view; user can pan/zoom; watching for downward tilt
 *   to_limit → Animating polar angle back to the original minPolarAngle
 *   cooldown → Waiting until user moves away from the limit to re-enable snap
 */
function handlePitchSnap(s) {
  const { controls, camera, THREE, pitchSnap: snap, pendingOrbit: orbit } = s;
  if (!controls || !camera || !THREE) return;

  // Feature is gated behind the orbit setting
  const enabled = orbit?.pitchSnapEnabled === true;

  // If disabled mid-animation, reset cleanly
  if (!enabled && snap.state !== 'idle') {
    if (snap.state === 'to_top' || snap.state === 'to_limit') {
      controls.enableRotate = true;
      controls.enablePan = true;
    }
    if (snap.originalMinPolar) {
      controls.minPolarAngle = snap.originalMinPolar;
    }
    snap.state = 'idle';
    return;
  }
  if (!enabled) return;

  // Target polar angle from settings (90° → phi 0, 45° → phi π/4, etc.)
  const snapTargetDeg = orbit?.pitchSnapTarget ?? 90;
  const HALF_PI = Math.PI / 2;
  const targetPhi = Math.max(HALF_PI - snapTargetDeg * (Math.PI / 180), 0.001);

  const polar = controls.getPolarAngle();

  switch (snap.state) {
    case 'idle': {
      const minPolar = controls.minPolarAngle;
      // Only activate when there is a meaningful upper-pitch limit (> ~3°)
      if (minPolar <= 0.05) return;
      // And only if the snap target is actually above the max
      if (targetPhi >= minPolar) return;
      if (polar <= minPolar + 0.03) {
        snap.state = 'to_top';
        snap.originalMinPolar = minPolar;
        controls.minPolarAngle = Math.max(targetPhi - 0.01, 0.001);
        controls.enableRotate = false;
        controls.enablePan = false;
      }
      break;
    }

    case 'to_top': {
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);

      sph.phi = THREE.MathUtils.lerp(sph.phi, targetPhi, 0.08);
      sph.makeSafe();
      offset.setFromSpherical(sph);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);

      if (Math.abs(sph.phi - targetPhi) < 0.015) {
        snap.state = 'at_top';
        controls.minPolarAngle = Math.max(targetPhi - 0.01, 0.001);
        controls.enableRotate = true;
        controls.enablePan = true;
      }
      break;
    }

    case 'at_top': {
      // User can freely pan / zoom from the snapped view.
      // If they tilt downward past a small threshold → animate back.
      if (polar > targetPhi + 0.08) {
        snap.state = 'to_limit';
        controls.enableRotate = false;
        controls.enablePan = false;
      }
      break;
    }

    case 'to_limit': {
      const returnPhi = snap.originalMinPolar;
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);

      sph.phi = THREE.MathUtils.lerp(sph.phi, returnPhi, 0.08);
      sph.makeSafe();
      offset.setFromSpherical(sph);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);

      if (Math.abs(sph.phi - returnPhi) < 0.015) {
        snap.state = 'cooldown';
        controls.minPolarAngle = snap.originalMinPolar;
        controls.enableRotate = true;
        controls.enablePan = true;
      }
      break;
    }

    case 'cooldown': {
      // Don't re-trigger until user moves well past the limit
      if (polar > snap.originalMinPolar + 0.2) {
        snap.state = 'idle';
      }
      break;
    }
  }
}

/* ─── Click Zoom Animation ─── */
/**
 * Press-and-hold zoom: on pointerdown the camera FOV narrows (zoom in),
 * on pointerup it smoothly returns to the original FOV.
 * Uses FOV instead of camera distance to avoid conflicts with OrbitControls.
 *
 * States:
 *   idle        → Normal; watching for pointerdown
 *   zooming_in  → Animating FOV toward narrower value (zoom in)
 *   held        → At zoomed FOV; waiting for pointerup
 *   zooming_out → Animating FOV back to original value
 */
function onCanvasPointerDown(s) {
  const { camera, clickZoom: cz, pendingOrbit: orbit } = s;
  if (!camera) return;
  if (orbit?.clickZoomEnabled !== true) return;

  // Only capture original FOV when starting from idle
  if (cz.state === 'idle') {
    cz.originalFov = camera.fov;
  }
  cz.state = 'zooming_in';
}

function onCanvasPointerUp(s) {
  const { clickZoom: cz, pendingOrbit: orbit } = s;
  if (orbit?.clickZoomEnabled !== true) return;

  if (cz.state === 'zooming_in' || cz.state === 'held') {
    cz.state = 'zooming_out';
  }
}

function handleClickZoom(s) {
  const { camera, clickZoom: cz, pendingOrbit: orbit } = s;
  if (!camera) return;

  const enabled = orbit?.clickZoomEnabled === true;

  // If disabled mid-animation, restore FOV cleanly
  if (!enabled && cz.state !== 'idle') {
    camera.fov = cz.originalFov;
    camera.updateProjectionMatrix();
    cz.state = 'idle';
    return;
  }
  if (!enabled || cz.state === 'idle') return;

  const THREE = s.THREE;
  if (!THREE) return;

  const amount = (orbit?.clickZoomAmount ?? 30) / 100; // 0→1
  const targetFov = cz.originalFov * (1 - amount);

  if (cz.state === 'zooming_in') {
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.09);
    camera.updateProjectionMatrix();

    if (Math.abs(camera.fov - targetFov) < 0.05) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
      cz.state = 'held';
    }
  } else if (cz.state === 'zooming_out') {
    camera.fov = THREE.MathUtils.lerp(camera.fov, cz.originalFov, 0.09);
    camera.updateProjectionMatrix();

    if (Math.abs(camera.fov - cz.originalFov) < 0.05) {
      camera.fov = cz.originalFov;
      camera.updateProjectionMatrix();
      cz.state = 'idle';
    }
  }
}

/* ─── Focus Camera Animation ─── */
function handleFocusAnimation(s) {
  const { camera, controls, focusTarget: focus, THREE } = s;
  if (!camera || !controls || !focus || !THREE || focus.state === 'idle') return;

  if (focus.state === 'animating') {
    // focusSpeed: 5 (very slow) → 100 (instant), stored in orbit settings
    const speed = s.pendingOrbit?.focusSpeed ?? 25;
    const LERP_SPEED = speed / 1000; // 5→0.005, 25→0.025, 100→0.1

    // Get current camera position in spherical coords relative to orbit target
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const current = new THREE.Spherical().setFromVector3(offset);

    // Lerp each spherical component independently
    current.phi = THREE.MathUtils.lerp(current.phi, focus.targetPhi, LERP_SPEED);
    current.theta = THREE.MathUtils.lerp(current.theta, focus.targetTheta, LERP_SPEED);
    current.radius = THREE.MathUtils.lerp(current.radius, focus.targetRadius, LERP_SPEED);
    current.makeSafe();

    // Convert back to cartesian and apply
    offset.setFromSpherical(current);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);

    // Check convergence
    const dPhi = Math.abs(current.phi - focus.targetPhi);
    const dTheta = Math.abs(current.theta - focus.targetTheta);
    const dRadius = Math.abs(current.radius - focus.targetRadius);

    if (dPhi < 0.002 && dTheta < 0.002 && dRadius < 0.05) {
      current.phi = focus.targetPhi;
      current.theta = focus.targetTheta;
      current.radius = focus.targetRadius;
      current.makeSafe();
      offset.setFromSpherical(current);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      focus.state = 'idle';
      if (typeof focus.onComplete === 'function') {
        focus.onComplete();
        focus.onComplete = null;
      }
    }
  }
}

/* ─── Dispose helper ─── */
function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        for (const key of Object.keys(mat)) {
          if (mat[key]?.dispose) mat[key].dispose();
        }
        mat.dispose();
      }
    }
  });
}

export default Viewer3D;
