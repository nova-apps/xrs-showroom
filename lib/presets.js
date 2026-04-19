/**
 * Material Presets CRUD — Firebase Realtime Database.
 * Presets are stored globally (not per-scene) at /materialPresets.
 */

import { db } from './firebase';
import { ref, push, set, get, update, remove, onValue } from 'firebase/database';

const PRESETS_PATH = 'materialPresets';

/**
 * Subscribe to all material presets in realtime.
 * @returns {Function} Unsubscribe function
 */
export function subscribePresets(callback) {
  const presetsRef = ref(db, PRESETS_PATH);
  return onValue(presetsRef, (snapshot) => {
    const presets = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        presets.push({ id: child.key, ...child.val() });
      });
    }
    presets.sort((a, b) => a.name.localeCompare(b.name));
    callback(presets);
  });
}

/**
 * Create a new material preset.
 * @param {Object} preset - { name, properties: { color, opacity, ... } }
 * @returns {Promise<string>} The new preset ID
 */
export async function createPreset(preset) {
  const presetsRef = ref(db, PRESETS_PATH);
  const newRef = push(presetsRef);
  await set(newRef, {
    name: preset.name,
    properties: preset.properties || {},
    createdAt: Date.now(),
  });
  return newRef.key;
}

/**
 * Update an existing material preset.
 */
export async function updatePreset(id, data) {
  const presetRef = ref(db, `${PRESETS_PATH}/${id}`);
  await update(presetRef, data);
}

/**
 * Delete a material preset.
 */
export async function deletePreset(id) {
  const presetRef = ref(db, `${PRESETS_PATH}/${id}`);
  await remove(presetRef);
}
