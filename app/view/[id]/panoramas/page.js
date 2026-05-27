'use client';

/**
 * Panoramas View — same scene as /view/[id], but the main canvas shows the
 * selected unit's equirectangular panorama instead of the 3D building.
 * Selecting a unit from the side panel swaps the panorama in place.
 *
 * Route: /view/[id]/panoramas
 * Only supported for scenes of type 'edificio'. Terreno scenes get a stub.
 */

import { useMemo, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useScene } from '@/hooks/useScene';
import { useDocumentMeta } from '@/hooks/useDocumentMeta';

import LeftPanelStack from '@/components/panels/LeftPanelStack';
import UnidadesListPanel from '@/components/panels/UnidadesListPanel';
import UnidadModal from '@/components/panels/UnidadModal';
import { getInitialLon } from '@/lib/panorama';

const PanoramaViewer = dynamic(() => import('@/components/panels/PanoramaViewer'), { ssr: false });

export default function PanoramasPage() {
  const params = useParams();
  const sceneId = params?.id;

  const { scene: rawScene, loading, error } = useScene(sceneId);

  // Same published-snapshot fallback as /view/[id] — render the published
  // version if there is one, otherwise the draft (so unpublished scenes
  // still preview).
  const scene = useMemo(() => {
    if (!rawScene) return null;
    if (rawScene.published) {
      return { id: rawScene.id, ...rawScene.published };
    }
    return rawScene;
  }, [rawScene]);

  useDocumentMeta(scene?.name, scene?.panelLogoUrl);

  // Only units that actually have a panorama uploaded are selectable.
  const unitsWithPanorama = useMemo(() => {
    const items = scene?.unidades?.items || [];
    return items.filter((u) => !!u.imagen_panoramica);
  }, [scene]);

  // Store only the picked id; derive the unit object from the current list
  // during render. If the user hasn't picked anything (or their pick fell
  // out of the list), fall back to the first unit with a panorama.
  const [pickedId, setPickedId] = useState(null);
  const selectedUnit = useMemo(() => {
    if (unitsWithPanorama.length === 0) return null;
    if (pickedId != null) {
      const match = unitsWithPanorama.find((u) => String(u.id) === String(pickedId));
      if (match) return match;
    }
    return unitsWithPanorama[0];
  }, [unitsWithPanorama, pickedId]);

  // Detail modal — separate state from pickedId. The first-unit default
  // auto-picks for the panorama but does NOT pop the modal; only an
  // explicit row tap should open it. Tapping the same row again closes.
  const [modalUnit, setModalUnit] = useState(null);
  const handleSelectUnit = useCallback((unit) => {
    if (!unit) return;
    setPickedId(unit.id ?? null);
    setModalUnit((prev) => (prev && String(prev.id) === String(unit.id) ? null : unit));
  }, []);

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

  // Terreno scenes have lotes, not unidades — this route only makes sense
  // for edificio. Stop early with a clear message instead of rendering an
  // empty panorama view.
  if (!loading && scene?.type === 'terreno') {
    return (
      <div className="home-container">
        <div className="home-card animate-fade">
          <div className="home-header">
            <h1>Ruta no disponible</h1>
            <p>El recorrido por panorámicas está disponible solo para escenas de tipo edificio.</p>
          </div>
        </div>
      </div>
    );
  }

  const panoYawMin = scene?.panoramaSettings?.yawMin ?? null;
  const panoYawMax = scene?.panoramaSettings?.yawMax ?? null;
  const panoPitchMin = scene?.panoramaSettings?.pitchMin ?? -85;
  const panoPitchMax = scene?.panoramaSettings?.pitchMax ?? 85;

  // Initial heading uses the unit's orientacion and the per-image offset
  // (falling back to the scene-wide northOffset) — see lib/panorama.
  const initialLon = getInitialLon(selectedUnit, scene?.panoramaSettings);

  return (
    <>
      {selectedUnit?.imagen_panoramica ? (
        // key=unit.id forces a full remount when the user picks a new unit.
        // PanoramaViewer's three.js setup runs once per mount and caches the
        // opening heading in a ref, so remount is the simplest way to reset
        // everything (camera, yaw anchor, clamps) for the new panorama.
        <PanoramaViewer
          key={String(selectedUnit.id)}
          inline
          url={selectedUnit.imagen_panoramica}
          unitId={selectedUnit.id}
          initialLon={initialLon}
          yawMin={panoYawMin}
          yawMax={panoYawMax}
          pitchMin={panoPitchMin}
          pitchMax={panoPitchMax}
        />
      ) : (
        <div className="pano-inline-container pano-empty">
          <div className="pano-empty-content">
            <div className="pano-empty-icon">🌐</div>
            <p>
              {unitsWithPanorama.length === 0
                ? 'Esta escena no tiene unidades con panorámica cargada.'
                : 'Elegí una unidad para ver su panorámica.'}
            </p>
          </div>
        </div>
      )}

      {scene && (
        <LeftPanelStack
          title={scene.name}
          logoUrl={scene?.panelLogoUrl}
          tabs={[{ id: 'unidades', label: 'Unidades' }]}
        >
          {() => (
            <UnidadesListPanel
              unidades={unitsWithPanorama}
              onSelectUnit={handleSelectUnit}
              selectedUnit={selectedUnit}
            />
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
          // The panorama is already on screen in this route, so the modal's
          // "Panorámica" CTA would duplicate what the user is already seeing.
          hidePanoramaButton
        />
      )}
    </>
  );
}
