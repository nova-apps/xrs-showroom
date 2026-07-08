/**
 * unitFicha — client-side PDF spec sheet ("ficha técnica") for a unit (FLO-3).
 *
 * Landscape A4: header band on top, then two columns — unit details on the
 * left, floor plan on the right. Uses the same hide-empty rule as the drawer
 * (fields without a value are omitted). jsPDF is imported dynamically so it
 * stays out of the initial bundle and never runs during SSR.
 */

const BRAND = [171, 136, 105];   // #ab8869
const INK = [27, 26, 23];        // #1b1a17
const MUTED = [122, 116, 106];
const HAIR = [225, 221, 213];    // hairline rule

const ESTADO_LABELS = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' };

const hasVal = (v) => v != null && String(v).trim() !== '';

/**
 * Load an image URL → { dataUrl, format:'JPEG', w, h }. Throws on failure.
 *
 * Firebase Storage doesn't send CORS headers for this origin, so a direct
 * fetch / crossOrigin canvas read is blocked. Instead we route the image
 * through Next's same-origin optimizer (`/_next/image`, whitelisted for
 * firebasestorage.* in next.config), then re-encode via canvas to a JPEG data
 * URL — same-origin means no taint, and canvas handles webp/avif transparently
 * so jsPDF (PNG/JPEG only) always gets something it can embed.
 */
async function loadImage(url) {
  const proxied = `/_next/image?url=${encodeURIComponent(url)}&w=1200&q=90`;
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', 0.92),
          format: 'JPEG',
          w: img.naturalWidth,
          h: img.naturalHeight,
        });
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = proxied;
  });
}

/**
 * Build and download the unit's ficha PDF (landscape, two columns).
 * @param {object} unit  standardized unit fields (id, piso, ambientes, …)
 * @param {object} opts  { projectName, logoUrl }
 */
export async function generateUnitFichaPdf(unit, { projectName = '', logoUrl = '' } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();   // 842
  const pageH = doc.internal.pageSize.getHeight();   // 595
  const M = 40;

  // Pre-fetch images (best-effort; ficha still renders if they fail).
  let logo = null;
  let plan = null;
  if (logoUrl) { try { logo = await loadImage(logoUrl); } catch { /* skip */ } }
  if (hasVal(unit.imagen_plano)) { try { plan = await loadImage(unit.imagen_plano); } catch { /* skip */ } }

  // ─── Two-column geometry ───
  // Plan on the right when present; otherwise details use the full width.
  const colGap = 36;
  const rightW = plan ? 400 : 0;
  const rightX = pageW - M - rightW;
  const leftX = M;
  const leftW = (plan ? rightX - colGap : pageW - M) - leftX;
  const valueX = leftX + leftW; // right-aligned column for spec values

  // ─── Header band (left column) ───
  let y = M + 6;

  if (logo) {
    const h = 30;
    const w = Math.min(150, (logo.w / logo.h) * h);
    doc.addImage(logo.dataUrl, logo.format, leftX, y, w, h);
    y += h + 18;
  }

  // Only show the project name as text when there's no logo (the logo already
  // carries the brand — avoid printing the name twice).
  if (projectName && !logo) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    doc.text(projectName.toUpperCase(), leftX, y, { charSpace: 0.6 });
    y += 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(...INK);
  const title = `Unidad ${unit.id || '—'}`;
  doc.text(title, leftX, y);
  if (hasVal(unit.piso)) {
    const tw = doc.getTextWidth(title);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(13);
    doc.setTextColor(...MUTED);
    doc.text(`Piso ${unit.piso}`, leftX + tw + 12, y);
  }
  y += 16;

  doc.setDrawColor(...BRAND);
  doc.setLineWidth(2.5);
  doc.line(leftX, y, leftX + 46, y);
  y += 30;

  // ─── Estado + Precio ───
  if (ESTADO_LABELS[unit.estado]) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND);
    doc.text(ESTADO_LABELS[unit.estado].toUpperCase(), leftX, y, { charSpace: 0.8 });
    y += 24;
  }
  if (hasVal(unit.precio)) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...INK);
    doc.text(String(unit.precio), leftX, y);
    y += 30;
  }

  // ─── Specs (hide-empty) ───
  const specs = [
    ['Ambientes', unit.ambientes],
    ['Orientación', unit.orientacion],
    ['Sup. cubierta', hasVal(unit.superficie_cubierta) ? `${unit.superficie_cubierta} m²` : ''],
    ['Sup. semicubierta', hasVal(unit.superficie_semicubierta) ? `${unit.superficie_semicubierta} m²` : ''],
    ['Sup. amenities', hasVal(unit.superficie_amenities) ? `${unit.superficie_amenities} m²` : ''],
    ['Sup. total', hasVal(unit.superficie_total) ? `${unit.superficie_total} m²` : ''],
  ].filter(([, v]) => hasVal(v));

  const rowH = 26;
  for (const [label, value] of specs) {
    doc.setDrawColor(...HAIR);
    doc.setLineWidth(0.5);
    doc.line(leftX, y - 14, valueX, y - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...MUTED);
    doc.text(String(label), leftX, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    doc.text(String(value), valueX, y, { align: 'right' });
    y += rowH;
  }

  // ─── Floor plan (right column) ───
  if (plan) {
    const boxX = rightX;
    const boxY = M + 6;
    const boxW = rightW;
    const boxH = pageH - M - boxY;

    // Frame
    doc.setDrawColor(...HAIR);
    doc.setLineWidth(1);
    doc.roundedRect(boxX, boxY, boxW, boxH, 6, 6, 'S');

    // "PLANO" caption
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text('PLANO', boxX + 14, boxY + 20, { charSpace: 1 });

    // Fit the image inside the box (with padding), centered.
    const pad = 18;
    const availW = boxW - pad * 2;
    const availH = boxH - pad * 2 - 14; // leave room under the caption
    let w = availW;
    let h = (plan.h / plan.w) * w;
    if (h > availH) { h = availH; w = (plan.w / plan.h) * h; }
    const imgX = boxX + (boxW - w) / 2;
    const imgY = boxY + 24 + (availH - h) / 2;
    doc.addImage(plan.dataUrl, plan.format, imgX, imgY, w, h);
  }

  const safeId = String(unit.id || 'unidad').replace(/[^\w-]+/g, '_');
  doc.save(`ficha-${safeId}.pdf`);
}
