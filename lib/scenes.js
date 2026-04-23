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
  serverTimestamp,
  query,
  orderByChild,
} from 'firebase/database';

const SCENES_PATH = 'scenes';

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
 * @returns {Function} Unsubscribe function
 */
export function subscribeSceneList(callback) {
  const scenesRef = ref(db, SCENES_PATH);
  return onValue(scenesRef, (snapshot) => {
    const scenes = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        scenes.push({ id: child.key, ...child.val() });
      });
    }
    // Sort by createdAt descending (newest first)
    scenes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    callback(scenes);
  });
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
  const assetRef = ref(db, `${SCENES_PATH}/${id}/assets/${assetType}`);
  await set(assetRef, assetData);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
}

/**
 * Remove an asset from a scene.
 */
export async function removeSceneAsset(id, assetType) {
  const assetRef = ref(db, `${SCENES_PATH}/${id}/assets/${assetType}`);
  await set(assetRef, null);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
}

/**
 * Update transforms for a specific asset type.
 * @param {'glb'|'sog'|'skybox'|'floor'} type
 */
export async function updateTransforms(id, type, transforms) {
  const transformRef = ref(db, `${SCENES_PATH}/${id}/transforms/${type}`);
  await set(transformRef, transforms);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
}

/**
 * Update orbit control settings for a scene.
 */
export async function updateOrbit(id, orbit) {
  const orbitRef = ref(db, `${SCENES_PATH}/${id}/orbit`);
  await set(orbitRef, orbit);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
}

/**
 * Update material overrides for a scene.
 * Stores a map of material name → property overrides.
 * @param {string} id - Scene ID
 * @param {Object} materials - Map of material name to overridden properties
 */
export async function updateMaterials(id, materials) {
  const materialsRef = ref(db, `${SCENES_PATH}/${id}/materials`);
  await set(materialsRef, materials);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
}

/**
 * Update unidades settings for a scene (API URL).
 * @param {string} id - Scene ID
 * @param {Object} unidades - { apiUrl: string }
 */
export async function updateUnidades(id, unidades) {
  const unidadesRef = ref(db, `${SCENES_PATH}/${id}/unidades`);
  await set(unidadesRef, unidades);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
}

/**
 * Update amenities for a scene.
 * @param {string} id - Scene ID
 * @param {Object} amenities - { items: Array<{ nombre, descripcion, plano }> }
 */
export async function updateAmenities(id, amenities) {
  const amenitiesRef = ref(db, `${SCENES_PATH}/${id}/amenities`);
  await set(amenitiesRef, amenities);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
}

/**
 * Update lighting settings for a scene.
 */
export async function updateLighting(id, lighting) {
  const lightingRef = ref(db, `${SCENES_PATH}/${id}/lighting`);
  await set(lightingRef, lighting);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
}

/**
 * Update GLB reveal settings for a scene.
 */
export async function updateGlbSettings(id, glbSettings) {
  const glbRef = ref(db, `${SCENES_PATH}/${id}/glbSettings`);
  await set(glbRef, glbSettings);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
}

/**
 * Update splat loader settings for a scene.
 */
export async function updateSplatSettings(id, splatSettings) {
  const splatRef = ref(db, `${SCENES_PATH}/${id}/splatSettings`);
  await set(splatRef, splatSettings);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
}

/**
 * Update colliders visibility setting for a scene.
 * @param {string} id - Scene ID
 * @param {boolean} visible - Whether colliders are visible in the scene
 */
export async function updateCollidersVisible(id, visible) {
  const visRef = ref(db, `${SCENES_PATH}/${id}/collidersVisible`);
  await set(visRef, visible);
  await update(ref(db, `${SCENES_PATH}/${id}`), { updatedAt: Date.now() });
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
