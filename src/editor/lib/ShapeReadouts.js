/* global THREE */

// On-canvas readouts for a shape. One renderer drives both the live draw
// preview (the active segment and corner) and a selected shape (all segments,
// or the hovered one on large shapes). Readouts are CSS2D DOM billboards.
//
// What shows follows the editor's display preferences, which the owner pushes
// in through setDisplay — this layer never reads the store:
// - Measurements on (the default): a length on each side the chip rule picks.
//   On a selected shape that length is also the side's insert control.
// - Measurements off: no length anywhere. A selected shape's insertable sides
//   keep their control as a "+"-only chip; the other sides show nothing.
// - Angles on (off by default): the included angle at the corners beside the
//   sides shown. An angle caption is never a control — it takes no pointer
//   event, so a vertex handle under it stays grabbable — and it sits offset
//   below its corner so it clears a handle drawn at its target size. It does
//   not try to clear anything larger: angles are opt-in, and at dense or
//   street-level views a caption may cover a neighbouring handle.
//
// Everything is attached under the shape entity's object3D and torn down in
// dispose() — CSS2DObjects detached, the group removed. (measure-line famously
// leaks its store subscription and never detaches its CSS2DObject; this
// renderer must not repeat that.)

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  segmentLength,
  distanceToSegmentXZ,
  formatAngle,
  formatLength,
  includedAngleDeg
} from './shapeMeasure';
import {
  ANGLE_CAPTION_OFFSET_PX,
  MIN_TAP_TARGET_PX,
  READOUT_RENDER_ORDER
} from './shapeEditRules';
import { forwardWheelToCanvas } from './forwardWheelToCanvas.js';

// Distinguishes chips built by THIS renderer from any other instance's. The
// panel's click handler is delegated on `document` and cannot be scoped to a
// container — every CSS2D element in the scene shares one renderer container —
// so the marker has to travel on the chip. See docs/shape-vertex-editing.md.
let nextInstanceId = 1;

const EPS = 1e-4;

// Names the action for anyone unsure what a chip that has turned into a "+" is
// about to do. "vertex" rather than "point" or "corner": that is the word the
// controls beside this one already use. The English fallback for callers that
// pass no translation — the sidebar passes the catalog string
// (shapeReadouts.insertHint) in, since this layer sits outside React and has
// no intl context of its own.
const INSERT_HINT = 'Add a vertex to this side';

const midpoint = (a, b) =>
  new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);

// The visible chip's look. Its rendered height is what shapeEditRules'
// CAPTION_HALF_PX is half of — restyle the font size, line-height or vertical
// padding here and that constant has to follow.
function styleInner(inner) {
  inner.style.color = '#fff';
  inner.style.fontFamily = 'sans-serif';
  inner.style.fontSize = '12px';
  inner.style.padding = '2px 4px';
  inner.style.borderRadius = '3px';
}

export default class ShapeReadouts {
  constructor(el, insertHint) {
    this.el = el;
    this.insertHint = insertHint || INSERT_HINT;
    this.instanceId = String(nextInstanceId++);
    this.units = 'metric';
    this.showMeasurements = true;
    this.showAngles = false;
    this.group = new THREE.Group();
    this.group.name = 'shapeReadouts';
    if (el.object3D) el.object3D.add(this.group);
    // { obj: CSS2DObject, outer: HTMLElement, inner: HTMLElement }
    this.labels = [];
    // Scratch for world-frame measurement in _addLengthLabel.
    this._worldA = new THREE.Vector3();
    this._worldB = new THREE.Vector3();
  }

  setUnits(units) {
    this.units = units || 'metric';
  }

  // The editor's display preferences, applied from the next render.
  setDisplay({ measurements = true, angles = false } = {}) {
    this.showMeasurements = !!measurements;
    this.showAngles = !!angles;
  }

  // --- public render entry points -----------------------------------------

  // Draw mode. `vertices` are THREE.Vector3 local to el; the last segment is
  // the active one. `extraSides` names further segments (i → i+1) to measure,
  // `corners` names [prev, corner, next] index triples to give an angle, and
  // `notice` is a sentence shown at the first vertex. None of them is ever a
  // control: a live chip on the draw path would break the draw tool.
  renderActive(
    vertices,
    { corners = [], extraSides = [], notice = null } = {}
  ) {
    this.clear();
    const n = vertices.length;
    if (notice && n) this._addNotice(notice, vertices[0]);
    if (n < 2) return;
    if (this.showMeasurements) {
      this._addLengthLabel(vertices[n - 2], vertices[n - 1]);
      for (const i of extraSides) {
        if (i >= 0 && i + 1 < n) {
          this._addLengthLabel(vertices[i], vertices[i + 1]);
        }
      }
    }
    if (this.showAngles) {
      for (const [a, b, c] of corners) {
        if (vertices[a] && vertices[b] && vertices[c]) {
          this._addAngleCaption(vertices[a], vertices[b], vertices[c]);
        }
      }
    }
  }

