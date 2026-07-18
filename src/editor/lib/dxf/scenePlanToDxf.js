// Scene → DXF plan-view exporter.
//
// Thin consumer of the shared plan model (see plan/planModel.js — the single
// geometry pass shared with the PDF writer and the Export modal's SVG
// preview, covering managed streets, legacy streets, and intersections).
// This file only maps the model onto the DXF builder API.

import { createDxf, INSUNITS } from './dxfWriter';
import { buildStreetPlanModel } from '../plan/planModel';

export function exportScenePlanToDxf(options = {}) {
  const model = buildStreetPlanModel(options);

  const dxf = createDxf();
  dxf.setUnits(model.unitsFeet ? INSUNITS.FEET : INSUNITS.METERS);

  for (const layer of model.layers) {
    dxf.addLayer(layer.name, layer.color);
  }
  for (const polyline of model.polylines) {
    dxf.addLwPolyline(polyline.layer, polyline.points, {
      closed: polyline.closed
    });
  }
  for (const line of model.lines) {
    dxf.addLine(line.layer, line.p1, line.p2);
  }

  return {
    dxfString: dxf.toString(),
    streetCount: model.streetCount,
    segmentCount: model.segmentCount,
    intersectionCount: model.intersectionCount
  };
}
