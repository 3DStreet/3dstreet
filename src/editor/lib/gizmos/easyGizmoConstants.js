// Every number the easy gizmo mints, in one place, so the pure maths beside it
// stays free of magic values and a tuning change is a one-line edit here.
// Values borrowed from another subsystem are NOT re-exported: where the easy
// gizmo happens to want the same figure a neighbour uses, it owns its own
// constant, because the neighbour's is documented against a different quantity
// and would move if that quantity were retuned.

// --- continuity (the object follows the ground, and never leaps) ---------

/**
 * The flat term of the continuity allowance, in metres: how big a step up or
 * down the object will follow at any drag speed.
 *
 * It has to be a height rather than a slope, because a kerb is a VERTICAL face
 * — the support jumps by the kerb's height in one frame however slowly the
 * cursor moves. 0.35 m clears the tallest shipped street level (0.30 m) and
 * sits far below building scale.
 */
export const STEP_METRES = 0.35;

/**
 * The steepest surface the object will follow, as a tangent. Above it the
 * surface is not continuous with the object's support and the object holds its
 * height and passes inside.
 */
export const FOLLOW_TAN = Math.tan(Math.PI / 3); // 60 degrees

/**
 * The spacing, in metres, at which a frame's travel is sampled for continuity.
 *
 * Derived rather than chosen: at exactly this sub-span the two-term allowance
 * `max(STEP, FOLLOW_TAN * d)` collapses to `STEP`, and at any shorter sub-span
 * the slope term is smaller still. So the criterion at every judged sub-span is
 * a HEIGHT — independent of sub-span length, and therefore of drag speed, which
 * is the property the whole rule exists to deliver.
 */
export const SUBSTEP_METRES = STEP_METRES / FOLLOW_TAN;

/**
 * Interior probes a single frame may cast. The gizmo's peak per-frame ray count
 * must not exceed the largest the product already ships on the same scenes and
 * the same pruned target list, which is the WASD flight frame's 13; this budget
 * plus the endpoint look-ahead every multi-sample frame casts first, plus the
 * endpoint probe that closes the sampled chain, comes to exactly that.
 *
 * The look-ahead settles most frames on its own (#2059): a destination level
 * with the remembered support is continuous on that one ray at any pointer
 * speed, and only a rise or drop of more than a step samples the interior. A
 * frame demanding more than the budget is declared discontinuous unless that
 * one ray settled it, and casts NO interior probe at all — with no early stop
 * the outcome is fixed before the first ray, so spending the budget on it
 * would buy nothing. Holding height can withhold a step; it can never invent
 * a leap.
 */
export const PATH_PROBE_BUDGET = 11;

// --- the column probe ----------------------------------------------------

/**
 * How far above the object's base the downward probe starts, in metres.
 *
 * It must exceed anything the object could step up onto, or a ray started just
 * above the base begins BELOW a kerb top and the kerb never enters the hit
 * list — leaving an object able to step down and never up.
 */
export const PROBE_UP_MARGIN_METRES = 500;

/**
 * How often the column is re-probed while the gizmo is shown and nothing is
 * moving, in milliseconds. It exists for geometry streaming in under a
 * stationary object, which resolves over seconds; anything faster is a
 * permanent cost on the one scene class where each ray is the expensive one.
 */
export const IDLE_PROBE_INTERVAL_MS = 1000;

// --- the two view regimes ------------------------------------------------

/**
 * Elevation angle, in degrees, below which a subsystem takes its flattened
 * presentation. Measured from the camera to that subsystem's own anchor, not
 * from the camera's pitch: the angle to a drawn element IS its foreshortening,
 * which is what the regime responds to.
 */
export const REGIME_ENTER_BELOW_DEG = 10;

/** The matching leave angle. The pair is what stops the presentation chattering
 * at the boundary. */
export const REGIME_LEAVE_ABOVE_DEG = 12;

/**
 * The plain threshold a subsystem seeds itself with when it is created — the
 * midpoint of the hysteresis pair. A subsystem that came into existence part
 * way through a drag has no previous state to latch from, and must arrive in
 * the right shape rather than animate into it.
 */
export const REGIME_SEED_DEG =
  (REGIME_ENTER_BELOW_DEG + REGIME_LEAVE_ABOVE_DEG) / 2;

/**
 * How long a regime change takes, in milliseconds. Long enough to read as one
 * control changing shape rather than two controls swapping.
 */
export const REGIME_TRANSITION_MS = 500;

// --- sizing --------------------------------------------------------------

/** The screen limb of the square's sizing law, in CSS pixels. */
export const SQUARE_TARGET_PX = 96;

