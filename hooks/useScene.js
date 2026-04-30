/**
 * Hook to subscribe to a single scene in realtime.
 */

'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  subscribeScene,
  updateTransforms as dbUpdateTransforms,
  updateOrbit as dbUpdateOrbit,
  updateMaterials as dbUpdateMaterials,
  updateUnidades as dbUpdateUnidades,
  updateAmenities as dbUpdateAmenities,
  updateCollidersVisible as dbUpdateCollidersVisible,
  updateLighting as dbUpdateLighting,
  updateTint as dbUpdateTint,
  updateGlbSettings as dbUpdateGlbSettings,
  updateSplatSettings as dbUpdateSplatSettings,
  updateSceneAsset,
  removeSceneAsset,
} from '@/lib/scenes';
import { uploadAsset as storageUpload, deleteAsset as storageDelete } from '@/lib/storage';

export function useScene(sceneId) {
  const [scene, setScene] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState({});
  const debounceTimers = useRef({});

  useEffect(() => {
    if (!sceneId) return;

    try {
      const unsubscribe = subscribeScene(sceneId, (data) => {
        setScene(data);
        setLoading(false);
      });
      return () => unsubscribe();
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }, [sceneId]);

  /**
   * Factory: creates a debounced updater for a given key and DB function.
   * Clears the previous timer on each call and schedules a new one at 500ms.
   */
  const makeDebouncedUpdate = useCallback(
    (key, dbFn) => (data) => {
      if (!sceneId) return;
      if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
      debounceTimers.current[key] = setTimeout(() => {
        dbFn(sceneId, data).catch(console.error);
      }, 500);
    },
    [sceneId]
  );

  /**
   * Update transforms with debounce (saves 500ms after last change).
   * Kept separate because it takes two args: (type, transforms).
   */
  const updateTransforms = useCallback(
    (type, transforms) => {
      if (!sceneId) return;
      if (debounceTimers.current[type]) clearTimeout(debounceTimers.current[type]);
      debounceTimers.current[type] = setTimeout(() => {
        dbUpdateTransforms(sceneId, type, transforms).catch(console.error);
      }, 500);
    },
    [sceneId]
  );

  // Debounced updaters — all share the same pattern via factory
  const updateOrbit = useMemo(() => makeDebouncedUpdate('orbit', dbUpdateOrbit), [makeDebouncedUpdate]);
  const updateMaterials = useMemo(() => makeDebouncedUpdate('materials', dbUpdateMaterials), [makeDebouncedUpdate]);
  const updateUnidades = useMemo(() => makeDebouncedUpdate('unidades', dbUpdateUnidades), [makeDebouncedUpdate]);
  const updateAmenities = useMemo(() => makeDebouncedUpdate('amenities', dbUpdateAmenities), [makeDebouncedUpdate]);
  const updateLighting = useMemo(() => makeDebouncedUpdate('lighting', dbUpdateLighting), [makeDebouncedUpdate]);
  const updateTint = useMemo(() => makeDebouncedUpdate('tint', dbUpdateTint), [makeDebouncedUpdate]);
  const updateGlbSettings = useMemo(() => makeDebouncedUpdate('glbSettings', dbUpdateGlbSettings), [makeDebouncedUpdate]);
  const updateSplatSettings = useMemo(() => makeDebouncedUpdate('splatSettings', dbUpdateSplatSettings), [makeDebouncedUpdate]);

  /**
   * Update colliders visibility flag (persists to DB immediately — no debounce).
   */
  const updateCollidersVisible = useCallback(
    (visible) => {
      if (!sceneId) return;
      dbUpdateCollidersVisible(sceneId, visible).catch(console.error);
    },
    [sceneId]
  );

  /**
   * Upload an asset file.
   * @param {'glb'|'sog'|'skybox'|'floor'|'colliders'} assetType
   * @param {File} file
   */
  const uploadAsset = useCallback(
    async (assetType, file) => {
      if (!sceneId) return;

      setUploadProgress((prev) => ({ ...prev, [assetType]: 0 }));

      try {
        // If there's an existing asset, delete it from storage first
        if (scene?.assets?.[assetType]?.fileName) {
          await storageDelete(sceneId, assetType, scene.assets[assetType].fileName).catch(() => {});
        }

        const result = await storageUpload(sceneId, assetType, file, (progress) => {
          setUploadProgress((prev) => ({ ...prev, [assetType]: progress }));
        });

        // Save metadata to database
        await updateSceneAsset(sceneId, assetType, result);

        setUploadProgress((prev) => ({ ...prev, [assetType]: 100 }));

        // Clear progress after a moment
        setTimeout(() => {
          setUploadProgress((prev) => {
            const copy = { ...prev };
            delete copy[assetType];
            return copy;
          });
        }, 1500);

        return result;
      } catch (err) {
        setUploadProgress((prev) => {
          const copy = { ...prev };
          delete copy[assetType];
          return copy;
        });
        throw err;
      }
    },
    [sceneId, scene]
  );

  /**
   * Remove an asset.
   */
  const removeAsset = useCallback(
    async (assetType) => {
      if (!sceneId) return;

      if (scene?.assets?.[assetType]?.fileName) {
        await storageDelete(sceneId, assetType, scene.assets[assetType].fileName).catch(() => {});
      }
      await removeSceneAsset(sceneId, assetType);
    },
    [sceneId, scene]
  );

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach(clearTimeout);
    };
  }, []);

  return {
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
  };
}

