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
import { useAmenityTourPrefetch } from '@/hooks/useAmenityTourPrefetch';

import LeftPanelStack from '@/components/panels/LeftPanelStack';
import UnidadesListPanel from '@/components/panels/UnidadesListPanel';
import UnidadModal from '@/components/panels/UnidadModal';
import AmenitiesListPanel from '@/components/panels/AmenitiesListPanel';
import LotesListPanel from '@/components/panels/LotesListPanel';
import LoteModal from '@/components/panels/LoteModal';

const Viewer3D = dynamic(() => import('@/components/viewer/Viewer3D'), { ssr: false });
const FpsCounter = dynamic(() => import('@/components/viewer/FpsCounter'), { ssr: false });
const ARExperience = dynamic(() => import('@/ar/ARExperience'), { ssr: false });

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
  const [arOpen, setArOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // El botón "Ver en AR" solo se muestra en mobile (la cámara/SLAM viven en el teléfono).
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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

  const { resetLoadedAsset, framed } = useSceneLoader({
    viewerRef,
    scene,
    viewerReady,
    isEditor: false,
    useProgressiveLoading: true,
  });

  // Hold the reveal curtain closed until the camera is framed (no flash of the
  // default pose). Fall back after 6s so it never gets stuck closed.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { if (framed) setRevealed(true); }, [framed]);
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 6000);
    return () => clearTimeout(t);
  }, []);

  const handleViewerReady = useCallback(() => {
    setViewerReady(true);
  }, []);

  // Once the 3D scene is up, warm the HTTP cache with each amenity tour's first
  // panorama (idle, low-priority) so opening a tour later paints instantly.
  useAmenityTourPrefetch(scene, viewerReady);

  const isTerreno = scene?.type === 'terreno';

  // Maqueta para AR: preferir el proxy (más liviano) y caer al GLB completo.
  const arModelUrl = scene?.assets?.glb_proxy?.url || scene?.assets?.glb?.url || null;
  const showArButton = isMobile && !!arModelUrl && !arOpen && scene?.showArButton !== false;

  // Mientras el AR posee la pantalla, DESMONTAMOS el Viewer3D principal por completo
  // (no solo lo pausamos) para liberar su VRAM: GLB + splat full-quality + texturas
  // seguían residentes en GPU y, sumados al splat + feed de cámara del AR, cruzaban el
  // límite de memoria de iOS y disparaban el recargado del tab. Reseteamos el tracking
  // del loader para que, al cerrar el AR y remontarse el viewer, la escena recargue limpia.
  useEffect(() => {
    if (!arOpen) return;
    setViewerReady(false);
    ['glb', 'colliders', 'sog', 'skybox', 'floor', 'modelHdri'].forEach(resetLoadedAsset);
  }, [arOpen, resetLoadedAsset]);

  // Animate the camera back to the scene's initial framing (mobile override
  // first, then the shared initial). Shared by every deselect gesture below.
  const resetCameraToInitial = useCallback(() => {
    const initial = scene?.orbit?.mobile?.initialCamera || scene?.orbit?.initialCamera;
    if (initial) viewerRef.current?.setInitialCameraPosition(initial);
  }, [scene]);

  const handleSelectTab = useCallback((tabId, { isMobile }) => {
    // Both the unidades and lotes lists pull the camera back to its initial
    // mobile framing when their tab gets tapped on a small viewport.
    if (!isMobile) return;
    if (tabId !== 'unidades' && tabId !== 'lotes') return;
    resetCameraToInitial();
  }, [resetCameraToInitial]);

  // Mobile-only: collapsing the panel is a deselect — drop the selected
  // collider AND pull the camera back to its initial framing (only if
  // something was actually selected, so the mount-time collapse is a no-op).
  const handlePanelCollapse = useCallback(() => {
    if (highlightedUnit || highlightedLote) resetCameraToInitial();
    setHighlightedUnit(null);
    setHighlightedLote(null);
  }, [highlightedUnit, highlightedLote, resetCameraToInitial]);

  // Move the camera to a unit: use its operator-saved pose when present
  // (set via the editor's unit-cameras tool), else the auto-computed framing.
  const focusUnit = useCallback((unitId) => {
    const v = viewerRef.current;
    if (!v || unitId == null) return;
    const pose = scene?.orbit?.unitCameras?.[String(unitId)];
    if (pose) v.setInitialCameraPosition(pose, { animate: true });
    else v.focusOnCollider(String(unitId));
  }, [scene?.orbit?.unitCameras]);

  const handleSelectUnit = useCallback((unit) => {
    // Row tap in the panel always opens detail (both desktop and mobile).
    setHighlightedUnit(unit ?? null);
    setModalUnit((prev) => prev?.id === unit?.id ? null : unit);
    if (unit?.id) focusUnit(unit.id);
  }, [focusUnit]);

  const handleSelectLote = useCallback((lote) => {
    setHighlightedLote(lote ?? null);
    setModalLote((prev) => prev?.id === lote?.id ? null : lote);
    if (viewerRef.current && lote?.id) {
      viewerRef.current.focusOnCollider(String(lote.id));
    }
  }, []);

  // Closing a detail on mobile is also a deselect: clear the highlight and
  // return the camera to its initial framing. On desktop the modal is a side
  // panel, so closing it just dismisses the panel (camera/highlight untouched).
  const handleCloseUnitModal = useCallback(() => {
    setModalUnit(null);
    if (isMobile) {
      setHighlightedUnit(null);
      resetCameraToInitial();
    }
  }, [isMobile, resetCameraToInitial]);

  const handleCloseLoteModal = useCallback(() => {
    setModalLote(null);
    if (isMobile) {
      setHighlightedLote(null);
      resetCameraToInitial();
    }
  }, [isMobile, resetCameraToInitial]);

  // Keep the 3D collider tint in sync with whatever the user is currently
  // pointing at — either via row tap or collider tap (mobile or desktop).
  // The two highlight states are exclusive per scene type, so just OR them.
  const highlightedColliderId = highlightedLote?.id ?? highlightedUnit?.id ?? null;
  useEffect(() => {
    viewerRef.current?.setSelectedCollider?.(highlightedColliderId);
  }, [highlightedColliderId]);

  // Availability tint: map each unit's estado onto its collider so disponible/
  // reservado/vendido reads straight from the maqueta (FLO-1). Units without an
  // estado are omitted → their collider stays neutral/invisible.
  const colliderEstados = useMemo(() => {
    if (isTerreno) return {};
    const map = {};
    for (const u of (scene?.unidades?.items || [])) {
      if (u?.id != null && u.estado) map[String(u.id)] = u.estado;
    }
    return map;
  }, [scene?.unidades, isTerreno]);

  useEffect(() => {
    if (!viewerReady) return;
    viewerRef.current?.setColliderEstados?.(colliderEstados);
  }, [viewerReady, colliderEstados, framed]);

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
    if (unit.id != null) focusUnit(unit.id);
    if (!isMobile) setModalUnit(unit);
  }, [scene, isTerreno, focusUnit]);

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
      {/* Se desmonta mientras el AR está abierto para liberar su VRAM (ver efecto arriba).
          Al cerrarse el AR se remonta y la escena recarga (la cortina enmascara la recarga). */}
      {!arOpen && (
        <Viewer3D ref={viewerRef} onReady={handleViewerReady} onColliderClick={handleColliderClick} />
      )}

      {/* Blackout overlay — masks WebGL resize flicker on mobile panel transitions */}
      <div className="canvas-blackout" aria-hidden="true" />

      {/* Canvas-scoped curtain — opens once the camera is framed (see `revealed`) */}
      <div className={`canvas-curtain${revealed ? ' is-open' : ''}`}>
        <div className="canvas-curtain-half canvas-curtain-top" />
        <div className="canvas-curtain-half canvas-curtain-bottom" />
      </div>

      {/* Left Sidebar — list panel; content swaps by scene.type.
          Se oculta mientras el AR posee la pantalla. */}
      {scene && !arOpen && (
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
          onClose={handleCloseUnitModal}
          whatsappNumber={scene?.whatsappNumber || ''}
          projectName={scene?.name || ''}
          panoramaSettings={scene?.panoramaSettings}
        />
      )}

      {modalLote && (
        <LoteModal
          lote={modalLote}
          barrio={loteBarrio}
          onClose={handleCloseLoteModal}
          whatsappNumber={scene?.whatsappNumber || ''}
          projectName={scene?.name || ''}
        />
      )}

      {/* Botón "Ver en AR" — solo mobile, cuando hay maqueta GLB. */}
      {showArButton && (
        <button
          className="xrs-ar-btn"
          onClick={() => setArOpen(true)}
          aria-label="Ver en AR"
          title="Ver en AR"
          style={{
            position: 'fixed', right: 16,
            top: 'calc(env(safe-area-inset-top, 0px) + 12px)', zIndex: 202,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 46, height: 46, borderRadius: 9999,
            background: '#ab8869', color: '#18120b',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {/* esquinas tipo visor AR */}
            <path d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" />
            {/* cubo 3D */}
            <path d="M12 8.2l3.2 1.8v3.6L12 15.4l-3.2-1.8V10z" />
            <path d="M12 8.2v0M12 11.8l3.2-1.8M12 11.8v3.6M12 11.8L8.8 10" />
          </svg>
        </button>
      )}

      {arOpen && (
        <ARExperience
          modelUrl={arModelUrl}
          sogUrl={scene?.assets?.sog?.url || null}
          transforms={scene?.transforms || null}
          logoUrl={scene?.panelLogoUrl}
          onClose={() => setArOpen(false)}
        />
      )}
    </>
  );
}
