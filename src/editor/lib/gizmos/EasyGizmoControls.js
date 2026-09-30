/* global THREE, AFRAME */
/**
 * EasyGizmoControls — the easy-mode move/rotate handle.
 *
 * A yellow square lying just beneath the object, a cyan rotate arc around it,
 * and outline landing targets on the nearest qualifying surface above and
 * below. Dragging the square moves the object along the ground it is standing
 * on, following steps and slopes that are continuous with its current support
 * and holding its height over anything that is not; clicking a landing target
 * drops it onto that surface.
 *
 * Two presentations, chosen per subsystem from the elevation angle to that
 * subsystem's own anchor: seen from above the square and the arc read
 * correctly, and near eye level they degenerate, so the square becomes a
 * camera-facing strip and the arc retracts to a pair of short arms.
 *
 * THE POINTER LAYER IS THIS CLASS'S OWN, and that is the one structural thing
 * worth knowing before reading it. The base class supplies the Object3D, the
 * raycaster, the pointer maths and the event objects viewport.js already knows
 * how to wire; its listeners are replaced wholesale, because they bind the
 * canvas at bubble phase and claim a press with stopPropagation() — and the
 * A-Frame cursor listens on that same element, where stopPropagation does
 * nothing to a listener already registered. Only an ancestor capture listener
 * runs first, so window capture is forced rather than chosen. See _addListeners.
 */

import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { GizmoPointerControls } from './GizmoPointerControls.js';
import { metresPerPixel } from '../shapeEditRules.js';
import Events from '../Events.js';
import { calculateHeight } from '../../../tested/street-segment-utils.js';
import { EasyGizmoProbe } from './easyGizmoProbe.js';
import {
  evaluatePath,
  isStreetEntity,
  resplitColumn
} from './easyGizmoGround.js';
import {
  computeDodge,
  dodgeExtents,
  decideEasyPress,
  deriveLocalBoxOf,
  easeInOutCubic,
  flatArcLift,
  elevationAngleDegrees,
  latchByHysteresis,
  lerp,
  offsetConvexPolygon,
  chevronLayout,
  lastVisiblePointOnSegment,
  squareSideMetres
} from './easyGizmoMath.js';
import {
  DisposalRegistry,
  makeArcGeometries,
  makeArcHeadGeometries,
  makeArrowheadGeometry,
  makeEdgeMaterial,
  makeMaterial
} from './easyGizmoBuild.js';
import { shouldCaptureKeyEvent } from '../keyCapture.js';
import { PressClassifier } from './pressClassifier.js';
import {
  ARC_FLAT_RADIUS_FRAC,
  ARC_FLAT_SWEEP_DEG,
  ARC_FULL_SWEEP_DEG,
  ARC_HALF_SWEEP_DEG,
  ARC_HEAD_LEN,
  ARC_HEAD_OFFSET_DEG,
  ARC_LIFT_SYMMETRIC,
  ARC_HEAD_RADIUS,
  ARC_ROUND_RADIUS_FRAC,
  ARC_STEP_DEG,
  ARC_TUBE_RADIUS,
  ARC_TUBULAR_SEGMENTS,
  CHEVRON_BASE_FRAC,
  CHEVRON_CYCLE_MS,
  CHEVRON_LEN_FRAC,
  CHEVRON_MAX,
  CHEVRON_SPACING_FRAC,
  COLOR_MOVE,
  COLOR_ROTATE,
  EDGE_FACING_FULL,
  EDGE_FACING_HIDE,
  EDGE_MAX_STRETCH,
  EDGE_OPACITY_RATIO,
  EDGE_PX,
  HEAD_BASE_FLAT_FRAC,
  HEAD_BASE_FRAC,
  HEAD_LEN_FLAT_FRAC,
  HEAD_LEN_FRAC,
  HORIZON_CAP_METRES,
  IDLE_PROBE_INTERVAL_MS,
  LANDING_BAR_HEIGHT_FRAC,
  LANDING_HIDE_GAP_METRES,
  LANDING_OUTLINE_FRAC,
  LANDING_SHOW_GAP_METRES,
  VERTICAL_HIDE_ABOVE_DEG,
  VERTICAL_CENTRE_ABOVE_PAD_FRAC,
  VERTICAL_SHAFT_LENGTH_FRAC,
  VERTICAL_SHAFT_WIDTH_FRAC,
  VERTICAL_HEAD_LENGTH_FRAC,
  VERTICAL_HEAD_BASE_FRAC,
  VERTICAL_PICK_WIDTH_FRAC,
  VERTICAL_PICK_LENGTH_FRAC,
  MOVE_PLATE_ROUND_FRAC,
  OPACITY_ACTION,
  OPACITY_DIM,
  OPACITY_FLAT_BOOST,
  OPACITY_HOVER,
  OPACITY_REST,
  PARALLEL_EPSILON,
  PATH_PROBE_BUDGET,
  POSITION_DECIMALS,
  REGIME_ENTER_BELOW_DEG,
  REGIME_LEAVE_ABOVE_DEG,
  REGIME_SEED_DEG,
  REGIME_TRANSITION_MS,
  RENDER_ORDER_BASE,
  RENDER_ORDER_CHEVRON,
  RENDER_ORDER_EDGE,
  RENDER_ORDER_LANDING_FAR,
  RENDER_ORDER_LANDING_NEAR,
  ROTATE_LEVER_FLOOR_FRAC,
  ROTATE_LEVER_PROBE_RAD,
  STRIP_LEN_FRAC,
  STRIP_NARROW_FRAC,
  YAW_DECIMALS
} from './easyGizmoConstants.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const FRAME_SYSTEM = 'easy-gizmo-frame';

function frameSystemFor(sceneEl) {
  if (
    !sceneEl ||
    typeof AFRAME === 'undefined' ||
    typeof AFRAME.registerSystem !== 'function'
  ) {
    return null;
  }
  if (!AFRAME.systems?.[FRAME_SYSTEM]) {
    AFRAME.registerSystem(FRAME_SYSTEM, {
      init() {
        this.controls = null;
      },
      tick() {
        this.controls?._advanceBeforeRender();
      }
    });
  }
  if (!sceneEl.systems?.[FRAME_SYSTEM] && sceneEl.initSystem) {
    sceneEl.initSystem(FRAME_SYSTEM);
  }
  return sceneEl.systems?.[FRAME_SYSTEM] || null;
}

/**
 * The move plate's round-presentation pose in its group's frame. R_x(-90) lays
 * the quad flat; the R_z(-90) factor then puts its local X — the axis the scale
 * stretches along in the flattened presentation — on the group's +Z, which is
 * where the arrowhead pair that survives the change sits. Invisible at both
 * ends because the plate is square there, and load-bearing in between.
 */
const PLATE_ROUND_LOCAL = new THREE.Quaternion()
  .setFromAxisAngle(X_AXIS, -Math.PI / 2)
  .multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -Math.PI / 2));

// Allocate-once scratch. Every per-frame path here reuses these rather than
// constructing vectors inside a frame, which is this codebase's own convention.
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _box = new THREE.Box3();
const _camPos = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _bn = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _rotCentre = new THREE.Vector3();
const _rotGrab = new THREE.Vector3();
const _rotQuarter = new THREE.Vector3();
const _rotProbe = new THREE.Vector3();
const _rotProject = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _hd = new THREE.Vector3();
const _hn = new THREE.Vector3();
const _hx = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qZ = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _edgePoint = new THREE.Vector3();
const _edgeProjection = new THREE.Vector3();
const _edgeMid = new THREE.Vector3();
const _edgeSegmentStart = new THREE.Vector3();
const _edgeSegmentEnd = new THREE.Vector3();
const _edgeAlong = new THREE.Vector3();
const _edgeNormal = new THREE.Vector3();
const _edgeU = new THREE.Vector3();
const _edgeV = new THREE.Vector3();
const _edgePlane = new THREE.Vector3();
const _edgeCentroid = new THREE.Vector3();
const _edgeToParent = new THREE.Matrix4();
const _edgeWorld = [0, 1, 2, 3].map(() => new THREE.Vector3());
const _edgeFlat = new Float64Array(8);
const _edgeOffsets = new Float64Array(4);
const _edgeOut = new Float64Array(8);
const _pivot = new THREE.Vector3();
const _qNow = new THREE.Quaternion();

// Outlines in their meshes' own frames: the unit quad every plate and bar is
// drawn from, and the unit arrowhead.
const QUAD_OUTLINE = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5]
];
const TRIANGLE_OUTLINE = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0, 0.5]
];
const OMIT_QUAD_HORIZONTAL = [0, 2];
const OMIT_QUAD_VERTICAL = [1, 3];

/**
 * Orient a flat arrowhead: apex along `dir`, lying in the plane whose normal is
 * `normal`. Both are in the head's parent frame; `normal` is orthogonalised
 * against `dir`, so an approximate one is fine.
 */
function aimArrowhead(head, dir, normal) {
  _hn.copy(normal).addScaledVector(dir, -normal.dot(dir));
  if (_hn.lengthSq() < 1e-8) return;
  _hn.normalize();
  _hx.crossVectors(dir, _hn);
  _basis.makeBasis(_hx, dir, _hn);
  head.quaternion.setFromRotationMatrix(_basis);
}

/** Shared no-op raycast for surfaces that depict rather than accept. */
function neverPicked() {}

function quantise(value, decimals) {
  return Number(value.toFixed(decimals));
}

class EasyGizmoControls extends GizmoPointerControls {
  constructor(camera, domElement, sceneEl) {
    // The base class's third argument is Object3D.name, so it must be a string
    // — passing the scene element through would make an Object3D's name a DOM
    // node.
    super(camera, domElement, 'gizmoPrototypeEasyControls');

    this.sceneEl = sceneEl;
    this.el = undefined;
    this.registry = new DisposalRegistry();
    this.probe = new EasyGizmoProbe(sceneEl);
    this.registry.add(this.probe);

    // Cached local bounds; pose-derived values are refreshed each frame.
    this.localBox = null;
    this.squareSide = 1;
    this.baseY = 0;
    this.baseOffset = 0;
    this._mpp = 0;
    this._anchor = new THREE.Vector3();

    // Ground state.
    this.supportY = null;
    this.landingDownY = null;
    this.landingUpY = null;
    this._landingDownShown = false;
    this._landingUpShown = false;

    // The move+arc subsystem's regime, and its transition.
    this.flat = false;
    this._regimeLatch = null;
    this._shallowAmount = 0;
    this._anim = { from: 0, to: 0, startMs: 0, endMs: 0 };
    this.animDurationMs = REGIME_TRANSITION_MS;
    this.animEasing = easeInOutCubic;

    // The camera-derived frame the flattened presentation aims at. Held on the
    // instance rather than recomputed inline precisely so it can be latched for
    // the duration of a gesture.
    this._shallowYaw = 0;
    this._roundYawOffset = 0;
    this._shallowQuat = new THREE.Quaternion();
    this._shallowArcYaw = 0;
    this._arcFollowFrom = null;

    // The flattened layout's dodge, and the ease back to its live value after
    // a gesture releases the value it latched.
    this._dodge = { flipArc: false, shift: 0 };
    this._dodgeLatches = null;
    this._dodgeHeld = null;
    this._dodgeRelease = null;

    // Drag state.
    this.dragPlane = new THREE.Plane();
    this.grabOffset = new THREE.Vector3();
    this.dragStartXZ = new THREE.Vector3();
    this.dragSupportY = 0;
    this.dragClearance = 0;
    this.dragSnapshot = null;
    this.dragConstrained = false;
    this.dragEl = null;
    this.dragObject = null;
    this.rotateStartYawDeg = 0;
    this.rotatePrevAngle = 0;
    this.rotateAccum = 0;
    this.shallowDir = new THREE.Vector3(1, 0, 0);
    this._pickPoint = new THREE.Vector3();
    this._pickHit = false;
    this._dragStartMouseX = 0;
    this._dragMpp = 0;
    this._dragVerticalAlongStart = 0;
    this._dragVerticalPoint = new THREE.Vector3();
    this._dragStartWorld = new THREE.Vector3();
    this._dragRotPxPerRad = 0;
    this._dragRotPxPerRadCap = 0;
    this._pendingXZ = null;
    this._lastProcessedXZ = { x: 0, z: 0 };
    this._frameToken = null;
    this._landingPress = null;
    this._releasePending = null;

    // Pointer-layer state.
    this._armed = false;
    this._pressWasClaimed = false;
    this._pointerId = null;
    // Native capture dropped by the browser mid-gesture (see _onLostCapture).
    this._captureLost = false;
    // A press suspended the selection's flattening and the tiles have not
    // regenerated yet: the drag's reference support is re-seeded once they
    // have (see _advance).
    this._dragReferencePending = false;
    // The canvas rectangle, read at most once per scene frame (_canvasRect).
    this._rect = null;
    this._rectToken = undefined;
    this._lastPointerType = 'mouse';
    this._wasOpen = false;
    this._frameSystem = null;

    // How the attached entity is handled where it differs from an item's; see
    // attach(). Null for the default behaviour.
    this._policy = null;
    // A press held back until it is known to be a drag (policy.deferPress).
    this._deferred = null;
    // A held press released as a mouse click, waiting for the click event
    // that carries its count (see _reportClick), and its fallback timer.
    this._pendingClick = null;
    this._pendingClickTimer = null;
    // A policy's pivot, captured at the start of a gesture and held until it
    // ends: in the entity's own frame, its parent's frame and the world.
    this._pivotLocal = new THREE.Vector3();
    this._pivotParent = new THREE.Vector3();
    this._pivotWorld = new THREE.Vector3();
    this._pivotHeld = false;
    this._posStart = new THREE.Vector3();
    this._quatStart = new THREE.Quaternion();

    this._bindHandlers();
    this._build();
    /**
     * Runtime switch for path evaluation, so the same gesture can be driven
     * with it and without it.
     *
     * Every frame that fails to follow the ground produces the same
     * observation — the object held its height — whether the sampler found a
     * discontinuity or there was nothing to find. Turning the sampler off
     * leaves only the endpoint probe, which is a build with no path evaluation
     * at all, so a drive that passes with it on and fails with it off has shown
     * the mechanism did the work. Set it from the console.
     */
    this.pathEvaluationEnabled = true;

    this._onEntityUpdate = (detail) => {
      if (!this.el || this.isDragging || !this._inspectorOpen()) return;
      // Only an update in this selection's own lineage can move its base or
      // change its box. Support changing beneath it from elsewhere (a street
      // edited under it, tiles streaming in) is the idle probe's job; probing
      // here for every entity would raycast the scene once per entity of a
      // batch command and once per pointer move of an unrelated scrub.
      const entity = detail?.entity;
      if (!entity || !this._inLineage(entity)) return;
      if (entity === this.el || this.el.contains(entity)) this.deriveLocalBox();
      this._refreshSupport();
    };
    // Bound once rather than per frame: the path evaluator takes the probe as
    // an argument, which is what keeps its own module free of raycasting.
    this._probeAt = (x, z, referenceY) =>
      this.probe.probeColumn(x, z, referenceY);
    this._onGeometryChanged = () => {
      if (!this.el) return;
      // The old press clearance no longer describes the edited geometry
      // (unless the attach policy opts out).
      if (
        this.isDragging &&
        this._policy?.endsGestureOnDescendantGeometry !== false
      ) {
        this.endGesture('geometrychanged');
      }
      this.deriveLocalBox();
      this._refreshSupport();
    };
  }

