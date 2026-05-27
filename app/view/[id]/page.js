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
import LotesListPanel from '@/components/panels/LotesListPanel';
import LoteModal from '@/components/panels/LoteModal';

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
  const [modalLote, setModalLote] = useState(null);
  const [highlightedLote, setHighlightedLote] = useState(null);

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

  const isTerreno = scene?.type === 'terreno';

  const handleSelectTab = useCallback((tabId, { isMobile }) => {
    // Both the unidades and lotes lists pull the camera back to its initial
    // mobile framing when their tab gets tapped on a small viewport.
    if (!isMobile) return;
    if (tabId !== 'unidades' && tabId !== 'lotes') return;
    const initial = scene?.orbit?.mobile?.initialCamera || scene?.orbit?.initialCamera;
    if (initial) viewerRef.current?.setInitialCameraPosition(initial);
  }, [scene]);

  // Mobile-only: collapsing the panel back to the initial view drops any
  // currently selected collider so the 3D goes back to a clean state.
  const handlePanelCollapse = useCallback(() => {
    setHighlightedUnit(null);
    setHighlightedLote(null);
  }, []);

  const handleSelectUnit = useCallback((unit) => {
    // Row tap in the panel always opens detail (both desktop and mobile).
    setHighlightedUnit(unit ?? null);
    setModalUnit((prev) => prev?.id === unit?.id ? null : unit);
    if (viewerRef.current && unit?.id) {
      viewerRef.current.focusOnCollider(String(unit.id));
    }
  }, []);

  const handleSelectLote = useCallback((lote) => {
    setHighlightedLote(lote ?? null);
    setModalLote((prev) => prev?.id === lote?.id ? null : lote);
    if (viewerRef.current && lote?.id) {
      viewerRef.current.focusOnCollider(String(lote.id));
    }
  }, []);

  // Keep the 3D collider tint in sync with whatever the user is currently
  // pointing at — either via row tap or collider tap (mobile or desktop).
  // The two highlight states are exclusive per scene type, so just OR them.
  const highlightedColliderId = highlightedLote?.id ?? highlightedUnit?.id ?? null;
  useEffect(() => {
    viewerRef.current?.setSelectedCollider?.(highlightedColliderId);
  }, [highlightedColliderId]);

  const handleColliderClick = useCallback((name) => {
    // Match the same way focusCameraOnCollider does — collider mesh names
    // often have hyphens / different casing than the item IDs.
    const norm = (v) => String(v ?? '').replace(/-/g, '').toLowerCase().trim();
    const target = norm(name);
    if (!target) return;

    const isMobile = typeof window !== 'undefined'
      && window.matchMedia('(max-width: 768px)').matches;

    if (isTerreno) {
      const lote = (scene?.lotes?.items || []).find((l) => norm(l.id) === target);
      if (!lote) return;
      setHighlightedLote(lote);
      panelRef.current?.expand?.('lotes');
      if (viewerRef.current && lote.id != null) {
        viewerRef.current.focusOnCollider(String(lote.id));
      }
      // Mobile: defer opening the modal until the user taps the highlighted row.
      if (!isMobile) setModalLote(lote);
      return;
    }

    const unit = (scene?.unidades?.items || []).find((u) => norm(u.id) === target);
    if (!unit) return;
    setHighlightedUnit(unit);
    panelRef.current?.expand?.('unidades');
    if (viewerRef.current && unit.id != null) {
      viewerRef.current.focusOnCollider(String(unit.id));
    }
    if (!isMobile) setModalUnit(unit);
  }, [scene, isTerreno]);

  const tabs = isTerreno
    ? [{ id: 'lotes', label: 'Lotes' }]
    : [{ id: 'unidades', label: 'Unidades' }, { id: 'amenities', label: 'Amenities' }];

  const loteBarrio = modalLote?.barrioId
    ? (scene?.barrios?.items || []).find((b) => b.id === modalLote.barrioId) || null
    : null;

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

      {/* Left Sidebar — list panel; content swaps by scene.type */}
      {scene && (
        <LeftPanelStack
          ref={panelRef}
          title={scene.name}
          logoUrl={scene?.panelLogoUrl}
          onSelectTab={handleSelectTab}
          onCollapse={handlePanelCollapse}
          tabs={tabs}
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
            {activeTab === 'lotes' && (
              <LotesListPanel
                lotes={scene?.lotes?.items || []}
                barrios={scene?.barrios?.items || []}
                onSelectLote={handleSelectLote}
                selectedLote={highlightedLote}
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
          panoramaSettings={scene?.panoramaSettings}
        />
      )}

      {modalLote && (
        <LoteModal
          lote={modalLote}
          barrio={loteBarrio}
          onClose={() => setModalLote(null)}
          whatsappNumber={scene?.whatsappNumber || ''}
          projectName={scene?.name || ''}
        />
      )}
    </>
  );
}
