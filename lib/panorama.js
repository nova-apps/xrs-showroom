/**
 * Panorama orientation math — shared by the viewer, the unit modal, the public
 * panoramas route and the editor's calibration tool.
 *
 * The model in one paragraph:
 *   - Each unit faces a compass direction (`orientacion`: N, NE, …). That's a
 *     property of the UNIT.
 *   - Each equirectangular image has a "north offset": the compass bearing its
 *     center column (lon=0) points to. That's a property of the IMAGE — every
 *     panorama is stitched independently, so this differs per image. A single
 *     scene-wide offset cannot orient them all (that was the original bug).
 *   - We open the camera looking at the unit's facing direction inside its
 *     image: lon_initial = imageOffset − orientacionDeg.
 *
 * Offsets live in `panoramaSettings`:
 *   - `northOffset` (number): scene-wide default, used for uncalibrated images.
 *   - `imageOffsets` (map): per-image overrides keyed by `panoramaImageKey(url)`.
 *     Populated by the editor's visual calibration. Units that share an image
 *     share its offset automatically.
 */

// Compass bearing in degrees per orientacion enum (clockwise: N=0, E=90).
export const ORIENTACION_DEG = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SO: 225, O: 270, NO: 315,
};

/** Wrap an angle to [0, 360). */
export function normalizeDeg(deg) {
  return ((Number(deg) || 0) % 360 + 360) % 360;
}

/**
 * Stable, Firebase-RTDB-safe key for a panorama image URL.
 *
 * RTDB keys forbid `. $ # [ ] /` and control chars. We also drop the query
 * string so a regenerated download token (`?alt=media&token=…`) doesn't
 * produce a different key for the same stored object.
 *
 * @param {string} url - panorama image URL (unit.imagen_panoramica)
 * @returns {string|null} sanitized key, or null if no url
 */
export function panoramaImageKey(url) {
  if (!url || typeof url !== 'string') return null;
  const withoutQuery = url.split('?')[0];
  // Replace every RTDB-forbidden char (and whitespace) with '_'. The rest of
  // the path is preserved, so distinct images map to distinct keys.
  return withoutQuery.replace(/[.#$/[\]\s]/g, '_');
}

/**
 * Effective north offset for a given image: per-image override if calibrated,
 * else the scene-wide default, else 0.
 *
 * @param {object} panoramaSettings - scene.panoramaSettings
 * @param {string} imageUrl
 * @returns {number} degrees
 */
export function getImageOffset(panoramaSettings, imageUrl) {
  const ps = panoramaSettings || {};
  const key = panoramaImageKey(imageUrl);
  const override = key ? ps.imageOffsets?.[key] : undefined;
  if (override !== null && override !== undefined && Number.isFinite(Number(override))) {
    return Number(override);
  }
  return Number(ps.northOffset) || 0;
}

/**
 * Initial camera longitude (degrees) for a unit's panorama: start the camera
 * pointed at the unit's facing direction inside its image.
 *
 * @param {object} unit - has `orientacion` and `imagen_panoramica`
 * @param {object} panoramaSettings - scene.panoramaSettings
 * @returns {number} degrees
 */
export function getInitialLon(unit, panoramaSettings) {
  if (!unit) return 0;
  const offset = getImageOffset(panoramaSettings, unit.imagen_panoramica);
  return offset - (ORIENTACION_DEG[unit.orientacion] ?? 0);
}

/**
 * Inverse of getInitialLon: given a longitude the operator dragged to while
 * viewing a unit, compute the image offset to store so that this image opens
 * at that heading for that unit (and, via each unit's orientacion, consistently
 * for every other unit sharing the image).
 *
 *   lon = imageOffset − orientacionDeg   ⟹   imageOffset = lon + orientacionDeg
 *
 * @param {number} lon - current camera longitude in degrees
 * @param {string} orientacion - the calibrating unit's orientacion enum
 * @returns {number} normalized image offset in [0, 360)
 */
export function imageOffsetFromLon(lon, orientacion) {
  return normalizeDeg((Number(lon) || 0) + (ORIENTACION_DEG[orientacion] ?? 0));
}