  // Select mode: all segments up to maxVertices, else the segment nearest
  // hoverPoint (a THREE.Vector3 in el-local space) only. When `closed`, the
  // ring has a wrap segment (last→first), so all indexing wraps mod n.
  //
  // `pinnedSegments` names segments that must be labelled whatever the cap
  // says.
  //
  // `interaction`, when supplied, turns the side chips into controls:
  // `{ isInsertable(segment) → boolean, revealedSegment: number | null }`. It is
  // a parameter of this method and of no other, which is what scopes
  // interactivity to a SELECTED shape structurally rather than by a condition —
  // a live chip on the draw path would break the draw tool. See
  // docs/shape-vertex-editing.md.
  //
  // The callback form is what keeps this file free of any knowledge of the edit
  // rules: the caller supplies the answer, this layer never asks the question.
  renderAll(
    vertices,
    maxVertices,
    hoverPoint,
    closed = false,
    pinnedSegments = null,
    interaction = null
  ) {
    this.clear();
    const n = vertices.length;
    if (n < 2) return;
    const ring = closed && n >= 3;
    const sides = this._chipRuleSides(
      vertices,
      maxVertices,
      hoverPoint,
      ring,
      pinnedSegments
    );
    for (const i of sides) {
      const a = vertices[i];
      const b = vertices[(i + 1) % n];
      if (this.showMeasurements) {
        this._addLengthLabel(a, b, i, interaction);
      } else if (interaction?.isInsertable(i)) {
        this._addPlusChip(a, b, i, interaction);
      }
    }
    if (this.showAngles) this._addCornerAngles(vertices, sides, ring);
  }

