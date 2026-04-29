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

import { useRef, useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useScene } from '@/hooks/useScene';
import { useSceneLoader } from '@/hooks/useSceneLoader';

import LeftPanelStack from '@/components/panels/LeftPanelStack';
import UnidadesListPanel from '@/components/panels/UnidadesListPanel';
import AmenitiesListPanel from '@/components/panels/AmenitiesListPanel';

const Viewer3D = dynamic(() => import('@/components/viewer/Viewer3D'), { ssr: false });
const FpsCounter = dynamic(() => import('@/components/viewer/FpsCounter'), { ssr: false });

export default function ViewPage() {
  const params = useParams();
  const sceneId = params?.id;
  const viewerRef = useRef(null);
  const panelRef = useRef(null);
  const [viewerReady, setViewerReady] = useState(false);

  const [modalUnit, setModalUnit] = useState(null);
  const [modalAmenity, setModalAmenity] = useState(null);

  const { scene, loading, error } = useScene(sceneId);

  const {
    loadingAssets,
    dismissing,
    loadProgress,
    loadStatus,
  } = useSceneLoader({
    viewerRef,
    scene,
    viewerReady,
    isEditor: false,
    useProgressiveLoading: true,
  });

  const handleViewerReady = useCallback(() => {
    setViewerReady(true);
  }, []);

  const handleSelectUnit = useCallback((unit) => {
    setModalUnit((prev) => prev?.id === unit?.id ? null : unit);
    if (viewerRef.current && unit?.id) {
      viewerRef.current.focusOnCollider(String(unit.id));
    }
    // Collapse expanded panel on mobile when opening a unit
    panelRef.current?.collapse();
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
        <LeftPanelStack
          ref={panelRef}
          title={scene.name}
          logoUrl={scene?.panelLogoUrl}
          show={!loadingAssets}
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
