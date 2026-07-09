// Plan model → vector PDF (letter landscape, fit-to-page).
//
// Draws the same linework as the DXF export straight into a PDF via jspdf —
// no DXF→PDF conversion step, no CAD engine. v1 scope: auto-fit to one
// letter-landscape page with margins and a footer line (scene title · date ·
// effective scale). True scale presets (1"=20', 1:100) and paper sizes are a
// future options-panel concern.
//
// jspdf is only reachable through dynamic import chains (exportUtils lazy-
// loads this module), so it stays out of the core bundle like @tarikjabiri/dxf
// and @gltf-transform.

import { jsPDF } from 'jspdf';
import { ACI, ACI_TO_PLOT_HEX } from './planModel';

// Letter landscape in points (jspdf 'letter' = 612×792 pt portrait).
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 36; // 0.5"
const FOOTER_H = 28; // reserved strip below the drawing area

const PT_PER_METER = 72 / 0.0254;
const FOOT_IN_METERS = 0.3048;

// Human scale label for the fitted drawing, e.g. "1:253". ptPerUnit is the
// fitted page points per model unit; unit size in meters converts that to a
// real-world ratio. Rounded — the fit is arbitrary, so the label is "≈".
function effectiveScaleLabel(ptPerUnit, unitsFeet) {
  const unitMeters = unitsFeet ? FOOT_IN_METERS : 1;
  const paperMetersPerUnit = ptPerUnit / PT_PER_METER;
  const ratio = unitMeters / paperMetersPerUnit;
  if (!isFinite(ratio) || ratio <= 0) return '';
  return `1:${Math.round(ratio)}`;
}

/**
 * Render a plan model (see planModel.js:buildStreetPlanModel) to a PDF Blob.
 * @param {object} model plan model with bounds !== null
 * @param {object} meta { title, dateLabel } — footer text pieces
 * @returns {{ blob: Blob, scaleLabel: string }}
 */
export function planModelToPdfBlob(model, { title = '', dateLabel = '' } = {}) {
  // eslint-disable-next-line new-cap -- jsPDF's exported constructor name
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'letter'
  });

  const { minX, minY, maxX, maxY } = model.bounds;
  const modelW = Math.max(maxX - minX, 1e-6);
  const modelH = Math.max(maxY - minY, 1e-6);

  const availW = PAGE_W - 2 * MARGIN;
  const availH = PAGE_H - 2 * MARGIN - FOOTER_H;
  const scale = Math.min(availW / modelW, availH / modelH);

  // Center the fitted drawing in the available area. PDF y grows downward;
  // model y grows "north" — flip so north stays up the page.
  const offsetX = MARGIN + (availW - modelW * scale) / 2;
  const offsetY = MARGIN + (availH - modelH * scale) / 2;
  const toPage = ([x, y]) => [
    offsetX + (x - minX) * scale,
    offsetY + (maxY - y) * scale
  ];

  const colorForLayer = new Map(
    model.layers.map((l) => [
      l.name,
      ACI_TO_PLOT_HEX[l.color] || ACI_TO_PLOT_HEX[ACI.WHITE]
    ])
  );

  doc.setLineWidth(0.75);
  doc.setLineJoin('round');

  for (const polyline of model.polylines) {
    doc.setDrawColor(colorForLayer.get(polyline.layer) || '#000000');
    const pts = polyline.points.map(toPage);
    for (let i = 0; i < pts.length - 1; i++) {
      doc.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    }
    if (polyline.closed && pts.length > 2) {
      const last = pts[pts.length - 1];
      doc.line(last[0], last[1], pts[0][0], pts[0][1]);
    }
  }

  for (const line of model.lines) {
    doc.setDrawColor(colorForLayer.get(line.layer) || '#000000');
    const p1 = toPage(line.p1);
    const p2 = toPage(line.p2);
    doc.line(p1[0], p1[1], p2[0], p2[1]);
  }

  // Footer: title (left) · scale + units (center) · date (right), with a
  // hairline rule above, in the reserved strip.
  const scaleLabel = effectiveScaleLabel(scale, model.unitsFeet);
  const unitsLabel = model.unitsFeet ? 'feet' : 'meters';
  const footerY = PAGE_H - MARGIN - 6;

  doc.setDrawColor('#bbbbbb');
  doc.setLineWidth(0.5);
  doc.line(MARGIN, footerY - 14, PAGE_W - MARGIN, footerY - 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor('#555555');
  if (title) {
    doc.text(title, MARGIN, footerY);
  }
  doc.text(
    `${scaleLabel ? `Scale ≈ ${scaleLabel} · ` : ''}units: ${unitsLabel} · 3DStreet plan view`,
    PAGE_W / 2,
    footerY,
    { align: 'center' }
  );
  if (dateLabel) {
    doc.text(dateLabel, PAGE_W - MARGIN, footerY, { align: 'right' });
  }

  return { blob: doc.output('blob'), scaleLabel };
}
