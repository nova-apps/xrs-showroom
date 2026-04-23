'use client';

/**
 * Scene Page — fullscreen 3D viewer with floating panels.
 * Loads scene data from Firebase and renders GLB + SOG + environment.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useScene } from '@/hooks/useScene';
import { useHistory } from '@/hooks/useHistory';
import { updateScene } from '@/lib/scenes';
import UnidadesListPanel from '@/components/panels/UnidadesListPanel';
import AmenitiesListPanel from '@/components/panels/AmenitiesListPanel';
import SceneEditorPanel from '@/components/panels/SceneEditorPanel';

import OrbitPanel from '@/components/panels/OrbitPanel';
import UnidadesPanel from '@/components/panels/UnidadesPanel';
import PresetsPanel from '@/components/panels/PresetsPanel';
import LeftPanelStack from '@/components/panels/LeftPanelStack';
import RightPanelStack from '@/components/panels/RightPanelStack';
import CameraSelector from '@/components/ui/CameraSelector';

// Dynamic import for client-only 3D components (no SSR)
const Viewer3D = dynamic(() => import('@/components/viewer/Viewer3D'), { ssr: false });
const PerformancePanel = dynamic(() => import('@/components/panels/PerformancePanel'), { ssr: false });
const MaterialPanel = dynamic(() => import('@/components/panels/MaterialPanel'), { ssr: false });


export default function ScenePage() {
  const params = useParams();
  const sceneId = params?.id;
  const viewerRef = useRef(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [dismissing, setDismissing] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStatus, setLoadStatus] = useState('Iniciando…');
  const [loadMetrics, setLoadMetrics] = useState(null);

  const [modalUnit, setModalUnit] = useState(null);
  const [modalAmenity, setModalAmenity] = useState(null);
  const [assetVisibility, setAssetVisibility] = useState({ glb: true, colliders: true, sog: true, skybox: true, floor: true });
  const [gizmoMode, setGizmoMode] = useState('select');
  const [gizmoAsset, setGizmoAsset] = useState('glb');
  const [hdriFromSkybox, setHdriFromSkybox] = useState(false);
  const [cameraInfo, setCameraInfo] = useState({ pitch: 0, yaw: 0, zoom: 0 });
  const cameraSelectorRef = useRef(null);

  // Track load timing
  const loadTimingRef = useRef({ startTime: null, pending: 0, done: false });

  // Track which assets have been loaded to avoid re-loading
  const loadedAssetsRef = useRef({
    glb: null,
    colliders: null,
    sog: null,
    skybox: null,
    floor: null,
    modelHdri: null,
  });

  const {
    scene,
    loading,
    error,
    uploadProgress,
    updateTransforms,
    updateOrbit,
    updateMaterials,
    updateUnidades,
    updateAmenities,
    updateLighting,
    updateGlbSettings,
    updateSplatSettings,
    updateCollidersVisible,
    uploadAsset,
    removeAsset,
  } = useScene(sceneId);

  // ─── Undo / Redo history ───
  const snapshotRef = useRef({}); // tracks "before" state for in-progress edits

  const history = useHistory({
    transform: {
      apply: (assetType, transforms) => {
        if (viewerRef.current) viewerRef.current.applyTransform(assetType, transforms);
      },
      save: (assetType, transforms) => {
        updateTransforms(assetType, transforms);
      },
    },
    lighting: {
      apply: (_key, lighting) => {
        if (viewerRef.current) viewerRef.current.setLighting(lighting);
      },
      save: (_key, lighting) => {
        updateLighting(lighting);
      },
    },
    visibility: {
      apply: (assetType, visible) => {
        setAssetVisibility((prev) => ({ ...prev, [assetType]: visible }));
        if (viewerRef.current) viewerRef.current.setAssetVisible(assetType, visible);
      },
      save: () => {}, // visibility is local-only, no Firebase persist
    },
  });

  const handleViewerReady = useCallback(() => {
    setViewerReady(true);
  }, []);

  // Load/update assets when scene data changes and viewer is ready
  // Priority: GLB + floor first (critical), dismiss loading overlay, then load rest
  useEffect(() => {
    if (!viewerReady || !scene || !viewerRef.current) return;

    const v = viewerRef.current;
    const assets = scene.assets || {};
    const loaded = loadedAssetsRef.current;
    const timing = loadTimingRef.current;

    async function loadAssets() {
      timing.startTime = timing.startTime || performance.now();

      // ── Phase 1: Critical assets (GLB + Floor) ──
      const criticalPromises = [];
      let hasCritical = false;

      setLoadStatus('Cargando modelo 3D…');
      setLoadProgress(0.05);

      const glbUrl = assets.glb?.url || null;
      if (glbUrl !== loaded.glb) {
        loaded.glb = glbUrl;
        if (glbUrl) {
          hasCritical = true;
          criticalPromises.push(v.loadGlb(glbUrl, scene.glbSettings || undefined));
        } else {
          v.removeGlb();
        }
      }

      const floorUrl = assets.floor?.url || null;
      if (floorUrl !== loaded.floor) {
        loaded.floor = floorUrl;
        if (floorUrl) {
          hasCritical = true;
          criticalPromises.push(v.loadFloorTexture(floorUrl));
        } else {
          v.removeFloorTexture();
        }
      }

      // Wait for GLB + floor
      if (criticalPromises.length > 0) {
        await Promise.all(criticalPromises).catch(() => {});
      }

      setLoadProgress(0.8);
      setLoadStatus('Listo');

      // ── Apply initial camera position after GLB is loaded ──
      if (scene.orbit?.initialCamera) {
        setTimeout(() => {
          viewerRef.current?.setInitialCameraPosition(scene.orbit.initialCamera);
        }, 150);
      }

      // ── Dismiss loading overlay — maqueta is visible ──
      if (hasCritical || !loadingAssets) {
        setLoadProgress(1);
        setTimeout(() => {
          setDismissing(true);
          setTimeout(() => setLoadingAssets(false), 900);
        }, 300);
      } else {
        // No critical assets to load — dismiss immediately
        setDismissing(true);
        setTimeout(() => setLoadingAssets(false), 900);
      }

      // ── Phase 2: Secondary assets — load in background ──
      const bgPromises = [];

      const collidersUrl = assets.colliders?.url || null;
      if (collidersUrl !== loaded.colliders) {
        loaded.colliders = collidersUrl;
        if (collidersUrl) {
          bgPromises.push((async () => {
            await v.loadColliders(collidersUrl);
            const vis = scene.collidersVisible;
            if (vis === false) v.setCollidersVisible(false);
          })());
        } else {
          v.removeColliders();
        }
      }

      const sogUrl = assets.sog?.url || null;
      if (sogUrl !== loaded.sog) {
        loaded.sog = sogUrl;
        if (sogUrl) bgPromises.push(v.loadSog(sogUrl, scene.splatSettings || undefined).catch(() => {}));
        else v.removeSog();
      }

      const skyUrl = assets.skybox?.url || null;
      if (skyUrl !== loaded.skybox) {
        loaded.skybox = skyUrl;
        if (skyUrl) bgPromises.push(v.loadSkyboxTexture(skyUrl).catch(() => {}));
        else v.removeSkyboxTexture();
      }

      const modelHdriUrl = assets.modelHdri?.url || null;
      if (modelHdriUrl !== loaded.modelHdri) {
        loaded.modelHdri = modelHdriUrl;
        if (modelHdriUrl) bgPromises.push(v.loadModelHdri(modelHdriUrl).catch(() => {}));
        else v.removeModelHdri();
      }

      if (bgPromises.length > 0) {
        await Promise.all(bgPromises).catch(() => {});
      }

      // Measure total load time
      if (timing.startTime && !timing.done) {
        const totalTime = Math.round(performance.now() - timing.startTime);
        timing.done = true;
        setLoadMetrics({ totalTime });
        console.log(`[Perf] Total load time: ${totalTime}ms`);
      }
    }

    loadAssets();
  }, [viewerReady, scene]);

  // Apply transforms when they change from Firebase
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

  // Apply saved material overrides when they arrive from Firebase
  useEffect(() => {
    if (!viewerReady || !viewerRef.current || !scene?.materials) return;
    viewerRef.current.applyMaterialOverrides(scene.materials);
  }, [viewerReady, scene?.materials]);

  // Apply saved lighting settings when they arrive from Firebase
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;
    const lighting = scene?.lighting;
    if (lighting) {
      viewerRef.current.setLighting(lighting);
    }
  }, [viewerReady, scene?.lighting]);

  // Handle transform changes from the panel (live update + debounced save + history)
  const historyTimers = useRef({});

  const handleTransformChange = useCallback(
    (type, transforms) => {
      // Capture "before" snapshot on the first change of a drag/slider interaction
      const snapKey = `transform:${type}`;
      if (!snapshotRef.current[snapKey]) {
        snapshotRef.current[snapKey] = JSON.parse(JSON.stringify(
          scene?.transforms?.[type] || {}
        ));
      }

      updateTransforms(type, transforms);

      // Debounce the history push — only commit when the user stops changing
      if (historyTimers.current[snapKey]) clearTimeout(historyTimers.current[snapKey]);
      historyTimers.current[snapKey] = setTimeout(() => {
        const before = snapshotRef.current[snapKey];
        delete snapshotRef.current[snapKey];
        if (before) {
          history.push({
            type: 'transform',
            key: type,
            before,
            after: JSON.parse(JSON.stringify(transforms)),
          });
        }
      }, 600);
    },
    [updateTransforms, scene?.transforms, history]
  );

  // Apply transform immediately to 3D objects (no delay)
  const handleApplyTransform = useCallback(
    (type, transforms) => {
      if (viewerRef.current) {
        viewerRef.current.applyTransform(type, transforms);
      }
    },
    []
  );

  // Handle orbit changes from the panel (live update + debounced save)
  const handleOrbitChange = useCallback(
    (orbit) => {
      updateOrbit(orbit);
    },
    [updateOrbit]
  );

  // Handle lighting changes from the panel (debounced save + history)
  const handleLightingChange = useCallback(
    (lighting) => {
      const snapKey = 'lighting';
      if (!snapshotRef.current[snapKey]) {
        snapshotRef.current[snapKey] = JSON.parse(JSON.stringify(
          scene?.lighting || { ambientIntensity: 0.6, ambientColor: '#ffffff', envMapIntensity: 1.0 }
        ));
      }

      updateLighting(lighting);

      if (historyTimers.current[snapKey]) clearTimeout(historyTimers.current[snapKey]);
      historyTimers.current[snapKey] = setTimeout(() => {
        const before = snapshotRef.current[snapKey];
        delete snapshotRef.current[snapKey];
        if (before) {
          history.push({
            type: 'lighting',
            key: 'lighting',
            before,
            after: JSON.parse(JSON.stringify(lighting)),
          });
        }
      }, 600);
    },
    [updateLighting, scene?.lighting, history]
  );

  // Apply lighting immediately to 3D scene (no delay)
  const handleApplyLighting = useCallback(
    (lighting) => {
      if (viewerRef.current) {
        viewerRef.current.setLighting(lighting);
      }
    },
    []
  );

  // Apply orbit immediately to controls (no delay)
  const handleApplyOrbit = useCallback(
    (orbit) => {
      if (viewerRef.current) {
        viewerRef.current.applyOrbit(orbit);
      }
    },
    []
  );

  // Handle GLB settings change — persist and update viewer
  const handleGlbSettingsChange = useCallback(
    (settings) => {
      updateGlbSettings(settings);
      if (viewerRef.current) {
        viewerRef.current.setGlbSettings(settings);
      }
    },
    [updateGlbSettings]
  );

  // Handle splat settings change — persist and update viewer
  const handleSplatSettingsChange = useCallback(
    (settings) => {
      updateSplatSettings(settings);
      if (viewerRef.current) {
        viewerRef.current.setSplatSettings(settings);
      }
    },
    [updateSplatSettings]
  );

  // Handle asset upload — force reload the asset in the viewer
  const handleUpload = useCallback(
    async (assetType, file) => {
      try {
        const result = await uploadAsset(assetType, file);
        // Reset loaded tracking so the effect will load the new asset
        loadedAssetsRef.current[assetType] = null;
        // Reset load timing for new measurements
        loadTimingRef.current = { startTime: null, pending: 0, done: false };
        setLoadMetrics(null);

        // Force immediate reload if the viewer is ready
        if (viewerReady && viewerRef.current && result?.url) {
          const v = viewerRef.current;
          const loaders = {
            glb: () => v.loadGlb(result.url),
            colliders: () => v.loadColliders(result.url),
            sog: () => v.loadSog(result.url),
            skybox: () => v.loadSkyboxTexture(result.url),
            floor: () => v.loadFloorTexture(result.url),
            modelHdri: () => v.loadModelHdri(result.url),
          };
          if (loaders[assetType]) {
            loadedAssetsRef.current[assetType] = result.url;
            loaders[assetType]();
          }
        }
      } catch (err) {
        console.error(`Upload failed [${assetType}]:`, err);
      }
    },
    [uploadAsset, viewerReady]
  );

  // Handle asset removal
  const handleRemove = useCallback(
    async (assetType) => {
      try {
        await removeAsset(assetType);
        loadedAssetsRef.current[assetType] = null;
      } catch (err) {
        console.error(`Remove failed [${assetType}]:`, err);
      }
    },
    [removeAsset]
  );

  // Handle asset visibility toggle (with history)
  const handleVisibilityChange = useCallback((assetType, visible) => {
    const prevVisible = assetVisibility[assetType] !== false;
    history.push({
      type: 'visibility',
      key: assetType,
      before: prevVisible,
      after: visible,
    });
    setAssetVisibility((prev) => ({ ...prev, [assetType]: visible }));
    if (viewerRef.current) {
      viewerRef.current.setAssetVisible(assetType, visible);
    }
  }, [assetVisibility, history]);

  // Handle active section change — update gizmo target
  const handleActiveSectionChange = useCallback((section) => {
    const gizmoTargets = ['glb', 'colliders', 'sog'];
    if (gizmoTargets.includes(section)) {
      setGizmoAsset(section);
      if (gizmoMode !== 'select' && viewerRef.current) {
        viewerRef.current.setGizmoMode(gizmoMode, section);
      }
    } else if (viewerRef.current) {
      // Non-gizmo section — detach 3D gizmo but keep mode
      viewerRef.current.detachGizmo();
    }
  }, [gizmoMode]);

  // Handle gizmo mode change
  const handleGizmoMode = useCallback((mode) => {
    setGizmoMode(mode);
    if (!viewerRef.current) return;
    if (mode === 'select') {
      viewerRef.current.detachGizmo();
    } else {
      viewerRef.current.setGizmoMode(mode, gizmoAsset);
    }
  }, [gizmoAsset]);

  // Register gizmo callbacks when viewer is ready
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;

    viewerRef.current.setGizmoChangeCallback((assetType, transforms) => {
      updateTransforms(assetType, transforms);
    });

    viewerRef.current.setGizmoDragEndCallback((assetType, before, after) => {
      history.push({
        type: 'transform',
        key: assetType,
        before,
        after,
      });
    });

    // Sync camera orientation to ViewCube + camera info panel
    viewerRef.current.setCameraRotationCallback((rot) => {
      cameraSelectorRef.current?.setCameraRotation(rot);
    });
    viewerRef.current.setCameraInfoCallback(setCameraInfo);
  }, [viewerReady, updateTransforms, history]);

  // Handle camera view preset
  const handleCameraView = useCallback((viewName) => {
    if (viewerRef.current) {
      viewerRef.current.setCameraView(viewName);
    }
  }, []);

  // Handle "use skybox as model HDRI" toggle
  const handleHdriFromSkybox = useCallback((checked) => {
    setHdriFromSkybox(checked);
    if (!viewerRef.current) return;
    if (checked) {
      // Use skybox URL as model HDRI
      const skyboxUrl = scene?.assets?.skybox?.url;
      if (skyboxUrl) {
        viewerRef.current.loadModelHdri(skyboxUrl);
      }
    } else {
      // Revert: load dedicated model HDRI or remove
      const modelHdriUrl = scene?.assets?.modelHdri?.url;
      if (modelHdriUrl) {
        viewerRef.current.loadModelHdri(modelHdriUrl);
      } else {
        viewerRef.current.removeModelHdri();
      }
    }
  }, [scene?.assets?.skybox?.url, scene?.assets?.modelHdri?.url]);

  // Save satellite URL to scene for next time
  const handleSaveSatelliteUrl = useCallback((satelliteUrl) => {
    if (sceneId) updateScene(sceneId, { satelliteUrl }).catch(console.error);
  }, [sceneId]);

  // Handle ViewCube drag — orbit camera in real time
  const handleCubeDragRotate = useCallback((rot) => {
    if (viewerRef.current) {
      viewerRef.current.setCameraFromRotation(rot.x, rot.y);
    }
  }, []);

  // Handle unit selection — trigger camera animation, open modal when done
  const handleSelectUnit = useCallback((unit) => {
    if (viewerRef.current && unit?.id) {
      viewerRef.current.focusOnCollider(String(unit.id), () => {
        setModalUnit(unit);
      });
    } else {
      // No collider model loaded — open modal immediately
      setModalUnit(unit);
    }
  }, []);

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
      {/* Fullscreen 3D Viewer */}
      <Viewer3D ref={viewerRef} onReady={handleViewerReady} />

      {/* Split loading screen while critical assets load */}
      {loadingAssets && (
        <div className={`loading-split${dismissing ? ' dismissing' : ''}`}>
          <div className="loading-split-half loading-split-top" />
          <div className="loading-split-half loading-split-bottom" />
          <div className="loader-content">
            <div className="loader-spinner" />
            <div className="loader-title">{scene.name}</div>
            <div className="loader-progress-bar">
              <div
                className="loader-progress-fill"
                style={{ width: `${Math.round(loadProgress * 100)}%` }}
              />
            </div>
            <div className="loader-status">{loadStatus}{loadProgress > 0 && loadProgress < 1 ? ` (${Math.round(loadProgress * 100)}%)` : ''}</div>
          </div>
        </div>
      )}

      {/* Orbit center crosshair */}
      <div className="orbit-crosshair" />

      {/* Bottom-right: ViewCube + camera info + compact performance */}
      <div className="bottom-right-bar">
        <PerformancePanel
          scene={scene}
          loadMetrics={loadMetrics}
          viewerRef={viewerRef}
        />
        <div className="bottom-right-stack">
          <CameraSelector ref={cameraSelectorRef} onSelectView={handleCameraView} onDragRotate={handleCubeDragRotate} />
          <div className="camera-info-panel">
            <span className="camera-info-item"><span className="camera-info-label">Zoom</span>{cameraInfo.zoom}</span>
            <span className="camera-info-item"><span className="camera-info-label">Pitch</span>{cameraInfo.pitch}°</span>
            <span className="camera-info-item"><span className="camera-info-label">Yaw</span>{cameraInfo.yaw}°</span>
          </div>
        </div>
      </div>

      {/* Left Sidebar — Units listing only */}
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

      {/* Right Sidebar — Scene settings & adjustments */}
      <RightPanelStack
        sceneName={scene.name}
        sceneId={sceneId}
      >
        {({ activePanel, toggle }) => (
          <>
            <SceneEditorPanel
              scene={scene}
              uploadProgress={uploadProgress}
              onUpload={handleUpload}
              onRemove={handleRemove}
              onTransformChange={handleTransformChange}
              onApplyTransform={handleApplyTransform}
              onVisibilityChange={handleVisibilityChange}
              visibility={assetVisibility}
              onLightingChange={handleLightingChange}
              onApplyLighting={handleApplyLighting}
              onActiveSectionChange={handleActiveSectionChange}
              viewerRef={viewerRef}
              viewerReady={viewerReady}
              hdriFromSkybox={hdriFromSkybox}
              onHdriFromSkybox={handleHdriFromSkybox}
              gizmoMode={gizmoMode}
              onGizmoMode={handleGizmoMode}
              onSaveSatelliteUrl={handleSaveSatelliteUrl}
              glbSettings={scene?.glbSettings || null}
              onGlbSettingsChange={handleGlbSettingsChange}
              splatSettings={scene?.splatSettings || null}
              onSplatSettingsChange={handleSplatSettingsChange}
              collapsed={activePanel !== 'assets'}
              onToggle={() => toggle('assets')}
              materialsContent={
                <MaterialPanel
                  viewerRef={viewerRef}
                  viewerReady={viewerReady}
                  savedMaterials={scene?.materials || null}
                  onMaterialsChange={updateMaterials}
                  collapsed={false}
                  onToggle={() => {}}
                  inline
                />
              }
            />

            <OrbitPanel
              scene={scene}
              onOrbitChange={handleOrbitChange}
              onApplyOrbit={handleApplyOrbit}
              viewerRef={viewerRef}
              collapsed={activePanel !== 'orbit'}
              onToggle={() => toggle('orbit')}
            />

            <PresetsPanel
              collapsed={activePanel !== 'presets'}
              onToggle={() => toggle('presets')}
            />

            <UnidadesPanel
              scene={scene}
              sceneId={sceneId}
              onUnidadesChange={updateUnidades}
              onAmenitiesChange={updateAmenities}
              collapsed={activePanel !== 'unidades'}
              onToggle={() => toggle('unidades')}
            />
          </>
        )}
      </RightPanelStack>
    </>
  );
}
