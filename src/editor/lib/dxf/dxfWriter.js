// DXF writer for the plan-view AutoCAD export — thin adapter over
// @tarikjabiri/dxf.
//
// History: the first cut hand-rolled the DXF text, but files that permissive
// viewers (ShareCAD) rendered fine crashed Autodesk Viewer's extractor
// (AutoCAD-InvalidFile / TranslationWorker exit code 0xC0000409). The
// Autodesk pipeline runs real AutoCAD code and requires the complete
// R13+ document skeleton — handles, all nine symbol tables, layout objects
// and dictionaries in OBJECTS, matched subclass markers — which is exactly
// the boilerplate a maintained library already gets right. This adapter
// keeps the tiny builder API the exporter uses (createDxf / addLayer /
// addLwPolyline / addLine / setUnits / toString) so the geometry code
// doesn't care what does the serializing.

import {
  DxfWriter,
  LWPolylineFlags,
  Units,
  point2d,
  point3d
} from '@tarikjabiri/dxf';

// $INSUNITS enum from the DXF spec (values match @tarikjabiri/dxf's Units
// enum). Only the two units 3DStreet actually asks for are wired up; extend
// if the export modal grows more.
export const INSUNITS = {
  METERS: Units.Meters,
  FEET: Units.Feet
};

// Layer colors are AutoCAD Color Index codes — the ACI palette lives with
// the shared plan model (plan/planModel.js:ACI) since the SVG and PDF
// consumers need the same codes. 7 = ACI white, the DXF default.
const ACI_WHITE = 7;

class DxfBuilder {
  constructor() {
    this.writer = new DxfWriter();
    this.layerNames = new Set();
  }

  setUnits(insunits) {
    this.writer.setUnits(insunits);
  }

  // Register a layer once; repeat calls with the same name are no-ops so
  // callers can declare a layer inline on every entity without bookkeeping.
  addLayer(name, color = ACI_WHITE) {
    if (!this.layerNames.has(name)) {
      this.layerNames.add(name);
      this.writer.addLayer(name, color, 'Continuous');
    }
  }

  addLwPolyline(layer, points, { closed = true } = {}) {
    this.writer.addLWPolyline(
      points.map(([x, y]) => ({ point: point2d(x, y) })),
      {
        flags: closed ? LWPolylineFlags.Closed : LWPolylineFlags.None,
        layerName: layer
      }
    );
  }

  addLine(layer, p1, p2) {
    this.writer.addLine(point3d(p1[0], p1[1], 0), point3d(p2[0], p2[1], 0), {
      layerName: layer
    });
  }

  toString() {
    return this.writer.stringify();
  }
}

export function createDxf() {
  return new DxfBuilder();
}