/** The world limb of the square's sizing law, in metres. The drawn size is the
 * geometric mean of the two, which is a fixed exponent in camera distance and
 * therefore self-similar at every scale — where an arithmetic mean would be a
 * `max` in disguise that switches regime mid-range. */
export const SQUARE_TARGET_METRES = 1.5;

/** Sanity clamps on the drawn square, deliberately far outside any working
 * zoom. Their job is to bound a degenerate metres-per-pixel, not to reintroduce
 * a world-size cap. */
export const SQUARE_MIN_METRES = 0.02;
export const SQUARE_MAX_METRES = 500;

/** Minimum drawn thickness of the arc's tube, in CSS pixels. This is what keeps
 * the arc visible at extreme zoom-out; read as device pixels it would be half
 * the intended width on a HiDPI display. */
export const ARC_MIN_TUBE_PX = 3;

// --- the flattened presentation and its dodge rules ----------------------
//
// Every threshold below is a fraction of S, the drawn square's world size,
// because S runs about 1.5 m at an 8 m camera to 6.3 m at 150 m. Written in
// metres these would fire at the right moment at exactly one zoom.

/**
 * Hysteresis on the choice of the arc's side, as a fraction of the room on the
 * side it is on: the arc moves only once the other side has this much more.
 * Without it the arc jumps back and forth as an object crosses a kerb between
 * two surfaces. Relative rather than absolute because the room scales with S.
 */
export const DODGE_HYSTERESIS_FRAC = 0.15;

// --- landing targets -----------------------------------------------------

/**
 * The gap, in metres, above which a landing target appears, and the gap below
 * which it disappears. A tolerance rather than a threshold: an object out by
 * less than the lower figure is treated as placed, and one out by more than the
 * upper always offers correction. Appearing at the higher and vanishing at the
 * lower is the way round that has a stable state between them.
 */
export const LANDING_SHOW_GAP_METRES = 0.1;
export const LANDING_HIDE_GAP_METRES = 0.05;

/** Outline stroke of a landing target, as a fraction of its side. */
export const LANDING_OUTLINE_FRAC = 0.08;

/**
 * The move square's side in the round presentation, as a fraction of S.
 * Chosen. The landing outline's interior is 0.84 S (`1 − 2 ·
 * LANDING_OUTLINE_FRAC`), so 0.79 leaves an empty band of 0.025 S each side,
 * which is what keeps an outline close underneath from reading as part of a
 * bigger square; 0.84 closes it.
 */
export const MOVE_PLATE_ROUND_FRAC = 0.79;

/** Height of a landing outline once it has flattened, as a fraction of its
 * width. Matches the move strip's narrowness so the two flattened controls read
 * as the same visual language. */
export const LANDING_BAR_HEIGHT_FRAC = 0.22;

/** Target spacing of the chevron stack along the gap, as a fraction of S, and
 * the cap on how many are drawn. The spacing is a target: the real step divides
 * the span, so the stack reaches the whole way however far that is. */
export const CHEVRON_SPACING_FRAC = 0.5;
export const CHEVRON_MAX = 8;

/** One full slide of the chevron stack on hover, in milliseconds. */
export const CHEVRON_CYCLE_MS = 900;

/** Chevron dimensions as fractions of the move-square side, keeping the
 * landing cue proportional to the control at every zoom level. */
export const CHEVRON_BASE_FRAC = 0.25;
export const CHEVRON_LEN_FRAC = 0.2;

// --- drag models ---------------------------------------------------------

/**
 * Where the object is placed when the cursor ray never meets the drag plane —
 * over the sky, or with the camera pitched up. Past anything a street scene
 * contains, so it bounds a degenerate solve rather than being a behaviour
 * anyone meets.
 */
export const HORIZON_CAP_METRES = 200;

/** Below this the cursor ray is treated as parallel to the drag plane and the
 * object holds its last valid position. */
export const PARALLEL_EPSILON = 1e-4;

/**
 * How small the measured rotation lever may get before it is floored, as a
 * fraction of its largest value anywhere on the ring.
 *
 * The lever falls with the cosine of the object's angle off the view axis and
 * reaches zero only at 90 degrees, which is off screen — so the floor never
 * binds in practice and exists so a degenerate camera divides by something
 * bounded. Exported rather than inlined because the rotate-lever suite asserts
 * equality against it, and a test reading a literal would pass against a build
 * that had changed the fraction.
 */
export const ROTATE_LEVER_FLOOR_FRAC = 0.3;