  // The sides a selected shape labels, in label order: the chip rule.
  _chipRuleSides(vertices, maxVertices, hoverPoint, ring, pinnedSegments) {
    const n = vertices.length;
    const sides = [];
    // Number of segments and corners: a closed ring has n of each; an open
    // polyline has n-1 segments and n-2 interior corners.
    const segCount = ring ? n : n - 1;

    // Pinned segments are labelled unconditionally, and FIRST. These captions
    // are the click target itself — a side is reached by clicking its number —
    // so they cannot inherit an early exit that the rest of the label set
    // legitimately takes. The in-range filter keeps this method total for any
    // caller.
    const pinned = new Set();
    if (pinnedSegments) {
      for (const i of pinnedSegments) {
        if (i >= 0 && i < segCount) pinned.add(i);
      }
    }
    for (const i of pinned) sides.push(i);

    if (n <= maxVertices) {
      for (let i = 0; i < segCount; i++) {
        if (!pinned.has(i)) sides.push(i); // pinned ones are already listed
      }
      return sides;
    }
    // Above the label cap it is hover-only: with no hover
    // point yet, show nothing beyond the pins rather than dumping all ~2N
    // labels — that dump is the exact jank the cap exists to prevent.
    if (!hoverPoint) return sides;
    // hover: nearest segment only. Search wraps over the wrap segment too when
    // closed (best can be n-1, whose end is vertices[0] via mod n — never
    // vertices[n]).
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < segCount; i++) {
      const { distance } = distanceToSegmentXZ(
        hoverPoint,
        vertices[i],
        vertices[(i + 1) % n]
      );
      if (distance < bestDist) {
        bestDist = distance;
        best = i;
      }
    }
    if (best >= 0 && !pinned.has(best)) sides.push(best);
    return sides;
  }

  // One angle at each corner beside a labelled side — so a large shape gains
  // at most two per side shown, never one per corner. Both ends of a side on
  // a closed ring; only interior corners (1..n-2) on an open polyline, which
  // has no angle at its ends. Each corner once.
  _addCornerAngles(vertices, sides, ring) {
    const n = vertices.length;
    const corners = new Set();
    for (const i of sides) {
      for (const c of [i, (i + 1) % n]) {
        if (ring || (c >= 1 && c <= n - 2)) corners.add(c);
      }
    }
    for (const c of corners) {
      this._addAngleCaption(
        vertices[(c - 1 + n) % n],
        vertices[c],
        vertices[(c + 1) % n]
      );
    }
  }

  // --- internals ----------------------------------------------------------

  // `segment` and `interaction` are both absent on the draw-preview path, which
  // has no segment index and must not gain one.
  //
  // The LENGTH is measured in the world frame — a shape nested inside a scaled
  // group must read the size it renders at (and the size a street following it
  // lays at). The label's position stays local: the group is a child of the
  // shape's object3D, so placement inherits the transform for free.
  _addLengthLabel(a, b, segment, interaction) {
    const len = this._worldLength(a, b);
    if (len < EPS) return; // zero-length segment carries no readout
    const mid = midpoint(a, b);
    let options = null;
    if (interaction && segment !== undefined) {
      // Asked only for segments about to be labelled, so the cost is
      // O(labelled) rather than O(segments): at most the cap's worth below it,
      // and pins plus one above it.
      options = interaction.isInsertable(segment)
        ? {
            insertable: true,
            segment,
            revealed: interaction.revealedSegment === segment
          }
        : { insertable: false };
    }
    this._makeLabel(formatLength(len, this.units), mid, options);
  }

  _worldLength(a, b) {
    const obj3D = this.el.object3D;
    obj3D.updateWorldMatrix(true, false);
    return segmentLength(
      this._worldA.copy(a).applyMatrix4(obj3D.matrixWorld),
      this._worldB.copy(b).applyMatrix4(obj3D.matrixWorld)
    );
  }

  // With measurements off, an insertable side keeps its insert control as a
  // chip that shows only "+": the side's function made explicit instead of
  // hidden behind a number it no longer shows.
  _addPlusChip(a, b, segment, interaction) {
    if (this._worldLength(a, b) < EPS) return;
    this._makeLabel('+', midpoint(a, b), {
      insertable: true,
      plusOnly: true,
      segment,
      revealed: interaction.revealedSegment === segment
    });
  }

  // The included angle at `corner`, on the vertex polygon's x/z plan view.
  _addAngleCaption(prev, corner, next) {
    const deg = includedAngleDeg(prev, corner, next);
    if (deg === null) return; // a degenerate corner has no angle
    this._makeCaption(
      formatAngle(deg),
      corner,
      'shape-readout--angle',
      ANGLE_CAPTION_OFFSET_PX
    );
  }

  // Offset above the first vertex, the opposite way to the angle caption that
  // can sit at the same corner.
  _addNotice(text, at) {
    this._makeCaption(
      text,
      at,
      'shape-readout--notice',
      -ANGLE_CAPTION_OFFSET_PX
    );
  }

  // A caption that is never a control, offset vertically on screen from its
  // anchor. The offset goes on the INNER, since the outer's transform is
  // CSS2DRenderer's to rewrite every pass.
  _makeCaption(text, pos, className, offsetPx) {
    const outer = document.createElement('div');
    outer.className = `shape-readout ${className}`;
    outer.style.pointerEvents = 'none';
    const inner = document.createElement('div');
    inner.className = 'label shape-readout-label';
    styleInner(inner);
    inner.style.pointerEvents = 'none';
    inner.style.transform = `translate(0px, ${offsetPx}px)`;
    inner.textContent = text;
    outer.appendChild(inner);
    const obj = new CSS2DObject(outer);
    obj.position.copy(pos);
    obj.renderOrder = READOUT_RENDER_ORDER.caption;
    this.group.add(obj);
    this.labels.push({ obj, outer, inner });
  }

  // TWO elements always: the OUTER is what CSS2DRenderer positions and whose
  // style.transform it rewrites every pass, so nothing of ours may go there;
  // the INNER is the visible chip, and its rendered HEIGHT is what
  // shapeEditRules' CAPTION_HALF_PX is half of — restyle the font size,
  // line-height or vertical padding below and that constant has to follow.
  //
  // A plain caption's inner is one text node; an insertable one's is two spans,
  // and that asymmetry is the footprint lock rather than styling. Why, and which
  // properties belong here rather than in the stylesheet:
  // docs/shape-vertex-editing.md.
  _makeLabel(text, pos, options) {
    const insertable = !!(options && options.insertable);
    const plusOnly = !!(options && options.plusOnly);
    const outer = document.createElement('div');
    outer.className = 'shape-readout';
    // Inline and unconditional, NOT in the stylesheet: no state variant, and a
    // chip that took presses on the draw path would break the draw tool.
    outer.style.pointerEvents = 'none';

    const inner = document.createElement('div');
    inner.className = 'label shape-readout-label';
    styleInner(inner);
    // The hit target is the outer, so the inner stays transparent: that way a
    // press reports the outer as its target and carries the segment marker.
    inner.style.pointerEvents = 'none';
    if (plusOnly) {
      // No number to hold a footprint for, so the glyph is in flow and at the
      // label's own size: the inner keeps the caption height CAPTION_HALF_PX
      // assumes. The glyph is decoration; the chip's accessible name is the
      // hint, in a visually hidden span.
      const glyph = document.createElement('span');
      glyph.className = 'shape-readout-plus-glyph';
      glyph.textContent = '+';
      glyph.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'shape-readout-sr';
      name.textContent = this.insertHint;
      inner.appendChild(glyph);
      inner.appendChild(name);
    } else if (insertable) {
      // The value span is the only child that occupies layout — the plus is out
      // of flow — so the inner's RENDERED HEIGHT is unchanged and
      // CAPTION_HALF_PX stays true of both branches. WHERE the glyph lands
      // inside the box is the stylesheet's job, not this one's.
      const value = document.createElement('span');
      value.className = 'shape-readout-value';
      value.textContent = text;
      const plus = document.createElement('span');
      plus.className = 'shape-readout-plus';
      plus.textContent = '+';
      // A decoration of the number, not a second thing to read out: the chip's
      // accessible name has to stay the measurement, which is what the panel
      // exists to show.
      plus.setAttribute('aria-hidden', 'true');
      inner.appendChild(value);
      inner.appendChild(plus);
    } else {
      inner.textContent = text;
    }
    outer.appendChild(inner);

    const obj = new CSS2DObject(outer);
    obj.position.copy(pos);
    // The bottom of the four CSS2D bands — see READOUT_RENDER_ORDER.
    obj.renderOrder = READOUT_RENDER_ORDER.caption;

    if (insertable) {
      outer.classList.add('shape-readout--insertable');
      outer.style.pointerEvents = 'auto';
      // Taking the pointer takes the wheel — see forwardWheelToCanvas. Bound on
      // this branch alone, the only one that can receive a wheel at all.
      outer.addEventListener('wheel', forwardWheelToCanvas, { passive: false });
      // A `title` and not a widget role (the chip cannot take focus, so a role
      // would announce a control that cannot be operated) nor an aria-label
      // (which overrides element content unconditionally, deleting the
      // measurement from the accessible name even at rest).
      outer.title = this.insertHint;
      // Lifted clear of the captions that are NOT controls, so an ordinary
      // neighbour cannot cover the affordance a hovering pointer summons here.
      obj.renderOrder = READOUT_RENDER_ORDER.insertableCaption;
      // Written from the constant rather than typed into the stylesheet, so the
      // hit box and the app's small-control size stay mechanically linked
      // instead of merely commented across a language boundary.
      outer.style.minHeight = `${MIN_TAP_TARGET_PX}px`;
      if (plusOnly) {
        // A "+" alone is narrower than a number, so the width needs the same
        // floor as the height to stay a finger-sized target.
        outer.classList.add('shape-readout--plus-only');
        outer.style.minWidth = `${MIN_TAP_TARGET_PX}px`;
      }
      // The two halves of the channel the panel's delegated click handler
      // resolves through: WHICH side this chip is, and WHOSE enumeration
      // stamped it. Both load-bearing rather than decorative.
      outer.dataset.shapeSegment = String(options.segment);
      outer.dataset.shapeReadouts = this.instanceId;
      if (options.revealed) {
        outer.classList.add('shape-readout--revealed');
        // Lifted a band so a neighbouring caption cannot cover the number the
        // user has to keep sight of while reaching for the button beside it.
        obj.renderOrder = READOUT_RENDER_ORDER.revealedCaption;
      }
    } else if (options) {
      // A side that cannot take a point is marked, and the ones that can are
      // not. On the overwhelmingly common shape every side can, so marking the
      // insertable ones would mark everything and carry no information; the
      // mark appears exactly when there is something to say. It is also the only
      // signal that exists on touch, where there is no hover and no cursor.
      outer.classList.add('shape-readout--muted');
    }

    this.group.add(obj);
    this.labels.push({ obj, outer, inner });
  }

  // Remove all rendered labels but keep the group for reuse.
  clear() {
    for (const { obj, outer } of this.labels) {
      this.group.remove(obj);
      // Not a leak fix (the handler is module-scope) — the listener's life is
      // stated at both ends. A no-op on the chips that never took one.
      if (outer) outer.removeEventListener('wheel', forwardWheelToCanvas);
      // Removing the outer takes its inner with it.
      if (outer && outer.parentNode) outer.parentNode.removeChild(outer);
    }
    this.labels.length = 0;
  }

  // Full teardown — call on deselect / tool exit / entity removal.
  dispose() {
    this.clear();
    if (this.el && this.el.object3D && this.group.parent) {
      this.el.object3D.remove(this.group);
    }
    this.el = null;
  }
}
