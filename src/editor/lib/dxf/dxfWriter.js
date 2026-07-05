// Minimal AutoCAD 2000 (AC1015) ASCII DXF writer for the plan-view export.
//
// Scope: just what the managed-street plan export needs — LWPOLYLINE / LINE
// entities on named layers. No HATCH, no dimensions, no custom blocks.
// Intentionally in-house (no npm dep) so the export stays small and
// self-contained; if the format grows past that (blocks for stencils/trees,
// hatches for surfaces) swap this for `@tarikjabiri/dxf`.
//
// Why the file carries so much boilerplate: LWPOLYLINE only exists in R13+
// DXF, and from R13 on the format is strict — every entity and symbol-table
// record needs a unique handle, all nine symbol tables must be present,
// entities live in the *Model_Space block record, and an OBJECTS section
// must hold the root dictionary. Emitting only the "interesting" parts
// produces a file that permissive viewers render but that crashes AutoCAD's
// own converter (Autodesk Viewer rejects it with TranslationWorker
// exit code 0xC0000409). This writer emits the full minimal AC1015 skeleton
// per the DXF reference:
// https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-235B22E0-A567-4CF6-92D3-38A2306D73F3
//
// DXF group-code format is pairs of lines: (code, value). One value per line.
// CRLF line endings — the spec allows LF but every Autodesk toolchain is
// Windows-based, so CRLF is the safe choice.

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
    this.layers = new Map();
    this.entities = [];
    this.insunits = INSUNITS.METERS;
    this.handle = 0x2f; // handles below 0x30 reserved for tables/blocks
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

  nextHandle() {
    return (++this.handle).toString(16).toUpperCase();
  }

  // Every 2D point across all entities, for $EXTMIN/$EXTMAX and the initial
  // viewport. Returns null when the drawing is empty.
  computeExtents() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const grow = ([x, y]) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const e of this.entities) {
      if (e.kind === 'LWPOLYLINE') e.points.forEach(grow);
      else if (e.kind === 'LINE') {
        grow(e.p1);
        grow(e.p2);
      }
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }

  toString() {
    const out = [];
    const pair = (code, value) => {
      out.push(String(code));
      out.push(String(value));
    };

    const ext = this.computeExtents() || { minX: 0, minY: 0, maxX: 1, maxY: 1 };

    // Fixed handles for the skeleton objects entities point back to. Chosen
    // below 0x30 so nextHandle() (which starts at 0x30) can never collide.
    const H = {
      ROOT_DICT: 'C',
      GROUP_DICT: 'D',
      TBL_VPORT: '8',
      REC_VPORT_ACTIVE: '29',
      TBL_LTYPE: '5',
      REC_LT_BYBLOCK: '14',
      REC_LT_BYLAYER: '15',
      REC_LT_CONTINUOUS: '16',
      TBL_LAYER: '2',
      REC_LAYER_0: '10',
      TBL_STYLE: '3',
      REC_STYLE_STANDARD: '11',
      TBL_VIEW: '6',
      TBL_UCS: '7',
      TBL_APPID: '9',
      REC_APPID_ACAD: '12',
      TBL_DIMSTYLE: 'A',
      REC_DIMSTYLE_STANDARD: '27',
      TBL_BLOCK_RECORD: '1',
      REC_MODEL_SPACE: '1F',
      REC_PAPER_SPACE: '1B'
    };

    // ---- ENTITIES (built first so $HANDSEED can be written accurately) ----
    const entityPairs = [];
    const epair = (code, value) => {
      entityPairs.push(String(code));
      entityPairs.push(String(value));
    };
    for (const e of this.entities) {
      if (e.kind === 'LWPOLYLINE') {
        epair(0, 'LWPOLYLINE');
        epair(5, this.nextHandle());
        epair(330, H.REC_MODEL_SPACE);
        epair(100, 'AcDbEntity');
        epair(8, e.layer);
        epair(100, 'AcDbPolyline');
        epair(90, e.points.length);
        epair(70, e.closed ? 1 : 0);
        epair(43, '0.0');
        for (const [x, y] of e.points) {
          epair(10, fmt(x));
          epair(20, fmt(y));
        }
      } else if (e.kind === 'LINE') {
        epair(0, 'LINE');
        epair(5, this.nextHandle());
        epair(330, H.REC_MODEL_SPACE);
        epair(100, 'AcDbEntity');
        epair(8, e.layer);
        epair(100, 'AcDbLine');
        epair(10, fmt(e.p1[0]));
        epair(20, fmt(e.p1[1]));
        epair(30, '0.0');
        epair(11, fmt(e.p2[0]));
        epair(21, fmt(e.p2[1]));
        epair(31, '0.0');
      }
    }
    // User layers get their handles here, before $HANDSEED is emitted.
    const layerHandles = new Map();
    for (const name of this.layers.keys()) {
      layerHandles.set(name, this.nextHandle());
    }

    // ---- HEADER ----
    pair(0, 'SECTION');
    pair(2, 'HEADER');
    pair(9, '$ACADVER');
    pair(1, 'AC1015');
    pair(9, '$HANDSEED');
    pair(5, this.nextHandle());
    pair(9, '$INSUNITS');
    pair(70, this.insunits);
    pair(9, '$MEASUREMENT');
    pair(70, this.insunits === INSUNITS.FEET ? 0 : 1);
    pair(9, '$EXTMIN');
    pair(10, fmt(ext.minX));
    pair(20, fmt(ext.minY));
    pair(30, '0.0');
    pair(9, '$EXTMAX');
    pair(10, fmt(ext.maxX));
    pair(20, fmt(ext.maxY));
    pair(30, '0.0');
    pair(0, 'ENDSEC');

    // ---- CLASSES (required for R2000+, may be empty) ----
    pair(0, 'SECTION');
    pair(2, 'CLASSES');
    pair(0, 'ENDSEC');

    // ---- TABLES — all nine are mandatory in R2000+, in this order ----
    pair(0, 'SECTION');
    pair(2, 'TABLES');

    // VPORT with one *ACTIVE viewport framing the drawing extents so the
    // file opens zoomed to the street instead of an empty origin.
    const cx = (ext.minX + ext.maxX) / 2;
    const cy = (ext.minY + ext.maxY) / 2;
    const viewH = Math.max(ext.maxY - ext.minY, 1) * 1.1;
    const viewW = Math.max(ext.maxX - ext.minX, 1) * 1.1;
    pair(0, 'TABLE');
    pair(2, 'VPORT');
    pair(5, H.TBL_VPORT);
    pair(330, '0');
    pair(100, 'AcDbSymbolTable');
    pair(70, 1);
    pair(0, 'VPORT');
    pair(5, H.REC_VPORT_ACTIVE);
    pair(330, H.TBL_VPORT);
    pair(100, 'AcDbSymbolTableRecord');
    pair(100, 'AcDbViewportTableRecord');
    pair(2, '*ACTIVE');
    pair(70, 0);
    pair(10, '0.0'); // lower-left of vport on screen
    pair(20, '0.0');
    pair(11, '1.0'); // upper-right
    pair(21, '1.0');
    pair(12, fmt(cx)); // view center (DCS)
    pair(22, fmt(cy));
    pair(13, '0.0'); // snap base
    pair(23, '0.0');
    pair(14, '0.5'); // snap spacing
    pair(24, '0.5');
    pair(15, '0.5'); // grid spacing
    pair(25, '0.5');
    pair(16, '0.0'); // view direction
    pair(26, '0.0');
    pair(36, '1.0');
    pair(17, '0.0'); // view target
    pair(27, '0.0');
    pair(37, '0.0');
    pair(40, fmt(viewH)); // view height
    pair(41, fmt(viewW / viewH)); // aspect ratio
    pair(42, '50.0'); // lens length
    pair(43, '0.0'); // front clip
    pair(44, '0.0'); // back clip
    pair(50, '0.0'); // snap rotation
    pair(51, '0.0'); // view twist
    pair(71, 0); // view mode
    pair(72, 1000); // circle zoom percent
    pair(73, 1); // fast zoom
    pair(74, 3); // UCSICON
    pair(75, 0); // snap on/off
    pair(76, 0); // grid on/off
    pair(77, 0); // snap style
    pair(78, 0); // snap isopair
    pair(0, 'ENDTAB');

    // LTYPE — ByBlock / ByLayer / Continuous are required, and Continuous is
    // what every layer below references.
    pair(0, 'TABLE');
    pair(2, 'LTYPE');
    pair(5, H.TBL_LTYPE);
    pair(330, '0');
    pair(100, 'AcDbSymbolTable');
    pair(70, 3);
    const ltype = (handle, name, desc) => {
      pair(0, 'LTYPE');
      pair(5, handle);
      pair(330, H.TBL_LTYPE);
      pair(100, 'AcDbSymbolTableRecord');
      pair(100, 'AcDbLinetypeTableRecord');
      pair(2, name);
      pair(70, 0);
      pair(3, desc);
      pair(72, 65);
      pair(73, 0);
      pair(40, '0.0');
    };
    ltype(H.REC_LT_BYBLOCK, 'ByBlock', '');
    ltype(H.REC_LT_BYLAYER, 'ByLayer', '');
    ltype(H.REC_LT_CONTINUOUS, 'Continuous', 'Solid line');
    pair(0, 'ENDTAB');

    // LAYER — layer 0 is required by every drawing; then the user layers.
    pair(0, 'TABLE');
    pair(2, 'LAYER');
    pair(5, H.TBL_LAYER);
    pair(330, '0');
    pair(100, 'AcDbSymbolTable');
    pair(70, this.layers.size + 1);
    const layerRec = (handle, name, color) => {
      pair(0, 'LAYER');
      pair(5, handle);
      pair(330, H.TBL_LAYER);
      pair(100, 'AcDbSymbolTableRecord');
      pair(100, 'AcDbLayerTableRecord');
      pair(2, name);
      pair(70, 0);
      pair(62, color);
      pair(6, 'Continuous');
    };
    layerRec(H.REC_LAYER_0, '0', ACI.WHITE);
    for (const { name, color } of this.layers.values()) {
      layerRec(layerHandles.get(name), name, color);
    }
    pair(0, 'ENDTAB');

    // STYLE — Standard text style, referenced by the Standard dimstyle.
    pair(0, 'TABLE');
    pair(2, 'STYLE');
    pair(5, H.TBL_STYLE);
    pair(330, '0');
    pair(100, 'AcDbSymbolTable');
    pair(70, 1);
    pair(0, 'STYLE');
    pair(5, H.REC_STYLE_STANDARD);
    pair(330, H.TBL_STYLE);
    pair(100, 'AcDbSymbolTableRecord');
    pair(100, 'AcDbTextStyleTableRecord');
    pair(2, 'Standard');
    pair(70, 0);
    pair(40, '0.0');
    pair(41, '1.0');
    pair(50, '0.0');
    pair(71, 0);
    pair(42, '2.5');
    pair(3, 'txt');
    pair(4, '');
    pair(0, 'ENDTAB');

    // VIEW / UCS — required tables, legitimately empty.
    pair(0, 'TABLE');
    pair(2, 'VIEW');
    pair(5, H.TBL_VIEW);
    pair(330, '0');
    pair(100, 'AcDbSymbolTable');
    pair(70, 0);
    pair(0, 'ENDTAB');
    pair(0, 'TABLE');
    pair(2, 'UCS');
    pair(5, H.TBL_UCS);
    pair(330, '0');
    pair(100, 'AcDbSymbolTable');
    pair(70, 0);
    pair(0, 'ENDTAB');

    // APPID — the ACAD entry is required.
    pair(0, 'TABLE');
    pair(2, 'APPID');
    pair(5, H.TBL_APPID);
    pair(330, '0');
    pair(100, 'AcDbSymbolTable');
    pair(70, 1);
    pair(0, 'APPID');
    pair(5, H.REC_APPID_ACAD);
    pair(330, H.TBL_APPID);
    pair(100, 'AcDbSymbolTableRecord');
    pair(100, 'AcDbRegAppTableRecord');
    pair(2, 'ACAD');
    pair(70, 0);
    pair(0, 'ENDTAB');

    // DIMSTYLE — note the record's handle uses group code 105, not 5.
    pair(0, 'TABLE');
    pair(2, 'DIMSTYLE');
    pair(5, H.TBL_DIMSTYLE);
    pair(330, '0');
    pair(100, 'AcDbSymbolTable');
    pair(70, 1);
    pair(100, 'AcDbDimStyleTable');
    pair(71, 0);
    pair(0, 'DIMSTYLE');
    pair(105, H.REC_DIMSTYLE_STANDARD);
    pair(330, H.TBL_DIMSTYLE);
    pair(100, 'AcDbSymbolTableRecord');
    pair(100, 'AcDbDimStyleTableRecord');
    pair(2, 'Standard');
    pair(70, 0);
    pair(340, H.REC_STYLE_STANDARD); // DIMTXSTY → Standard text style
    pair(0, 'ENDTAB');

    // BLOCK_RECORD — *Model_Space owns every entity in ENTITIES (their 330).
    pair(0, 'TABLE');
    pair(2, 'BLOCK_RECORD');
    pair(5, H.TBL_BLOCK_RECORD);
    pair(330, '0');
    pair(100, 'AcDbSymbolTable');
    pair(70, 2);
    const blockRec = (handle, name) => {
      pair(0, 'BLOCK_RECORD');
      pair(5, handle);
      pair(330, H.TBL_BLOCK_RECORD);
      pair(100, 'AcDbSymbolTableRecord');
      pair(100, 'AcDbBlockTableRecord');
      pair(2, name);
    };
    blockRec(H.REC_MODEL_SPACE, '*Model_Space');
    blockRec(H.REC_PAPER_SPACE, '*Paper_Space');
    pair(0, 'ENDTAB');
    pair(0, 'ENDSEC');

    // ---- BLOCKS — definitions for the two required layout blocks ----
    pair(0, 'SECTION');
    pair(2, 'BLOCKS');
    const blockDef = (ownerRecHandle, name, beginH, endH) => {
      pair(0, 'BLOCK');
      pair(5, beginH);
      pair(330, ownerRecHandle);
      pair(100, 'AcDbEntity');
      pair(8, '0');
      pair(100, 'AcDbBlockBegin');
      pair(2, name);
      pair(70, 0);
      pair(10, '0.0');
      pair(20, '0.0');
      pair(30, '0.0');
      pair(3, name);
      pair(1, '');
      pair(0, 'ENDBLK');
      pair(5, endH);
      pair(330, ownerRecHandle);
      pair(100, 'AcDbEntity');
      pair(8, '0');
      pair(100, 'AcDbBlockEnd');
    };
    blockDef(H.REC_MODEL_SPACE, '*Model_Space', '20', '21');
    blockDef(H.REC_PAPER_SPACE, '*Paper_Space', '1C', '1D');
    pair(0, 'ENDSEC');

    // ---- ENTITIES ----
    pair(0, 'SECTION');
    pair(2, 'ENTITIES');
    out.push(...entityPairs);
    pair(0, 'ENDSEC');

    // ---- OBJECTS — root dictionary with the ACAD_GROUP dictionary ----
    pair(0, 'SECTION');
    pair(2, 'OBJECTS');
    pair(0, 'DICTIONARY');
    pair(5, H.ROOT_DICT);
    pair(330, '0');
    pair(100, 'AcDbDictionary');
    pair(281, 1);
    pair(3, 'ACAD_GROUP');
    pair(350, H.GROUP_DICT);
    pair(0, 'DICTIONARY');
    pair(5, H.GROUP_DICT);
    pair(330, H.ROOT_DICT);
    pair(100, 'AcDbDictionary');
    pair(281, 1);
    pair(0, 'ENDSEC');

    pair(0, 'EOF');
    return out.join('\r\n') + '\r\n';
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
