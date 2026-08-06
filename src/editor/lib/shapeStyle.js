// The "sticky style" for shapes: the appearance a newly drawn shape inherits.
//
// Written when the SELECTED shape's `shape` component is written (whoever
// writes it — the properties panel is the usual emitter, but not the only one);
// read by the draw tool. Drawing a shape never changes the sticky style. See
// `docs/shape-sticky-style.md` for the rule, its over-trigger and why it is
// shaped this way.
//
// This module imports NOTHING — no store, no Events, no THREE. That is what
// keeps it unit-testable with no stubbing, and what makes an import cycle
// structurally impossible now that it owns state.

// Retained deliberately despite reading like "last shape drawn" — which is NOT
// the rule (see the doc). The key is the identity of every user's already-
// persisted value; renaming it would silently discard all of them. The per-key
// merge in `normaliseShapeStyle` is no help here — it carries forward a change
// in the stored VALUE's shape (one holding only `lineColor`/`lineWidth`, say),
// and can do nothing about a change of KEY NAME, because the old key is simply
// never read. Fix the name only with a read-old-key migration alongside.
const STORAGE_KEY = 'lastShapeStyle';

// The single definition of "a shape's appearance". Everything else in this file
// — the key set, the defaults, the validation — is derived from it, so adding a
// fifth appearance property is one line rather than three tables to keep in
// agreement.
//
// `closed` and `selectInside` are deliberately absent: `closed` is geometry
// rather than appearance, and `selectInside` is a per-shape escape valve for a
// fill big enough to swallow clicks — neither is something a user expresses as
// a drawing preference.
const SHAPE_STYLE_SPEC = {
  lineColor: { kind: 'color', default: '#ffe600' },
  lineWidth: { kind: 'number', default: 0.15, min: 0 },
  fillColor: { kind: 'color', default: '#ffe600' },
  fillOpacity: { kind: 'int', default: 40, min: 0, max: 100 }
};

const SHAPE_STYLE_KEYS = Object.freeze(Object.keys(SHAPE_STYLE_SPEC));

/**
 * Cold-start appearance, with nothing persisted and nothing recoloured.
 *
 * These four values deliberately MIRROR the `shape` component's schema defaults
 * rather than reading them, so an upstream reader of that schema still sees a
 * literal default in the place A-Frame schemas normally carry one. The two are
 * kept honest by a components-suite test that compares them; change one and
 * that test fails.
 *
 * A trap worth knowing before changing `fillOpacity`: the scene serializer's
 * default-stripping test is `if ((currentValue || defaultValue) && !deepEqual(...))`
 * (`getModifiedProperty`, `json-utils_1.1.js`). A user's explicit `fillOpacity: 0`
 * survives that falsy guard ONLY because the default (40) is truthy. Setting
 * this default to 0 would silently stop saving every user's explicit zero.
 */
export const DEFAULT_SHAPE_STYLE = Object.freeze(
  Object.fromEntries(
    SHAPE_STYLE_KEYS.map((key) => [key, SHAPE_STYLE_SPEC[key].default])
  )
);

// Is `value` usable as a number, judged BEFORE any coercion? Never coerce first
// and check `Number.isFinite` after — see `docs/shape-sticky-style.md`
// (Validation, in one rule) for why that ordering is load-bearing.
function toUsableNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Coerce an arbitrary stored/live value into a complete, valid style object.
 *
 * Per key, in this order: missing → that key's default; not a usable value of
 * its type → that key's default; then coercion (including `int` rounding); then
 * clamping to the schema's range. Per key, never all-or-nothing — that is what
 * makes this the migration as well as the validator: a value persisted with
 * only `lineColor`/`lineWidth` keeps both and picks up default fill.
 *
 * Colours accept any non-empty string, not just hex — `red` and `rgb(1,2,3)`
 * are real live values. See `docs/shape-sticky-style.md` for why a hex test
 * would be wrong.
 *
 * Total: tolerates null/undefined/non-object input and never throws. Always
 * returns a FRESH object — callers keep the result, and `getAttribute` on a
 * multi-prop component hands back the component's live data.
 */
