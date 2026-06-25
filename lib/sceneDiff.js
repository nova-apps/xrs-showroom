/**
 * Shared scene-diff helpers — used both for the editor's "unpublished changes"
 * list and for labeling what changed in each published version. Keeping the
 * labels in one place means both lists read identically.
 */

/**
 * Human-friendly labels for each publishable field. Sub-fields under `assets`
 * and `transforms` get split out so the list reads as discrete changes.
 */
export const FIELD_LABELS = {
  name: 'Nombre',
  type: 'Tipo de escena',
  panelLogoUrl: 'Logo del panel',
  whatsappNumber: 'WhatsApp',
  customDomain: 'Dominio personalizado',
  orbit: 'Cámara y órbita',
  materials: 'Materiales',
  unidades: 'Unidades',
  amenities: 'Amenities',
  barrios: 'Barrios',
  lotes: 'Lotes',
  panoramaSettings: 'Panorámicas',
  lighting: 'Iluminación',
  tint: 'Tinte',
  saturation: 'Saturación',
  bgBlur: 'Blur de fondo',
  glbSettings: 'Ajustes del modelo',
  splatSettings: 'Ajustes del splat',
  collidersVisible: 'Visibilidad de colliders',
};

export const ASSET_LABELS = {
  glb: 'Modelo 3D (GLB)',
  sog: 'Gaussian Splat',
  skybox: 'Cielo (skybox)',
  floor: 'Piso',
  colliders: 'Colliders',
  modelHdri: 'HDRI del modelo',
};

export const TRANSFORM_LABELS = {
  glb: 'Transformación del modelo',
  sog: 'Transformación del splat',
  skybox: 'Posición del cielo',
  floor: 'Posición del piso',
  colliders: 'Transformación de colliders',
  mask: 'Máscara de fondo',
};

/**
 * Order-stable JSON serialization so deep-equality comparisons don't get
 * tripped up by key ordering differences coming back from Firebase.
 */
export function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Return the human-friendly labels of the fields that differ between two
 * snapshot-shaped objects. Works for draft-vs-published (the editor's pending
 * changes) and new-version-vs-previous-version (per-version change list).
 * @param {Object} next - the newer state (draft or new snapshot)
 * @param {Object} prev - the older state (published snapshot or previous version)
 * @returns {string[]} change labels
 */
export function diffSnapshots(next, prev) {
  const a = next || {};
  const b = prev || {};
  const changes = [];

  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    if (stableStringify(a[field]) !== stableStringify(b[field])) changes.push(label);
  }

  const aAssets = a.assets || {};
  const bAssets = b.assets || {};
  for (const [key, label] of Object.entries(ASSET_LABELS)) {
    if (stableStringify(aAssets[key]) !== stableStringify(bAssets[key])) changes.push(label);
  }

  const aTransforms = a.transforms || {};
  const bTransforms = b.transforms || {};
  for (const [key, label] of Object.entries(TRANSFORM_LABELS)) {
    if (stableStringify(aTransforms[key]) !== stableStringify(bTransforms[key])) changes.push(label);
  }

  return changes;
}