/** The test angle, in radians, the rotate lever is measured over. Small enough
 * that the chord agrees with the tangent, large enough to stay clear of float
 * noise in the projection. */
export const ROTATE_LEVER_PROBE_RAD = 1e-3;

// --- drawing -------------------------------------------------------------

export const COLOR_MOVE = 0xffd633;
export const COLOR_ROTATE = 0x33e0ff;

/**
 * The four emphasis levels, as apparent opacity. Every gizmo surface draws
 * front faces only where it is solid, so each composites exactly once and the
 * apparent opacity IS the material alpha.
 *
 * Hover is a step within the translucent range rather than a jump to solid, so
 * every surface has to rest below it. `ACTION` is what an element that DEPICTS
 * the pending action goes to — the chevron stack, which is the picture of what
 * pressing will do and so the most informative thing on screen while its
 * control is engaged.
 */
export const OPACITY_REST = 0.45;
export const OPACITY_HOVER = 0.65;
export const OPACITY_DIM = 0.25;
export const OPACITY_ACTION = 0.85;

/** Added across the flattened presentation: a narrow shape reads lighter than a
 * broad one at the same opacity, and the strip narrows to a fifth of its
 * width. */
export const OPACITY_FLAT_BOOST = 0.1;

/** Render order the gizmo draws at. Everything is `depthTest: false`, so this
 * is what puts it over the scene; the chevron stack takes the higher value
 * because it runs straight through the move square. */
export const RENDER_ORDER_BASE = 210;
export const RENDER_ORDER_CHEVRON = 215;

// --- arc geometry --------------------------------------------------------
//
// All lengths are in units of the ring's radius, which is 1 in the arm frame,
// so an arc length is an angle.

export const ARC_RADIAL_SEGMENTS = 8;
export const ARC_TUBULAR_SEGMENTS = 32;
export const ARC_TUBE_RADIUS = 0.05;
export const ARC_HEAD_RADIUS = 0.16;
export const ARC_HEAD_LEN = 0.4;

/** How far a head sits beyond the end of its tube, so the two abut rather than
 * overlap. */
export const ARC_HEAD_OFFSET_DEG = (ARC_HEAD_LEN / 2) * (180 / Math.PI);

/** Each half's sweep. The pair leaves a gap on the object's front; shortening
 * each half by exactly the head offset keeps the tip-to-tip gap where it was
 * when the heads were moved outward. */
export const ARC_HALF_SWEEP_DEG = 150 - ARC_HEAD_OFFSET_DEG;
export const ARC_FULL_SWEEP_DEG = 2 * ARC_HALF_SWEEP_DEG;
export const ARC_STEP_DEG = ARC_HALF_SWEEP_DEG / ARC_TUBULAR_SEGMENTS;

/**
 * The retracted sweep, 30 degrees per arm and 60 across the pair.
 *
 * QUANTISED TO A WHOLE TUBULAR STEP, and it has to be: the retracted length is
 * drawn with setDrawRange, which can only stop on a step boundary, while the
 * arm yaw that brings the two tails together is continuous. A target that is
 * not a multiple of the step parks each arm where its tail cannot reach, and
 * leaves a notch dead centre of the arrow.
 */
export const ARC_FLAT_SWEEP_DEG = Math.round(30 / ARC_STEP_DEG) * ARC_STEP_DEG;

/** Quarter-tube-width picking slack on each side keeps nearby landing targets reachable. */
export const ARC_PICK_WIDTH_MULT = 1.5;

// Vertical control dimensions are fractions of the screen-scaled gizmo size,
// independent of object bounds. Near overhead, Y motion is not observable.
export const VERTICAL_HIDE_ABOVE_DEG = 70;
export const VERTICAL_CENTRE_ABOVE_PAD_FRAC = 1.8;
export const VERTICAL_SHAFT_LENGTH_FRAC = 1.4;
export const VERTICAL_SHAFT_WIDTH_FRAC = 0.12;
export const VERTICAL_HEAD_LENGTH_FRAC = 0.28;
export const VERTICAL_HEAD_BASE_FRAC = 0.34;
export const VERTICAL_PICK_WIDTH_FRAC = 0.5;
export const VERTICAL_PICK_LENGTH_FRAC = 2.1;

/** Ring radius as a multiple of S, in each presentation. A flat ring seen from
 * a near-horizontal camera is foreshortened to a shallow bow, so the flattened
 * radius carries both the curvature and the reach out in front of the object. */
export const ARC_ROUND_RADIUS_FRAC = (1.3 * Math.SQRT2) / 2;
export const ARC_FLAT_RADIUS_FRAC = 1.5;

