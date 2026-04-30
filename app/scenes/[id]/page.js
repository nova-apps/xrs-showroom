'use client';

/**
 * Scene Page — fullscreen 3D viewer with floating panels.
 * Loads scene data from Firebase and renders GLB + SOG + environment.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useScene } from '@/hooks/useScene';
import { useSceneLoader } from '@/hooks/useSceneLoader';
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

  const [modalUnit, setModalUnit] = useState(null);
  const [modalAmenity, setModalAmenity] = useState(null);
  const [assetVisibility, setAssetVisibility] = useState({ glb: true, colliders: true, sog: true, skybox: true, floor: true });
  const [gizmoMode, setGizmoMode] = useState('select');
  const [gizmoAsset, setGizmoAsset] = useState('glb');
  const [hdriFromSkybox, setHdriFromSkybox] = useState(false);
  const [cameraInfo, setCameraInfo] = useState({ pitch: 0, yaw: 0, zoom: 0 });
  const cameraSelectorRef = useRef(null);

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
    updateTint,
    updateGlbSettings,
    updateSplatSettings,
    updateCollidersVisible,
    uploadAsset,
    removeAsset,
  } = useScene(sceneId);

  // ─── Shared scene loader (assets + transforms + orbit + lighting + materials) ───
  const {
    loadMetrics,
    resetLoadedAsset,
  } = useSceneLoader({
    viewerRef,
    scene,
    viewerReady,
    isEditor: true,
  });

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

  // Handle tint changes from the panel (debounced save)
  const handleTintChange = useCallback(
    (tint) => {
      updateTint(tint);
    },
    [updateTint]
  );

  // Apply tint immediately to 3D scene (no delay)
  const handleApplyTint = useCallback(
    (tint) => {
      if (viewerRef.current) {
        viewerRef.current.setTint(tint);
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
        // Reset loaded tracking so the loader hook picks up the new asset
        resetLoadedAsset(assetType);

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
            loaders[assetType]();
          }
        }
      } catch (err) {
        console.error(`Upload failed [${assetType}]:`, err);
      }
    },
    [uploadAsset, viewerReady, resetLoadedAsset]
  );

  // Handle asset removal
  const handleRemove = useCallback(
    async (assetType) => {
      try {
        await removeAsset(assetType);
        resetLoadedAsset(assetType);
      } catch (err) {
        console.error(`Remove failed [${assetType}]:`, err);
      }
    },
    [removeAsset, resetLoadedAsset]
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
    setModalUnit((prev) => prev?.id === unit?.id ? null : unit);
    if (viewerRef.current && unit?.id) {
      viewerRef.current.focusOnCollider(String(unit.id));
    }
  }, []);

  // While Firebase data is loading, render the viewer structure anyway.
  // Scene content will populate once `scene` arrives.

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

  return (
    <>
      {/* Fullscreen 3D Viewer */}
      <Viewer3D ref={viewerRef} onReady={handleViewerReady} />

      {/* Canvas-scoped curtain animation — plays immediately on mount */}
      <div className="canvas-curtain">
        <div className="canvas-curtain-half canvas-curtain-top" />
        <div className="canvas-curtain-half canvas-curtain-bottom" />
      </div>

      {/* Orbit center crosshair */}
      <div className="orbit-crosshair" />

      {/* Bottom-right: ViewCube + camera info + compact performance */}
      <div className="bottom-right-bar">
        {scene && <PerformancePanel
          scene={scene}
          loadMetrics={loadMetrics}
          viewerRef={viewerRef}
        />}
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
      {scene && <LeftPanelStack
        title={scene.name}
        logoUrl={scene?.panelLogoUrl}
        tabs={[
          { id: 'unidades', label: 'Unidades' },
          { id: 'amenities', label: 'Amenities' },
        ]}
      >
        {({ activeTab }) => (
          <>
            {activeTab === 'unidades' && (
              <UnidadesListPanel
                unidades={scene?.unidades?.items || []}
                onSelectUnit={handleSelectUnit}
                selectedUnit={modalUnit}
                onCloseModal={() => setModalUnit(null)}
                whatsappNumber={scene?.whatsappNumber || ''}
                projectName={scene?.name || ''}
              />
            )}
            {activeTab === 'amenities' && (
              <AmenitiesListPanel
                amenities={scene?.amenities?.items || []}
                onSelectAmenity={setModalAmenity}
                selectedAmenity={modalAmenity}
                onCloseModal={() => setModalAmenity(null)}
              />
            )}
          </>
        )}
      </LeftPanelStack>}

      {/* Right Sidebar — Scene settings & adjustments */}
      {scene && <RightPanelStack
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
              onTintChange={handleTintChange}
              onApplyTint={handleApplyTint}
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

            {/* <PresetsPanel
              collapsed={activePanel !== 'presets'}
              onToggle={() => toggle('presets')}
            /> */}

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
      </RightPanelStack>}
    </>
  );
}
