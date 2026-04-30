'use client';

/**
 * Shared hook for loading scene assets into a Viewer3D instance.
 * Used by both the editor (scenes/[id]) and the public view (view/[id]).
 *
 * Handles:
 *   - Two-phase asset loading (critical → background)
 *   - Loading overlay state (progress, status, dismiss animation)
 *   - Applying transforms, orbit, lighting, and materials from Firebase to the viewer
 *   - Dedup tracking to avoid re-loading unchanged assets
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * @param {Object} options
 * @param {React.RefObject} options.viewerRef - Ref to the Viewer3D component
 * @param {Object|null} options.scene - Scene data from useScene hook
 * @param {boolean} options.viewerReady - Whether the viewer is initialized
 * @param {boolean} [options.isEditor=false] - Editor mode (has timing metrics, modelHdri, keeps colliders visible)
 * @param {boolean} [options.useProgressiveLoading=false] - Use proxy GLB → full GLB swap (view mode)
 * @returns {{ loadingAssets, dismissing, loadProgress, loadStatus, loadMetrics }}
 */
export function useSceneLoader({ viewerRef, scene, viewerReady, isEditor = false, useProgressiveLoading = false }) {
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [dismissing, setDismissing] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStatus, setLoadStatus] = useState('Iniciando…');
  const [loadMetrics, setLoadMetrics] = useState(null);

  // Track which assets have been loaded to avoid re-loading
  const loadedAssetsRef = useRef({
    glb: null,
    colliders: null,
    sog: null,
    skybox: null,
    floor: null,
    modelHdri: null,
  });

  // Track load timing (editor only)
  const loadTimingRef = useRef({ startTime: null, pending: 0, done: false });

  /**
   * Reset loaded-asset tracking for a specific type.
   * Call this after uploading/removing an asset so the loader picks up the change.
   */
  const resetLoadedAsset = useCallback((assetType) => {
    loadedAssetsRef.current[assetType] = null;
    if (isEditor) {
      loadTimingRef.current = { startTime: null, pending: 0, done: false };
      setLoadMetrics(null);
    }
  }, [isEditor]);

  // ── Asset Loading Effect ──
  useEffect(() => {
    if (!viewerReady || !scene || !viewerRef.current) return;

    const v = viewerRef.current;
    const assets = scene.assets || {};
    const loaded = loadedAssetsRef.current;
    const timing = loadTimingRef.current;

    async function loadAssets() {
      if (isEditor) {
        timing.startTime = timing.startTime || performance.now();
      }

      // ── Phase 1: Critical assets (GLB + Floor) ──
      const criticalPromises = [];
      let hasCritical = false;

      setLoadStatus('Cargando modelo 3D…');
      setLoadProgress(0.05);

      const glbUrl = assets.glb?.url || null;
      const proxyUrl = assets.glb_proxy?.url || null;

      if (glbUrl !== loaded.glb) {
        loaded.glb = glbUrl;
        if (glbUrl) {
          hasCritical = true;
          if (useProgressiveLoading && proxyUrl) {
            criticalPromises.push(
              v.loadGlbProgressive(proxyUrl, glbUrl, (p) => {
                setLoadProgress(0.05 + p * 0.75);
              }).catch(() => {})
            );
          } else if (useProgressiveLoading) {
            criticalPromises.push(
              v.loadGlbWithProgress(glbUrl, (p) => {
                setLoadProgress(0.05 + p * 0.75);
              }).catch(() => {})
            );
          } else {
            criticalPromises.push(v.loadGlb(glbUrl, scene.glbSettings || undefined));
          }
        } else if (isEditor) {
          v.removeGlb();
        }
      }

      const floorUrl = assets.floor?.url || null;
      if (floorUrl !== loaded.floor) {
        loaded.floor = floorUrl;
        if (floorUrl) {
          hasCritical = true;
          criticalPromises.push(v.loadFloorTexture(floorUrl).catch(() => {}));
        } else if (isEditor) {
          v.removeFloorTexture();
        }
      }

      // Wait for GLB + floor
      if (criticalPromises.length > 0) {
        await Promise.all(criticalPromises).catch(() => {});
      }

      setLoadProgress(isEditor ? 0.8 : 1);
      setLoadStatus('Listo');

      // ── Apply initial camera position after GLB is loaded ──
      if (scene.orbit?.initialCamera) {
        setTimeout(() => {
          viewerRef.current?.setInitialCameraPosition(scene.orbit.initialCamera);
        }, 150);
      }

      // ── Dismiss loading overlay ──
      if (isEditor) {
        if (hasCritical || !loadingAssets) {
          setLoadProgress(1);
          setTimeout(() => {
            setDismissing(true);
            setTimeout(() => setLoadingAssets(false), 900);
          }, 300);
        } else {
          setDismissing(true);
          setTimeout(() => setLoadingAssets(false), 900);
        }
      } else {
        setTimeout(() => {
          setDismissing(true);
          setTimeout(() => setLoadingAssets(false), 900);
        }, 300);
      }

      // ── Phase 2: Secondary assets — load in background ──
      const bgPromises = [];

      const collidersUrl = assets.colliders?.url || null;
      if (collidersUrl !== loaded.colliders) {
        loaded.colliders = collidersUrl;
        if (collidersUrl) {
          if (isEditor) {
            bgPromises.push((async () => {
              await v.loadColliders(collidersUrl);
              const vis = scene.collidersVisible;
              if (vis === false) v.setCollidersVisible(false);
            })());
          } else {
            // View mode: load colliders but hide them (used only for click targeting)
            bgPromises.push(v.loadColliders(collidersUrl).then(() => {
              v.setCollidersVisible(false);
            }).catch(() => {}));
          }
        } else if (isEditor) {
          v.removeColliders();
        }
      }

      const sogUrl = assets.sog?.url || null;
      if (sogUrl !== loaded.sog) {
        loaded.sog = sogUrl;
        if (sogUrl) bgPromises.push(v.loadSog(sogUrl, scene.splatSettings || undefined).catch(() => {}));
        else if (isEditor) v.removeSog();
      }

      const skyUrl = assets.skybox?.url || null;
      if (skyUrl !== loaded.skybox) {
        loaded.skybox = skyUrl;
        if (skyUrl) bgPromises.push(v.loadSkyboxTexture(skyUrl).catch(() => {}));
        else if (isEditor) v.removeSkyboxTexture();
      }

      // Model HDRI — editor only
      if (isEditor) {
        const modelHdriUrl = assets.modelHdri?.url || null;
        if (modelHdriUrl !== loaded.modelHdri) {
          loaded.modelHdri = modelHdriUrl;
          if (modelHdriUrl) bgPromises.push(v.loadModelHdri(modelHdriUrl).catch(() => {}));
          else v.removeModelHdri();
        }
      }

      if (bgPromises.length > 0) {
        if (!isEditor) {
          // View mode: detect mobile for sequential loading to avoid memory spikes
          const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

          if (isMobile) {
            console.log('[SceneLoader] Mobile — loading secondary assets sequentially');
            for (const p of bgPromises) {
              await p;
            }
          } else {
            await Promise.all(bgPromises);
          }
          console.log('[SceneLoader] ✓ All secondary assets loaded');
        } else {
          await Promise.all(bgPromises).catch(() => {});
        }
      }

      // Measure total load time (editor only)
      if (isEditor && timing.startTime && !timing.done) {
        const totalTime = Math.round(performance.now() - timing.startTime);
        timing.done = true;
        setLoadMetrics({ totalTime });
        console.log(`[Perf] Total load time: ${totalTime}ms`);
      }
    }

    loadAssets();
  }, [viewerReady, scene]);

  // ── Apply transforms when they change from Firebase ──
  useEffect(() => {
    if (!viewerReady || !scene?.transforms || !viewerRef.current) return;

    const v = viewerRef.current;
    const t = scene.transforms;
    if (t.glb) v.applyTransform('glb', t.glb);
    if (t.colliders) v.applyTransform('colliders', t.colliders);
    if (t.sog) v.applyTransform('sog', t.sog);
    if (t.skybox) v.applyTransform('skybox', t.skybox);
    if (t.floor) v.applyTransform('floor', t.floor);
    if (t.mask) v.applyTransform('mask', t.mask);
  }, [viewerReady, scene?.transforms]);

  // ── Apply orbit settings ──
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const orbit = scene?.orbit;
    if (orbit) {
      viewerRef.current.applyOrbit(orbit);
    }
  }, [viewerReady, scene?.orbit]);

  // ── Apply lighting settings ──
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const lighting = scene?.lighting;
    if (lighting) {
      viewerRef.current.setLighting(lighting);
    }
  }, [viewerReady, scene?.lighting]);

  // ── Apply material overrides ──
  useEffect(() => {
    if (!viewerReady || !viewerRef.current || !scene?.materials) return;
    viewerRef.current.applyMaterialOverrides(scene.materials);
  }, [viewerReady, scene?.materials]);

  // ── Apply tint overlay settings ──
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const tint = scene?.tint;
    if (tint) {
      viewerRef.current.setTint(tint);
    }
  }, [viewerReady, scene?.tint]);

  return {
    loadingAssets,
    dismissing,
    loadProgress,
    loadStatus,
    loadMetrics,
    resetLoadedAsset,
  };
}
