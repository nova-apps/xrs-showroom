/**
 * unitFicha — client-side PDF spec sheet ("ficha técnica") for a unit (FLO-3).
 *
 * Produces a one-page A4 PDF with the project header, the unit's *visible* data
 * (same hide-empty rule as the drawer: fields without a value are omitted) and
 * the floor plan image. jsPDF is imported dynamically so it stays out of the
 * initial bundle and never runs during SSR.
 */

const BRAND = [171, 136, 105];   // #ab8869
const INK = [27, 26, 23];        // #1b1a17
const MUTED = [120, 114, 104];

const ESTADO_LABELS = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' };

const hasVal = (v) => v != null && String(v).trim() !== '';

/** Fetch an image URL and return { dataUrl, format }. Throws on CORS/network failure. */
async function fetchImage(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const format = blob.type.includes('png') ? 'PNG' : 'JPEG';
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  const dims = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
  return { dataUrl, format, ...dims };
}

/**
 * Build and download the unit's ficha PDF.
 * @param {object} unit  standardized unit fields (id, piso, ambientes, …)
 * @param {object} opts  { projectName, logoUrl }
 */
export async function generateUnitFichaPdf(unit, { projectName = '', logoUrl = '' } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 48;
  const contentW = pageW - M * 2;
  let y = M;

  // ─── Optional logo ───
  if (logoUrl) {
    try {
      const logo = await fetchImage(logoUrl);
      const h = 34;
      const w = Math.min(160, (logo.w / logo.h) * h);
      doc.addImage(logo.dataUrl, logo.format, M, y, w, h);
      y += h + 16;
    } catch { /* logo optional — skip on failure */ }
  }

  // ─── Project name + title ───
  if (projectName) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(projectName.toUpperCase(), M, y);
    y += 18;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(...INK);
  const title = `Unidad ${unit.id || '—'}`;
  doc.text(title, M, y);

  if (hasVal(unit.piso)) {
    const tw = doc.getTextWidth(title);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(...MUTED);
    doc.text(`Piso ${unit.piso}`, M + tw + 10, y);
  }
  y += 10;

  // Accent rule
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(2);
  doc.line(M, y, M + 40, y);
  y += 24;

  // ─── Estado + Precio ───
  if (ESTADO_LABELS[unit.estado]) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND);
    doc.text(ESTADO_LABELS[unit.estado].toUpperCase(), M, y);
    y += 18;
  }
  if (hasVal(unit.precio)) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...INK);
    doc.text(String(unit.precio), M, y);
    y += 22;
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

  y += 6;
  doc.setFontSize(11);
  for (const [label, value] of specs) {
    doc.setDrawColor(230, 226, 218);
    doc.setLineWidth(0.5);
    doc.line(M, y + 6, pageW - M, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(String(label), M, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    doc.text(String(value), pageW - M, y, { align: 'right' });
    y += 22;
  }

  // ─── Floor plan ───
  if (hasVal(unit.imagen_plano)) {
    try {
      const plan = await fetchImage(unit.imagen_plano);
      y += 16;
      const availH = pageH - M - y;
      let w = contentW;
      let h = (plan.h / plan.w) * w;
      if (h > availH) { h = availH; w = (plan.w / plan.h) * h; }
      const x = M + (contentW - w) / 2;
      doc.addImage(plan.dataUrl, plan.format, x, y, w, h);
    } catch { /* plan optional — skip on failure */ }
  }

  const safeId = String(unit.id || 'unidad').replace(/[^\w-]+/g, '_');
  doc.save(`ficha-${safeId}.pdf`);
}