/** Visible gap between the flattened arc and the underside of the move strip,
 * on top of the two half-thicknesses. */
export const ARC_FLAT_CLEAR_FRAC = 0.04;

// --- the move square's arrowheads ---------------------------------------

export const HEAD_BASE_FRAC = 0.2;
export const HEAD_LEN_FRAC = 0.14;
export const HEAD_BASE_FLAT_FRAC = 0.4;
export const HEAD_LEN_FLAT_FRAC = 0.28;

/** The flattened strip's extents, as fractions of S. */
export const STRIP_LEN_FRAC = 2.2;
export const STRIP_NARROW_FRAC = 0.22;

// --- edges and derived dodge extents -------------------------------------

/**
 * Draw orders for a landing target, chosen per frame so that where a target
 * and the move handle overlap on screen, the one drawn on top is the one a
 * press there would hit. A target on the camera's side of the handle's plane is
 * nearer along any ray through both, so it is drawn over the handle and the
 * arc; one on the far side is drawn beneath them. A flattened target stands in
 * the handle's own plane, where the arc is nearer, so it is always beneath.
 */
export const RENDER_ORDER_LANDING_NEAR = RENDER_ORDER_BASE + 6;
export const RENDER_ORDER_LANDING_FAR = RENDER_ORDER_BASE - 1;

/**
 * The part of the flattened arc's parallax that its world clearance already
 * absorbs, as a fraction of S. The lift is the rest. Chosen: no larger than the
 * smallest value that keeps the arc clear of the move handle anywhere measured.
 */
export const ARC_LIFT_SLACK_FRAC = 0.05;

/**
 * Upper bound, in degrees, on the elevation the flattened arc's lift is
 * computed from. The flattened presentation is held for a drag while the camera
 * or the object can keep moving, so the elevation can grow far past the
 * flattened range; the lift grows with its tangent, and without a bound it can
 * carry the arc out of view. The bound only keeps the lift finite. A drag held
 * flat past about 25° can still put the arc across the move handle.
 */
export const ARC_LIFT_MAX_DEG = 30;

/**
 * Whether the flattened arc is lifted away from the move handle whichever side
 * of it the camera is on (true), or only when the camera and the arc are on
 * the same side of the strip (false).
 *
 * At rest only the same-side case needs it: the flat ring's near edge is drawn
 * toward the handle from that side and away from it from the other. During a
 * rotate drag, though, the ring turns with the object and its far points can
 * come back across the handle from either side, so lifting on both sides keeps
 * more clearance while rotating. The cost is that in the commonest low view,
 * camera above with the arc below the strip, the arc sits noticeably further
 * below the strip than it needs to at rest.
 */
export const ARC_LIFT_SYMMETRIC = true;

/** The yellow parts' edge colour: near-black rather than pure black, so it
 * reads as an outline and not as a second fill. */
export const EDGE_COLOR = 0x111111;

/** The edge's width, in CSS pixels: visible against pale ground at a glance,
 * while staying well inside the thinnest yellow stroke it outlines, a far
 * landing outline at about 3 px. */
export const EDGE_PX = 1.5;

/** The edge's opacity as a fraction of its part's. It fades with the part and
 * stays a little lighter than it, so emphasis is still only an opacity change,
 * and a dimmed part's edge dims too. */
export const EDGE_OPACITY_RATIO = 0.8;

/** How face-on a chevron must be seen, as the cosine between its plane's
 * normal and the view ray, before its edge starts to show. Below this it is
 * close enough to edge-on that an outline would draw over it rather than
 * around it. */
export const EDGE_FACING_HIDE = 0.2;

/** The facing at which a chevron's edge is fully shown; it fades in smoothly
 * from `EDGE_FACING_HIDE`, so orbiting past the threshold does not pop. */
export const EDGE_FACING_FULL = 0.5;

/** Caps the edge's offset on a side seen nearly edge-on, where the on-screen
 * distance per metre of offset tends to zero. */
export const EDGE_MAX_STRETCH = 4;

/** Below every gizmo fill, so an edge that falls under a neighbouring part is
 * covered by it rather than drawn across it. */
export const RENDER_ORDER_EDGE = RENDER_ORDER_BASE - 3;

// --- commit --------------------------------------------------------------

/** Decimal places the gizmo quantises to before writing a transform back.
 * Matching the two nearest neighbours; applied identically to the mouse-down
 * snapshot and the release value, which is what makes a gesture that changes
 * nothing produce no undo entry. */
export const POSITION_DECIMALS = 3;
export const YAW_DECIMALS = 2;
