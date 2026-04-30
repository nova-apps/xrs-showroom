'use client';

/**
 * Shared hook for loading scene assets into a Viewer3D instance.
 * Used by both the editor (scenes/[id]) and the public view (view/[id]).
 *
 * Handles:
 *   - Parallel asset loading with priority ordering (floor → skybox → GLB → SOG → colliders)
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
 * @returns {{ loadMetrics, resetLoadedAsset }}
 */
export function useSceneLoader({ viewerRef, scene, viewerReady, isEditor = false, useProgressiveLoading = false }) {
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
  // All assets load in parallel, initiated in priority order:
  // 1. Floor  2. Skybox  3. GLB (maqueta)  4. SOG  5. Colliders
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

      const allPromises = [];

      // ── Priority 1: Floor ──
      const floorUrl = assets.floor?.url || null;
      if (floorUrl !== loaded.floor) {
        loaded.floor = floorUrl;
        if (floorUrl) {
          allPromises.push(v.loadFloorTexture(floorUrl).catch(() => {}));
        } else if (isEditor) {
          v.removeFloorTexture();
        }
      }

      // ── Priority 2: Skybox ──
      const skyUrl = assets.skybox?.url || null;
      if (skyUrl !== loaded.skybox) {
        loaded.skybox = skyUrl;
        if (skyUrl) {
          allPromises.push(v.loadSkyboxTexture(skyUrl).catch(() => {}));
        } else if (isEditor) {
          v.removeSkyboxTexture();
        }
      }

      // ── Priority 3: GLB (Maqueta 3D) ──
      const glbUrl = assets.glb?.url || null;
      const proxyUrl = assets.glb_proxy?.url || null;

      if (glbUrl !== loaded.glb) {
        loaded.glb = glbUrl;
        if (glbUrl) {
          if (useProgressiveLoading && proxyUrl) {
            allPromises.push(
              v.loadGlbProgressive(proxyUrl, glbUrl).catch(() => {})
            );
          } else if (useProgressiveLoading) {
            allPromises.push(
              v.loadGlbWithProgress(glbUrl).catch(() => {})
            );
          } else {
            allPromises.push(v.loadGlb(glbUrl, scene.glbSettings || undefined));
          }
        } else if (isEditor) {
          v.removeGlb();
        }
      }

      // ── Priority 4: SOG ──
      const sogUrl = assets.sog?.url || null;
      if (sogUrl !== loaded.sog) {
        loaded.sog = sogUrl;
        if (sogUrl) {
          allPromises.push(v.loadSog(sogUrl, scene.splatSettings || undefined).catch(() => {}));
        } else if (isEditor) {
          v.removeSog();
        }
      }

      // ── Priority 5: Colliders ──
      const collidersUrl = assets.colliders?.url || null;
      if (collidersUrl !== loaded.colliders) {
        loaded.colliders = collidersUrl;
        if (collidersUrl) {
          if (isEditor) {
            allPromises.push((async () => {
              await v.loadColliders(collidersUrl);
              const vis = scene.collidersVisible;
              if (vis === false) v.setCollidersVisible(false);
            })());
          } else {
            // View mode: load colliders but hide them (used only for click targeting)
            allPromises.push(v.loadColliders(collidersUrl).then(() => {
              v.setCollidersVisible(false);
            }).catch(() => {}));
          }
        } else if (isEditor) {
          v.removeColliders();
        }
      }

      // ── Model HDRI — editor only ──
      if (isEditor) {
        const modelHdriUrl = assets.modelHdri?.url || null;
        if (modelHdriUrl !== loaded.modelHdri) {
          loaded.modelHdri = modelHdriUrl;
          if (modelHdriUrl) allPromises.push(v.loadModelHdri(modelHdriUrl).catch(() => {}));
          else v.removeModelHdri();
        }
      }

      // Wait for all assets (parallel, but initiated in priority order)
      if (allPromises.length > 0) {
        if (!isEditor) {
          // View mode: detect mobile for sequential loading to avoid memory spikes
          const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

          if (isMobile) {
            console.log('[SceneLoader] Mobile — loading assets sequentially');
            for (const p of allPromises) {
              await p;
            }
          } else {
            await Promise.all(allPromises);
          }
          console.log('[SceneLoader] ✓ All assets loaded');
        } else {
          await Promise.all(allPromises).catch(() => {});
        }
      }

      // ── Apply initial camera position after GLB is loaded ──
      if (scene.orbit?.initialCamera) {
        setTimeout(() => {
          viewerRef.current?.setInitialCameraPosition(scene.orbit.initialCamera);
        }, 150);
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
    loadMetrics,
    resetLoadedAsset,
  };
}
