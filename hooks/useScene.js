/**
 * Hook to subscribe to a single scene in realtime.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeScene, updateTransforms as dbUpdateTransforms, updateOrbit as dbUpdateOrbit, updateMaterials as dbUpdateMaterials, updateUnidades as dbUpdateUnidades, updateCollidersVisible as dbUpdateCollidersVisible, updateLighting as dbUpdateLighting, updateSceneAsset, removeSceneAsset } from '@/lib/scenes';
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
   * Update transforms with debounce (saves 500ms after last change).
   */
  const updateTransforms = useCallback(
    (type, transforms) => {
      if (!sceneId) return;

      // Clear previous timer for this type
      if (debounceTimers.current[type]) {
        clearTimeout(debounceTimers.current[type]);
      }

      debounceTimers.current[type] = setTimeout(() => {
        dbUpdateTransforms(sceneId, type, transforms).catch(console.error);
      }, 500);
    },
    [sceneId]
  );

  /**
   * Update orbit settings with debounce.
   */
  const updateOrbit = useCallback(
    (orbit) => {
      if (!sceneId) return;

      if (debounceTimers.current.orbit) {
        clearTimeout(debounceTimers.current.orbit);
      }

      debounceTimers.current.orbit = setTimeout(() => {
        dbUpdateOrbit(sceneId, orbit).catch(console.error);
      }, 500);
    },
    [sceneId]
  );

  /**
   * Update material overrides with debounce.
   */
  const updateMaterials = useCallback(
    (materials) => {
      if (!sceneId) return;

      if (debounceTimers.current.materials) {
        clearTimeout(debounceTimers.current.materials);
      }

      debounceTimers.current.materials = setTimeout(() => {
        dbUpdateMaterials(sceneId, materials).catch(console.error);
      }, 500);
    },
    [sceneId]
  );

  /**
   * Update unidades settings with debounce.
   */
  const updateUnidades = useCallback(
    (unidades) => {
      if (!sceneId) return;

      if (debounceTimers.current.unidades) {
        clearTimeout(debounceTimers.current.unidades);
      }

      debounceTimers.current.unidades = setTimeout(() => {
        dbUpdateUnidades(sceneId, unidades).catch(console.error);
      }, 500);
    },
    [sceneId]
  );

  /**
   * Update lighting settings with debounce.
   */
  const updateLighting = useCallback(
    (lighting) => {
      if (!sceneId) return;

      if (debounceTimers.current.lighting) {
        clearTimeout(debounceTimers.current.lighting);
      }

      debounceTimers.current.lighting = setTimeout(() => {
        dbUpdateLighting(sceneId, lighting).catch(console.error);
      }, 500);
    },
    [sceneId]
  );

  /**
   * Update colliders visibility flag (persists to DB immediately).
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
    updateLighting,
    updateCollidersVisible,
    uploadAsset,
    removeAsset,
  };
}
