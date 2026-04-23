'use client';

/**
 * Public View Page — fullscreen 3D viewer without any editing panels.
 * Route: /view/[id]
 * 
 * Supports:
 *   - Progressive loading (proxy GLB → full GLB swap)
 *   - Real download progress tracking via ReadableStream
 *   - Sequential loading on mobile to avoid memory spikes
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useScene } from '@/hooks/useScene';

import LeftPanelStack from '@/components/panels/LeftPanelStack';
import UnidadesListPanel from '@/components/panels/UnidadesListPanel';
import AmenitiesListPanel from '@/components/panels/AmenitiesListPanel';

const Viewer3D = dynamic(() => import('@/components/viewer/Viewer3D'), { ssr: false });
const FpsCounter = dynamic(() => import('@/components/viewer/FpsCounter'), { ssr: false });

export default function ViewPage() {
  const params = useParams();
  const sceneId = params?.id;
  const viewerRef = useRef(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [dismissing, setDismissing] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStatus, setLoadStatus] = useState('Iniciando…');


  const [modalUnit, setModalUnit] = useState(null);
  const [modalAmenity, setModalAmenity] = useState(null);

  const loadedAssetsRef = useRef({
    glb: null,
    colliders: null,
    sog: null,
    skybox: null,
    floor: null,
  });

  const { scene, loading, error } = useScene(sceneId);

  const handleViewerReady = useCallback(() => {
    setViewerReady(true);
  }, []);

  // Load assets when scene data arrives
  // Priority: GLB model + floor first (critical), then dismiss loading screen,
  // then load remaining assets (skybox, SOG) in background
  useEffect(() => {
    if (!viewerReady || !scene || !viewerRef.current) return;

    const v = viewerRef.current;
    const assets = scene.assets || {};
    const loaded = loadedAssetsRef.current;

    async function loadAssets() {
      // ── Phase 1: Critical assets (GLB + Floor) ──
      // These define the maqueta — load them first and dismiss loading screen after
      const criticalPromises = [];

      setLoadStatus('Cargando modelo 3D…');
      setLoadProgress(0.05);

      // GLB model — use progressive loading if proxy is available
      const glbUrl = assets.glb?.url || null;
      const proxyUrl = assets.glb_proxy?.url || null;

      if (glbUrl && glbUrl !== loaded.glb) {
        loaded.glb = glbUrl;

        if (proxyUrl) {
          criticalPromises.push(
            v.loadGlbProgressive(proxyUrl, glbUrl, (p) => {
              setLoadProgress(0.05 + p * 0.75);
            }).catch(() => {})
          );
        } else {
          criticalPromises.push(
            v.loadGlbWithProgress(glbUrl, (p) => {
              setLoadProgress(0.05 + p * 0.75);
            }).catch(() => {})
          );
        }
      }

      // Floor texture
      const floorUrl = assets.floor?.url || null;
      if (floorUrl && floorUrl !== loaded.floor) {
        loaded.floor = floorUrl;
        criticalPromises.push(v.loadFloorTexture(floorUrl).catch(() => {}));
      }

      // Wait for GLB + floor to finish
      if (criticalPromises.length > 0) {
        await Promise.all(criticalPromises);
      }

      setLoadProgress(1);
      setLoadStatus('Listo');

      // ── Apply initial camera position after GLB is loaded ──
      if (scene.orbit?.initialCamera) {
        setTimeout(() => {
          viewerRef.current?.setInitialCameraPosition(scene.orbit.initialCamera);
        }, 150);
      }

      // ── Dismiss loading screen — maqueta is visible ──
      setTimeout(() => {
        setDismissing(true);
        // Remove overlay after animation completes (800ms CSS transition)
        setTimeout(() => setLoadingAssets(false), 900);
      }, 300);

      // ── Phase 2: Secondary assets (colliders, skybox, SOG) — load in background ──
      const bgPromises = [];

      const collidersUrl = assets.colliders?.url || null;
      if (collidersUrl && collidersUrl !== loaded.colliders) {
        loaded.colliders = collidersUrl;
        bgPromises.push(v.loadColliders(collidersUrl).then(() => {
          // Hide colliders in view mode — they're only used for click targeting
          v.setCollidersVisible(false);
        }).catch(() => {}));
      }

      const skyUrl = assets.skybox?.url || null;
      if (skyUrl && skyUrl !== loaded.skybox) {
        loaded.skybox = skyUrl;
        bgPromises.push(v.loadSkyboxTexture(skyUrl).catch(() => {}));
      }

      const sogUrl = assets.sog?.url || null;
      if (sogUrl && sogUrl !== loaded.sog) {
        loaded.sog = sogUrl;
        bgPromises.push(v.loadSog(sogUrl).catch(() => {}));
      }

      if (bgPromises.length > 0) {
        // Detect mobile for sequential loading to avoid memory spikes
        const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        if (isMobile) {
          console.log('[View] Mobile — loading secondary assets sequentially');
          for (const p of bgPromises) {
            await p;
          }
        } else {
          await Promise.all(bgPromises);
        }
        console.log('[View] ✓ All secondary assets loaded');
      }
    }

    loadAssets();
  }, [viewerReady, scene]);

  // Apply transforms
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

  // Apply orbit settings when they change from Firebase
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const orbit = scene?.orbit;
    if (orbit) {
      viewerRef.current.applyOrbit(orbit);
    }
  }, [viewerReady, scene?.orbit]);

  // Apply lighting settings
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const lighting = scene?.lighting;
    if (lighting) {
      viewerRef.current.setLighting(lighting);
    }
  }, [viewerReady, scene?.lighting]);

  // Apply saved material overrides when they arrive from Firebase
  useEffect(() => {
    if (!viewerReady || !viewerRef.current || !scene?.materials) return;
    viewerRef.current.applyMaterialOverrides(scene.materials);
  }, [viewerReady, scene?.materials]);



  const handleSelectUnit = useCallback((unit) => {
    if (viewerRef.current && unit?.id) {
      viewerRef.current.focusOnCollider(String(unit.id), () => {
        setModalUnit(unit);
      });
    } else {
      setModalUnit(unit);
    }
  }, []);

  // Error state — only show after Firebase has finished loading

  if (!loading && (error || !scene)) {
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

  const progressPct = Math.round(loadProgress * 100);

  return (
    <>
      <Viewer3D ref={viewerRef} onReady={handleViewerReady} />

      {/* Left Sidebar — Units listing only */}
      {scene && (
        <LeftPanelStack title={scene.name} show={!loadingAssets}>
        {({ activePanel, toggle }) => (
          <>
            <UnidadesListPanel
              unidades={scene?.unidades?.items || []}
              onSelectUnit={handleSelectUnit}
              selectedUnit={modalUnit}
              onCloseModal={() => setModalUnit(null)}
              collapsed={activePanel !== 'unidadesList'}
              onToggle={() => toggle('unidadesList')}
              whatsappNumber={scene?.whatsappNumber || ''}
              projectName={scene?.name || ''}
            />
            <AmenitiesListPanel
              amenities={scene?.amenities?.items || []}
              onSelectAmenity={setModalAmenity}
              selectedAmenity={modalAmenity}
              onCloseModal={() => setModalAmenity(null)}
              collapsed={activePanel !== 'amenitiesList'}
              onToggle={() => toggle('amenitiesList')}
            />
          </>
        )}
        </LeftPanelStack>
      )}

      {/* Split loading screen */}
      {loadingAssets && (
        <div className={`loading-split${dismissing ? ' dismissing' : ''}`}>
          <div className="loading-split-half loading-split-top" />
          <div className="loading-split-half loading-split-bottom" />
          <div className="loader-content">
            <div className="loader-spinner" />
            <div className="loader-title">{scene?.name || 'Cargando…'}</div>
            <div className="loader-progress-bar">
              <div
                className="loader-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="loader-status">{loadStatus}{progressPct > 0 && progressPct < 100 ? ` (${progressPct}%)` : ''}</div>
          </div>
        </div>
      )}
    </>
  );
}
