'use client';

/**
 * Public View Page — fullscreen 3D viewer without any editing panels.
 * Route: /view/[id]
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useScene } from '@/hooks/useScene';

const Viewer3D = dynamic(() => import('@/components/viewer/Viewer3D'), { ssr: false });
const FpsCounter = dynamic(() => import('@/components/viewer/FpsCounter'), { ssr: false });

export default function ViewPage() {
  const params = useParams();
  const sceneId = params?.id;
  const viewerRef = useRef(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(true);

  const loadedAssetsRef = useRef({
    glb: null,
    sog: null,
    skybox: null,
    floor: null,
  });

  const { scene, loading, error } = useScene(sceneId);

  const handleViewerReady = useCallback(() => {
    setViewerReady(true);
  }, []);

  // Load assets when scene data arrives
  // On mobile: load sequentially (GLB → SOG) to avoid memory spikes
  // On desktop: load in parallel for speed
  useEffect(() => {
    if (!viewerReady || !scene || !viewerRef.current) return;

    const v = viewerRef.current;
    const assets = scene.assets || {};
    const loaded = loadedAssetsRef.current;

    // Detect mobile for sequential loading
    const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    async function loadSequential() {
      // 1. Skybox + Floor first (lightweight)
      const skyUrl = assets.skybox?.url || null;
      if (skyUrl && skyUrl !== loaded.skybox) {
        loaded.skybox = skyUrl;
        await v.loadSkyboxTexture(skyUrl).catch(() => {});
      }

      const floorUrl = assets.floor?.url || null;
      if (floorUrl && floorUrl !== loaded.floor) {
        loaded.floor = floorUrl;
        await v.loadFloorTexture(floorUrl).catch(() => {});
      }

      // 2. GLB model (medium memory)
      const glbUrl = assets.glb?.url || null;
      if (glbUrl && glbUrl !== loaded.glb) {
        loaded.glb = glbUrl;
        await v.loadGlb(glbUrl).catch(() => {});
      }

      // 3. SOG splat last (heaviest on VRAM)
      const sogUrl = assets.sog?.url || null;
      if (sogUrl && sogUrl !== loaded.sog) {
        loaded.sog = sogUrl;
        await v.loadSog(sogUrl).catch(() => {});
      }

      setLoadingAssets(false);
    }

    function loadParallel() {
      let hasAnyAsset = false;

      const glbUrl = assets.glb?.url || null;
      if (glbUrl !== loaded.glb) {
        loaded.glb = glbUrl;
        if (glbUrl) { v.loadGlb(glbUrl); hasAnyAsset = true; }
      }

      const sogUrl = assets.sog?.url || null;
      if (sogUrl !== loaded.sog) {
        loaded.sog = sogUrl;
        if (sogUrl) { v.loadSog(sogUrl); hasAnyAsset = true; }
      }

      const skyUrl = assets.skybox?.url || null;
      if (skyUrl !== loaded.skybox) {
        loaded.skybox = skyUrl;
        if (skyUrl) v.loadSkyboxTexture(skyUrl);
      }

      const floorUrl = assets.floor?.url || null;
      if (floorUrl !== loaded.floor) {
        loaded.floor = floorUrl;
        if (floorUrl) v.loadFloorTexture(floorUrl);
      }

      setTimeout(() => setLoadingAssets(false), 800);
    }

    if (isMobile) {
      console.log('[View] Mobile detected — loading assets sequentially');
      loadSequential();
    } else {
      loadParallel();
    }
  }, [viewerReady, scene]);

  // Apply transforms
  useEffect(() => {
    if (!viewerReady || !scene?.transforms || !viewerRef.current) return;

    const v = viewerRef.current;
    const t = scene.transforms;
    if (t.glb) v.applyTransform('glb', t.glb);
    if (t.sog) v.applyTransform('sog', t.sog);
    if (t.skybox) v.applyTransform('skybox', t.skybox);
    if (t.floor) v.applyTransform('floor', t.floor);
  }, [viewerReady, scene?.transforms]);

  // Apply orbit settings when they change from Firebase
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const orbit = scene?.orbit;
    if (orbit) {
      viewerRef.current.applyOrbit(orbit);
    }
  }, [viewerReady, scene?.orbit]);

  // Apply saved material overrides when they arrive from Firebase
  useEffect(() => {
    if (!viewerReady || !viewerRef.current || !scene?.materials) return;
    viewerRef.current.applyMaterialOverrides(scene.materials);
  }, [viewerReady, scene?.materials]);

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="loader-content">
          <div className="loader-spinner" />
          <div className="loader-title">Cargando escena…</div>
        </div>
      </div>
    );
  }

  if (error || !scene) {
    return (
      <div className="home-container">
        <div className="home-card animate-fade">
          <div className="home-header">
            <h1>Escena no encontrada</h1>
            <p>{error?.message || 'La escena solicitada no existe.'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Viewer3D ref={viewerRef} onReady={handleViewerReady} />

      {/* Loading overlay while assets load */}
      {loadingAssets && (
        <div className="loading-overlay" style={{ transition: 'opacity 0.6s ease' }}>
          <div className="loader-content">
            <div className="loader-spinner" />
            <div className="loader-title">{scene.name}</div>
            <div className="loader-status">Cargando escena…</div>
          </div>
        </div>
      )}
    </>
  );
}
