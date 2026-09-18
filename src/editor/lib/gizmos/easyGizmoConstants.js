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
 * plus the one endpoint probe every frame casts anyway comes to exactly that.
 *
 * A frame demanding more is declared discontinuous and casts NO interior probe
 * at all — with no early stop the outcome is fixed before the first ray, so
 * spending the budget on it would buy nothing. Holding height can withhold a
 * step; it can never invent a leap.
 */
export const PATH_PROBE_BUDGET = 12;

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

/** Half the flattened strip's height, as a fraction of S. Also the closest the
 * handle may be shifted to a landing bar. */
export const STRIP_HALF_FRAC = 0.11;

/** How far from the base the arc starts, as a fraction of S — and therefore the
 * scale at which a bar crowds the strip. */
export const ARC_NEAR_FRAC = 0.15;

/** How far from the base the arc reaches, as a fraction of S. A bar beyond it
 * cannot be under the arc whichever side the arc takes, which is what makes it
 * the right threshold for the flip rule. */
export const ARC_REACH_FRAC = 0.47;

/**
 * Hysteresis band on each dodge threshold, as a fraction of the threshold: a
 * rule engages at its own figure and disengages at that figure plus this much.
 * Without a pair the handle jumps back and forth as an object crosses a kerb.
 * Relative rather than absolute because every threshold here scales with S.
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

/** Hit region as a multiple of the drawn tube's width — a tube's width of slack
 * either side, because the drawn tube is about 3 px across. */
export const ARC_PICK_WIDTH_MULT = 3;

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

// --- commit --------------------------------------------------------------

/** Decimal places the gizmo quantises to before writing a transform back.
 * Matching the two nearest neighbours; applied identically to the mouse-down
 * snapshot and the release value, which is what makes a gesture that changes
 * nothing produce no undo entry. */
export const POSITION_DECIMALS = 3;
export const YAW_DECIMALS = 2;
