/**
 * Curve core for path-following streets (curved managed streets prototype).
 *
 * A street that follows a path keeps its familiar straight-space layout —
 * street-align still assigns each segment a lateral x offset, generated
 * content still computes positions in (x across, z along) — and this module
 * owns the one mapping that bends that straight space onto a curve:
 *
 *   straight (x = lateral offset, z = along) → curved (position + yaw)
 *
 * via an arc-length parameterization s of the sampled centerline, where
 * s = z - zStart and zStart is derived from the street's length alignment.
 *
 * Everything here is pure three.js math (no AFRAME, no DOM) so it can be
 * unit-tested in isolation (test/editor/streetPathUtils.test.js). The
 * DOM-facing wiring lives in aframe-components/street-path.js.
 */
import * as THREE from 'three';

const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Centerline construction
// ---------------------------------------------------------------------------

/**
 * Build the sampled centerline polyline for a path.
 * @param {THREE.Vector3[]} rawPoints control vertices (path/shape vertices)
 * @param {Object} options
 * @param {('smooth'|'arc'|'linear')} options.curveType
 *   smooth: centripetal Catmull-Rom through the vertices (no cusps/loops on
 *           uneven spacing); arc: straight legs joined by circular fillets of
 *           `filletRadius` (how real road centerlines are drawn); linear:
 *           hard corners at the vertices.
 * @param {number} options.filletRadius corner radius in meters (arc only)
 * @param {boolean} options.closed loop path (last connects back to first)
 * @param {number} [options.sampleDistance=1] target spacing of curve samples
 * @returns {THREE.Vector3[]} sampled points (closed paths do NOT repeat the
 *   first point at the end; the wrap segment is implicit)
 */
export function buildCenterlinePoints(rawPoints, options = {}) {
  const {
    curveType = 'smooth',
    filletRadius = 3,
    closed = false,
    sampleDistance = 1
  } = options;

  let pts = dedupePoints(rawPoints);
  // a closed ring needs 3 distinct vertices; otherwise treat as open
  const isClosed = closed && pts.length >= 3;
  if (pts.length < 2) return pts;

  if (curveType === 'linear' || pts.length === 2) {
    return pts.map((p) => p.clone());
  }

  if (curveType === 'arc') {
    return filletPolyline(pts, filletRadius, isClosed, sampleDistance);
  }

  // smooth (centripetal Catmull-Rom)
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => p.clone()),
    isClosed,
    'centripetal'
  );
  const approxLength = curve.getLength();
  const divisions = Math.min(
    4096,
    Math.max(8, Math.ceil(approxLength / sampleDistance))
  );
  const sampled = curve.getSpacedPoints(divisions);
  // getSpacedPoints on a closed curve repeats the first point last — drop it,
  // PathSampler adds the wrap segment itself.
  if (isClosed && sampled.length > 1) {
    if (sampled[0].distanceTo(sampled[sampled.length - 1]) < 1e-4) {
      sampled.pop();
    }
  }
  return dedupePoints(sampled);
}

function dedupePoints(points) {
  const out = [];
  for (const p of points) {
    if (!out.length || out[out.length - 1].distanceTo(p) > 1e-4) {
      out.push(p.clone());
    }
  }
  // drop a closing duplicate of the first point too
  if (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < 1e-4) {
    out.pop();
  }
  return out;
}

/**
 * Replace each interior corner of a polyline with a circular arc tangent to
 * both legs (a fillet). The radius is clamped per-corner so adjacent fillets
 * never overlap (tangent length ≤ half of each adjacent leg). Fillet math is
 * 2D in the XZ plane; y is interpolated linearly across the corner.
 */
