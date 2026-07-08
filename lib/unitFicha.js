/**
 * unitFicha — client-side PDF spec sheet ("ficha técnica") for a unit (FLO-3).
 *
 * Landscape A4 styled like the app's dark UI: warm-dark background, light text,
 * golden labels. Two columns — unit details on the left, floor plan framed on
 * the right. Same hide-empty rule as the drawer. jsPDF is imported dynamically
 * so it stays out of the initial bundle and never runs during SSR.
 */

const BG = [28, 28, 28];        // #1c1c1c — sidebar background
const TEXT = [232, 228, 222];   // light warm text
const GOLD = [194, 161, 132];   // #c2a184 — golden labels/accents
const BRAND = [171, 136, 105];  // #ab8869 — accent rule
const DIM = [150, 144, 134];    // muted light (piso, secondary)
const HAIR = [64, 60, 55];      // subtle divider on dark

const ESTADO_LABELS = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' };

const hasVal = (v) => v != null && String(v).trim() !== '';

/**
 * Load an image URL → { dataUrl, format, w, h }. Throws on failure.
 *
 * Firebase Storage doesn't send CORS headers for this origin, so a direct
 * fetch / crossOrigin canvas read is blocked. Instead we route the image
 * through Next's same-origin optimizer (`/_next/image`, whitelisted for
 * firebasestorage.* in next.config), then re-encode via canvas — same-origin
 * means no taint, and canvas handles webp/avif transparently. Use `alpha` for
 * logos (PNG, keeps transparency on the dark page); plans use JPEG (opaque).
 */
async function loadImage(url, { alpha = false } = {}) {
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
          dataUrl: alpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92),
          format: alpha ? 'PNG' : 'JPEG',
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
 * Build and download the unit's ficha PDF (landscape, dark theme, two columns).
 * @param {object} unit  standardized unit fields (id, piso, ambientes, …)
 * @param {object} opts  { projectName, logoUrl }
 */
export async function generateUnitFichaPdf(unit, { projectName = '', logoUrl = '' } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();   // 842
  const pageH = doc.internal.pageSize.getHeight();   // 595
  const M = 44;

  // Dark page background.
  doc.setFillColor(...BG);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Best-effort images (ficha still renders if they fail).
  let logo = null;
  let plan = null;
  if (logoUrl) { try { logo = await loadImage(logoUrl, { alpha: true }); } catch { /* skip */ } }
  if (hasVal(unit.imagen_plano)) { try { plan = await loadImage(unit.imagen_plano); } catch { /* skip */ } }

  // Two-column geometry (plan on the right when present).
  const colGap = 40;
  const rightW = plan ? 400 : 0;
  const rightX = pageW - M - rightW;
  const leftX = M;
  const leftW = (plan ? rightX - colGap : pageW - M) - leftX;
  const valueX = leftX + leftW;

  let y = M + 6;

  // ─── Logo (aspect-preserving fit; no squish) ───
  if (logo) {
    const maxW = 190;
    const maxH = 40;
    const scale = Math.min(maxW / logo.w, maxH / logo.h);
    const lw = logo.w * scale;
    const lh = logo.h * scale;
    doc.addImage(logo.dataUrl, logo.format, leftX, y, lw, lh);
    y += lh + 34; // generous gap so the title never crowds the logo
  } else if (projectName) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...DIM);
    doc.text(projectName.toUpperCase(), leftX, y, { charSpace: 0.6 });
    y += 26;
  }

  // ─── Title + Piso (stacked) ───
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(25);
  doc.setTextColor(...TEXT);
  doc.text(`Unidad ${unit.id || '—'}`, leftX, y);

  if (hasVal(unit.piso)) {
    y += 24;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12.5);
    doc.setTextColor(...DIM);
    doc.text(`Piso ${unit.piso}`, leftX, y);
  }
  y += 20;

  // Accent rule.
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(2.5);
  doc.line(leftX, y, leftX + 46, y);
  y += 32;

  // ─── Estado + Precio ───
  if (ESTADO_LABELS[unit.estado]) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...GOLD);
    doc.text(ESTADO_LABELS[unit.estado].toUpperCase(), leftX, y, { charSpace: 0.8 });
    y += 26;
  }
  if (hasVal(unit.precio)) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...TEXT);
    doc.text(String(unit.precio), leftX, y);
    y += 32;
  }

  // ─── Specs (hide-empty): golden labels, light values ───
  const specs = [
    ['Ambientes', unit.ambientes],
    ['Orientación', unit.orientacion],
    ['Sup. cubierta', hasVal(unit.superficie_cubierta) ? `${unit.superficie_cubierta} m²` : ''],
    ['Sup. semicubierta', hasVal(unit.superficie_semicubierta) ? `${unit.superficie_semicubierta} m²` : ''],
    ['Sup. amenities', hasVal(unit.superficie_amenities) ? `${unit.superficie_amenities} m²` : ''],
    ['Sup. total', hasVal(unit.superficie_total) ? `${unit.superficie_total} m²` : ''],
  ].filter(([, v]) => hasVal(v));

  const rowH = 27;
  for (const [label, value] of specs) {
    doc.setDrawColor(...HAIR);
    doc.setLineWidth(0.5);
    doc.line(leftX, y - 15, valueX, y - 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...GOLD);
    doc.text(String(label), leftX, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT);
    doc.text(String(value), valueX, y, { align: 'right' });
    y += rowH;
  }

  // ─── Floor plan (right column) ───
  if (plan) {
    const boxX = rightX;
    const boxY = M + 6;
    const boxW = rightW;
    const boxH = pageH - M - boxY;

    doc.setDrawColor(...HAIR);
    doc.setLineWidth(1);
    doc.roundedRect(boxX, boxY, boxW, boxH, 6, 6, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...GOLD);
    doc.text('PLANO', boxX + 16, boxY + 22, { charSpace: 1 });

    const pad = 20;
    const availW = boxW - pad * 2;
    const availH = boxH - pad * 2 - 16;
    let w = availW;
    let h = (plan.h / plan.w) * w;
    if (h > availH) { h = availH; w = (plan.w / plan.h) * h; }
    const imgX = boxX + (boxW - w) / 2;
    const imgY = boxY + 28 + (availH - h) / 2;
    doc.addImage(plan.dataUrl, plan.format, imgX, imgY, w, h);
  }

  const safeId = String(unit.id || 'unidad').replace(/[^\w-]+/g, '_');
  doc.save(`ficha-${safeId}.pdf`);
}
