/* global THREE */
// Where an oriented box lies on screen: the convex outline of its projection,
// clipped to the canvas.
//
// Each of the box's twelve edges is clipped to the camera's near and far
// planes in clip space, before the perspective divide, so a box that reaches
// behind the camera projects as the part in front of it rather than as a huge
// or inverted shape. The convex hull of the remaining points is the projected
// box; it is then clipped to the canvas rectangle. With the camera inside the
// box the outline covers the whole canvas.
//
// Runs every frame while a group is open, so its vectors and point lists are
// kept between calls: the returned points are overwritten by the next call.

const EDGES = [
  0, 1, 0, 2, 0, 4, 1, 3, 1, 5, 2, 3, 2, 6, 3, 7, 4, 5, 4, 6, 5, 7, 6, 7
];
// At most two points per edge, and one extra point per canvas side clipped.
const MAX_POINTS = EDGES.length + 4;
// The hull is built in place and briefly holds up to twice its input.
const MAX_HULL = 2 * EDGES.length;
// Below this area (in square pixels) the outline is a line or a point, which
// has no inside.
const MIN_AREA = 1e-3;

let scratch = null;
function tmp() {
  if (!scratch) {
    const points = (length = MAX_POINTS) =>
      Array.from({ length }, () => ({ x: 0, y: 0 }));
    scratch = {
      toClip: new THREE.Matrix4(),
      corners: Array.from({ length: 8 }, () => new THREE.Vector4()),
      a: new THREE.Vector4(),
      b: new THREE.Vector4(),
      projected: points(),
      hull: points(MAX_HULL),
      clipA: points(),
      clipB: points(),
      order: [],
      result: []
    };
  }
  return scratch;
}

const cross = (o, a, b) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function byPosition(p, q) {
  return p.x - q.x || p.y - q.y;
}

// Andrew's monotone chain over the first `count` points of `points`, into
// `out`. Returns the number of hull points.
function convexHull(points, count, out) {
  const order = tmp().order;
  order.length = 0;
  for (let i = 0; i < count; i++) order.push(points[i]);
  order.sort(byPosition);
  let n = 0;
  const push = (p) => {
    out[n].x = p.x;
    out[n].y = p.y;
    n++;
  };
  for (let i = 0; i < order.length; i++) {
    while (n >= 2 && cross(out[n - 2], out[n - 1], order[i]) <= 0) n--;
    push(order[i]);
  }
  const lower = n + 1;
  for (let i = order.length - 2; i >= 0; i--) {
    while (n >= lower && cross(out[n - 2], out[n - 1], order[i]) <= 0) n--;
    push(order[i]);
  }
  return Math.max(0, n - 1); // the last point repeats the first
}

// Keep the part of the convex polygon `input[0..count)` on the canvas side of
// one canvas edge (see `distance`), into `out`. Returns the new point count.
function clipPolygon(input, count, out, side, limit) {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const a = input[i];
    const b = input[(i + 1) % count];
    const da = distance(a, side, limit);
    const db = distance(b, side, limit);
    if (da >= 0) {
      out[n].x = a.x;
      out[n].y = a.y;
      n++;
    }
    if (da < 0 !== db < 0) {
      const t = da / (da - db);
      out[n].x = a.x + t * (b.x - a.x);
      out[n].y = a.y + t * (b.y - a.y);
      n++;
    }
  }
  return n;
}

// Signed distance of `p` inside one canvas side: 0 left (x >= limit),
// 1 right (x <= limit), 2 top (y >= limit), 3 bottom (y <= limit).
function distance(p, side, limit) {
  switch (side) {
    case 0:
      return p.x - limit;
    case 1:
      return limit - p.x;
    case 2:
      return p.y - limit;
    default:
      return limit - p.y;
  }
}

function area(points, count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const p = points[i];
    const q = points[(i + 1) % count];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * The on-screen outline of `box` (a local box placed by `matrixWorld`) seen
 * by `camera`, in pixels of a `width` × `height` canvas (origin top left).
 *
 * Returns the outline's corners in order, or an empty array when no part of
 * the box is on the canvas. The camera's matrices must be current. The array
 * and its points are reused by the next call: copy what must be kept.
 */
export function projectBoxSilhouette(box, matrixWorld, camera, width, height) {
  const t = tmp();
  t.result.length = 0;
  if (!box || box.isEmpty() || !(width > 0) || !(height > 0)) return t.result;

  t.toClip
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(matrixWorld);
  for (let i = 0; i < 8; i++) {
    t.corners[i]
      .set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
        1
      )
      .applyMatrix4(t.toClip);
  }

  let count = 0;
  const project = (p) => {
    const point = t.projected[count++];
    point.x = ((p.x / p.w + 1) * width) / 2;
    point.y = ((1 - p.y / p.w) * height) / 2;
  };
  for (let e = 0; e < EDGES.length; e += 2) {
    const a = t.a.copy(t.corners[EDGES[e]]);
    const b = t.b.copy(t.corners[EDGES[e + 1]]);
    let visible = true;
    // Near plane (z >= -w), then far plane (z <= w).
    for (let sign = 1; sign >= -1; sign -= 2) {
      const da = a.w + sign * a.z;
      const db = b.w + sign * b.z;
      if (da < 0 && db < 0) {
        visible = false;
        break;
      }
      if (da < 0) a.lerp(b, da / (da - db));
      else if (db < 0) b.lerp(a, db / (db - da));
    }
    if (!visible) continue;
    if (a.w > 0) project(a);
    if (b.w > 0) project(b);
  }
  if (count < 3) return t.result;

  let n = convexHull(t.projected, count, t.hull);
  let input = t.hull;
  let output = t.clipA;
  const limits = [0, width, 0, height];
  for (let side = 0; side < 4 && n > 0; side++) {
    n = clipPolygon(input, n, output, side, limits[side]);
    input = output;
    output = output === t.clipA ? t.clipB : t.clipA;
  }
  if (n < 3 || area(input, n) < MIN_AREA) return t.result;
  for (let i = 0; i < n; i++) t.result.push(input[i]);
  return t.result;
}
