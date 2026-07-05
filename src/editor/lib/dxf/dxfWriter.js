// Minimal DXF R14+ ASCII writer for the plan-view AutoCAD export.
//
// Scope: just what the first-cut managed-street plan export needs — a HEADER
// with drawing units, a LAYER table, and LWPOLYLINE / LINE entities. No BLOCKS,
// no HATCH, no dimensions. Intentionally in-house (no npm dep) so the draft PR
// stays small and self-contained; if the format grows past that (blocks for
// stencils/trees, hatches for surfaces) swap this for `@tarikjabiri/dxf`.
//
// DXF group-code format is pairs of lines: (code, value). One value per line,
// LF line endings. Numeric values follow the code convention — reader parses
// the code to know the type. Reference:
// https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-235B22E0-A567-4CF6-92D3-38A2306D73F3

// $INSUNITS enum from the DXF spec. Only the two units 3DStreet actually asks
// for are wired up; extend if the export modal grows more.
export const INSUNITS = {
  METERS: 6,
  FEET: 2
};

// AutoCAD Color Index — 1-based palette baked into every AutoCAD install. Using
// ACI (not true RGB) keeps the file the smallest possible and lets users apply
// their office ctb/stb plot styles by layer, which is what the target workflow
// actually wants.
export const ACI = {
  RED: 1,
  YELLOW: 2,
  GREEN: 3,
  CYAN: 4,
  BLUE: 5,
  MAGENTA: 6,
  WHITE: 7,
  DARK_GREY: 8,
  LIGHT_GREY: 9
};

class DxfBuilder {
  constructor() {
    this.lines = [];
    this.layers = new Map();
    this.entities = [];
    this.insunits = INSUNITS.METERS;
  }

  setUnits(insunits) {
    this.insunits = insunits;
  }

  // Register a layer once; repeat calls with the same name are no-ops so
  // callers can declare a layer inline on every entity without bookkeeping.
  addLayer(name, color = ACI.WHITE) {
    if (!this.layers.has(name)) {
      this.layers.set(name, { name, color });
    }
  }

  addLwPolyline(layer, points, { closed = true } = {}) {
    this.entities.push({ kind: 'LWPOLYLINE', layer, points, closed });
  }

  addLine(layer, p1, p2) {
    this.entities.push({ kind: 'LINE', layer, p1, p2 });
  }

  toString() {
    const out = [];
    const pair = (code, value) => {
      out.push(String(code));
      out.push(String(value));
    };

    // HEADER — just $INSUNITS so AutoCAD imports at the right scale. Every
    // other header var defaults sensibly for a fresh drawing.
    pair(0, 'SECTION');
    pair(2, 'HEADER');
    pair(9, '$INSUNITS');
    pair(70, this.insunits);
    pair(0, 'ENDSEC');

    // TABLES → LAYER. Layer 0 is required by every AutoCAD drawing; add it
    // even if unused so opening the file doesn't produce a "missing layer 0"
    // warning.
    pair(0, 'SECTION');
    pair(2, 'TABLES');
    pair(0, 'TABLE');
    pair(2, 'LAYER');
    pair(70, this.layers.size + 1);
    pair(0, 'LAYER');
    pair(2, '0');
    pair(70, 0);
    pair(62, ACI.WHITE);
    pair(6, 'CONTINUOUS');
    for (const { name, color } of this.layers.values()) {
      pair(0, 'LAYER');
      pair(2, name);
      pair(70, 0);
      pair(62, color);
      pair(6, 'CONTINUOUS');
    }
    pair(0, 'ENDTAB');
    pair(0, 'ENDSEC');

    // ENTITIES.
    pair(0, 'SECTION');
    pair(2, 'ENTITIES');
    for (const e of this.entities) {
      if (e.kind === 'LWPOLYLINE') {
        pair(0, 'LWPOLYLINE');
        pair(8, e.layer);
        // Subclass marker so R2000+ readers accept the LWPOLYLINE record.
        pair(100, 'AcDbEntity');
        pair(100, 'AcDbPolyline');
        pair(90, e.points.length);
        pair(70, e.closed ? 1 : 0);
        for (const [x, y] of e.points) {
          pair(10, fmt(x));
          pair(20, fmt(y));
        }
      } else if (e.kind === 'LINE') {
        pair(0, 'LINE');
        pair(8, e.layer);
        pair(10, fmt(e.p1[0]));
        pair(20, fmt(e.p1[1]));
        pair(30, 0);
        pair(11, fmt(e.p2[0]));
        pair(21, fmt(e.p2[1]));
        pair(31, 0);
      }
    }
    pair(0, 'ENDSEC');

    pair(0, 'EOF');
    return out.join('\n') + '\n';
  }
}

// AutoCAD parses DXF numbers with `atof`, so millimeter precision (4 decimals
// in meters) is more than enough and keeps the file small.
function fmt(n) {
  return Number(n).toFixed(4);
}

export function createDxf() {
  return new DxfBuilder();
}
