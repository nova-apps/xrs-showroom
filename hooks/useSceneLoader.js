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
 * @param {boolean} [options.introReleased=true] - Gate for the cinematic entrance. When
 *   false, assets still stream in but the intro→final camera move + FX fade are held
 *   until this flips true (mobile: released when the welcome modal's "Comenzar" is tapped,
 *   so the entrance actually plays for the user instead of behind the modal).
 * @returns {{ loadMetrics, resetLoadedAsset, framed }}
 */
export function useSceneLoader({ viewerRef, scene, viewerReady, isEditor = false, useProgressiveLoading = false, introReleased = true }) {
  const [loadMetrics, setLoadMetrics] = useState(null);
  // `framed` flips true once the camera is sitting at its configured intro/initial
  // pose, so the page can hold the reveal curtain closed until then (no flash of
  // the default OrbitControls pose while Firebase data is still in flight).
  const [framed, setFramed] = useState(false);
  // Pending intro→final camera animation + floor-reveal timers (cleared on
  // reload/unmount so a stale callback never fires against a new scene).
  const introTimerRef = useRef(null);
  const floorRevealTimerRef = useRef(null);
  const floorBackstopRef = useRef(null);
  // The cinematic entrance (snap to intro pose → glide to final + intro FX) must
  // play only once per viewer mount. Otherwise re-enabling/re-uploading an asset
  // — which pushes a load promise — would replay the whole camera animation.
  const cinematicPlayedRef = useRef(false);
  // The cinematic runner is built once assets have loaded, but its actual firing
  // is gated on `introReleased` (see the gate effect below). We stash the closure
  // here and flip `readyForIntro` so the gate can run it exactly once.
  const cinematicRunnerRef = useRef(null);
  const [readyForIntro, setReadyForIntro] = useState(false);

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

    // Per-asset enabled (loaded) state. Absent/true = enabled (default); false =
    // disabled. A disabled asset resolves to a null "effective URL" below, so
    // the dedup logic never downloads it and (in the editor) unloads it if it
    // was previously loaded. This is distinct from the old `visibility` toggle,
    // which only flipped `.visible` on an already-loaded mesh.
    const enabledMap = scene.enabled || {};
    const isEnabled = (type) => enabledMap[type] !== false;

    async function loadAssets() {
      if (isEditor) {
        timing.startTime = timing.startTime || performance.now();
      }

      const allPromises = [];

      // ── Priority 1: Floor ──
      const floorUrl = isEnabled('floor') ? (assets.floor?.url || null) : null;
      // El plano de piso por defecto (opaco, en y=-0.5) solo tiene sentido cuando
      // hay una textura asignada. Sin textura ocluiría la mitad inferior del
      // skybox, así que su visibilidad sigue a la presencia de piso. Esto permite
      // ver la esfera completa en escenas cuyo piso vive en el GLB por debajo de 0.
      v.setAssetVisible?.('floor', !!floorUrl);
      if (floorUrl !== loaded.floor) {
        loaded.floor = floorUrl;
        if (floorUrl) {
          allPromises.push(v.loadFloorTexture(floorUrl).catch(() => {}));
        } else if (isEditor) {
          v.removeFloorTexture();
        }
      }

      // ── Priority 2: Skybox ──
      const skyUrl = isEnabled('skybox') ? (assets.skybox?.url || null) : null;
      if (skyUrl !== loaded.skybox) {
        loaded.skybox = skyUrl;
        if (skyUrl) {
          allPromises.push(v.loadSkyboxTexture(skyUrl).catch(() => {}));
        } else if (isEditor) {
          v.removeSkyboxTexture();
        }
      }

      // ── Priority 3: GLB (Maqueta 3D) ──
      const glbEnabled = isEnabled('glb');
      const glbUrl = glbEnabled ? (assets.glb?.url || null) : null;
      const proxyUrl = glbEnabled ? (assets.glb_proxy?.url || null) : null;
      // Captured so the colliders can wait for the maqueta before becoming
      // visible/interactive (they load faster and must not appear first).
      let glbPromise = null;

      if (glbUrl !== loaded.glb) {
        loaded.glb = glbUrl;
        if (glbUrl) {
          if (useProgressiveLoading && proxyUrl) {
            glbPromise = v.loadGlbProgressive(proxyUrl, glbUrl, scene.glbSettings || undefined).catch(() => {});
          } else if (useProgressiveLoading) {
            glbPromise = v.loadGlbWithProgress(glbUrl, scene.glbSettings || undefined).catch(() => {});
          } else {
            glbPromise = v.loadGlb(glbUrl, scene.glbSettings || undefined);
          }
          allPromises.push(glbPromise);
        } else if (isEditor) {
          v.removeGlb();
        }
      }

      // ── Priority 4: SOG ──
      const sogUrl = isEnabled('sog') ? (assets.sog?.url || null) : null;
      if (sogUrl !== loaded.sog) {
        loaded.sog = sogUrl;
        if (sogUrl) {
          allPromises.push(v.loadSog(sogUrl, scene.splatSettings || undefined).catch(() => {}));
        } else if (isEditor) {
          v.removeSog();
        }
      }

      // ── Priority 5: Colliders ──
      // Disabling colliders skips loading them entirely → no raycasting/hover,
      // both in the editor and in /view (the published snapshot carries the flag).
      const collidersUrl = isEnabled('colliders') ? (assets.colliders?.url || null) : null;
      if (collidersUrl !== loaded.colliders) {
        loaded.colliders = collidersUrl;
        if (collidersUrl) {
          // Colliders are a lightweight GLB that loads faster than the maqueta.
          // Load + hide them now, but enable hover/click only AFTER the maqueta
          // (GLB) has loaded — otherwise they'd surface (flash / hover-highlight)
          // over an empty scene before the model is on screen. Both editor and
          // /view share this behavior.
          allPromises.push((async () => {
            await v.loadColliders(collidersUrl);
            v.setCollidersVisible(false);
            if (glbPromise) await glbPromise.catch(() => {});
            v.setCollidersHoverEnabled?.(true);
          })().catch(() => {}));
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

      // ── Camera framing ──
      // Show the intro (or, if none, the final) pose BEFORE assets stream in so
      // the user never sees the default OrbitControls pose. fitCamera re-applies
      // it relative to the GLB center once the model loads; the intro→final
      // animation below runs after everything has loaded.
      const isMobileEarly = typeof navigator !== 'undefined' && (
        /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      );
      const orbit = scene.orbit || {};
      const introCam = (isMobileEarly && orbit.mobile?.introCamera) ? orbit.mobile.introCamera : orbit.introCamera;
      const finalCam = (isMobileEarly && orbit.mobile?.initialCamera) ? orbit.mobile.initialCamera : orbit.initialCamera;
      const startCam = introCam || finalCam;
      // Play the cinematic entrance only on the FIRST real load of this mount.
      // A later asset (re)load — e.g. re-enabling a toggled-off element — also
      // pushes promises, but must not re-snap the camera or replay the intro.
      const playIntro = allPromises.length > 0 && !cinematicPlayedRef.current;
      if (playIntro && startCam) {
        v.setInitialCameraPosition?.(startCam, { animate: false });
      }
      // Reveal the canvas (open the curtain) once the framing pose is painted.
      requestAnimationFrame(() => setFramed(true));

      // ── Intro FX ──
      // Blur + low contrast on the environment while the scene loads; faded out
      // below once the maqueta (GLB) + SOG are in. Only on the first load.
      if (playIntro && scene.introFx?.enabled) {
        v.setIntroFx?.(scene.introFx);
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

      // Note: per-asset show/hide is no longer applied here. Assets are either
      // enabled (loaded → visible) or disabled (never loaded), so there's no
      // "loaded but hidden" state to reconcile. Colliders remain hidden + hover
      // enabled via the load block above.

      // ── Camera: settle into the final framing once everything has loaded ──
      // Only on a real (re)load (allPromises>0) so editor edits don't snap the
      // camera back. With an intro pose configured, animate intro→final after a
      // short dwell so the building's reveal can be appreciated first; otherwise
      // snap straight to the final pose (fitCamera has already run by now).
      // The floor stays hidden until the camera has come to rest (revealFloor),
      // so it never appears to slide while the camera is moving/reframing.
      if (playIntro) {
        // First load of this mount: arm the cinematic entrance once. We build the
        // runner now (assets are in) but don't fire it here — the gate effect runs
        // it as soon as `introReleased` is true, so on mobile it plays when the
        // welcome modal is dismissed instead of unseen behind it.
        cinematicPlayedRef.current = true;
        cinematicRunnerRef.current = () => {
          if (introCam && finalCam) {
            const durationMs = Math.max(0, (orbit.introDuration ?? 2) * 1000);
            clearTimeout(introTimerRef.current);
            clearTimeout(floorRevealTimerRef.current);
            introTimerRef.current = setTimeout(() => {
              viewerRef.current?.setInitialCameraPosition(finalCam, { animate: true, durationMs });
              floorRevealTimerRef.current = setTimeout(
                () => viewerRef.current?.revealFloor(),
                durationMs + 100
              );
            }, 500);
          } else if (finalCam) {
            // No intro animation: fitCamera has already run, so snap and reveal now.
            viewerRef.current?.setInitialCameraPosition(finalCam, { animate: false });
            viewerRef.current?.revealFloor();
          } else {
            viewerRef.current?.revealFloor();
          }
          // Maqueta (GLB) + SOG are loaded by now (awaited above) — fade the intro
          // FX (blur + low contrast) back to the scene's normal look.
          if (scene.introFx?.enabled) {
            viewerRef.current?.fadeOutIntroFx(scene.introFx.duration ?? 1.5);
          }
        };
        setReadyForIntro(true);
      } else {
        // Either nothing (re)loaded this pass (a plain scene-data edit), or an
        // incremental (re)load after the cinematic already played (e.g. re-
        // enabling a toggled-off element). Reveal the floor (idempotent) without
        // touching the camera, so the user's current view is preserved.
        viewerRef.current?.revealFloor();
      }

      // Measure total load time (editor only)
      if (isEditor && timing.startTime && !timing.done) {
        const totalTime = Math.round(performance.now() - timing.startTime);
        timing.done = true;
        setLoadMetrics({ totalTime });
        console.log(`[Perf] Total load time: ${totalTime}ms`);
      }
    }

    // Safety net: the floor is normally revealed once the camera settles after
    // loading. If asset loading stalls (a hung download), reveal it anyway so it
    // never stays hidden. revealFloor is idempotent, so the normal path wins.
    clearTimeout(floorBackstopRef.current);
    floorBackstopRef.current = setTimeout(() => {
      viewerRef.current?.revealFloor();
      // Don't leave the scene blurred/low-contrast if asset loading stalled.
      viewerRef.current?.fadeOutIntroFx?.(scene?.introFx?.duration ?? 1.5);
    }, 12000);

    loadAssets();
    return () => {
      clearTimeout(introTimerRef.current);
      clearTimeout(floorRevealTimerRef.current);
      clearTimeout(floorBackstopRef.current);
    };
  }, [viewerReady, scene]);

  // ── Intro gate ──
  // Fire the armed cinematic entrance once the intro is released. `readyForIntro`
  // flips true when assets finish loading; `introReleased` is the external gate
  // (mobile: the welcome "Comenzar" tap). Both true → run the runner exactly once.
  useEffect(() => {
    if (!readyForIntro || !introReleased) return;
    const run = cinematicRunnerRef.current;
    if (!run) return;
    cinematicRunnerRef.current = null;
    run();
  }, [readyForIntro, introReleased]);

  // Re-arm the reveal curtain whenever the viewer tears down (e.g. AR remount),
  // so it masks the next load instead of staying open on the default pose.
  useEffect(() => {
    if (!viewerReady) {
      setFramed(false);
      cinematicPlayedRef.current = false;
      cinematicRunnerRef.current = null;
      setReadyForIntro(false);
    }
  }, [viewerReady]);

  // ── Apply transforms when they change from Firebase ──
  useEffect(() => {
    if (!viewerReady || !scene?.transforms || !viewerRef.current) return;

    const v = viewerRef.current;
    const t = scene.transforms;
    if (t.glb) v.applyTransform('glb', t.glb);
    if (t.colliders) v.applyTransform('colliders', t.colliders);
    if (t.sog) v.applyTransform('sog', t.sog);
    if (t.skybox) v.applyTransform('skybox', t.skybox);
    // Always apply (fallback to {} → schema defaults) so the floor gets
    // positioned and revealed even on legacy scenes with no saved transform.
    v.applyTransform('floor', t.floor || {});
    if (t.mask) v.applyTransform('mask', t.mask);
  }, [viewerReady, scene?.transforms]);

  // ── Apply orbit settings ──
  // Depend on the orbit *values*, not its object identity. Every Firebase
  // update (e.g. a gizmo transform write, which also bumps `updatedAt`) rebuilds
  // the scene via `{ ...data }`, handing us a fresh `scene.orbit` reference with
  // identical contents. Keying on reference would re-fire `applyOrbit` on every
  // transform, which recenters `controls.target` and snaps the camera back.
  const orbitKey = scene?.orbit ? JSON.stringify(scene.orbit) : null;
  useEffect(() => {
    if (!viewerReady || !viewerRef.current || !orbitKey) return;
    viewerRef.current.applyOrbit(JSON.parse(orbitKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerReady, orbitKey]);

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

  // ── Apply BG-only post-process blur ──
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    viewerRef.current.setBgBlur?.(scene?.bgBlur ?? 0);
  }, [viewerReady, scene?.bgBlur]);

  // ── Apply environment desaturation settings ──
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    viewerRef.current.setSaturation(scene?.saturation);
  }, [viewerReady, scene?.saturation]);

  // ── Apply splat color (brillo/contraste + recorte de neblina cercana) ──
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    if (scene?.splatColor) viewerRef.current.setSplatColor?.(scene.splatColor);
  }, [viewerReady, scene?.splatColor]);

  return {
    loadMetrics,
    resetLoadedAsset,
    framed,
  };
}
