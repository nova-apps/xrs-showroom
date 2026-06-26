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
  onValue,
} from 'firebase/database';
import { normalizeDomain, isValidDomain, domainToKey } from './customDomain';
import { diffSnapshots } from './sceneDiff';

const SCENES_PATH = 'scenes';
const DOMAINS_PATH = 'domains';
// Published version history lives OUTSIDE scenes/{id} so the editor's realtime
// scene subscription doesn't download every snapshot on each change.
const VERSIONS_PATH = 'sceneVersions';
// Keep only the most recent N published snapshots per scene.
const MAX_VERSIONS = 30;

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
 * @param {'edificio' | 'terreno'} [type='edificio'] - Scene type, immutable after creation.
 * @returns {Promise<string>} The new scene ID
 */
export async function createScene(name, type = 'edificio') {
  const scenesRef = ref(db, SCENES_PATH);
  const newRef = push(scenesRef);
  const now = Date.now();
  const sceneType = type === 'terreno' ? 'terreno' : 'edificio';

  await set(newRef, {
    name,
    type: sceneType,
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
 * @param {Object} amenities - { items: Array<{ nombre, descripcion, plano,
 *   imagenes?: string[], thumbnail?: string }> }. `plano` is the cover image
 *   (kept for backward compat); `imagenes` is the optional gallery shown as a
 *   carousel; `thumbnail` is the optional list-panel image.
 */
export async function updateAmenities(id, amenities) {
  await setWithTimestamp(id, 'amenities', amenities);
}

/**
 * Update panorama-viewer settings for a scene.
 * @param {string} id - Scene ID
 * @param {Object} settings - All angles in degrees.
 *   - northOffset: compass bearing of the panorama's center column. Combined
 *     with each unit's `orientacion` to set the initial heading.
 *   - yawMin / yawMax: horizontal rotation clamp RELATIVE to the opening
 *     heading (e.g. -45 / +45 = ±45° around wherever the camera starts).
 *     null = unlimited.
 *   - pitchMin / pitchMax: vertical rotation clamp (default ±85).
 */
export async function updatePanoramaSettings(id, settings) {
  await setWithTimestamp(id, 'panoramaSettings', settings);
}

/**
 * Update barrios for a terreno-type scene.
 * @param {string} id - Scene ID
 * @param {Object} barrios - { items: Array<{ id, nombre, color? }> }
 */
export async function updateBarrios(id, barrios) {
  await setWithTimestamp(id, 'barrios', barrios);
}

/**
 * Update lotes for a terreno-type scene.
 * @param {string} id - Scene ID
 * @param {Object} lotes - { items: Array<{ id, numero, barrioId, estado, superficieTotal, superficieConstruible }> }
 */
export async function updateLotes(id, lotes) {
  await setWithTimestamp(id, 'lotes', lotes);
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
 * Update intro FX settings for a scene. Blur + low contrast on the environment
 * while the scene loads, faded out once the maqueta (GLB) + SOG are ready.
 * @param {string} id - Scene ID
 * @param {Object} introFx - { enabled, blur, contrast, duration }
 */
export async function updateIntroFx(id, introFx) {
  await setWithTimestamp(id, 'introFx', introFx);
}

/**
 * Fields included in the published snapshot. Asset URLs are part of the
 * snapshot, but uploadAsset still deletes the previous file on Storage —
 * uploading a new asset before re-publishing will break the live /view/.
 */
const PUBLISHABLE_FIELDS = [
  'name',
  'type',
  'panelLogoUrl',
  'whatsappNumber',
  'customDomain',
  'assets',
  'transforms',
  'orbit',
  'materials',
  'unidades',
  'amenities',
  'barrios',
  'lotes',
  'panoramaSettings',
  'lighting',
  'tint',
  'saturation',
  'bgBlur',
  'introFx',
  'glbSettings',
  'splatSettings',
  'collidersVisible',
  'visibility',
  'enabled',
  'showArButton',
];

/**
 * Copy the current draft (top-level scene fields) into `scenes/{id}/published`
 * so the /view/ route renders a stable snapshot until the next publish.
 */
export async function publishScene(id) {
  const sceneRef = ref(db, `${SCENES_PATH}/${id}`);
  const snapshot = await get(sceneRef);
  if (!snapshot.exists()) throw new Error(`Scene ${id} not found`);
  const data = snapshot.val();
  const published = {};
  for (const field of PUBLISHABLE_FIELDS) {
    if (data[field] !== undefined) published[field] = data[field];
  }
  const now = Date.now();
  const updates = {};
  updates[`${SCENES_PATH}/${id}/published`] = published;
  updates[`${SCENES_PATH}/${id}/publishedAt`] = now;
  updates[`${SCENES_PATH}/${id}/updatedAt`] = now;

  // ── Version history ── snapshot every publish under sceneVersions/{id}.
  // `list` holds lightweight metadata (subscribed by the UI); `snapshots`
  // holds the full publishable payload (fetched only on restore).
  // Label what changed vs the previously published version. First publish has
  // no predecessor, so just mark it as the initial publish.
  const changes = data.published
    ? diffSnapshots(published, data.published)
    : ['Publicación inicial'];
  const versionMeta = { publishedAt: now };
  if (changes.length) versionMeta.changes = changes;

  const versionId = push(ref(db, `${VERSIONS_PATH}/${id}/list`)).key;
  updates[`${VERSIONS_PATH}/${id}/list/${versionId}`] = versionMeta;
  updates[`${VERSIONS_PATH}/${id}/snapshots/${versionId}`] = published;

  // Prune oldest versions beyond MAX_VERSIONS (counting the one we're adding).
  const listSnap = await get(ref(db, `${VERSIONS_PATH}/${id}/list`));
  const existing = listSnap.val() || {};
  const olderFirst = Object.keys(existing).sort(
    (a, b) => (existing[a]?.publishedAt ?? 0) - (existing[b]?.publishedAt ?? 0),
  );
  const overflow = olderFirst.length + 1 - MAX_VERSIONS;
  for (let i = 0; i < overflow; i++) {
    updates[`${VERSIONS_PATH}/${id}/list/${olderFirst[i]}`] = null;
    updates[`${VERSIONS_PATH}/${id}/snapshots/${olderFirst[i]}`] = null;
  }

  await update(ref(db), updates);
}

/**
 * Subscribe to the published version history of a scene (most recent first).
 * Only the lightweight metadata list is streamed — call restoreSceneVersion to
 * pull a full snapshot on demand.
 * @param {string} id - Scene ID
 * @param {(versions: Array<{id: string, publishedAt: number}>) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribeSceneVersions(id, callback) {
  const listRef = ref(db, `${VERSIONS_PATH}/${id}/list`);
  return onValue(listRef, (snap) => {
    const val = snap.val() || {};
    const versions = Object.entries(val)
      .map(([versionId, meta]) => ({
        id: versionId,
        publishedAt: meta?.publishedAt ?? 0,
        changes: meta?.changes || [],
      }))
      .sort((a, b) => b.publishedAt - a.publishedAt);
    callback(versions);
  });
}

/**
 * Restore a published version into the draft (top-level fields) so it can be
 * reviewed and re-published. Does NOT touch scenes/{id}/published, so the live
 * /view/ keeps showing the current published version until the user publishes
 * again. Mirrors discardSceneChanges' field-nulling + domain-index re-sync.
 * @param {string} id - Scene ID
 * @param {string} versionId - Version key from subscribeSceneVersions
 */
export async function restoreSceneVersion(id, versionId) {
  const sceneSnap = await get(ref(db, `${SCENES_PATH}/${id}`));
  if (!sceneSnap.exists()) throw new Error(`Scene ${id} not found`);
  const data = sceneSnap.val();

  const snapSnap = await get(ref(db, `${VERSIONS_PATH}/${id}/snapshots/${versionId}`));
  if (!snapSnap.exists()) throw new Error(`Version ${versionId} not found`);
  const snapshot = snapSnap.val();

  const updates = {};
  for (const field of PUBLISHABLE_FIELDS) {
    // type is immutable after creation; never null it from a restore.
    if (field === 'type') {
      updates[`${SCENES_PATH}/${id}/${field}`] = snapshot[field] ?? data[field] ?? 'edificio';
      continue;
    }
    updates[`${SCENES_PATH}/${id}/${field}`] = snapshot[field] ?? null;
  }
  updates[`${SCENES_PATH}/${id}/updatedAt`] = Date.now();

  // Re-sync the /domains index for the draft customDomain change so routing
  // keeps pointing at this scene.
  const currentDomain = normalizeDomain(data.customDomain || '');
  const restoredDomain = normalizeDomain(snapshot.customDomain || '');
  if (currentDomain !== restoredDomain) {
    if (currentDomain) updates[`${DOMAINS_PATH}/${domainToKey(currentDomain)}`] = null;
    if (restoredDomain) updates[`${DOMAINS_PATH}/${domainToKey(restoredDomain)}`] = id;
  }

  await update(ref(db), updates);
}

/**
 * Discard unpublished draft changes by copying scenes/{id}/published back over
 * the top-level fields. Fields that exist in the draft but not in the
 * published snapshot are explicitly nulled so they get removed.
 */
export async function discardSceneChanges(id) {
  const sceneRef = ref(db, `${SCENES_PATH}/${id}`);
  const snapshot = await get(sceneRef);
  if (!snapshot.exists()) throw new Error(`Scene ${id} not found`);
  const data = snapshot.val();
  const published = data.published;
  if (!published) throw new Error('No published snapshot to revert to');
  const updates = {};
  for (const field of PUBLISHABLE_FIELDS) {
    // type is immutable after creation; never null it from a discard. Default
    // legacy scenes (no published.type) to 'edificio'.
    if (field === 'type') {
      updates[`${SCENES_PATH}/${id}/${field}`] = published[field] ?? data[field] ?? 'edificio';
      continue;
    }
    updates[`${SCENES_PATH}/${id}/${field}`] = published[field] ?? null;
  }
  updates[`${SCENES_PATH}/${id}/updatedAt`] = data.publishedAt ?? Date.now();

  // Re-sync the /domains index when reverting customDomain, otherwise the
  // index would be left pointing to whatever the draft used.
  const draftDomain = normalizeDomain(data.customDomain || '');
  const publishedDomain = normalizeDomain(published.customDomain || '');
  if (draftDomain !== publishedDomain) {
    if (draftDomain) updates[`${DOMAINS_PATH}/${domainToKey(draftDomain)}`] = null;
    if (publishedDomain) updates[`${DOMAINS_PATH}/${domainToKey(publishedDomain)}`] = id;
  }

  await update(ref(db), updates);
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
 * Set (or clear) the custom domain for a scene. Updates the scene record AND
 * the /domains/{key} index in a single atomic write so the proxy lookup is
 * always consistent.
 *
 * @param {string} id - Scene ID
 * @param {string} domain - Raw domain input (will be normalized); pass '' or
 *                          null to clear the custom domain.
 * @throws if the normalized domain is invalid, reserved, or already owned by
 *         another scene.
 */
export async function updateCustomDomain(id, domain) {
  const normalized = normalizeDomain(domain || '');

  // Read what's currently on this scene so we can clean up the old index entry.
  const currentSnap = await get(ref(db, `${SCENES_PATH}/${id}/customDomain`));
  const previous = normalizeDomain(currentSnap.val() || '');

  const updates = {};
  updates[`${SCENES_PATH}/${id}/updatedAt`] = Date.now();

  if (!normalized) {
    // Clearing the custom domain.
    updates[`${SCENES_PATH}/${id}/customDomain`] = null;
    if (previous) {
      updates[`${DOMAINS_PATH}/${domainToKey(previous)}`] = null;
    }
    await update(ref(db), updates);
    return '';
  }

  if (!isValidDomain(normalized)) {
    throw new Error(`Invalid custom domain: "${normalized}"`);
  }

  // Uniqueness check — if /domains/{key} already points to another scene, refuse.
  const key = domainToKey(normalized);
  const indexSnap = await get(ref(db, `${DOMAINS_PATH}/${key}`));
  const owner = indexSnap.val();
  if (owner && owner !== id) {
    throw new Error(`Domain "${normalized}" is already used by another scene`);
  }

  updates[`${SCENES_PATH}/${id}/customDomain`] = normalized;
  updates[`${DOMAINS_PATH}/${key}`] = id;
  if (previous && previous !== normalized) {
    updates[`${DOMAINS_PATH}/${domainToKey(previous)}`] = null;
  }
  await update(ref(db), updates);
  return normalized;
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
 * Update the show/hide state of a single asset (glb, colliders, sog, skybox, floor).
 * Stored under `visibility/{type}` so the whole `visibility` node travels in the
 * published snapshot. Absent/true = visible (default); false = hidden.
 * @param {string} id - Scene ID
 * @param {'glb'|'colliders'|'sog'|'skybox'|'floor'} type
 * @param {boolean} visible
 */
export async function updateVisibility(id, type, visible) {
  await setWithTimestamp(id, `visibility/${type}`, visible);
}

/**
 * Update the enabled (loaded) state of a single asset (glb, colliders, sog,
 * skybox, floor). Unlike `visibility` (which only toggled `.visible` on an
 * already-loaded mesh), a disabled asset is never downloaded nor added to the
 * scene — no network, no GPU memory, and (for colliders) no raycasting.
 * Stored under `enabled/{type}` so the whole node travels in the published
 * snapshot. Absent/true = enabled (default); false = disabled (not loaded).
 * @param {string} id - Scene ID
 * @param {'glb'|'colliders'|'sog'|'skybox'|'floor'} type
 * @param {boolean} enabled
 */
export async function updateEnabled(id, type, enabled) {
  await setWithTimestamp(id, `enabled/${type}`, enabled);
}

/**
 * Delete a scene entirely. Also frees its /domains index entry, if any.
 */
export async function deleteScene(id) {
  // Read the current customDomain (drafted + published) so we can clean up
  // whichever entry the index still points at.
  const snap = await get(ref(db, `${SCENES_PATH}/${id}`));
  const data = snap.val() || {};
  const draftDomain = normalizeDomain(data.customDomain || '');
  const publishedDomain = normalizeDomain(data.published?.customDomain || '');

  const updates = {};
  updates[`${SCENES_PATH}/${id}`] = null;
  updates[`${VERSIONS_PATH}/${id}`] = null;
  if (draftDomain) updates[`${DOMAINS_PATH}/${domainToKey(draftDomain)}`] = null;
  if (publishedDomain && publishedDomain !== draftDomain) {
    updates[`${DOMAINS_PATH}/${domainToKey(publishedDomain)}`] = null;
  }
  await update(ref(db), updates);
}

/**
 * Rename a scene.
 */
export async function renameScene(id, newName) {
  await updateScene(id, { name: newName });
}