  /**
   * The base class calls activate() as the LAST statement of its constructor,
   * so an override here runs before any field of this class exists — which is
   * why this is a no-op rather than a place to install anything. It must not
   * call super either: the base's canvas-bubble listeners are exactly the half
   * being replaced.
   */
  activate() {}

  // --- construction -----------------------------------------------------

  _bindHandlers() {
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onSuppressClaimed = this._onSuppressClaimed.bind(this);
    this._onSuppressLatched = this._onSuppressLatched.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onCanvasLeave = this._onCanvasLeave.bind(this);
    this._onModelLoaded = this._onModelLoaded.bind(this);
  }

  _material(color, opacity, solid) {
    return this.registry.add(makeMaterial(color, opacity, solid));
  }

  _mesh(geometry, material, renderOrder) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  _build() {
    const reg = this.registry;

    // Shared, level-carrying materials. One per (subsystem, colour, side): the
    // meshes of a subsystem are all at the same emphasis level at once, so
    // writing the level onto the material they point at keeps the count bounded
    // as the chevron stack grows. The two surfaces that carry a genuinely
    // per-mesh ALPHA rather than a level — the arrowheads that fade out across
    // the flattened transition, and each chevron, which fades independently as
    // the stack recycles — own materials of their own further down.
    this.materials = {
      move: {
        flat: this._material(COLOR_MOVE, OPACITY_REST, false),
        solid: this._material(COLOR_MOVE, OPACITY_REST, true)
      },
      rotate: {
        flat: this._material(COLOR_ROTATE, OPACITY_REST, false),
        solid: this._material(COLOR_ROTATE, OPACITY_REST, true)
      },
      vertical: { flat: this._material(COLOR_MOVE, OPACITY_REST, false) },
      landingDown: { flat: this._material(COLOR_MOVE, OPACITY_REST, false) },
      landingUp: { flat: this._material(COLOR_MOVE, OPACITY_REST, false) },
      // Invisible and shared by every pick proxy: a drawn one would paint a
      // solid square over a landing outline or a fat tube over the arc.
      pick: this._material(COLOR_MOVE, 0, false),
      // The pair of arrowheads that fade with the transition.
      moveHeadFading: this._material(COLOR_MOVE, OPACITY_REST, false)
    };
    this.arrowheadGeometry = reg.add(makeArrowheadGeometry());
    this.quadGeometry = reg.add(new THREE.PlaneGeometry(1, 1));

    this._buildMoveHandle();
    this._buildVerticalHandle();
    this._buildArc();
    this.landingDownGroup = this._buildLandingTarget('landingDown');
    this.landingUpGroup = this._buildLandingTarget('landingUp');
    this.add(this.landingDownGroup);
    this.add(this.landingUpGroup);
    this._buildEdges();

    this.visible = false;
  }

  /**
   * A thin dark edge just outside every yellow part, so each stays legible on
   * pale ground. The cyan arc has none.
   *
   * Each edge is a screen-space line with its geometry allocated once, at the
   * most segments it will ever need, and rewritten in place each frame. Its
   * bounds are never recomputed after that, so it is never frustum-culled.
   */
  _buildEdges() {
    const reg = this.registry;
    this.edgeMaterials = {
      move: reg.add(makeEdgeMaterial()),
      moveFading: reg.add(makeEdgeMaterial()),
      landingDown: reg.add(makeEdgeMaterial()),
      landingUp: reg.add(makeEdgeMaterial()),
      vertical: reg.add(makeEdgeMaterial())
    };
    this.plateEdge = this._edge(this.moveGroup, this.edgeMaterials.move, 4);
    // The ±Z pair survives the flattened presentation; the ±X pair fades.
    this.zHeadsEdge = this._edge(this.moveGroup, this.edgeMaterials.move, 8);
    this.xHeadsEdge = this._edge(
      this.moveGroup,
      this.edgeMaterials.moveFading,
      8
    );
    this.verticalShaftEdge = this._edge(
      this.verticalGroup,
      this.edgeMaterials.vertical,
      4
    );
    this.verticalHeadsEdge = this._edge(
      this.verticalGroup,
      this.edgeMaterials.vertical,
      8
    );
    [this.landingDownGroup, this.landingUpGroup].forEach((group) => {
      const ud = group.userData;
      // An outer and inner rectangle, collapsing to one shallow stroke.
      ud.edge = this._edge(group, this.edgeMaterials[ud.gizmoAxis], 8);
      ud.chevrons.forEach((chev) => {
        chev.userData.edge = this._edge(chev, reg.add(makeEdgeMaterial()), 3);
        chev.userData.edgeFacing = 1;
      });
    });
  }

  _edge(parent, material, maxSegments) {
    const geometry = this.registry.add(new LineSegmentsGeometry());
    geometry.setPositions(new Float32Array(maxSegments * 6));
    const edge = new LineSegments2(geometry, material);
    edge.frustumCulled = false;
    edge.raycast = neverPicked;
    edge.renderOrder = RENDER_ORDER_EDGE;
    edge.userData.isEdge = true;
    parent.add(edge);
    return edge;
  }

