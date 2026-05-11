/**
 * Scene CRUD operations using Firebase Realtime Database.
 */

import { db } from './firebase';
import {
  ref,
  push,
  set,
  get,
  update,
  remove,
  onValue,
} from 'firebase/database';

const SCENES_PATH = 'scenes';

/**
 * Internal helper — set a path and update timestamp in a single atomic operation.
 * Uses Firebase multi-path update so both writes succeed or fail together.
 */
async function setWithTimestamp(id, path, data) {
  const updates = {};
  updates[`${SCENES_PATH}/${id}/${path}`] = data;
  updates[`${SCENES_PATH}/${id}/updatedAt`] = Date.now();
  await update(ref(db), updates);
}

/**
 * Create a new scene with just a name.
 * @param {string} name
 * @returns {Promise<string>} The new scene ID
 */
export async function createScene(name) {
  const scenesRef = ref(db, SCENES_PATH);
  const newRef = push(scenesRef);
  const now = Date.now();

  await set(newRef, {
    name,
    createdAt: now,
    updatedAt: now,
    assets: {
      glb: null,
      sog: null,
      skybox: null,
      floor: null,
    },
    transforms: {
      glb: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: 1,
      },
      sog: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: 1,
      },
      skybox: {
        position: { x: 0, y: 0, z: 0 },
        radius: 400,
        blur: 3,
      },
      floor: {
        position: { x: 0, y: -0.5, z: 0 },
        scale: 1050,
        blur: 3,
      },
      mask: {
        enabled: false,
        position: { x: 0, y: 0, z: 0 },
        radius: 50,
        falloff: 10,
      },
    },
    orbit: {
      zoomMin: 0.5,
      zoomMax: 500,
      pitchMin: -90,
      pitchMax: 90,
      yawMin: -180,
      yawMax: 180,
    },
  });

  return newRef.key;
}

/**
 * Get a scene by ID (one-time read).
 */
export async function getScene(id) {
  const sceneRef = ref(db, `${SCENES_PATH}/${id}`);
  const snapshot = await get(sceneRef);
  if (!snapshot.exists()) return null;
  return { id, ...snapshot.val() };
}

/**
 * Subscribe to a scene in realtime.
 * @returns {Function} Unsubscribe function
 */
export function subscribeScene(id, callback) {
  const sceneRef = ref(db, `${SCENES_PATH}/${id}`);
  return onValue(sceneRef, (snapshot) => {
    if (snapshot.exists()) {
      callback({ id, ...snapshot.val() });
    } else {
      callback(null);
    }
  });
}

/**
 * Subscribe to the scenes list in realtime.
 * @param {(scenes: Array) => void} callback
 * @param {(error: Error) => void} [onError]
 * @returns {Function} Unsubscribe function
 */
export function subscribeSceneList(callback, onError) {
  const scenesRef = ref(db, SCENES_PATH);
  return onValue(
    scenesRef,
    (snapshot) => {
      const scenes = [];
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          scenes.push({ id: child.key, ...child.val() });
        });
      }
      scenes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      callback(scenes);
    },
    (error) => {
      console.error('[scenes] subscribeSceneList listener error:', error);
      if (onError) onError(error);
    }
  );
}

/**
 * Update scene metadata (partial update).
 */
export async function updateScene(id, data) {
  const sceneRef = ref(db, `${SCENES_PATH}/${id}`);
  await update(sceneRef, {
    ...data,
    updatedAt: Date.now(),
  });
}


/**
 * Update asset metadata for a scene.
 * @param {'glb'|'sog'|'skybox'|'floor'} assetType
 */
export async function updateSceneAsset(id, assetType, assetData) {
  await setWithTimestamp(id, `assets/${assetType}`, assetData);
}

/**
 * Remove an asset from a scene.
 */
export async function removeSceneAsset(id, assetType) {
  await setWithTimestamp(id, `assets/${assetType}`, null);
}

/**
 * Update transforms for a specific asset type.
 * @param {'glb'|'sog'|'skybox'|'floor'} type
 */
export async function updateTransforms(id, type, transforms) {
  await setWithTimestamp(id, `transforms/${type}`, transforms);
}

/**
 * Update orbit control settings for a scene.
 */
export async function updateOrbit(id, orbit) {
  await setWithTimestamp(id, 'orbit', orbit);
}

/**
 * Update material overrides for a scene.
 * Stores a map of material name → property overrides.
 * @param {string} id - Scene ID
 * @param {Object} materials - Map of material name to overridden properties
 */
export async function updateMaterials(id, materials) {
  await setWithTimestamp(id, 'materials', materials);
}

/**
 * Update unidades settings for a scene (API URL).
 * @param {string} id - Scene ID
 * @param {Object} unidades - { apiUrl: string }
 */
export async function updateUnidades(id, unidades) {
  await setWithTimestamp(id, 'unidades', unidades);
}

/**
 * Update amenities for a scene.
 * @param {string} id - Scene ID
 * @param {Object} amenities - { items: Array<{ nombre, descripcion, plano }> }
 */
export async function updateAmenities(id, amenities) {
  await setWithTimestamp(id, 'amenities', amenities);
}

/**
 * Update lighting settings for a scene.
 */
export async function updateLighting(id, lighting) {
  await setWithTimestamp(id, 'lighting', lighting);
}

/**
 * Update tint overlay settings for a scene.
 * @param {string} id - Scene ID
 * @param {Object} tint - { enabled, color, opacity }
 */
export async function updateTint(id, tint) {
  await setWithTimestamp(id, 'tint', tint);
}

/**
 * Update saturation settings for a scene.
 * Desaturates the environment (skybox, floor, splat) while leaving the GLB intact.
 * @param {string} id - Scene ID
 * @param {Object} saturation - { enabled, value } where value is 0 (grayscale) to 1 (normal)
 */
export async function updateSaturation(id, saturation) {
  await setWithTimestamp(id, 'saturation', saturation);
}

/**
 * Update GLB reveal settings for a scene.
 */
export async function updateGlbSettings(id, glbSettings) {
  await setWithTimestamp(id, 'glbSettings', glbSettings);
}

/**
 * Update splat loader settings for a scene.
 */
export async function updateSplatSettings(id, splatSettings) {
  await setWithTimestamp(id, 'splatSettings', splatSettings);
}

/**
 * Update colliders visibility setting for a scene.
 * @param {string} id - Scene ID
 * @param {boolean} visible - Whether colliders are visible in the scene
 */
export async function updateCollidersVisible(id, visible) {
  await setWithTimestamp(id, 'collidersVisible', visible);
}

/**
 * Delete a scene entirely.
 */
export async function deleteScene(id) {
  const sceneRef = ref(db, `${SCENES_PATH}/${id}`);
  await remove(sceneRef);
}

/**
 * Rename a scene.
 */
export async function renameScene(id, newName) {
  await updateScene(id, { name: newName });
}