export function normaliseShapeStyle(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of SHAPE_STYLE_KEYS) {
    const spec = SHAPE_STYLE_SPEC[key];
    const value = source[key];
    if (spec.kind === 'color') {
      out[key] =
        typeof value === 'string' && value !== '' ? value : spec.default;
      continue;
    }
    const n = toUsableNumber(value);
    if (n === null) {
      out[key] = spec.default;
      continue;
    }
    let result = spec.kind === 'int' ? Math.round(n) : n;
    if (spec.min !== undefined) result = Math.max(spec.min, result);
    if (spec.max !== undefined) result = Math.min(spec.max, result);
    out[key] = result;
  }
  return out;
}

/**
 * Read and normalise the persisted style.
 *
 * Exported and taking the key as an argument so tests can exercise it directly,
 * without going through `getShapeStyle` and its module-level cache. The
 * `getItem` is deliberately INSIDE the try — storage access can throw outright
 * on disabled storage or in a blocked third-party context.
 *
 * On any failure returns a fresh defaults object (not the frozen
 * `DEFAULT_SHAPE_STYLE` singleton, so every path has one contract).
 */
export function readStoredShapeStyle(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    return normaliseShapeStyle(raw ? JSON.parse(raw) : null);
  } catch {
    return normaliseShapeStyle(null);
  }
}

// The sticky style itself. Read lazily on first use, then cached for the
// session — see getShapeStyle.
let cachedStyle = null;

/**
 * The current sticky style. Reads `localStorage` on the first call and caches
 * in module scope for the rest of the session — so the in-memory value, not
 * storage, is the source of truth after that. See
 * `docs/shape-sticky-style.md` for what that buys and costs.
 *
 * Returns the live cached object by reference. TREAT IT AS READ-ONLY: mutating
 * it would disable `setShapeStyle`'s equality guard and leave memory
 * disagreeing with storage.
 */
export function getShapeStyle() {
  if (cachedStyle === null) cachedStyle = readStoredShapeStyle(STORAGE_KEY);
  return cachedStyle;
}

/**
 * Replace the sticky style. Normalises first, so callers may pass a live
 * `shape` component data object with extra keys. Unchanged values are dropped
 * before touching storage, which makes this idempotent. Never throws, whatever
 * storage does.
 */
export function setShapeStyle(raw) {
  const next = normaliseShapeStyle(raw);
  const previous = getShapeStyle();
  if (SHAPE_STYLE_KEYS.every((key) => previous[key] === next[key])) return;
  cachedStyle = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors (private mode, quota, disabled storage)
  }
}

function isShapeAppearanceProperty(property) {
  return Object.prototype.hasOwnProperty.call(SHAPE_STYLE_SPEC, property);
}

/**
 * Given an `entityupdate` payload and the entity it landed on, the style to
 * seed — or null for "do not seed".
 *
 * THE SNAPSHOT IS READ FROM THE ENTITY, NOT FROM `detail.value` — so the seed
 * is the whole shape rather than the one property that was edited. Do not
 * "simplify" this to `detail.value`; see `docs/shape-sticky-style.md`.
 *
 * Note the payload contract is looser than it looks: `property` and `value` may
 * be absent entirely (some emitters dispatch `entityupdate` directly with only
 * `entity` and `component`), and a whole-component write leaves `property` as
 * an empty string — which is accepted, and is the over-trigger the doc names.
 */
export function shapeStyleSeedFromUpdate(detail, entity) {
  if (detail?.component !== 'shape') return null;
  if (detail.property && !isShapeAppearanceProperty(detail.property)) {
    return null;
  }
  // A component REMOVAL emits a whole-component payload with a null value and
  // then has no attribute left to read; without this bail, undoing an AI-added
  // `shape` component would reset the preference. The `typeof` half matters
  // separately:
  // `AEntity.getAttribute` falls through to `HTMLElement.getAttribute` before
  // the component has initialised and hands back the raw attribute STRING,
  // which `normaliseShapeStyle` would read as an empty source and answer with
  // full cold-start defaults — silently resetting the user's preference.
  const data = entity?.getAttribute('shape');
  if (!data || typeof data !== 'object') return null;
  return normaliseShapeStyle(data);
}
