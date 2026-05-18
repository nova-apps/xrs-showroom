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

import { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useScene } from '@/hooks/useScene';
import { useSceneLoader } from '@/hooks/useSceneLoader';
import { useDocumentMeta } from '@/hooks/useDocumentMeta';

import LeftPanelStack from '@/components/panels/LeftPanelStack';
import UnidadesListPanel from '@/components/panels/UnidadesListPanel';
import UnidadModal from '@/components/panels/UnidadModal';
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
  const [highlightedUnit, setHighlightedUnit] = useState(null);
  const [modalAmenity, setModalAmenity] = useState(null);

  const { scene: rawScene, loading, error } = useScene(sceneId);

  // /view/ renders the published snapshot. If the scene was never published,
  // fall back to the draft so legacy scenes keep working until first publish.
  const scene = useMemo(() => {
    if (!rawScene) return null;
    if (rawScene.published) {
      return { id: rawScene.id, ...rawScene.published };
    }
    return rawScene;
  }, [rawScene]);

  useDocumentMeta(scene?.name, scene?.panelLogoUrl);

  useSceneLoader({
    viewerRef,
    scene,
    viewerReady,
    isEditor: false,
    useProgressiveLoading: true,
  });

  const handleViewerReady = useCallback(() => {
    setViewerReady(true);
  }, []);

  const handleSelectTab = useCallback((tabId, { isMobile }) => {
    if (!isMobile || tabId !== 'unidades') return;
    const initial = scene?.orbit?.mobile?.initialCamera || scene?.orbit?.initialCamera;
    if (initial) viewerRef.current?.setInitialCameraPosition(initial);
  }, [scene]);

  const handleSelectUnit = useCallback((unit) => {
    // Row tap in the panel always opens detail (both desktop and mobile).
    setHighlightedUnit(unit ?? null);
    setModalUnit((prev) => prev?.id === unit?.id ? null : unit);
    if (viewerRef.current && unit?.id) {
      viewerRef.current.focusOnCollider(String(unit.id));
    }
  }, []);

  // Keep the 3D collider tint in sync with whatever the user is currently
  // pointing at — either via row tap or collider tap (mobile or desktop).
  useEffect(() => {
    viewerRef.current?.setSelectedCollider?.(highlightedUnit?.id ?? null);
  }, [highlightedUnit?.id]);

  const handleColliderClick = useCallback((name) => {
    // Match the same way focusCameraOnCollider does — collider mesh names
    // often have hyphens / different casing than the unit IDs.
    const norm = (v) => String(v ?? '').replace(/-/g, '').toLowerCase().trim();
    const target = norm(name);
    if (!target) return;
    const unit = (scene?.unidades?.items || []).find(
      (u) => norm(u.id) === target,
    );
    if (!unit) return;

    const isMobile = typeof window !== 'undefined'
      && window.matchMedia('(max-width: 768px)').matches;

    setHighlightedUnit(unit);
    panelRef.current?.expand?.('unidades');
    if (viewerRef.current && unit.id != null) {
      viewerRef.current.focusOnCollider(String(unit.id));
    }
    // Mobile: defer opening the detail modal until the user taps the
    // highlighted row in the panel. Keeps the 3D visible for context.
    if (!isMobile) {
      setModalUnit(unit);
    }
  }, [scene]);

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

  return (
    <>
      <Viewer3D ref={viewerRef} onReady={handleViewerReady} onColliderClick={handleColliderClick} />

      {/* Blackout overlay — masks WebGL resize flicker on mobile panel transitions */}
      <div className="canvas-blackout" aria-hidden="true" />

      {/* Canvas-scoped curtain animation — plays immediately on mount */}
      <div className="canvas-curtain">
        <div className="canvas-curtain-half canvas-curtain-top" />
        <div className="canvas-curtain-half canvas-curtain-bottom" />
      </div>

      {/* Left Sidebar — Units listing, always visible */}
      {scene && (
        <LeftPanelStack
          ref={panelRef}
          title={scene.name}
          logoUrl={scene?.panelLogoUrl}
          onSelectTab={handleSelectTab}
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
                selectedUnit={highlightedUnit}
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

      {modalUnit && (
        <UnidadModal
          unit={modalUnit}
          onClose={() => setModalUnit(null)}
          whatsappNumber={scene?.whatsappNumber || ''}
          projectName={scene?.name || ''}
        />
      )}
    </>
  );
}
