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
import { detectGPU } from '@/lib/utils';
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
    splatMesh: null,
    skyboxMesh: null,
    floorMesh: null,
    skyboxRawTexture: null,
    floorRawTexture: null,
    THREE: null,
    optimizer: null,
    clock: null,
    // Store transforms so they can be applied after models load
    pendingTransforms: { glb: null, sog: null, skybox: null, floor: null },
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
    loadSog: (url) => loadSogModel(url),
    loadSkyboxTexture: (url) => loadSkyboxTexture(url),
    loadFloorTexture: (url) => loadFloorTexture(url),
    removeGlb: () => removeGlb(),
    removeSog: () => removeSog(),
    removeSkyboxTexture: () => removeSkyboxTex(),
    removeFloorTexture: () => removeFloorTex(),
  }));

  /* ─── Orbit Controls Application ─── */
  const applyOrbitToControls = useCallback((orbit) => {
    const s = stateRef.current;
    if (!s.controls || !orbit) return;

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
      model.renderOrder = -2;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
          child.frustumCulled = false;
          child.renderOrder = -2;
        }
      });

      // Optimize
      if (!s.optimizer) s.optimizer = new Optimizer(THREE);
      await s.optimizer.optimize(model);

      s.scene.add(model);
      s.glbModel = model;

      // Apply pending transforms if they exist
      if (s.pendingTransforms.glb) {
        applyTransformToObject('glb', s.pendingTransforms.glb);
      }

      // Fit camera
      fitCamera(model);

      console.log('[Viewer] ✓ GLB loaded');
      dracoLoader.dispose();
    } catch (err) {
      console.error('[Viewer] GLB load failed:', err);
    }
  }, []);

  /* ─── SOG Loading ─── */
  const loadSogModel = useCallback(async (url) => {
    const s = stateRef.current;
    if (!s.THREE || !url) return;

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

      const splatMesh = new SplatMesh({
        fileBytes: bytes.buffer,
        fileName: 'splat.sog',
        lod: true,
        extSplats: true,
        onLoad: () => {
          console.log('[Viewer] ✓ SOG splat loaded (LoD + ExtSplats enabled)');
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

    s.camera.position.copy(center);
    s.camera.position.x += dist * 0.6;
    s.camera.position.y += dist * 0.4;
    s.camera.position.z += dist * 0.8;
    s.camera.lookAt(center);
    s.controls.target.copy(center);
    s.controls.update();
  }, []);

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

      // ─── Renderer (optimized for splats) ───
      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        logarithmicDepthBuffer: false,
        powerPreference: 'high-performance',
        alpha: false,
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = false;
      container.appendChild(renderer.domElement);
      s.renderer = renderer;

      // ─── Scene ───
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x08080e);
      s.scene = scene;

      // ─── Camera ───
      const aspect = container.clientWidth / container.clientHeight;
      const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 50000);
      camera.position.set(3, 2, 5);
      s.camera = camera;

      // ─── Controls ───
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.5;
      controls.maxDistance = Infinity;
      controls.target.set(0, 0, 0);
      s.controls = controls;

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
      const skyGeo = new THREE.SphereGeometry(400, 64, 32);
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
      s.controls?.dispose();
      if (s.sparkRenderer) {
        s.sparkRenderer.dispose();
        s.sparkRenderer = null;
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
