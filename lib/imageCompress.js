// Compresión de imágenes equirectangulares (360°) en el navegador, vía canvas → WebP.
// Baja la resolución a un máximo y re-encodea para reducir el peso sin pérdida perceptible,
// de modo que las panorámicas y nodos de tour carguen más rápido.

export const PANO_MAX_WIDTH = 6144; // ancho máx de la equirectangular (equilibrio nitidez/peso)
export const PANO_QUALITY = 0.85;   // calidad WebP
const SIZE_BUDGET = 2_500_000;      // ~2.5MB: por debajo se considera ya optimizada

/**
 * ¿La imagen ya está optimizada? (ancho ≤ maxWidth y peso ≤ presupuesto)
 * Recomprimir algo ya optimizado solo degrada, así que se saltea.
 */
export function isOptimized(width, bytes, { maxWidth = PANO_MAX_WIDTH, sizeBudget = SIZE_BUDGET } = {}) {
  return width <= maxWidth && bytes <= sizeBudget;
}

/**
 * Comprime un blob de imagen equirectangular.
 * @returns {Promise<{ skipped: boolean, reason?: string, blob?: Blob, width: number,
 *   height?: number, bytes: number, srcWidth: number, srcBytes: number }>}
 *   skipped=true si ya estaba optimizada o si el resultado no sería más liviano (no se degrada).
 */
export async function compressEquirect(srcBlob, opts = {}) {
  const { maxWidth = PANO_MAX_WIDTH, quality = PANO_QUALITY, sizeBudget = SIZE_BUDGET } = opts;
  const bitmap = await createImageBitmap(srcBlob);
  const srcWidth = bitmap.width;
  const srcBytes = srcBlob.size;

  if (isOptimized(srcWidth, srcBytes, { maxWidth, sizeBudget })) {
    bitmap.close?.();
    return { skipped: true, reason: 'optimized', srcWidth, srcBytes, width: srcWidth, bytes: srcBytes };
  }

  const scale = Math.min(1, maxWidth / srcWidth);
  const w = Math.round(srcWidth * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high'; // los downscales grandes quedan feos con el default
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob || blob.size >= srcBytes) {
    // No se logró achicar (raro): no degradar, dejar la original.
    return { skipped: true, reason: 'no-gain', srcWidth, srcBytes, width: srcWidth, bytes: srcBytes };
  }
  return { skipped: false, blob, width: w, height: h, bytes: blob.size, srcWidth, srcBytes };
}