  _buildMoveHandle() {
    // ONE hierarchy for both presentations, not two. The four arrowheads are
    // repositioned, reoriented and faded across the change rather than swapped
    // out, which is what makes it read as a reshape; two hierarchies could not
    // express that, and would give the drag two pickable objects to reconcile.
    this.moveGroup = new THREE.Group();
    this.moveGroup.name = 'easyGizmoMove';
    this.moveGroup.userData.gizmoAxis = 'move';

    this.movePlate = this._mesh(
      this.quadGeometry,
      this.materials.move.flat,
      RENDER_ORDER_BASE
    );
    this.moveGroup.add(this.movePlate);

    // Index 0/1 are the ±X pair, which fades out where movement is restricted
    // to left and right; 2/3 are the ±Z pair, which survives. Directions are
    // fixed here; position, size, orientation and opacity are per frame,
    // because a flat head has to lie in a PLANE and the plate's swings from
    // horizontal to vertical.
    this.moveHeads = [];
    [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1]
    ].forEach((d, i) => {
      const fading = i < 2;
      const head = this._mesh(
        this.arrowheadGeometry,
        fading ? this.materials.moveHeadFading : this.materials.move.flat,
        RENDER_ORDER_BASE + 1
      );
      head.userData.dir = new THREE.Vector3(d[0], d[1], d[2]);
      head.userData.fades = fading;
      // A head that is not drawn must not stay pickable: the raycaster tests
      // layers and geometry, not `visible` and not opacity, so a faded head
      // would otherwise leave an invisible pick region out to either side of
      // the strip.
      head.raycast = function (raycaster, intersects) {
        if (this.visible === false) return;
        THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
      };
      this.moveGroup.add(head);
      this.moveHeads.push(head);
    });
    this.add(this.moveGroup);
  }

  _buildVerticalHandle() {
    this.verticalGroup = new THREE.Group();
    this.verticalGroup.name = 'easyGizmoVertical';
    this.verticalGroup.userData.gizmoAxis = 'vertical';

    this.verticalShaft = this._mesh(
      this.quadGeometry,
      this.materials.vertical.flat,
      RENDER_ORDER_BASE + 1
    );
    this.verticalGroup.add(this.verticalShaft);

    this.verticalHeads = [-1, 1].map((sign) => {
      const head = this._mesh(
        this.arrowheadGeometry,
        this.materials.vertical.flat,
        RENDER_ORDER_BASE + 2
      );
      head.userData.sign = sign;
      this.verticalGroup.add(head);
      return head;
    });

    this.verticalPick = this._mesh(
      this.quadGeometry,
      this.materials.pick,
      RENDER_ORDER_BASE + 2
    );
    this.verticalPick.visible = false;
    this.verticalPick.userData.isPickProxy = true;
    this.verticalGroup.add(this.verticalPick);
    this.add(this.verticalGroup);
  }

  _buildArc() {
    this.arcGroup = new THREE.Group();
    this.arcGroup.name = 'easyGizmoRotate';
    this.arcGroup.userData.gizmoAxis = 'rotate';

    // The inner group's yaw puts the middle of the gap on the object's local
    // front. Written as an expression because the same one puts the two halves'
    // meeting point on the group's local +Z for any sweep, which is what the
    // flattened yaw then aims along the view axis.
    this.arcInner = new THREE.Group();
    this.arcInner.rotation.y = -(ARC_HALF_SWEEP_DEG + 90) * DEG;

    const arc = makeArcGeometries();
    this.registry.add(arc.drawn);
    this.registry.add(arc.pick);
    this.arcGeometry = arc.drawn;
    this.arcPickGeometry = arc.pick;
    this._arcIndicesPerStep = arc.indicesPerStep;

    // Two halves rather than one sweep: each retracts toward its own arrowhead,
    // and setDrawRange takes one contiguous range, so a single sweep could not
    // produce two. The geometry is shared, so both retract from one call.
    this.arcHalfA = this._mesh(
      arc.drawn,
      this.materials.rotate.solid,
      RENDER_ORDER_BASE + 2
    );
    this.arcHalfA.rotation.x = -Math.PI / 2;
    // Half B covers the far half, which needs the sweep parameter REVERSED —
    // not expressible as a yaw alone. R_x(180°) composed with the flat rotation
    // reverses it; the yaw then carries it to the far end. Both are proper
    // rotations, so no normal is inverted.
    _qA.setFromAxisAngle(X_AXIS, Math.PI / 2);
    _qB.setFromAxisAngle(UP, ARC_FULL_SWEEP_DEG * DEG);
    this.arcHalfB = this._mesh(
      arc.drawn,
      this.materials.rotate.solid,
      RENDER_ORDER_BASE + 2
    );
    this.arcHalfB.quaternion.multiplyQuaternions(_qB, _qA);

    // Each half and its own arrowhead live in an arm group: retracting swings
    // the arms, and rotating the halves alone would slide them out from under
    // their heads. An arm yaw is exactly a shift of the sweep parameter.
    this.arcArmA = new THREE.Group();
    this.arcArmB = new THREE.Group();
    this.arcArmA.add(this.arcHalfA);
    this.arcArmB.add(this.arcHalfB);
    [this.arcHalfA, this.arcHalfB].forEach((half, i) => {
      const proxy = this._mesh(
        arc.pick,
        this.materials.pick,
        RENDER_ORDER_BASE + 2
      );
      // The quaternion only: assigning rotation.x afterwards would rewrite the
      // Euler and throw away half B's pose, which is not an X rotation alone.
      proxy.quaternion.copy(half.quaternion);
      proxy.visible = false;
      proxy.userData.isPickProxy = true;
      (i === 0 ? this.arcArmA : this.arcArmB).add(proxy);
    });
    this.arcInner.add(this.arcArmA);
    this.arcInner.add(this.arcArmB);

    const headGeom = makeArcHeadGeometries();
    this.registry.add(headGeom.cone);
    this.registry.add(headGeom.cap);
    [0, ARC_FULL_SWEEP_DEG].forEach((deg) => {
      const first = deg === 0;
      const sign = first ? -1 : 1;
      const a = (deg + sign * ARC_HEAD_OFFSET_DEG) * DEG;
      const head = new THREE.Group();
      head.add(
        this._mesh(
          headGeom.cone,
          this.materials.rotate.solid,
          RENDER_ORDER_BASE + 3
        )
      );
      const cap = this._mesh(
        headGeom.cap,
        this.materials.rotate.flat,
        RENDER_ORDER_BASE + 3
      );
      cap.rotation.x = -Math.PI / 2;
      cap.position.y = -0.5;
      head.add(cap);
      head.scale.set(ARC_HEAD_RADIUS, ARC_HEAD_LEN, ARC_HEAD_RADIUS);
      head.position.set(Math.cos(a), 0, -Math.sin(a));
      // The tangent, flipped on the start cap so both heads point outward.
      _v.set(-Math.sin(a) * sign, 0, -Math.cos(a) * sign).normalize();
      head.quaternion.setFromUnitVectors(UP, _v);
      (first ? this.arcArmA : this.arcArmB).add(head);
    });

    this.arcGroup.add(this.arcInner);
    this.add(this.arcGroup);
  }

  /**
   * One landing target: an outline square with an invisible quad inside it so
   * the whole square is clickable, and a stack of chevrons running back to the
   * object.
   *
   * Outline against the move handle's solid square is the whole affordance —
   * solid means drag, outline means click to place.
   */
  _buildLandingTarget(axis) {
    const group = new THREE.Group();
    group.name = `easyGizmo_${axis}`;
    group.userData.gizmoAxis = axis;
    const material = this.materials[axis].flat;

    const outline = new THREE.Group();
    // Four bars laid out per frame rather than a scaled square: the outline has
    // to squash from a square to a wide bar as it flattens, and scaling the
    // group would thin the horizontal strokes to hairlines while leaving the
    // vertical ones full width.
    const bars = [];
    for (let i = 0; i < 4; i++) {
      const strip = this._mesh(
        this.quadGeometry,
        material,
        RENDER_ORDER_LANDING_NEAR
      );
      strip.rotation.x = -Math.PI / 2;
      outline.add(strip);
      bars.push(strip);
    }
    const pick = this._mesh(
      this.quadGeometry,
      this.materials.pick,
      RENDER_ORDER_LANDING_NEAR
    );
    pick.rotation.x = -Math.PI / 2;
    pick.visible = false;
    pick.userData.isPickProxy = true;
    outline.add(pick);
    group.add(outline);

    // Flat triangles standing upright and yawed to the viewer. A triangle
    // turned to face the camera fully tips toward face-on as you rise above it,
    // and a triangle seen face-on stops saying "down" — it is just a triangle.
    // Yaw alone keeps each one upright, so the apex still points at the floor
    // from every angle while the silhouette stays a clean arrow from every
    // azimuth. Each carries its own material because the stack fades its ends
    // independently as it recycles.
    const chevrons = [];
    for (let i = 0; i < CHEVRON_MAX; i++) {
      const chev = this._mesh(
        this.arrowheadGeometry,
        this._material(COLOR_MOVE, OPACITY_REST, false),
        RENDER_ORDER_CHEVRON
      );
      // It depicts the action; it does not accept it. The stack runs straight
      // through the move square on its way to the object, and hiding a mesh
      // does not unhit it — the raycaster tests layers and nothing else.
      chev.raycast = neverPicked;
      chev.visible = false;
      group.add(chev);
      chevrons.push(chev);
    }

    group.userData.outline = outline;
    group.userData.bars = bars;
    group.userData.pick = pick;
    group.userData.chevrons = chevrons;
    group.userData.material = material;
    // Per-target regime state: a landing point well below the object is seen at
    // a steeper angle than the object is, so the two decide independently.
    group.userData.regimeLatch = null;
    group.userData.faceAmount = 0;
    group.userData.anim = { from: 0, to: 0, startMs: 0, endMs: 0 };
    group.userData.wasVisible = false;
    group.visible = false;
    return group;
  }

  // --- attach / detach --------------------------------------------------

  /** Whether the selection supports easy move/rotate; managed lanes use width bars. */
  accepts(el) {
    if (!el || !el.object3D) return false;
    if (el.hasAttribute('data-no-transform')) return false;
    if (el.classList && el.classList.contains('street-parent')) return false;
    // street-align owns managed-segment positions; the viewport gives these
    // entities width bars only.
    if (
      el.components &&
      el.components['street-segment'] &&
      el.parentElement?.components?.['managed-street']
    ) {
      return false;
    }
    return true;
  }

  /**
   * Attach to `el`. `policy`, when given, replaces the item rules where they
   * do not fit the entity:
   * - `pivotLocal(el, out)`: the point, in el's own frame, the handles stand
   *   at and a rotation turns about (an item's is its origin);
   * - `localBox(el)`: el's box in its own frame, or null; read at every layout
   *   instead of measuring el's meshes;
   * - `positionForRotation(posStart, qStart, qNow, pivotParent, out)`: where
   *   the origin goes when a turn holds the pivot still, in the parent frame;
   * - `groundBehaviour: false`: a move keeps its height, with no ground
   *   following, support probing or landing targets;
   * - `endsGestureOnDescendantGeometry: false`: geometry edits inside el do
   *   not cancel a gesture;
   * - `deferPress: true`: a press on a control is held until it moves far
   *   enough to be a drag; released before that, it is a click, reported as
   *   'handleClick' and nothing else ('handlePress' and 'handlePressEnd'
   *   bracket the held press).
   */
  attach(el, policy = null) {
    if (!el || !el.object3D) return this;
    if (!this.accepts(el)) return this;
    this.el = el;
    this._policy = policy;
    // Both are required: nothing here resolves hover or accepts a press with
    // either unset.
    this.object = el.object3D;
    this.visible = true;
    this.probe.excludeEl = el;
    this._landingDownShown = false;
    this._landingUpShown = false;
    this._dodgeLatches = null;
    this._dodgeHeld = null;
    this._dodgeRelease = null;
    this.deriveLocalBox();
    this._updateBase();
    this._seedRegime();
    this._refreshSupport();
    // A glTF that has not loaded has no box, so the base would fall back to the
    // object's origin. Re-derive when the model arrives, plus the short settle
    // the selection box already waits for.
    el.addEventListener('model-loaded', this._onModelLoaded);
    el.addEventListener('shape-geometry-changed', this._onGeometryChanged);
    el.addEventListener('segments-changed', this._onGeometryChanged);
    el.addEventListener('alignment-changed', this._onGeometryChanged);
    Events.on('entityupdate', this._onEntityUpdate);
    this._idleTimer = setInterval(() => {
      if (this.el && !this.isDragging && this._inspectorOpen()) {
        this._refreshSupport();
      }
    }, IDLE_PROBE_INTERVAL_MS);
    this._addListeners();
    this._frameSystem = frameSystemFor(this.sceneEl);
    if (this._frameSystem) this._frameSystem.controls = this;
    return this;
  }

  /**
   * Idempotent, because the router detaches everything on EVERY selection —
   * including selections this gizmo never attached to.
   */
  detach() {
    if (!this.el) return this;
    this._clearDeferredPress();
    this._dropPendingClick();
    // Restore a live gesture while its entity is still attached.
    if (this.isDragging) this.endGesture('detach');
    this.el.removeEventListener('model-loaded', this._onModelLoaded);
    this.el.removeEventListener(
      'shape-geometry-changed',
      this._onGeometryChanged
    );
    this.el.removeEventListener('segments-changed', this._onGeometryChanged);
    this.el.removeEventListener('alignment-changed', this._onGeometryChanged);
    clearTimeout(this._modelSettleTimer);
    Events.off('entityupdate', this._onEntityUpdate);
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
    this._removeListeners();
    this.probe.setFlatteningSuspended(false);
    if (this._frameSystem?.controls === this) {
      this._frameSystem.controls = null;
    }
    this._frameSystem = null;
    this.el = undefined;
    this.object = undefined;
    this._policy = null;
    this.probe.excludeEl = null;
    this.visible = false;
    this.axis = null;
    this.highlight(null);
    this.dispatchEvent({ type: 'axisHoverChange', axis: null });
    if (this.domElement) this.domElement.style.cursor = null;
    this.localBox = null;
    this.supportY = null;
    this.landingDownY = null;
    this.landingUpY = null;
    this._landingDownShown = false;
    this._landingUpShown = false;
    this.landingDownGroup.visible = false;
    this.landingUpGroup.visible = false;
    this._pendingXZ = null;
    return this;
  }

  /**
   * Reachable from a viewport teardown, and correct to write even though
   * nothing calls one today — the three gizmos beside this one are constructed
   * once and never disposed either. It is NOT the answer to disarming the
   * window listeners: those come off in detach() and on the editor-closed edge.
   */
  dispose() {
    this.detach();
    super.dispose();
    this.registry.dispose();
  }

  _onModelLoaded(event) {
    if (!this.el || event.target !== this.el) return;
    this._onGeometryChanged();
    clearTimeout(this._modelSettleTimer);
    this._modelSettleTimer = setTimeout(this._onGeometryChanged, 20);
  }

  deriveLocalBox() {
    // A policy supplies the box at every layout; see _updateBase.
    if (this._policy) return;
    this.localBox = deriveLocalBoxOf(this.object);
  }

  /** Does this attachment follow the ground (the item rules)? */
  _followsGround() {
    return this._policy?.groundBehaviour !== false;
  }

  // --- the pointer layer ------------------------------------------------

  _canvas() {
    if (typeof AFRAME === 'undefined') return this.domElement || null;
    return AFRAME.INSPECTOR?.container ?? AFRAME.scenes?.[0]?.canvas ?? null;
  }

  _inspectorOpen() {
    if (typeof AFRAME === 'undefined') return true;
    return !!AFRAME.INSPECTOR?.opened;
  }

  /** The attached entity, one of its ancestors, or one of its descendants. */
  _inLineage(entity) {
    if (entity === this.el) return true;
    if (typeof entity.contains !== 'function') return false;
    return this.el.contains(entity) || entity.contains(this.el);
  }

  /**
   * The canvas rectangle, read at most once per scene frame. Every matrix
   * update (twice per frame while attached) and every pointer move mapped
   * through it, and each read is a forced layout flush; with React panels
   * re-rendering per entityupdate during a drag that was layout thrash on the
   * hot path. A resize lands on the next frame. Without a frame clock (unit
   * fixtures) it reads live.
   */
  _canvasRect() {
    if (!this.domElement) return null;
    const token = this.sceneEl ? this.sceneEl.time : undefined;
    if (token !== undefined && this._rect && this._rectToken === token) {
      return this._rect;
    }
    this._rect = this.domElement.getBoundingClientRect();
    this._rectToken = token;
    return this._rect;
  }

  /** Claim before canvas listeners; see docs/easy-gizmo.md#pointer-ownership. */
  _addListeners() {
    if (this._armed) return;
    this._armed = true;
    window.addEventListener('pointerdown', this._onPointerDown, true);
    window.addEventListener('pointermove', this._onPointerMove, true);
    window.addEventListener('pointerup', this._onPointerUp, true);
    window.addEventListener('pointercancel', this._onPointerCancel, true);
    window.addEventListener('lostpointercapture', this._onLostCapture, true);
    window.addEventListener('mousedown', this._onSuppressClaimed, true);
    // The options form is required: a window touch listener is passive by
    // default, where preventDefault() does nothing and logs on every touch.
    window.addEventListener('touchstart', this._onSuppressClaimed, {
      capture: true,
      passive: false
    });
    window.addEventListener('click', this._onSuppressLatched, true);
    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('keyup', this._onKeyUp, true);
    window.addEventListener('blur', this._onBlur);
    const canvas = this._canvas();
    if (canvas) canvas.addEventListener('mouseleave', this._onCanvasLeave);
  }

  _removeListeners() {
    if (!this._armed) return;
    this._armed = false;
    window.removeEventListener('pointerdown', this._onPointerDown, true);
    window.removeEventListener('pointermove', this._onPointerMove, true);
    window.removeEventListener('pointerup', this._onPointerUp, true);
    window.removeEventListener('pointercancel', this._onPointerCancel, true);
    window.removeEventListener('lostpointercapture', this._onLostCapture, true);
    window.removeEventListener('mousedown', this._onSuppressClaimed, true);
    // Removal keys on the capture flag alone, so `true` matches the options
    // form the add side uses.
    window.removeEventListener('touchstart', this._onSuppressClaimed, true);
    window.removeEventListener('keydown', this._onKeyDown, true);
    window.removeEventListener('keyup', this._onKeyUp, true);
    window.removeEventListener('blur', this._onBlur);
    const canvas = this._canvas();
    if (canvas) canvas.removeEventListener('mouseleave', this._onCanvasLeave);
    // Suppression is scoped to the attachment, like the press listeners.
    window.removeEventListener('click', this._onSuppressLatched, true);
  }

  _suppress(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * The mouse and touch families of a press this gizmo already claimed.
   *
   * The latch de-duplicates the WORK, never the SUPPRESSION: the hit test, the
   * snapshot and the mouseDown dispatch happen once, for the pointer family,
   * but preventDefault and stopPropagation run for every family. Returning
   * early here instead would drop the suppression of the one family the
   * A-Frame cursor actually listens to.
   */
  _onSuppressClaimed(event) {
    if (!this._pressWasClaimed) return;
    this._suppress(event);
  }

  /**
   * The synthetic click that trails the gesture that set the latch, and no
   * other: reaching the canvas it would hand the selection to whatever sits
   * under the handle.
   *
   * The latch is cleared by the NEXT pointerdown, so a click with no claimed
   * press behind it passes; the canvas gate covers a click with no press at
   * all — Enter or Space on a focused button.
   *
   * The double-click is deliberately NOT suppressed. Both presses of a double
   * click on a handle are claimed, so suppressing it here would swallow every
   * double-click on the gizmo — and zoomed out, the gizmo covers the object it
   * belongs to. The editor's double-click focuses the selected entity, which
   * is this gizmo's, so letting it through frames the object the user aimed
   * at (#2054).
   */
  _onSuppressLatched(event) {
    this._flushPendingClick(event.detail || 1);
    if (!this._pressWasClaimed) return;
    if (event.target !== this._canvas()) return;
    this._suppress(event);
  }

  _onPointerDown(event) {
    if (this.isDragging || this._releasePending || this._deferred) {
      this._suppress(event);
      return;
    }
    // Cleared on every press this listener sees, ahead of every return below,
    // so the trailing-click latch can never outlive the gesture it was set for.
    this._pressWasClaimed = false;
    if (!this.el || !this.object || !this.visible || !this.enabled) return;
    if (!this._inspectorOpen()) return;
    if (event.button !== 0 || event.isPrimary === false) return;

    const canvas = this._canvas();
    const targetIsCanvas = !!canvas && event.target === canvas;
    this._lastPointerType = event.pointerType || 'mouse';

    let axis = null;
    let otherAffordanceHit = false;
    if (targetIsCanvas && !this.isDragging) {
      // An existing editing affordance for the selected entity wins the press,
      // tested POSITIVELY rather than inferred from event state. Two capture
      // listeners on one node fire in registration order, so `defaultPrevented`
      // would be a yield only if the other party happened to have run first —
      // an ordering neither layer controls, since both re-arm per selection.
      otherAffordanceHit = this._otherAffordanceUnder(event);
      if (!otherAffordanceHit) {
        this.updateMouse(event);
        axis = this.pickAxis();
      }
    }

    const decision = decideEasyPress({
      targetIsCanvas,
      alreadyClaimed: this.isDragging,
      otherAffordanceHit,
      hit: !!axis,
      inert: axis ? this._isInert(axis) : false
    });

    if (decision === 'ignore') return;

    // An inert control still claims the press — it just does nothing with it.
    // Falling through would deselect the object, which is the failure the press
    // claim exists to prevent.
    this._suppress(event);
    this._pressWasClaimed = true;
    if (this._policy?.deferPress) {
      this._deferPress(event, axis);
      return;
    }
    if (decision === 'swallow') return;

    if (this.axis !== axis) {
      this.axis = axis;
      this.highlight(axis);
      this.dispatchEvent({ type: 'axisHoverChange', axis });
    }
    this._beginDrag(axis, event);
  }

  /** Start the drag of a claimed press; false when it cannot start. */
  _beginDrag(axis, event) {
    // Before the reference support is measured: placement must not sample
    // terrain the dragged item flattened itself. A merely selected street
    // keeps its flattening; this is released on every gesture exit, and here
    // when the press does not become a drag. Tiles regenerate asynchronously
    // and the probe withholds tile support until they have, so the reference
    // is re-seeded once they are (see _advance).
    this.probe.setFlatteningSuspended(true);
    this._dragReferencePending = this.probe.hasPendingRegeneration();
    if (this.startDrag(axis, event) === false) {
      this.probe.setFlatteningSuspended(false);
      this._dragReferencePending = false;
      return false;
    }
    // Ownership is independent of whether native capture is available.
    this._pointerId = event.pointerId ?? null;
    this._captureLost = false;
    const canvas = this._canvas();
    if (canvas && canvas.setPointerCapture && event.pointerId !== undefined) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners still track only the pointer that claimed the drag.
      }
    }
    this.isDragging = true;
    this.highlight(axis);
    this.dispatchEvent(this.mouseDownEvent);
    this.dispatchEvent(this.changeEvent);
    return true;
  }

  /**
   * Hold a claimed press until it is known to be a click or a drag (see
   * pressClassifier.js). The pressed control shows as active at once, for
   * every pointer type, so a touch user sees what a drag would move.
   */
  _deferPress(event, axis) {
    this._deferred = {
      axis,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      classifier: new PressClassifier(event.clientX, event.clientY)
    };
    this._pointerId = event.pointerId ?? null;
    if (this.axis !== axis) {
      this.axis = axis;
      this.dispatchEvent({ type: 'axisHoverChange', axis });
    }
    this.highlight(axis);
    this.dispatchEvent({
      type: 'handlePress',
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: this._lastPointerType
    });
  }

  /**
   * The held press moved far enough: it is a drag, starting from the press
   * point and then following the pointer to `event`.
   */
  _promoteDeferredPress(event) {
    const press = this._deferred;
    this._deferred = null;
    this._pointerId = null;
    this.dispatchEvent({ type: 'handlePressEnd' });
    // A control that was mid-transition at the press does nothing with it.
    if (!press.axis || this._isInert(press.axis)) {
      this.highlight(this.axis);
      return false;
    }
    this.updateMouse(press);
    if (!this._beginDrag(press.axis, press)) return false;
    this.updateMouse(event);
    this._trackDrag(event);
    return true;
  }

  /**
   * Report a held press released at `event` as a click: 'handleClick' with
   * the press point and the browser's click count as `detail`. A mouse's
   * count arrives only on the click event that trails the release: the
   * compatibility mousedown that would carry it is never sent, because the
   * press's pointerdown was cancelled, and pointer events carry none. So a
   * mouse click is reported from that click event (_onSuppressLatched), or
   * as a single click once the release's task is over if none follows. A
   * touch press has no count, and no click follows it: it is reported at
   * once.
   */
  _reportClick(press, event) {
    const click = {
      type: 'handleClick',
      clientX: press.clientX,
      clientY: press.clientY,
      detail: 1
    };
    if ((event.pointerType || 'mouse') === 'touch') {
      this.dispatchEvent(click);
      return;
    }
    this._flushPendingClick(1);
    this._pendingClick = click;
    this._pendingClickTimer = setTimeout(() => this._flushPendingClick(1), 0);
  }

  _flushPendingClick(detail) {
    const click = this._pendingClick;
    if (!click) return;
    this._dropPendingClick();
    click.detail = detail;
    this.dispatchEvent(click);
  }

  _dropPendingClick() {
    this._pendingClick = null;
    clearTimeout(this._pendingClickTimer);
    this._pendingClickTimer = null;
  }

  /** End a held press with nothing done. True when there was one. */
  _clearDeferredPress() {
    if (!this._deferred) return false;
    this._deferred = null;
    this._pointerId = null;
    if (this._lastPointerType !== 'mouse') {
      this.axis = null;
      this.dispatchEvent({ type: 'axisHoverChange', axis: null });
    }
    this.highlight(this.axis);
    this.dispatchEvent({ type: 'handlePressEnd' });
    return true;
  }

  /**
   * Whether another editing affordance for this entity is under the cursor.
   *
   * Existing shape and street affordances win when visible under the pointer.
   * Managed lanes normally route to width controls alone; querying visible
   * peers also covers selection transitions without changing their state.
   */
  _otherAffordanceUnder(event) {
    const inspector = typeof AFRAME === 'undefined' ? null : AFRAME.INSPECTOR;
    if (!inspector) return false;
    const svc = inspector.shapeVertexControls;
    if (svc && typeof svc._hitTest === 'function') {
      if (svc._hitTest(event.clientX, event.clientY)) return true;
    }
    const peers = [
      inspector.streetNodeControls,
      inspector.segmentWidthControls
    ];
    for (let i = 0; i < peers.length; i++) {
      const peer = peers[i];
      if (!peer || !peer.visible || !peer.object || !peer.enabled) continue;
      this.updateMouse(event);
      const pickers = peer.getPickers();
      if (
        pickers.length &&
        this.raycaster.intersectObjects(pickers, true).length
      ) {
        return true;
      }
    }
    return false;
  }

  _onPointerMove(event) {
    if (!this.el || !this.object || !this.enabled) return;
    if (this._releasePending) return;
    if (this._deferred) {
      if (!this._ownsPointer(event)) return;
      this._suppress(event);
      if (this._deferred.classifier.track(event)) {
        this._promoteDeferredPress(event);
      }
      return;
    }
    if (this.isDragging) {
      if (!this._ownsPointer(event)) return;
      this._suppress(event);
      this._reacquireCapture(event);
      this.updateMouse(event);
      this._trackDrag(event);
      return;
    }
    // Hover is resolved from pointermove and from nothing else. That is what
    // stops a tap's compatibility mouse events latching a control after the
    // finger lifts, and it is a rule about which listener exists rather than
    // about ordering — the compatibility events are dispatched AFTER touchend,
    // so any clear on release would run before the thing it was clearing.
    if (!this.visible) return;
    const canvas = this._canvas();
    const onCanvas = !!canvas && event.target === canvas;
    // Touch has no hover, and a control drawn beneath a panel must not light up
    // and then refuse the click.
    const hoverable = onCanvas && (event.pointerType || 'mouse') === 'mouse';
    this._lastPointerType = event.pointerType || 'mouse';
    let axis = null;
    if (hoverable) {
      this.updateMouse(event);
      axis = this.pickAxis();
      if (axis && this._isInert(axis)) axis = null;
    }
    if (this.axis !== axis) {
      this.axis = axis;
      this.highlight(axis);
      if (this.domElement) {
        this.domElement.style.cursor = axis ? 'pointer' : null;
      }
      this.dispatchEvent({ type: 'axisHoverChange', axis });
      this.dispatchEvent(this.changeEvent);
    }
  }

  _onPointerUp(event) {
    if (this._deferred && this._ownsPointer(event)) {
      const press = this._deferred;
      if (!press.classifier.track(event)) {
        // Still within the click distance: a click, and nothing else happens.
        this._suppress(event);
        this._clearDeferredPress();
        this._reportClick(press, event);
        return;
      }
      // Released after moving away with no pointermove between: a drag that
      // ends here.
      if (!this._promoteDeferredPress(event)) {
        this._suppress(event);
        return;
      }
    }
    if (!this.isDragging || !this._ownsPointer(event)) return;
    this._suppress(event);
    if (this._releasePending) return;
    this.updateMouse(event);
    this._trackDrag(event);
    if (this.axis === 'move') {
      // Finish on the next frame token, so release never spends a second
      // path-probe budget in the frame that already processed a pointermove.
      this._releasePending = { reason: 'pointerup', event };
    } else {
      this.endGesture('pointerup', event);
    }
  }

  _ownsPointer(event) {
    return (event.pointerId ?? null) === this._pointerId;
  }

  _onPointerCancel(event) {
    if (this._deferred && this._ownsPointer(event)) {
      this._clearDeferredPress();
      return;
    }
    if (!this.isDragging || !this._ownsPointer(event)) return;
    this.endGesture('pointercancel');
  }

  _onLostCapture = (event) => {
    // Losing native capture is not the end of the gesture. Browsers release
    // capture after pointerup, before the queued frame runs, and Chrome also
    // drops it mid-drag the moment a pointermove reports no buttons held —
    // which macOS trackpads produce during a real drag (three-finger drag,
    // drag lock) with the real pointerup still to come. Cancelling here
    // restored the press pose on release, the reported snap-back. Ownership
    // never depended on capture: the window listeners follow the claiming
    // pointer by id, so the drag carries on and ends on pointerup,
    // pointercancel, blur or Escape like any other. Capture is re-acquired
    // on the next move that reports the button down again, so a cursor
    // passing over a panel does not read as leaving the canvas.
    if (this.isDragging && this._ownsPointer(event) && !this._releasePending) {
      this._captureLost = true;
    }
  };

  _reacquireCapture(event) {
    if (!this._captureLost || !event.buttons) return;
    const canvas = this._canvas();
    if (!canvas || !canvas.setPointerCapture || event.pointerId === undefined) {
      return;
    }
    try {
      canvas.setPointerCapture(event.pointerId);
      this._captureLost = false;
    } catch {
      // Not in an active-buttons state as far as the browser is concerned;
      // the window listeners keep following the pointer regardless.
    }
  }

  _onBlur() {
    if (this._clearDeferredPress()) return;
    if (!this.isDragging) return;
    this.endGesture('blur');
  }

  _onCanvasLeave() {
    if (!this.isDragging) return;
    if (this._releasePending) return;
    // Without native capture the canvas sees the cursor cross its edge (the
    // browser dropped capture on a phantom button-up, see _onLostCapture),
    // which is not the user letting go: the window listeners still own the
    // pointer, and the real pointerup ends the gesture.
    if (this._captureLost) return;
    if (this.axis === 'move') {
      this._releasePending = { reason: 'mouseleave' };
    } else {
      this.endGesture('mouseleave');
    }
  }

  /**
   * Everything the editor's own keymap binds is suppressed for the duration of
   * a claimed gesture, on both phases — undo and redo are keydown, delete and
   * the mode keys are keyup, and one handler cannot reach the other's family.
   *
   * A rule over the whole keymap rather than a list of keys: over-suppressing
   * costs a key doing nothing while a press is held, which is what a user
   * pressing it mid-drag would expect anyway, while under-suppressing costs a
   * gesture committing against a changed selection, camera or history. Cloning
   * the entity, focusing the camera or entering play mode mid-drag are all
   * worse than an unsuppressed undo.
   *
   * The keymap's own focus test is applied first, or the gizmo swallows text
   * typed into a properties-panel field while a gesture happens to be live.
   */
  _suppressKey(event) {
    if (!this.isDragging && !this._deferred) return false;
    if (!shouldCaptureKeyEvent(event)) return false;
    this._suppress(event);
    return true;
  }

  _onKeyDown(event) {
    this._suppressKey(event);
  }

  _onKeyUp(event) {
    if (!this._suppressKey(event)) return;
    if (event.key === 'Escape' || event.keyCode === 27) {
      // A held press is let go; the Escape does nothing else.
      if (this._clearDeferredPress()) return;
      this.endGesture('escape');
    }
  }

  // --- picking and emphasis ---------------------------------------------

  getPickers() {
    const pickers = [this.moveGroup, this.arcGroup];
    if (this.verticalGroup.visible) pickers.push(this.verticalGroup);
    if (this.landingDownGroup.visible) pickers.push(this.landingDownGroup);
    if (this.landingUpGroup.visible) pickers.push(this.landingUpGroup);
    return pickers;
  }

  /**
   * The axis under the current pointer ray, or null — and the point it was hit
   * at, which the near-level rotation needs. The horizontal-plane solve cannot
   * supply that point at a near-level camera, which is the whole reason the
   * flattened rotation model exists; the pick tube is a real surface and is
   * well conditioned at every tilt.
   */
  pickAxis() {
    const intersects = this.raycaster.intersectObjects(this.getPickers(), true);
    this._pickHit = false;
    if (!intersects.length) return null;
    this._pickPoint.copy(intersects[0].point);
    this._pickHit = true;
    let node = intersects[0].object;
    while (node && !node.userData.gizmoAxis) node = node.parent;
    return node ? node.userData.gizmoAxis : null;
  }

  _isLandingAxis(axis) {
    return axis === 'landingUp' || axis === 'landingDown';
  }

  /**
   * Is the subsystem that owns this axis mid-transition?
   *
   * Per subsystem, and only that subsystem: a landing square folding does not
   * disable the move square. Appearing and disappearing at the landing gate is
   * NOT a regime change and makes nothing inert — the square is pressable
   * throughout its fade-in.
   */
  _isInert(axis) {
    if (axis === 'vertical') return false;
    if (this._isLandingAxis(axis)) {
      const group =
        axis === 'landingUp' ? this.landingUpGroup : this.landingDownGroup;
      const anim = group.userData.anim;
      return anim.endMs > anim.startMs;
    }
    return this._anim.endMs > this._anim.startMs;
  }

  /**
   * Four emphasis levels, plus a boost across the flattened presentation
   * because a narrow shape reads lighter than a broad one at the same opacity.
   * Hovering any control dims the others, so a hover reads as a change of state
   * across the whole gizmo rather than a brightening of one part of it.
   *
   * Never a colour change and never full opacity: white read as a different
   * control rather than as the same one under the cursor.
   */
  highlight(axis) {
    const flat = this._shallowAmount;
    const groups = [
      {
        group: this.moveGroup,
        slot: this.materials.move,
        edge: this.edgeMaterials.move,
        flatness: flat
      },
      {
        group: this.arcGroup,
        slot: this.materials.rotate,
        flatness: flat
      },
      {
        group: this.verticalGroup,
        slot: this.materials.vertical,
        edge: this.edgeMaterials.vertical,
        flatness: 0
      },
      {
        group: this.landingDownGroup,
        slot: this.materials.landingDown,
        edge: this.edgeMaterials.landingDown,
        flatness: this.landingDownGroup.userData.faceAmount
      },
      {
        group: this.landingUpGroup,
        slot: this.materials.landingUp,
        edge: this.edgeMaterials.landingUp,
        flatness: this.landingUpGroup.userData.faceAmount
      }
    ];
    const mouse = this._lastPointerType === 'mouse';
    const pressed = this._landingPress;
    // A held press shows its control as active, as a drag does.
    const held = this.isDragging || !!this._deferred;
    const activeAxis = pressed && !pressed.armed ? null : axis;
    const someActive =
      mouse && groups.some((g) => g.group.userData.gizmoAxis === activeAxis);

    groups.forEach(({ group, slot, edge, flatness }) => {
      const active = group.userData.gizmoAxis === activeAxis;
      let level = OPACITY_REST;
      if (active && held) level = OPACITY_ACTION;
      else if (active && mouse) level = OPACITY_HOVER;
      else if (someActive) level = OPACITY_DIM;
      const opacity = Math.min(level + OPACITY_FLAT_BOOST * flatness, 1);
      if (slot.flat) slot.flat.opacity = opacity;
      if (slot.solid) slot.solid.opacity = opacity;
      const outlined = active && (mouse || held || (pressed && pressed.armed));
      if (edge) edge.opacity = outlined ? opacity * EDGE_OPACITY_RATIO : 0;
      if (group === this.moveGroup) {
        this.materials.moveHeadFading.opacity = opacity * (1 - flat);
        this.edgeMaterials.moveFading.opacity = outlined
          ? this.materials.moveHeadFading.opacity * EDGE_OPACITY_RATIO
          : 0;
      }
    });

    // The chevron stack takes the ACTION level whenever its own target is
    // engaged — hovered, or held during a landing press. It is the picture of
    // what pressing will do, so it is the most informative thing on screen at
    // that moment; and because a touch user gets no hover at all, the held
    // press is the only state in which they see any emphasis, which is exactly
    // the "about to" this feedback exists for.
    [this.landingDownGroup, this.landingUpGroup].forEach((group) => {
      const own = group.userData.gizmoAxis;
      const engaged =
        (mouse && own === activeAxis) ||
        (pressed && pressed.armed && pressed.axis === own);
      const base = engaged
        ? OPACITY_ACTION
        : someActive
          ? OPACITY_DIM
          : OPACITY_REST;
      group.userData.chevrons.forEach((chev) => {
        const fade = chev.userData.fade === undefined ? 1 : chev.userData.fade;
        chev.material.opacity = Math.min(base, 1) * fade;
        chev.userData.edge.material.opacity = engaged
          ? chev.material.opacity *
            EDGE_OPACITY_RATIO *
            chev.userData.edgeFacing
          : 0;
      });
    });
  }

  // --- per-frame --------------------------------------------------------

  /**
   * Layout runs from the helper-scene traversal, up to twice per rendered
   * frame. Movement runs earlier, from the A-Frame system tick, so parents and
   * children have their new pose before WebGL traverses the scene. Tests and
   * non-A-Frame consumers retain the guarded traversal fallback.
   */
  updateMatrixWorld(force) {
    this._checkEditorClosedEdge();
    const laidOut =
      this.el && this.object && this.object.parent && this._inspectorOpen();
    if (laidOut) {
      this._layoutFrame();
      if (!this._frameSystem) this._advanceBeforeRender();
    }
    super.updateMatrixWorld(force);
    // After the traversal, so every part's world matrix is this frame's.
    if (laidOut) this._layoutEdges();
  }

  // --- edges ------------------------------------------------------------

  _layoutEdges() {
    // The same rectangle the pointer is mapped through, so the edge is sized
    // in the pixels the user sees, for any camera.
    const rect = this._canvasRect();
    if (!rect || !rect.width || !rect.height || !(this.squareSide > 0)) return;
    this._edgeScreenW = rect.width;
    this._edgeScreenH = rect.height;
    this.camera.updateMatrixWorld();

    const openShallow = this._shallowAmount >= 0.99;
    this._edgeBegin(this.plateEdge);
    this._edgeAddMesh(
      this.plateEdge,
      this.movePlate,
      QUAD_OUTLINE,
      openShallow ? OMIT_QUAD_VERTICAL : null
    );
    this._edgeEnd(this.plateEdge);

    this._edgeBegin(this.zHeadsEdge);
    this._edgeAddMesh(
      this.zHeadsEdge,
      this.moveHeads[2],
      TRIANGLE_OUTLINE,
      null,
      openShallow ? this.moveHeads[2].userData.outlineBaseGap : null
    );
    this._edgeAddMesh(
      this.zHeadsEdge,
      this.moveHeads[3],
      TRIANGLE_OUTLINE,
      null,
      openShallow ? this.moveHeads[3].userData.outlineBaseGap : null
    );
    this._edgeEnd(this.zHeadsEdge);

    this.xHeadsEdge.visible = this.moveHeads[0].visible;
    if (this.xHeadsEdge.visible) {
      this._edgeBegin(this.xHeadsEdge);
      this._edgeAddMesh(this.xHeadsEdge, this.moveHeads[0], TRIANGLE_OUTLINE);
      this._edgeAddMesh(this.xHeadsEdge, this.moveHeads[1], TRIANGLE_OUTLINE);
      this._edgeEnd(this.xHeadsEdge);
    }

    this.verticalShaftEdge.visible = this.verticalGroup.visible;
    this.verticalHeadsEdge.visible = this.verticalGroup.visible;
    if (this.verticalGroup.visible) {
      this._edgeBegin(this.verticalShaftEdge);
      this._edgeAddMesh(
        this.verticalShaftEdge,
        this.verticalShaft,
        QUAD_OUTLINE,
        OMIT_QUAD_HORIZONTAL
      );
      this._edgeEnd(this.verticalShaftEdge);
      this._edgeBegin(this.verticalHeadsEdge);
      this.verticalHeads.forEach((head) => {
        this._edgeAddMesh(
          this.verticalHeadsEdge,
          head,
          TRIANGLE_OUTLINE,
          null,
          head.userData.outlineBaseGap
        );
      });
      this._edgeEnd(this.verticalHeadsEdge);
    }

    this._layoutLandingEdge(this.landingDownGroup);
    this._layoutLandingEdge(this.landingUpGroup);
  }

  _layoutLandingEdge(group) {
    if (!group.visible) return;
    const ud = group.userData;
    const outline = ud.outline;
    const edge = ud.edge;
    const stroke = LANDING_OUTLINE_FRAC;
    const halfH = ud.outlineHeight / 2;
    this._edgeBegin(edge);
    if (!ud.bars[1].visible) {
      this._edgeAddRect(edge, outline, 0.5, -stroke / 2, stroke / 2, 1);
    } else {
      // Outside the outer rectangle, and inside the inner one.
      this._edgeAddRect(edge, outline, 0.5, -halfH, halfH, 1);
      const innerX = 0.5 - ud.sideStroke;
      this._edgeAddRect(
        edge,
        outline,
        innerX,
        stroke - halfH,
        halfH - stroke,
        -1
      );
    }
    this._edgeEnd(edge);

    for (const chev of ud.chevrons) {
      if (!chev.visible) continue;
      const chevEdge = chev.userData.edge;
      this._edgeBegin(chevEdge);
      this._edgeAddMesh(chevEdge, chev, TRIANGLE_OUTLINE);
      this._edgeEnd(chevEdge);
    }
  }

  _edgeBegin(edge) {
    _edgeToParent.copy(edge.parent.matrixWorld).invert();
    edge.userData.segments = 0;
  }

  _edgeEnd(edge) {
    const geometry = edge.geometry;
    geometry.instanceCount = edge.userData.segments;
    geometry.attributes.instanceStart.data.needsUpdate = true;
  }

  /** A mesh's outline, given in its own frame (z = 0), edged outward. */
  _edgeAddMesh(
    edge,
    mesh,
    outline,
    omittedSegments = null,
    baseGapHalf = null
  ) {
    for (let i = 0; i < outline.length; i++) {
      _edgeWorld[i]
        .set(outline[i][0], outline[i][1], 0)
        .applyMatrix4(mesh.matrixWorld);
    }
    this._edgeAddPolygon(edge, outline.length, 1, omittedSegments, baseGapHalf);
  }

  /** A rectangle in a landing outline's own frame, which lies in its XZ plane:
   * ±halfX across and `z0`…`z1` deep. `sign` −1 edges it on the inside. */
  _edgeAddRect(edge, outline, halfX, z0, z1, sign) {
    _edgeWorld[0].set(-halfX, 0, z0);
    _edgeWorld[1].set(halfX, 0, z0);
    _edgeWorld[2].set(halfX, 0, z1);
    _edgeWorld[3].set(-halfX, 0, z1);
    for (let i = 0; i < 4; i++) _edgeWorld[i].applyMatrix4(outline.matrixWorld);
    this._edgeAddPolygon(edge, 4, sign);
  }

  /**
   * Append the offset outline of the convex polygon in `_edgeWorld`.
   *
   * Offset along the in-plane normal, sized so the line sits half its width
   * from the side measured perpendicular to the side on screen. Measuring
   * along the projected normal instead under-measures on any side oblique to
   * the view. Each side is measured at its own depth.
   */
  _edgeAddPolygon(
    edge,
    count,
    sign,
    omittedSegments = null,
    baseGapHalf = null
  ) {
    const a = _edgeWorld[0];
    _edgeU.subVectors(_edgeWorld[1], a);
    _edgeV.subVectors(_edgeWorld[2], a);
    _edgePlane.crossVectors(_edgeU, _edgeV);
    if (_edgePlane.lengthSq() < 1e-20 || _edgeU.lengthSq() < 1e-20) return;
    _edgePlane.normalize();
    _edgeU.normalize();
    _edgeV.crossVectors(_edgePlane, _edgeU);

    _edgeCentroid.set(0, 0, 0);
    for (let i = 0; i < count; i++) _edgeCentroid.add(_edgeWorld[i]);
    _edgeCentroid.multiplyScalar(1 / count);

    const eps = this.squareSide * 1e-3;
    for (let i = 0; i < count; i++) {
      const p = _edgeWorld[i];
      const q = _edgeWorld[(i + 1) % count];
      _edgeMid.subVectors(p, a);
      _edgeFlat[2 * i] = _edgeMid.dot(_edgeU);
      _edgeFlat[2 * i + 1] = _edgeMid.dot(_edgeV);
      _edgeMid.addVectors(p, q).multiplyScalar(0.5);
      _edgeAlong.subVectors(q, p).normalize();
      _edgeNormal.crossVectors(_edgeAlong, _edgePlane);
      _edgePoint.subVectors(_edgeMid, _edgeCentroid);
      if (_edgeNormal.dot(_edgePoint) < 0) _edgeNormal.negate();
      _edgeOffsets[i] = sign * this._edgeOffsetAt(eps);
    }
    offsetConvexPolygon(_edgeFlat, _edgeOffsets, _edgeOut, count);

    for (let i = 0; i < count; i++) {
      if (omittedSegments && omittedSegments.includes(i)) continue;
      const j = (i + 1) % count;
      _edgePoint
        .copy(a)
        .addScaledVector(_edgeU, _edgeOut[2 * i])
        .addScaledVector(_edgeV, _edgeOut[2 * i + 1])
        .applyMatrix4(_edgeToParent);
      _edgeMid
        .copy(a)
        .addScaledVector(_edgeU, _edgeOut[2 * j])
        .addScaledVector(_edgeV, _edgeOut[2 * j + 1])
        .applyMatrix4(_edgeToParent);
      if (i === 0 && baseGapHalf !== null) {
        const gap = Math.min(Math.max(baseGapHalf, 0), 0.499);
        _edgeSegmentStart.copy(_edgePoint);
        _edgeSegmentEnd.lerpVectors(_edgePoint, _edgeMid, 0.5 - gap);
        this._edgeAppendSegment(edge, _edgeSegmentStart, _edgeSegmentEnd);
        _edgeSegmentStart.lerpVectors(_edgePoint, _edgeMid, 0.5 + gap);
        _edgeSegmentEnd.copy(_edgeMid);
        this._edgeAppendSegment(edge, _edgeSegmentStart, _edgeSegmentEnd);
      } else {
        this._edgeAppendSegment(edge, _edgePoint, _edgeMid);
      }
    }
  }

  _edgeAppendSegment(edge, start, end) {
    const array = edge.geometry.attributes.instanceStart.data.array;
    let k = edge.userData.segments * 6;
    array[k++] = start.x;
    array[k++] = start.y;
    array[k++] = start.z;
    array[k++] = end.x;
    array[k++] = end.y;
    array[k] = end.z;
    edge.userData.segments++;
  }

  /**
   * The in-plane offset, in metres, that puts the edge line's centre half its
   * width from the side on screen, for the side at `_edgeMid` running along
   * `_edgeAlong` with outward normal `_edgeNormal`. From the screen Jacobian at
   * that point, so it is exact for the side's own depth and angle.
   */
  _edgeOffsetAt(eps) {
    const m = this._edgeScreen(_edgeMid, _edgeProjection);
    const mx = m.x;
    const my = m.y;
    _edgePoint.copy(_edgeMid).addScaledVector(_edgeAlong, eps);
    const e = this._edgeScreen(_edgePoint, _edgeProjection);
    const ex = (e.x - mx) / eps;
    const ey = (e.y - my) / eps;
    _edgePoint.copy(_edgeMid).addScaledVector(_edgeNormal, eps);
    const n = this._edgeScreen(_edgePoint, _edgeProjection);
    const nx = (n.x - mx) / eps;
    const ny = (n.y - my) / eps;
    const alongPx = Math.hypot(ex, ey);
    const across = alongPx > 0 ? Math.abs(nx * ey - ny * ex) / alongPx : 0;
    const perMetre = Math.max(across, Math.hypot(nx, ny) / EDGE_MAX_STRETCH);
    return perMetre > 0 && Number.isFinite(perMetre)
      ? EDGE_PX / 2 / perMetre
      : 0;
  }

  /** A world point in CSS pixels on the canvas, written into `out` (x, y). */
  _edgeScreen(point, out) {
    out.copy(point).project(this.camera);
    out.set(
      ((out.x + 1) / 2) * this._edgeScreenW,
      ((1 - out.y) / 2) * this._edgeScreenH,
      0
    );
    return out;
  }

  _advanceBeforeRender() {
    if (!this.el || !this.object || !this.object.parent) return;
    if (!this._inspectorOpen() || !this._frameChanged()) return;
    this._advance();
    if (this._releasePending) {
      const { reason, event } = this._releasePending;
      this.endGesture(reason, event);
    }
  }

  /**
   * Closing the editor deselects nothing and calls no detach, so this hook is
   * the only thing still running that can notice. Without it, closing the
   * editor with an entity selected would leave every window-capture listener
   * armed over the running viewer — including the pair whose whole job is to
   * swallow delete, undo and clone. Hiding the helper scene does not help:
   * matrix updates traverse regardless of visibility, which is exactly why this
   * is the right place to look.
   */
  _checkEditorClosedEdge() {
    if (typeof AFRAME === 'undefined') return;
    const open = this._inspectorOpen();
    if (this._wasOpen && !open) {
      this._clearDeferredPress();
      if (this.isDragging) this.endGesture('editorclosed');
      this._removeListeners();
      this.probe.setFlatteningSuspended(false);
    } else if (!this._wasOpen && open && this.el) {
      this._addListeners();
    }
    this._wasOpen = open;
  }

  /**
   * One browser frame, identified by the scene's own frame time.
   *
   * The renderer's frame counter is not usable for this: it is incremented long
   * after the traversal it would identify, so the two traversals of one frame
   * see different values — and screenshot and thumbnail paths drive extra
   * renders that bump it out of band. The scene sets its time once per
   * animation-loop callback and before rendering, so it is constant across both
   * traversals and changes exactly once per frame.
   */
  _frameChanged() {
    const token = this.sceneEl ? this.sceneEl.time : undefined;
    if (token === undefined) return true;
    if (token === this._frameToken) return false;
    this._frameToken = token;
    return true;
  }

  _updateBase() {
    this.object.updateWorldMatrix(true, false);
    this.object.matrixWorld.decompose(_p, _q, _s);
    if (this._policy) {
      this._updateBaseFromPolicy();
      return;
    }
    if (isStreetEntity(this.el)) {
      // Managed roads sit above the dirt origin; standalone segments use local zero.
      const localY = this.el.hasAttribute('managed-street')
        ? calculateHeight(0)
        : 0;
      this.baseY = _v2
        .set(0, localY, 0)
        .applyMatrix4(this.object.matrixWorld).y;
    } else {
      this.baseY = this.localBox
        ? _box.copy(this.localBox).applyMatrix4(this.object.matrixWorld).min.y
        : _p.y;
    }
    this.baseOffset = this.baseY - _p.y;
    this._anchor.set(_p.x, this.baseY, _p.z);
  }

  /**
   * The handles stand at the policy's pivot, on the bottom of its box (or at
   * the pivot's own height when there is no box), so `_p` leaves here with the
   * pivot's X and Z and the origin's Y. The pivot held for a gesture is used
   * while one is live.
   */
  _updateBaseFromPolicy() {
    const matrixWorld = this.object.matrixWorld;
    if (this._pivotHeld) _pivot.copy(this._pivotLocal);
    else this._policy.pivotLocal(this.el, _pivot);
    _pivot.applyMatrix4(matrixWorld);
    const box = this._policy.localBox(this.el);
    this.baseY = box
      ? _box.copy(box).applyMatrix4(matrixWorld).min.y
      : _pivot.y;
    this.baseOffset = this.baseY - _p.y;
    _p.x = _pivot.x;
    _p.z = _pivot.z;
    this._anchor.set(_p.x, this.baseY, _p.z);
  }

  /** Capture the policy's pivot for the gesture starting now. */
  _holdPivot() {
    this._policy.pivotLocal(this.el, this._pivotLocal);
    this.object.updateWorldMatrix(true, false);
    this._pivotParent.copy(this._pivotLocal).applyMatrix4(this.object.matrix);
    this._pivotWorld
      .copy(this._pivotLocal)
      .applyMatrix4(this.object.matrixWorld);
    const pos = this.el.getAttribute('position');
    this._posStart.set(pos.x, pos.y, pos.z);
    const rot = this.el.getAttribute('rotation');
    this._quatStart.setFromEuler(
      _e.set(rot.x * DEG, rot.y * DEG, rot.z * DEG, 'YXZ')
    );
    this._pivotHeld = true;
  }

  _layoutFrame() {
    this._updateBase();
    _e.setFromQuaternion(_q, 'YXZ');
    const yaw = _e.y;

    // Measured where the user is looking — the square's own position — not at
    // the object's origin. This is also the anchor the regime is decided from,
    // in BOTH presentations and before any dodge shift, so the angle that
    // decides the layout is never measured from the layout it decided.
    _v2.set(_p.x, this.baseY, _p.z);
    this._anchor.copy(_v2);
    const mpp = this._metresPerPixelAt(_v2);
    const side = squareSideMetres(mpp);
    if (side === null) return; // hold the last good layout
    this._mpp = mpp;
    this.squareSide = side;

    const now = performance.now();
    this._advanceRegime(now);
    this._layout(_p, yaw, now);
  }

  /** The object's base RIGHT NOW. Pointer events can outpace the render loop,
   * so a second advance in one frame must not correct against a stale base. */
  currentBaseY() {
    this.object.getWorldPosition(_p);
    return _p.y + this.baseOffset;
  }

  _refreshSupport() {
    // Flattening suspension is a property of the GESTURE, not of the
    // selection, and is owned by the press and the gesture exits alone: a
    // selected street keeps flattening the terrain around it until a drag
    // begins and gets it back the moment the drag ends.
    if (!this.object || !this._inspectorOpen()) return;
    if (!this._followsGround()) return;
    this._updateBase();
    const baseY = this.currentBaseY();
    const column = this.probe.probeColumn(_p.x, _p.z, baseY);
    this._applyColumn(column, baseY);
  }

  _applyColumn(column, baseY) {
    this._landingDownEntity = column.below ? column.below.entity : null;
    this._landingUpEntity = column.above ? column.above.entity : null;
    this.supportY = column.below ? column.below.y : null;
    this.landingDownY = this._gateLanding(
      column.below ? column.below.y : null,
      baseY,
      false
    );
    this.landingUpY = this._gateLanding(
      column.above ? column.above.y : null,
      baseY,
      true
    );
  }

  /**
   * A target appears once the gap exceeds the show figure and disappears below
   * the hide one. A tolerance rather than a threshold: an object out by less
   * than the lower figure is treated as placed. An object resting on its
   * support is zero away, so this excludes it without a carve-out — which is
   * what makes snap-to-ground and snap-to-roof one gesture rather than two
   * affordances.
   */
  _gateLanding(y, baseY, isUp) {
    const key = isUp ? '_landingUpShown' : '_landingDownShown';
    if (y === null || y === undefined) {
      this[key] = false;
      return null;
    }
    const gap = Math.abs(baseY - y);
    if (gap > LANDING_SHOW_GAP_METRES) this[key] = true;
    else if (gap < LANDING_HIDE_GAP_METRES) this[key] = false;
    return this[key] ? y : null;
  }

  // --- the two presentations --------------------------------------------

  _elevationToDegrees(point) {
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(_camPos);
    return elevationAngleDegrees(_camPos, point);
  }

  /**
   * World metres per screen pixel at a world point, for movement perpendicular
   * to the view axis — measured on DEPTH ALONG THE VIEW AXIS, not on radial
   * distance. The image plane is flat, so a metre of lateral displacement
   * projects to a pixel count set by depth alone; radial distance overstates it
   * by one over the cosine of the angle off the view axis, which is about 1.3
   * at the horizontal edge of a wide frame.
   */
  _metresPerPixelAt(worldPoint) {
    const h = this.domElement ? this.domElement.clientHeight : 0;
    if (!h) return 0;
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(_camPos);
    _camFwd.setFromMatrixColumn(this.camera.matrixWorld, 2).negate();
    _delta.subVectors(worldPoint, _camPos);
    const depth = _delta.dot(_camFwd);
    if (!(depth > 1e-6)) return 0;
    return metresPerPixel(this.camera, depth, h);
  }

  /**
   * The regime is symmetric: looking UP at a facade from below foreshortens the
   * controls exactly as looking along the street does, so the magnitude of the
   * elevation angle is what decides it.
   *
   * It is FROZEN for the duration of a gesture. The two presentations have
   * incompatible drag models, so which one a gesture uses has to be decided
   * once, at the press — otherwise dragging an object toward the camera could
   * flip its own regime and change the model under the cursor.
   */
  _advanceRegime(now) {
    if (!this.isDragging) {
      const tilt = Math.abs(this._elevationToDegrees(this._anchor));
      this._regimeLatch = latchByHysteresis(
        tilt,
        REGIME_ENTER_BELOW_DEG,
        REGIME_LEAVE_ABOVE_DEG,
        this._regimeLatch
      );
      if (this._regimeLatch !== this.flat) {
        this.flat = this._regimeLatch;
        this._startAnim(this._anim, this.flat ? 1 : 0, now);
      }
    }
    this._shallowAmount = this._advanceAnim(
      this._anim,
      this._shallowAmount,
      now
    );
  }

  _startAnim(anim, to, now) {
    anim.from = anim.current === undefined ? anim.to : anim.current;
    anim.to = to;
    anim.startMs = now;
    // Proportional, so reversing part way across travels only the remaining
    // distance rather than spending the full duration on it.
    anim.endMs =
      now + Math.max(1, this.animDurationMs * Math.abs(to - anim.from));
  }

  /**
   * Driven from the clock, never from an accumulator: this runs up to twice per
   * rendered frame, so a delta-accumulating tween would advance at double speed
   * and non-deterministically.
   */
  _advanceAnim(anim, current, now) {
    anim.current = current;
    if (anim.endMs <= anim.startMs) return current;
    const p = Math.min(
      Math.max((now - anim.startMs) / (anim.endMs - anim.startMs), 0),
      1
    );
    const ease = this.animEasing || easeInOutCubic;
    let value = lerp(anim.from, anim.to, ease(p));
    if (p >= 1) {
      value = anim.to;
      anim.endMs = anim.startMs;
    }
    anim.current = value;
    return value;
  }

  /**
   * A subsystem arrives in the right shape rather than animating into it.
   *
   * Seeded with a plain threshold rather than the hysteresis pair, because
   * there is no previous state to latch from — and seeding matters most for a
   * landing square, which comes into existence part way through a drag. Without
   * it, a target that has just appeared would be inert for half a second while
   * still claiming the press, so pressing it straight away — which the small
   * landing gate makes the natural gesture — would do nothing.
   */
  _seedRegime() {
    this.camera.updateMatrixWorld();
    const tilt = Math.abs(this._elevationToDegrees(this._anchor));
    this.flat = tilt < REGIME_SEED_DEG;
    this._regimeLatch = this.flat;
    this._shallowAmount = this.flat ? 1 : 0;
    this._anim.startMs = 0;
    this._anim.endMs = 0;
    this._anim.to = this._shallowAmount;
    this._anim.current = this._shallowAmount;
  }

  /** Horizontal camera-right, normalised. */
  cameraRight(out) {
    this.camera.updateMatrixWorld();
    out.setFromMatrixColumn(this.camera.matrixWorld, 0);
    out.y = 0;
    if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
    return out.normalize();
  }

  /** Hold the camera-derived frame during gestures; see docs/easy-gizmo.md#flattened-frame. */
  _refreshShallowFrame(yaw) {
    if (this.isDragging) return;
    this.cameraRight(_camRight);

    // Choose the nearest equivalent half-turn of the handle.
    let sy = Math.atan2(_camRight.x, _camRight.z);
    if (Math.cos(sy - yaw) < 0) sy += Math.PI;
    this._shallowYaw = sy;

    // Re-pick the quarter-turn offset only at endpoints to avoid transition pops.
    if (this._shallowAmount === 0 || this._shallowAmount === 1) {
      const quarter = Math.PI / 2;
      const d = Math.atan2(Math.sin(sy - yaw), Math.cos(sy - yaw));
      this._roundYawOffset = quarter * Math.round(d / quarter);
    }

    // The strip advertises the horizontal drag direction.
    _bx.copy(_camRight);
    _bn.crossVectors(_bx, UP);
    _basis.makeBasis(_bx, UP, _bn);
    this._shallowQuat.setFromRotationMatrix(_basis);

    // Keep the ring horizontal and aligned with the view axis to communicate yaw.
    this._shallowArcYaw = Math.atan2(_bn.x, _bn.z);
    // Unlike the handle, the arrowheads are not invariant under a half turn.
  }

  // --- layout -----------------------------------------------------------

  _layout(worldPos, yaw, now) {
    const S = this.squareSide;
    const t = this._shallowAmount;
    const baseY = this.baseY;
    const mpp = this._mpp;

    _centre.set(worldPos.x, baseY, worldPos.z);
    this._refreshShallowFrame(yaw);
    const shallowYaw = this._shallowYaw;
    const extents = dodgeExtents(S, mpp, t);
    const dodge = this._resolveDodge(extents.stripClear, baseY, now);
    const shift = dodge.shift * t;

    // --- move handle ---------------------------------------------------
    // Just beneath the OBJECT, not on the ground: reaching down to the ground
    // to move an object floating overhead put the handle nowhere near the thing
    // being manipulated. It is also the plane the drag is solved on, so the two
    // coincide rather than being two heights held apart.
    this.moveGroup.position.set(_centre.x, _centre.y + shift, _centre.z);
    _qA.setFromAxisAngle(UP, yaw + this._roundYawOffset);
    _qB.setFromAxisAngle(UP, shallowYaw);
    this.moveGroup.quaternion.copy(_qA).slerp(_qB, t);

    // The plate's slerp runs in the GROUP's frame, not the world's. Two
    // independent interpolations of the same change take their own shortest
    // paths and routinely travel in opposite senses while agreeing at both
    // ends; slerping the plate against the group's flattened endpoint leaves a
    // residual that is a pure tilt about the long axis the arrowheads already
    // travel on.
    _qB.setFromAxisAngle(UP, shallowYaw).invert().multiply(this._shallowQuat);
    // The yaw normalisation above can leave that endpoint sending local X to
    // the group's −Z. The plate is a rectangle, so a half turn about its own
    // normal is visually a no-op — but not to slerp, which would take the long
    // way round.
    if (_v.set(1, 0, 0).applyQuaternion(_qB).z < 0) {
      _qZ.setFromAxisAngle(Z_AXIS, Math.PI);
      _qB.multiply(_qZ);
    }
    this.movePlate.quaternion.copy(PLATE_ROUND_LOCAL).slerp(_qB, t);

    const stripLen = S * STRIP_LEN_FRAC;
    const stripNarrow = S * STRIP_NARROW_FRAC;
    // Inset inside a landing outline of side S, so the outline reads as a
    // separate ring around it.
    const plate = S * MOVE_PLATE_ROUND_FRAC;
    const halfZ = lerp(plate / 2, stripLen / 2, t);
    // Lerped with the plate rather than pinned: the ±X heads fade across the
    // change while the plate narrows underneath them, so a fixed half-width
    // would leave them floating clear of the strip's edge mid-transition.
    const halfX = lerp(plate / 2, stripNarrow / 2, t);
    this.movePlate.scale.set(
      lerp(plate, stripLen, t),
      lerp(plate, stripNarrow, t),
      1
    );

    const headBase = S * lerp(HEAD_BASE_FRAC, HEAD_BASE_FLAT_FRAC, t);
    const headLen = S * lerp(HEAD_LEN_FRAC, HEAD_LEN_FLAT_FRAC, t);
    // The plate's live normal in the group's frame — the plane the flat heads
    // lie in. It swings from up to horizontal with the plate, which is what
    // keeps the heads face-on in both presentations.
    _hd.set(0, 0, 1).applyQuaternion(this.movePlate.quaternion);
    this.moveHeads.forEach((head, i) => {
      const alongZ = i >= 2;
      const sign = i % 2 === 0 ? 1 : -1;
      const reach = (alongZ ? halfZ : halfX) + headLen / 2;
      head.position.set(
        alongZ ? 0 : sign * reach,
        0,
        alongZ ? sign * reach : 0
      );
      head.scale.set(headBase, headLen, 1);
      head.userData.outlineBaseGap = stripNarrow / (2 * headBase);
      aimArrowhead(head, head.userData.dir, _hd);
      // The ±X pair fades out where movement is restricted to left and right:
      // an arrowhead promising the other axis would be lying. Drives the
      // raycast override, so a head that is not drawn is not pickable either.
      if (head.userData.fades) head.visible = t < 0.99;
    });

    // --- vertical handle -----------------------------------------------
    // A camera-facing world-Y arrow, deliberately detached from object bounds.
    // It stays above the pad in both round and flattened presentations.
    const verticalElevation = Math.abs(this._elevationToDegrees(_centre));
    this.verticalGroup.visible =
      (this.isDragging && this.axis === 'vertical') ||
      verticalElevation < VERTICAL_HIDE_ABOVE_DEG;
    this.verticalGroup.position.set(
      _centre.x,
      _centre.y + S * VERTICAL_CENTRE_ABOVE_PAD_FRAC,
      _centre.z
    );
    this.verticalGroup.quaternion.copy(this._shallowQuat);
    const shaftLength = S * VERTICAL_SHAFT_LENGTH_FRAC;
    const shaftWidth = S * VERTICAL_SHAFT_WIDTH_FRAC;
    const verticalHeadLength = S * VERTICAL_HEAD_LENGTH_FRAC;
    const verticalHeadBase = S * VERTICAL_HEAD_BASE_FRAC;
    this.verticalShaft.scale.set(shaftWidth, shaftLength, 1);
    this.verticalHeads.forEach((head) => {
      const sign = head.userData.sign;
      head.position.set(0, sign * (shaftLength + verticalHeadLength) * 0.5, 0);
      head.scale.set(verticalHeadBase, verticalHeadLength, 1);
      head.userData.outlineBaseGap = shaftWidth / (2 * verticalHeadBase);
      _hd.set(0, sign, 0);
      aimArrowhead(head, _hd, Z_AXIS);
    });
    this.verticalPick.scale.set(
      S * VERTICAL_PICK_WIDTH_FRAC,
      S * VERTICAL_PICK_LENGTH_FRAC,
      1
    );

    // --- rotate arc -----------------------------------------------------
    const radius = S * lerp(ARC_ROUND_RADIUS_FRAC, ARC_FLAT_RADIUS_FRAC, t);
    const tubeWorld = extents.tubeWorld;
    // The flat ring sits in the strip's own plane and would cross it on screen
    // at every near-horizontal view, so it is held clear of the strip and its
    // arrowheads by their half-heights, its own and a small gap. Its drawn
    // front is nearer the camera than the strip, so parallax moves it on screen
    // by up to its radius times the tangent of the elevation; the lift makes up
    // the rest of that. The elevation is taken to the handle as drawn, shift
    // included, because the shift changes how far the camera looks down on it.
    // Both are scaled by the flatten amount, so the round presentation is
    // untouched.
    const side = dodge.flipArc ? 1 : -1;
    _v.set(_centre.x, _centre.y + shift, _centre.z);
    const lift = flatArcLift(
      S,
      this._elevationToDegrees(_v),
      side,
      ARC_LIFT_SYMMETRIC
    );
    this.arcGroup.position.set(
      _centre.x,
      _centre.y + shift + side * t * (extents.clearance + lift),
      _centre.z
    );

    // The arrows travel with the rotation and return to forward on release.
    // The round presentation does this for free, since the arc's resting
    // orientation IS the heading; the flattened endpoint is a camera frame and
    // is latched for the gesture, so without this the ring would stand still
    // while the object turned beneath it. Adding the gesture's accumulated turn
    // to the flattened endpoint makes both endpoints follow by the same angle,
    // so the arc follows at any point in the transition.
    let shallowArcYaw = this._shallowArcYaw;
    if (this.isDragging && this.axis === 'rotate') {
      if (this._arcFollowFrom === null) this._arcFollowFrom = yaw;
      shallowArcYaw += yaw - this._arcFollowFrom;
    } else {
      this._arcFollowFrom = null;
    }
    _qA.setFromAxisAngle(UP, yaw);
    _qB.setFromAxisAngle(UP, shallowArcYaw);
    this.arcGroup.quaternion.copy(_qA).slerp(_qB, t);
    this.arcGroup.scale.set(radius, tubeWorld / ARC_TUBE_RADIUS, radius);

    const sweepDeg = lerp(ARC_HALF_SWEEP_DEG, ARC_FLAT_SWEEP_DEG, t);
    const steps = Math.max(
      1,
      Math.round((sweepDeg / ARC_HALF_SWEEP_DEG) * ARC_TUBULAR_SEGMENTS)
    );
    const drawn = steps * this._arcIndicesPerStep;
    this.arcGeometry.setDrawRange(0, drawn);
    // The hit region retracts with the drawn arc, so the flattened presentation
    // does not leave rotation pickable all the way round a ring that is no
    // longer drawn.
    this.arcPickGeometry.setDrawRange(0, drawn);
    // Derived from the DRAWN length, not from the transition amount: the spread
    // is continuous while the drawn sweep is quantised to whole steps, so
    // scaling a precomputed spread would leave the two tails missing each other
    // everywhere between the endpoints — invisible in review, because it is
    // exactly right at both ends.
    const spread = (ARC_HALF_SWEEP_DEG - steps * ARC_STEP_DEG) * DEG;
    this.arcArmA.rotation.y = spread;
    this.arcArmB.rotation.y = -spread;

    // --- landing targets ------------------------------------------------
    this._layoutLandingTarget(
      this.landingDownGroup,
      this.landingDownY,
      worldPos,
      yaw,
      baseY,
      S,
      now
    );
    this._layoutLandingTarget(
      this.landingUpGroup,
      this.landingUpY,
      worldPos,
      yaw,
      baseY,
      S,
      now
    );

    // Opacity is per frame, so hover has to be reapplied on top of it rather
    // than written once when the cursor arrives.
    this.highlight(this.axis);
  }

  /**
   * Where the flattened handle sits, given the landing bars around it.
   *
   * Latched at the press alongside the regime and the drag conversion, because
   * targets update live during a drag — an unlatched shift would slide the
   * handle under the cursor as the object crossed a kerb. On release it eases
   * back to its live value rather than popping, since by then the press-time
   * shift can be a kerb-height stale and the user is looking straight at the
   * control they just let go of.
   */
  _resolveDodge(stripClear, baseY, now) {
    const live = computeDodge({
      stripClear,
      gapBelow: this.landingDownY === null ? null : baseY - this.landingDownY,
      gapAbove: this.landingUpY === null ? null : this.landingUpY - baseY,
      latches: this._dodgeLatches
    });
    this._dodgeLatches = live.latches;

    if (this.isDragging) {
      if (!this._dodgeHeld) this._dodgeHeld = { ...live };
      this._dodge = this._dodgeHeld;
      return this._dodge;
    }
    if (this._dodgeHeld) {
      this._dodgeRelease = {
        from: this._dodgeHeld.shift,
        startMs: now,
        endMs: now + this.animDurationMs
      };
      this._dodgeHeld = null;
    }
    if (this._dodgeRelease) {
      const r = this._dodgeRelease;
      const p = Math.min(
        Math.max((now - r.startMs) / (r.endMs - r.startMs), 0),
        1
      );
      const ease = this.animEasing || easeInOutCubic;
      this._dodge = {
        flipArc: live.flipArc,
        shift: lerp(r.from, live.shift, ease(p))
      };
      if (p >= 1) this._dodgeRelease = null;
      return this._dodge;
    }
    this._dodge = live;
    return live;
  }

  _layoutLandingTarget(group, targetY, worldPos, yaw, baseY, S, now) {
    const ud = group.userData;
    group.visible = targetY !== null;
    if (!group.visible) {
      ud.wasVisible = false;
      ud.regimeLatch = null;
      ud.chevronCount = undefined;
      return;
    }
    group.position.set(worldPos.x, targetY, worldPos.z);
    // The square a click would land the object in reads as the object's own
    // footprint, so it follows the object's heading.
    group.rotation.set(0, yaw, 0);
    // Uniform in the plane, so the stroke stays the same width whichever way
    // the outline is turned; the flattening is in the layout below.
    ud.outline.scale.set(S, 1, S);

    _v.set(worldPos.x, targetY, worldPos.z);
    const tilt = Math.abs(this._elevationToDegrees(_v));
    if (!ud.wasVisible) {
      // A target that comes into existence at a shallow angle arrives
      // flattened. Appearance is not a regime change: it makes nothing inert,
      // and the square is pressable throughout.
      ud.regimeLatch = tilt < REGIME_SEED_DEG;
      ud.faceAmount = ud.regimeLatch ? 1 : 0;
      ud.anim.to = ud.faceAmount;
      ud.anim.current = ud.faceAmount;
      ud.anim.endMs = ud.anim.startMs;
      ud.wasVisible = true;
    } else {
      const want = latchByHysteresis(
        tilt,
        REGIME_ENTER_BELOW_DEG,
        REGIME_LEAVE_ABOVE_DEG,
        ud.regimeLatch
      );
      if (want !== ud.regimeLatch) {
        ud.regimeLatch = want;
        this._startAnim(ud.anim, want ? 1 : 0, now);
      }
    }
    const f = this._advanceAnim(ud.anim, ud.faceAmount, now);
    ud.faceAmount = f;

    // Drawn over the handle only from the side a press would reach it first.
    this.camera.getWorldPosition(_camPos);
    const cameraSide = Math.sign(_camPos.y - baseY);
    const order =
      f < 0.5 && Math.sign(targetY - baseY) === cameraSide
        ? RENDER_ORDER_LANDING_NEAR
        : RENDER_ORDER_LANDING_FAR;
    if (ud.renderOrder !== order) {
      ud.renderOrder = order;
      for (const bar of ud.bars) bar.renderOrder = order;
      ud.pick.renderOrder = order;
    }

    // The outline, laid out for a rectangle one wide and `h` tall. At h = 1
    // this is exactly the square, and the stroke is the same on all four bars
    // at every h — which is the whole reason this is not a group scale.
    const stroke = LANDING_OUTLINE_FRAC;
    const h = lerp(1, stroke, f);
    const bars = ud.bars;
    // A bar's own quarter turn maps its local X and Y onto the group's X and Z,
    // and scale applies before rotation.
    bars[0].position.set(0, 0, (h - stroke) / 2);
    bars[0].scale.set(1, stroke, 1);
    bars[1].position.set(0, 0, -(h - stroke) / 2);
    bars[1].scale.set(1, stroke, 1);
    const side = Math.max(h - 2 * stroke, 1e-4);
    // The side bars thin away from the inside as the outline flattens. At the
    // endpoint the far horizontal bar also disappears, leaving one stroke.
    const sideStroke = Math.max(stroke * (1 - f), 1e-4);
    bars[2].position.set((1 - sideStroke) / 2, 0, 0);
    bars[2].scale.set(sideStroke, side, 1);
    bars[3].position.set(-(1 - sideStroke) / 2, 0, 0);
    bars[3].scale.set(sideStroke, side, 1);
    bars[1].visible = bars[2].visible = bars[3].visible = f < 0.99;
    ud.outlineHeight = h;
    ud.sideStroke = sideStroke;
    // The clickable area is the rectangle, not the square it came from.
    ud.pick.scale.set(1, lerp(1, LANDING_BAR_HEIGHT_FRAC, f), 1);

    if (f > 0) {
      // The bars lie in the outline's horizontal plane, so facing the camera
      // sends local X to camera-right and local Z to world up. `up × right`
      // gives the remaining axis with a positive determinant; the other order
      // would mirror the basis.
      this.cameraRight(_right);
      _v2.crossVectors(UP, _right);
      _basis.makeBasis(_right, _v2, UP);
      _qB.setFromRotationMatrix(_basis);
      _qA.setFromAxisAngle(UP, -yaw);
      _qB.premultiply(_qA);
      ud.outline.quaternion.set(0, 0, 0, 1).slerp(_qB, f);
    } else {
      ud.outline.quaternion.identity();
    }

    this._layoutChevrons(group, targetY, baseY, S, yaw, now);
  }

  _layoutChevrons(group, targetY, baseY, S, yaw, now) {
    const ud = group.userData;
    const span = Math.abs(baseY - targetY);
    const dir = targetY < baseY ? -1 : 1;
    const chevrons = ud.chevrons;
    // The stack DIVIDES the gap rather than being laid out from one end, and
    // reaches the whole way: a run that stopped short would read as one
    // triangle floating at the midpoint on the commonest gap of all.
    const { count, step } = chevronLayout(
      span,
      S * CHEVRON_SPACING_FRAC,
      ud.chevronCount
    );
    ud.chevronCount = count;
    const headBase = S * CHEVRON_BASE_FRAC;
    // Capped against the STEP, not the span, so they do not run into each other
    // on a short hop.
    const headLen = Math.min(S * CHEVRON_LEN_FRAC, step * 0.8);

    // Hovered, or held: the stack slides toward the target. Motion is the one
    // cue for "down" that survives being seen from directly overhead, where
    // every static form here degenerates.
    //
    // The phase is read from the moment the slide STARTED rather than from the
    // absolute clock, or the stack jumps in position and opacity at exactly the
    // instant the user's attention arrives on it. On touch it does not run at
    // all, along with every other hover affordance.
    const engaged =
      this._lastPointerType === 'mouse' &&
      this.axis === ud.gizmoAxis &&
      (!this._landingPress || this._landingPress.armed);
    if (engaged) {
      if (ud.slideFrom === undefined || ud.slideFrom === null) {
        ud.slideFrom = now;
      }
    } else {
      ud.slideFrom = null;
    }
    const phase = engaged
      ? ((now - ud.slideFrom) % CHEVRON_CYCLE_MS) / CHEVRON_CYCLE_MS
      : 0;

    // The plane each chevron stands in: vertical, with its normal on the
    // horizontal line to the camera, taken into this group's frame. Yaw only,
    // which is the whole point — a triangle turned to face the camera fully
    // would tip toward face-on as the viewer rises above it.
    this.cameraRight(_right);
    _hd.crossVectors(_right, UP).applyAxisAngle(UP, -yaw);
    _v.set(0, dir, 0);
    // The same plane normal in world space, for how face-on each chevron's
    // edge is seen.
    _edgeNormal.crossVectors(_right, UP);
    this.camera.getWorldPosition(_camPos);
    let lastChevron = null;
    let nearestTarget = Infinity;
    for (let i = 0; i < chevrons.length; i++) {
      const chev = chevrons[i];
      chev.visible = i < count;
      if (!chev.visible) continue;
      let k = (i + 0.5 - phase) % count;
      if (k < 0) k += count;
      const u = k * step;
      if (u < nearestTarget) {
        nearestTarget = u;
        lastChevron = chev;
      }
      // Fade the ends only while moving, so a chevron recycling from the target
      // back to the object does not pop. At rest they are all solid.
      let fade = 1;
      if (engaged) {
        const e = step * 0.5;
        fade = Math.min(Math.max(Math.min(u / e, (span - u) / e), 0), 1);
      }
      chev.position.set(0, -dir * u, 0);
      chev.scale.set(headBase, headLen, 1);
      // A proper rotation, not a negative scale: a negative determinant inverts
      // transformed normals, so a down-pointing chevron would shade inward and
      // render black under a lit material.
      aimArrowhead(chev, _v, _hd);
      chev.userData.fade = fade;
      // An edge-on chevron, seen from overhead, would be all edge.
      _edgeMid
        .set(group.position.x, targetY - dir * u, group.position.z)
        .sub(_camPos)
        .normalize();
      chev.userData.edgeFacing = THREE.MathUtils.smoothstep(
        Math.abs(_edgeMid.dot(_edgeNormal)),
        EDGE_FACING_HIDE,
        EDGE_FACING_FULL
      );
    }
    // Keep the final direction mark visible when the landing button is outside
    // the viewport. It remains on the vertical connection and cannot be picked.
    _edgePoint.set(group.position.x, baseY, group.position.z);
    _edgeProjection.set(group.position.x, targetY, group.position.z);
    if (
      lastChevron &&
      lastVisiblePointOnSegment(
        _edgePoint,
        _edgeProjection,
        this.camera,
        _edgePoint
      )
    ) {
      lastChevron.position.y = _edgePoint.y - targetY;
      lastChevron.userData.fade = 1;
    }
  }

  // --- the drag ---------------------------------------------------------

  /**
   * Both sides of the unchanged-value comparison come from THIS formatter, at
   * the same quantisation. The stock gizmo snapshots the live, unrounded
   * transform, and copying that shape is exactly the build in which a gesture
   * released where it started still writes an undo entry — the snapshot and the
   * value it is compared against would have been through different roundings.
   *
   * Pitch and roll are written as read: the gizmo never edits them, and
   * rounding them would change an axis the user did not touch (and turn a
   * yaw of an entity that may only yaw into a refused pitch edit).
   */
  _formatPose(el) {
    const pos = el.getAttribute('position');
    const rot = el.getAttribute('rotation');
    const p = (v) => quantise(v, POSITION_DECIMALS);
    return {
      position: `${p(pos.x)} ${p(pos.y)} ${p(pos.z)}`,
      rotation: `${rot.x} ${quantise(rot.y, YAW_DECIMALS)} ${rot.z}`
    };
  }

  startDrag(axis, event) {
    if (!this.el || !this.object) return false;
    // Recorded so the commit can refuse to fire against an entity that changed
    // underneath the gesture.
    this.dragEl = this.el;
    this.dragObject = this.object;
    this.dragSnapshot = this._formatPose(this.el);
    this._dodgeHeld = null;
    if (this._policy) this._holdPivot();

    if (this._isLandingAxis(axis)) {
      const targetY =
        axis === 'landingUp' ? this.landingUpY : this.landingDownY;
      if (targetY === null) {
        this.dragSnapshot = null;
        return false;
      }
      // Freezing the target set is what gives "the target that was pressed" an
      // identity. Without it the probe keeps running under a held press, so a
      // tile streaming in can put a nearer surface between the object and the
      // pressed one — the pointer is still over A target, and the release
      // commits to a destination the user never pressed.
      this._landingPress = {
        axis,
        y: targetY,
        armed: true,
        entity:
          axis === 'landingUp' ? this._landingUpEntity : this._landingDownEntity
      };
      return;
    }

    if (axis === 'vertical') {
      this.object.getWorldPosition(this._dragStartWorld);
      this._dragVerticalPoint.copy(this._pickPoint);
      const along = this._verticalRayAlong();
      if (along === null) return false;
      this._dragVerticalAlongStart = along;
      this._refreshSupport();
      return;
    }

    // The drag plane is horizontal and fixed for the whole gesture, at the
    // object's BASE — the height the square is drawn at, so the handle and the
    // surface it slides on are the same thing.
    const baseY = this.currentBaseY();
    _v2.set(_p.x, baseY, _p.z);
    this.dragPlane.setFromNormalAndCoplanarPoint(UP, _v2);
    this.dragConstrained = this.flat;
    if (!this.dragConstrained && !this.intersectPlane(this.dragPlane, _v)) {
      this.dragSnapshot = null;
      return false;
    }

    // Latched before the axis branches, because rotation returns early.
    if (this.dragConstrained) _v.copy(_v2);
    if (this.dragConstrained) this.cameraRight(this.shallowDir);
    this._dragStartMouseX = this.mouse.x;
    // Frozen for the gesture: a mouse-locked drag has to hold its scale to stay
    // locked, and the drag runs along camera-right, which cannot change the
    // object's depth — so latching it is exact rather than an approximation.
    this._dragMpp = this._mpp;

    if (axis === 'rotate') {
      this._measureRotateLever();
      const centre = this._pivotHeld ? this._pivotWorld : _p;
      this.rotatePrevAngle = Math.atan2(_v.x - centre.x, _v.z - centre.z);
      this.rotateAccum = 0;
      this.rotateStartYawDeg = this.el.getAttribute('rotation').y;
      return;
    }

    this.grabOffset.set(_p.x - _v.x, 0, _p.z - _v.z);
    this.dragStartXZ.set(_p.x, 0, _p.z);
    this._lastProcessedXZ = { x: _p.x, z: _p.z };
    this._pendingXZ = null;
    if (this._followsGround()) this._seedDragReference(baseY);
  }

  /**
   * The support the drag follows and the clearance it preserves above it,
   * from a fresh probe beneath the object. Taken at the press, and again once
   * tiles the press un-flattened have regenerated: until then the probe
   * withholds tile support, so a flattened street pressed over tiles would
   * otherwise carry its own plateau as the reference for the whole gesture
   * and read every sample of real terrain as a step.
   */
  _seedDragReference(baseY) {
    this._refreshSupport();
    if (this.supportY === null) {
      // No support at all under the object is a reachable state; treat its own
      // base as its support and carry no clearance, so it holds its height and
      // offers nothing rather than misbehaving.
      this.dragSupportY = baseY;
      this.dragClearance = 0;
    } else {
      this.dragSupportY = this.supportY;
      this.dragClearance = Math.max(0, baseY - this.supportY);
    }
  }

  /** Cursor ray against the fixed drag plane, with degenerate solves rejected. */
  solvePlane(out) {
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) < PARALLEL_EPSILON) return false;
    if (this.intersectPlane(this.dragPlane, out)) return true;
    if (ray.direction.y >= 0) {
      // The cursor is over the sky, or the camera is pitched up so the plane
      // lies behind the ray at every screen position. Same case: place at a
      // capped distance toward the horizon so the object still tracks the
      // gesture's direction.
      _v2.copy(ray.direction);
      _v2.y = 0;
      if (_v2.lengthSq() < 1e-8) return false;
      _v2.normalize().multiplyScalar(HORIZON_CAP_METRES);
      out.copy(ray.origin).add(_v2);
      return true;
    }
    return false;
  }

  /**
   * Is this gesture using the flattened, screen-space model?
   *
   * Every latch it depends on has to be real. Zero pixels-per-radian is the
   * did-not-run sentinel for the rotation lever, and refusing on it sends the
   * gesture to the bounded ground-plane model instead of dividing by nothing.
   */
  _useShallowPointerModel() {
    if (!this.dragConstrained || !(this._dragMpp > 0)) return false;
    if (this.axis === 'rotate') return this._dragRotPxPerRad !== 0;
    return true;
  }

  /** Horizontal cursor travel since the press, in screen pixels. */
  _shallowDragPixels() {
    const rect = this._canvasRect();
    return ((this.mouse.x - this._dragStartMouseX) * rect.width) / 2;
  }

  /** Measure pixels per radian at the arm join; see docs/easy-gizmo.md#projected-rotation-lever. */
  _measureRotateLever() {
    this._dragRotPxPerRad = 0;
    this._dragRotPxPerRadCap = 0;
    if (!this._pickHit) return;

    this.arcGroup.getWorldPosition(_rotCentre);
    _rotGrab.subVectors(this._pickPoint, _rotCentre);
    const azimuth = Math.atan2(_rotGrab.x, _rotGrab.z);
    _rotGrab.applyAxisAngle(UP, this._shallowArcYaw - azimuth);

    const at = (offset) => {
      _rotProbe.copy(offset).add(_rotCentre);
      const before = this._screenX(_rotProbe);
      _rotProbe
        .copy(offset)
        .applyAxisAngle(UP, ROTATE_LEVER_PROBE_RAD)
        .add(_rotCentre);
      const after = this._screenX(_rotProbe);
      if (before === null || after === null) return 0;
      return (after - before) / ROTATE_LEVER_PROBE_RAD;
    };

    const here = at(_rotGrab);
    // A quarter turn round the ring, where the sinusoid is at its other phase,
    // so the two samples' hypotenuse is the widest lever anywhere on it.
    _rotQuarter.copy(_rotGrab).applyAxisAngle(UP, Math.PI / 2);
    const quarter = at(_rotQuarter);
    const cap = Math.hypot(here, quarter);
    if (!(cap > 1e-6)) return;

    this._dragRotPxPerRadCap = cap;
    const floor = cap * ROTATE_LEVER_FLOOR_FRAC;
    // The sign comes from the measurement, so a press on the far side of the
    // ring inverts correctly rather than by accident.
    this._dragRotPxPerRad =
      Math.abs(here) < floor ? Math.sign(here || 1) * floor : here;
  }

  /** A world point's horizontal screen position, in pixels from the centre. */
  _screenX(worldPoint) {
    const rect = this._canvasRect();
    if (!rect) return null;
    _rotProject.copy(worldPoint).project(this.camera);
    return (_rotProject.x * rect.width) / 2;
  }

  /** Offset along the latched world-Y axis closest to the current pointer ray. */
  _verticalRayAlong() {
    const ray = this.raycaster.ray;
    _delta.subVectors(ray.origin, this._dragVerticalPoint);
    const a = ray.direction.lengthSq();
    const b = ray.direction.dot(UP);
    const d = ray.direction.dot(_delta);
    const e = UP.dot(_delta);
    const denominator = a - b * b;
    if (!(denominator > 1e-6)) return null;
    return (a * e - b * d) / denominator;
  }

  /**
   * What a pointer move does, by axis.
   *
   * Rotation and the landing squares resolve immediately, because neither casts
   * a ray into the scene. A translate only records where the cursor now is: its
   * probe budget is spent once per rendered frame, so several pointer events
   * inside one frame accumulate into one larger step rather than two advances.
   */
  _trackDrag(event) {
    if (this._isLandingAxis(this.axis)) {
      if (!this._landingPress) return;
      // The highlight tracks pointer-over live, so moving away visibly disarms
      // the button and returning re-arms it.
      const hit = this.pickAxis();
      const armed = hit === this._landingPress.axis;
      if (armed !== this._landingPress.armed) {
        this._landingPress.armed = armed;
        this.highlight(this.axis);
      }
      return;
    }
    if (this.axis === 'vertical') {
      const along = this._verticalRayAlong();
      if (along === null) return;
      this.setWorldPosition(
        this._dragStartWorld.x,
        this._dragStartWorld.y + along - this._dragVerticalAlongStart,
        this._dragStartWorld.z
      );
      if (this._followsGround()) {
        const baseY = this.currentBaseY();
        this._applyColumn(resplitColumn(this.probe.lastHits, baseY), baseY);
      }
      this.dispatchEvent(this.changeEvent);
      this.dispatchEvent(this.objectChangeEvent);
      return;
    }
    if (this.axis === 'rotate') {
      this.moveRotate();
      return;
    }
    if (this.axis !== 'move') return;
    if (this._useShallowPointerModel()) {
      // Direct screen travel avoids a grazing plane ray amplifying vertical motion.
      const k = this._shallowDragPixels() * this._dragMpp;
      this._pendingXZ = {
        x: this.dragStartXZ.x + this.shallowDir.x * k,
        z: this.dragStartXZ.z + this.shallowDir.z * k
      };
      return;
    }
    if (!this.solvePlane(_v)) return;
    this._pendingXZ = {
      x: _v.x + this.grabOffset.x,
      z: _v.z + this.grabOffset.z
    };
  }

  moveRotate() {
    if (this._useShallowPointerModel()) {
      // Rack and pinion: constant cursor speed gives constant rotation speed,
      // calibrated so the mouse and the ring's tangent move together at the
      // join. Absolute from the press rather than accumulated, so a long
      // gesture cannot drift and returning the cursor returns the object.
      //
      // The grabbed point therefore falls BEHIND through a large turn — about a
      // fifth by sixty degrees — because the lever is exact at the press and
      // decays with the cosine of the ring angle. That is the design, not a
      // defect to be found later: tracking it exactly needs an arcsin, which
      // cannot track past a quarter turn from the near point at all.
      this.rotateAccum = this._shallowDragPixels() / this._dragRotPxPerRad;
    } else {
      if (!this.solvePlane(_v)) return;
      const centre = this._pivotHeld
        ? this._pivotWorld
        : this.object.getWorldPosition(_p);
      const ang = Math.atan2(_v.x - centre.x, _v.z - centre.z);
      // Accumulated across the half turn, so a full turn does not snap back.
      let d = ang - this.rotatePrevAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.rotateAccum += d;
      this.rotatePrevAngle = ang;
    }

    const rot = this.el.getAttribute('rotation');
    const yawDeg = this.rotateStartYawDeg + (this.rotateAccum * 180) / Math.PI;
    const yaw = quantise(yawDeg, YAW_DECIMALS);
    this.el.setAttribute('rotation', { x: rot.x, y: yaw, z: rot.z });
    if (this._pivotHeld) this._orbitPivot(rot, yaw);
    this.dispatchEvent(this.changeEvent);
    this.dispatchEvent(this.objectChangeEvent);
  }

  /**
   * Keep the held pivot still through a turn to `yaw` degrees: the origin
   * orbits it. From the rounded yaw, the one written, so returning to the
   * start angle returns the position exactly.
   */
  _orbitPivot(rot, yaw) {
    _qNow.setFromEuler(_e.set(rot.x * DEG, yaw * DEG, rot.z * DEG, 'YXZ'));
    this._policy.positionForRotation(
      this._posStart,
      this._quatStart,
      _qNow,
      this._pivotParent,
      _v2
    );
    this.el.setAttribute('position', {
      x: quantise(_v2.x, POSITION_DECIMALS),
      y: quantise(_v2.y, POSITION_DECIMALS),
      z: quantise(_v2.z, POSITION_DECIMALS)
    });
  }

  /**
   * One frame's worth of translation, and the only place the probe budget is
   * spent.
   */
  _advance() {
    if (!this.isDragging || this.axis !== 'move' || !this._pendingXZ) return;
    const target = this._pendingXZ;
    this._pendingXZ = null;
    if (this._dragReferencePending && !this.probe.hasPendingRegeneration()) {
      this._dragReferencePending = false;
      this._seedDragReference(this.currentBaseY());
    }
    const baseY = this.currentBaseY();
    const startY = _p.y;
    if (!this._followsGround()) {
      // Held at its height: no ground to follow and no landing to offer.
      this.setWorldPosition(target.x, startY, target.z);
      this._lastProcessedXZ = { x: target.x, z: target.z };
      this.dispatchEvent(this.changeEvent);
      this.dispatchEvent(this.objectChangeEvent);
      return;
    }
    const result = evaluatePath({
      from: this._lastProcessedXZ,
      to: target,
      fromSupportY: this.dragSupportY,
      probeAt: this._probeAt,
      // Zero interior samples is the endpoint-only build, which is what the
      // paired negative of a drive needs.
      budget: this.pathEvaluationEnabled ? PATH_PROBE_BUDGET : 0,
      substep: this.pathEvaluationEnabled ? undefined : Infinity
    });

    let newY = startY;
    if (result.continuous && result.supportY !== null) {
      // Track the support, preserving the clearance captured at the press.
      this.dragSupportY = result.supportY;
      newY = startY + (result.supportY + this.dragClearance - baseY);
    }
    // Otherwise hold the absolute height AND leave the remembered support where
    // it is: advancing it on a frame the object did not follow would let an
    // object floating over a drop silently re-latch onto whatever passed
    // beneath it.
    this.setWorldPosition(target.x, newY, target.z);
    this._lastProcessedXZ = { x: target.x, z: target.z };

    // What is DRAWN is not the latch. The remembered support is deliberately
    // frozen on a frame that did not follow — but a frozen support is exactly
    // what a floating object does not have beneath it, so driving the display
    // from it would compute the clearance against a surface that is no longer
    // there and suppress the downward target for the rest of the gesture.
    // Re-split the endpoint's own hit list about the new base instead, which
    // costs no extra ray.
    const newBaseY = this.currentBaseY();
    this._applyColumn(resplitColumn(this.probe.lastHits, newBaseY), newBaseY);

    this.dispatchEvent(this.changeEvent);
    this.dispatchEvent(this.objectChangeEvent);
  }

  setWorldPosition(x, y, z) {
    _v2.set(x, y, z);
    const parent = this.object.parent;
    // The gizmo reasons in world space and commits parent-local values, so the
    // conversion is required: a parent may be scaled, and an imported parent
    // may carry pitch or roll.
    if (parent) parent.worldToLocal(_v2);
    this.el.setAttribute('position', {
      x: quantise(_v2.x, POSITION_DECIMALS),
      y: quantise(_v2.y, POSITION_DECIMALS),
      z: quantise(_v2.z, POSITION_DECIMALS)
    });
  }

  _restore(snapshot) {
    if (!snapshot || !this.el) return;
    const [px, py, pz] = snapshot.position.split(' ').map(Number);
    const [rx, ry, rz] = snapshot.rotation.split(' ').map(Number);
    this.el.setAttribute('position', { x: px, y: py, z: pz });
    this.el.setAttribute('rotation', { x: rx, y: ry, z: rz });
  }

  /**
   * The single way out of a gesture.
   *
   * Pointer release commits; mouseleave commits the last tracked move/rotation.
   * Cancellation, blur, Escape, selection/geometry change and editor close restore.
   */
  endGesture(reason, event) {
    const snapshot = this.dragSnapshot;
    const dragEl = this.dragEl;
    const dragObject = this.dragObject;
    const axis = this.axis;
    const landing = this._landingPress;

    this.isDragging = false;
    this._pivotHeld = false;
    // The selection's own flattening comes back on every exit, commit or
    // cancel: the terrain re-flattens around wherever the item ended up.
    this.probe.setFlatteningSuspended(false);
    this._dragReferencePending = false;
    this.dragSnapshot = null;
    this.dragEl = null;
    this.dragObject = null;
    this.dragConstrained = false;
    this._landingPress = null;
    this._releasePending = null;
    this._pendingXZ = null;
    this._arcFollowFrom = null;

    // Cleared before the capture is released, because releasing a capture for a
    // pointer that is already gone throws — and that is precisely the lost
    // pointer case the capture exists for.
    const canvas = this._canvas();
    if (this._pointerId !== null && canvas && canvas.releasePointerCapture) {
      try {
        canvas.releasePointerCapture(this._pointerId);
      } catch {
        // The pointer is already gone; nothing to release.
      }
    }
    this._pointerId = null;
    this._captureLost = false;

    this.dispatchEvent(this.mouseUpEvent);
    if (this._lastPointerType !== 'mouse') {
      this.axis = null;
      this.dispatchEvent({ type: 'axisHoverChange', axis: null });
    }
    this.highlight(this.axis);

    if (!this.el || !snapshot) return;
    if (this.el !== dragEl || this.object !== dragObject) return;

    const commits = reason === 'pointerup' || reason === 'mouseleave';
    if (!commits) {
      this._restore(snapshot);
      this.dispatchEvent(this.changeEvent);
      this.dispatchEvent(this.objectChangeEvent);
      return;
    }

    if (this._isLandingAxis(axis)) {
      // A landing square is a button: it commits only if the release happens
      // with the pointer still over the target that was pressed, and a release
      // anywhere else cancels with no movement and no undo entry.
      if (!landing || !landing.armed || reason !== 'pointerup') return;
      if (landing.entity && landing.entity.isConnected === false) return;
      const baseY = this.currentBaseY();
      if (landing.entity) {
        const column = this.probe.probeColumn(_p.x, _p.z, baseY);
        const target = axis === 'landingUp' ? column.above : column.below;
        if (
          !target ||
          target.entity !== landing.entity ||
          Math.abs(target.y - landing.y) > 0.001
        ) {
          return;
        }
      }
      // X, Z and yaw are unchanged; the base comes to rest on the surface.
      this.setWorldPosition(_p.x, _p.y + (landing.y - baseY), _p.z);
      if (landing.entity) {
        this._applyColumn(
          resplitColumn(this.probe.lastHits, this.currentBaseY()),
          this.currentBaseY()
        );
      } else {
        this._refreshSupport();
      }
    }

    const pose = this._formatPose(this.el);
    this.dispatchEvent({
      type: 'commitDrag',
      entity: this.el,
      // Three gesture kinds need three labels: a rotate-only gesture committed
      // through this same path would otherwise be listed as a move.
      name: this._isLandingAxis(axis)
        ? 'place'
        : axis === 'rotate'
          ? 'rotate'
          : 'move',
      changes: [
        {
          component: 'position',
          value: pose.position,
          oldValue: snapshot.position
        },
        {
          component: 'rotation',
          value: pose.rotation,
          oldValue: snapshot.rotation
        }
      ]
    });
  }
}

export { EasyGizmoControls };