export function filletPolyline(pts, radius, closed, sampleDistance = 1) {
  const n = pts.length;
  const out = [];
  const cornerIndices = [];
  if (closed) {
    for (let i = 0; i < n; i++) cornerIndices.push(i);
  } else {
    for (let i = 1; i < n - 1; i++) cornerIndices.push(i);
    out.push(pts[0].clone());
  }

  for (const i of cornerIndices) {
    const A = pts[(i - 1 + n) % n];
    const B = pts[i];
    const C = pts[(i + 1) % n];
    const inVec = new THREE.Vector3().subVectors(B, A);
    const outVec = new THREE.Vector3().subVectors(C, B);
    const lenIn = Math.hypot(inVec.x, inVec.z);
    const lenOut = Math.hypot(outVec.x, outVec.z);
    if (lenIn < EPS || lenOut < EPS) {
      out.push(B.clone());
      continue;
    }
    // XZ unit directions
    const u = { x: inVec.x / lenIn, z: inVec.z / lenIn };
    const v = { x: outVec.x / lenOut, z: outVec.z / lenOut };
    const dot = clamp(u.x * v.x + u.z * v.z, -1, 1);
    const turn = Math.acos(dot); // turning angle at the corner
    if (turn < THREE.MathUtils.degToRad(1) || turn > Math.PI - 1e-3) {
      // straight-through or a hairpin reversal: no usable fillet
      out.push(B.clone());
      continue;
    }
    // tangent length for the requested radius, clamped to half of each leg
    // (each leg is shared with the neighboring corner's fillet)
    const tanHalf = Math.tan(turn / 2);
    let t = radius * tanHalf;
    const tMax = 0.5 * Math.min(lenIn, lenOut);
    if (t > tMax) t = tMax;
    const rEff = t / tanHalf;
    if (rEff < 0.01) {
      out.push(B.clone());
      continue;
    }
    // tangent points on each leg (3D so y interpolates through the corner)
    const p1 = new THREE.Vector3(
      B.x - u.x * t,
      B.y + (A.y - B.y) * (t / lenIn),
      B.z - u.z * t
    );
    const p2 = new THREE.Vector3(
      B.x + v.x * t,
      B.y + (C.y - B.y) * (t / lenOut),
      B.z + v.z * t
    );
    // center sits perpendicular to the incoming leg at p1, on the turn side.
    // right(u) = (u.z, -u.x); turning right when v has a positive component
    // along right(u).
    const rightX = u.z;
    const rightZ = -u.x;
    const turningRight = v.x * rightX + v.z * rightZ > 0;
    const nX = turningRight ? rightX : -rightX;
    const nZ = turningRight ? rightZ : -rightZ;
    const cX = p1.x + nX * rEff;
    const cZ = p1.z + nZ * rEff;
    const a1 = Math.atan2(p1.z - cZ, p1.x - cX);
    const a2 = Math.atan2(p2.z - cZ, p2.x - cX);
    let delta = normalizeAngle(a2 - a1);
    const steps = Math.max(
      2,
      Math.ceil((rEff * Math.abs(delta)) / sampleDistance)
    );
    out.push(p1);
    for (let j = 1; j < steps; j++) {
      const f = j / steps;
      const a = a1 + delta * f;
      out.push(
        new THREE.Vector3(
          cX + rEff * Math.cos(a),
          p1.y + (p2.y - p1.y) * f,
          cZ + rEff * Math.sin(a)
        )
      );
    }
    out.push(p2);
  }

  if (!closed) out.push(pts[n - 1].clone());
  return dedupePoints(out);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ---------------------------------------------------------------------------
// PathSampler — arc-length frames along the sampled centerline
// ---------------------------------------------------------------------------

export class PathSampler {
  /**
   * @param {THREE.Vector3[]} points sampled centerline (no closing duplicate)
   * @param {boolean} closed loop path (implicit wrap segment last→first)
   */
  constructor(points, closed = false) {
    this.points = points;
    this.closed = closed && points.length >= 3;
    this.segDirs = []; // unit direction of segment i (points[i] → points[i+1])
    this.segLengths = [];
    this.cumulative = [0]; // arc length at points[i]
    const count = this.closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      this.segDirs.push(
        len > EPS ? dir.divideScalar(len) : new THREE.Vector3(0, 0, 1)
      );
      this.segLengths.push(len);
      this.cumulative.push(this.cumulative[i] + len);
    }
    this.totalLength = this.cumulative[this.cumulative.length - 1];
  }

  /**
   * Frame at arc length s: centerline position, unit tangent, horizontal
   * right vector (up × tangent) and yaw (degrees rotating +z onto the
   * tangent). Open paths extrapolate linearly beyond either end; closed
   * paths wrap.
   */
  frameAtS(s) {
    const L = this.totalLength;
    if (this.closed) {
      s = ((s % L) + L) % L;
    }
    let position;
    let tangent;
    if (!this.closed && s <= 0) {
      tangent = this.segDirs[0];
      position = this.points[0].clone().addScaledVector(tangent, s);
    } else if (!this.closed && s >= L) {
      tangent = this.segDirs[this.segDirs.length - 1];
      position = this.points[this.points.length - 1]
        .clone()
        .addScaledVector(tangent, s - L);
    } else {
      const i = this.segmentIndexAtS(s);
      const local = s - this.cumulative[i];
      tangent = this.segDirs[i];
      position = this.points[i].clone().addScaledVector(tangent, local);
    }
    return this.makeFrame(position, tangent);
  }

  segmentIndexAtS(s) {
    // binary search for the segment containing arc length s
    let lo = 0;
    let hi = this.segLengths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cumulative[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  makeFrame(position, tangent, miterScale = 1) {
    const h = Math.hypot(tangent.x, tangent.z);
    let right;
    if (h < EPS) {
      right = new THREE.Vector3(1, 0, 0);
    } else {
      // up × tangent, normalized in the horizontal plane so lateral offsets
      // stay true-to-width even on sloped paths
      right = new THREE.Vector3(tangent.z / h, 0, -tangent.x / h);
    }
    return {
      position,
      tangent,
      right,
      miterScale,
      yawDeg: THREE.MathUtils.radToDeg(Math.atan2(tangent.x, tangent.z))
    };
  }

  /**
   * Ring stations for extruded geometry between arc lengths sStart..sEnd:
   * frames at curvature-relevant points (interior sample vertices use the
   * miter tangent — the normalized average of adjacent segment directions —
   * with a bounded miter scale so ribbon edges stay parallel to the legs).
   * Long straight runs are decimated; gaps are capped at maxSpacing.
   */
  getRingStations(sStart, sEnd, options = {}) {
    const {
      maxSpacing = 6,
      minSpacing = 0.2,
      angleThresholdDeg = 1.5
    } = options;
    const L = this.totalLength;
    const stations = [];
    const pushFrame = (s, frame) => {
      stations.push({ s, ...frame });
    };

    // candidate interior s values: the sample vertices inside (sStart, sEnd)
    const candidates = [];
    if (this.closed) {
      // walk vertices across the (possibly >L) window by unrolling
      for (let k = Math.floor(sStart / L) - 1; k * L < sEnd + L; k++) {
        for (let i = 0; i < this.points.length; i++) {
          const s = this.cumulative[i] + k * L;
          if (s > sStart + EPS && s < sEnd - EPS) {
            candidates.push({ s, vertexIndex: i });
          }
        }
      }
      candidates.sort((a, b) => a.s - b.s);
    } else {
      for (let i = 1; i < this.points.length - 1; i++) {
        const s = this.cumulative[i];
        if (s > sStart + EPS && s < sEnd - EPS) {
          candidates.push({ s, vertexIndex: i });
        }
      }
    }

    pushFrame(sStart, this.frameAtS(sStart));
    let lastS = sStart;
    let accumTurn = 0;
    const angleThreshold = THREE.MathUtils.degToRad(angleThresholdDeg);
    for (const cand of candidates) {
      const turn = this.turnAngleAtVertex(cand.vertexIndex);
      accumTurn += turn;
      const gap = cand.s - lastS;
      if (accumTurn < angleThreshold && gap < maxSpacing) continue;
      if (gap < minSpacing && accumTurn < THREE.MathUtils.degToRad(20)) {
        continue;
      }
      // subdivide a long straight gap so lighting/UVs stay well-behaved
      this.fillGap(stations, lastS, cand.s, maxSpacing);
      pushFrame(cand.s, this.vertexFrame(cand.vertexIndex));
      lastS = cand.s;
      accumTurn = 0;
    }
    this.fillGap(stations, lastS, sEnd, maxSpacing);
    pushFrame(sEnd, this.frameAtS(sEnd));
    return stations;
  }

  fillGap(stations, from, to, maxSpacing) {
    const gap = to - from;
    if (gap <= maxSpacing) return;
    const steps = Math.ceil(gap / maxSpacing);
    for (let j = 1; j < steps; j++) {
      const s = from + (gap * j) / steps;
      stations.push({ s, ...this.frameAtS(s) });
    }
  }

  turnAngleAtVertex(i) {
    const prev = this.segDirAtVertex(i, -1);
    const next = this.segDirAtVertex(i, 0);
    if (!prev || !next) return 0;
    return prev.angleTo(next);
  }

  segDirAtVertex(i, offset) {
    const count = this.segLengths.length;
    let idx = i + offset;
    if (this.closed) {
      idx = ((idx % count) + count) % count;
      return this.segDirs[idx];
    }
    if (idx < 0 || idx >= count) return null;
    return this.segDirs[idx];
  }

  /** Miter frame at sample vertex i (averaged adjacent directions). */
  vertexFrame(i) {
    const prev = this.segDirAtVertex(i, -1);
    const next = this.segDirAtVertex(i, 0);
    let tangent;
    let miterScale = 1;
    if (prev && next) {
      tangent = new THREE.Vector3().addVectors(prev, next);
      if (tangent.lengthSq() < EPS) {
        tangent = next.clone();
      } else {
        tangent.normalize();
        // widen the ribbon at the corner so its edges stay parallel to the
        // legs; bounded so a sharp corner cannot blow the width up
        const halfTurn = prev.angleTo(next) / 2;
        miterScale = Math.min(1 / Math.max(Math.cos(halfTurn), 0.5), 2);
      }
    } else {
      tangent = (next || prev || new THREE.Vector3(0, 0, 1)).clone();
    }
    return this.makeFrame(this.points[i].clone(), tangent, miterScale);
  }
}

// ---------------------------------------------------------------------------
// straight → curved mapping
// ---------------------------------------------------------------------------

/**
 * Map a point expressed in the street's STRAIGHT local space (x lateral,
 * z along) onto the curve. zStart is the straight-space z of the street's
 * start (depends on street-align length alignment).
 * Returns {x, y, z, yawDeg}: curved street-local position of the point and
 * the yaw to add to content so it faces along the curve. y is the curve's
 * own elevation at that station (additive to any content y).
 */
export function mapStraightPoint(sampler, zStart, x, z) {
  const s = z - zStart;
  const frame = sampler.frameAtS(s);
  return {
    x: frame.position.x + frame.right.x * x,
    y: frame.position.y,
    z: frame.position.z + frame.right.z * x,
    yawDeg: frame.yawDeg
  };
}

// ---------------------------------------------------------------------------
// Ribbon geometry — the curved equivalent of the straight below-box
// ---------------------------------------------------------------------------

/**
 * Build an extruded ribbon along the curve: cross-section is a rectangle
 * [lateralCenter - width/2, lateralCenter + width/2] × [top 0, bottom -height]
 * relative to the centerline, swept from sStart to sEnd. Top-face UVs match
 * BoxGeometry conventions (u across width 0..1, v along length 0..1) so the
 * straight-street material repeat math keeps working unchanged.
 *
 * `origin` is subtracted from every vertex (x/z), so the geometry can live on
 * an entity that street-align has already translated in straight space.
 * height 0 builds the top face only (striping planes).
 *
 * `slopeLeftDelta` / `slopeRightDelta` tilt the TOP face across the ribbon's
 * width (left = lateral min / straight -x edge, right = lateral max /
 * straight +x edge), matching below-box's slopeStartDelta/slopeEndDelta:
 * side-wall top edges follow the tilt, the bottom stays flat.
 */
export function buildRibbonGeometry(sampler, options = {}) {
  const {
    lateralCenter = 0,
    width = 1,
    height = 0.2,
    sStart = 0,
    sEnd = sampler.totalLength,
    origin = { x: 0, z: 0 },
    closedLoop = false,
    maxSpacing = 6,
    yTop = 0,
    slopeLeftDelta = 0,
    slopeRightDelta = 0
  } = options;

  const stations = sampler.getRingStations(sStart, sEnd, { maxSpacing });
  const ringCount = stations.length;
  const halfWidth = width / 2;
  const vDenom = Math.max(sEnd - sStart, EPS);

  const positions = [];
  const uvs = [];
  const indices = [];

  // ring corner positions, computed once per ring
  const rings = stations.map((st) => {
    const scale = st.miterScale || 1;
    const latLeft = (lateralCenter - halfWidth) * scale;
    const latRight = (lateralCenter + halfWidth) * scale;
    const v = (st.s - sStart) / vDenom;
    const topY = st.position.y + yTop;
    return {
      v,
      left: {
        x: st.position.x + st.right.x * latLeft - origin.x,
        z: st.position.z + st.right.z * latLeft - origin.z
      },
      right: {
        x: st.position.x + st.right.x * latRight - origin.x,
        z: st.position.z + st.right.z * latRight - origin.z
      },
      leftTopY: topY + slopeLeftDelta,
      rightTopY: topY + slopeRightDelta,
      bottomY: topY - height
    };
  });

  // one vertex strip per face group; strips share ring vertices internally
  // (smooth along the curve) but not across groups (hard edges between top,
  // sides and bottom).
  const addStrip = (cornerA, cornerB, yKeyA, yKeyB, uvFn) => {
    const base = positions.length / 3;
    rings.forEach((ring) => {
      const a = ring[cornerA];
      const b = ring[cornerB];
      positions.push(a.x, ring[yKeyA], a.z, b.x, ring[yKeyB], b.z);
      const [uvA, uvB] = uvFn(ring);
      uvs.push(uvA[0], uvA[1], uvB[0], uvB[1]);
    });
    return base;
  };

  // top: left/right at their (possibly slope-tilted) top heights —
  // triangles (A, D, B), (A, C, D) face +y
  const topBase = addStrip('left', 'right', 'leftTopY', 'rightTopY', (r) => [
    [0, r.v],
    [1, r.v]
  ]);
  for (let i = 0; i < ringCount - 1; i++) {
    const a = topBase + 2 * i;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, d, b, a, c, d);
  }

  if (height > 0) {
    // bottom (faces -y)
    const bottomBase = addStrip('left', 'right', 'bottomY', 'bottomY', (r) => [
      [0, r.v],
      [1, r.v]
    ]);
    for (let i = 0; i < ringCount - 1; i++) {
      const a = bottomBase + 2 * i;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, d, a, d, c);
    }
    // right wall (faces outward +lateral): verts TR, BR per ring
    const rightBase = addStrip(
      'right',
      'right',
      'rightTopY',
      'bottomY',
      (r) => [
        [r.v, 1],
        [r.v, 0]
      ]
    );
    for (let i = 0; i < ringCount - 1; i++) {
      const tr = rightBase + 2 * i;
      const br = tr + 1;
      const trN = tr + 2;
      const brN = tr + 3;
      indices.push(tr, trN, brN, tr, brN, br);
    }
    // left wall (faces outward -lateral): verts TL, BL per ring
    const leftBase = addStrip('left', 'left', 'leftTopY', 'bottomY', (r) => [
      [r.v, 1],
      [r.v, 0]
    ]);
    for (let i = 0; i < ringCount - 1; i++) {
      const tl = leftBase + 2 * i;
      const bl = tl + 1;
      const tlN = tl + 2;
      const blN = tl + 3;
      indices.push(tl, blN, tlN, tl, bl, blN);
    }
    if (!closedLoop) {
      // end caps
      const addCap = (ring, flip) => {
        const base = positions.length / 3;
        positions.push(
          ring.left.x,
          ring.leftTopY,
          ring.left.z,
          ring.right.x,
          ring.rightTopY,
          ring.right.z,
          ring.left.x,
          ring.bottomY,
          ring.left.z,
          ring.right.x,
          ring.bottomY,
          ring.right.z
        );
        uvs.push(0, 1, 1, 1, 0, 0, 1, 0);
        const [tl, tr, bl, br] = [base, base + 1, base + 2, base + 3];
        if (flip) {
          indices.push(tr, tl, bl, tr, bl, br);
        } else {
          indices.push(tl, tr, bl, tr, br, bl);
        }
      };
      addCap(rings[0], false); // start cap faces -s
      addCap(rings[ringCount - 1], true); // end cap faces +s
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
