// Capability markers that restrict what may be done to an entity's transform,
// enforced centrally for every command the editor runs. An entity opts in by
// carrying the attribute; the guard is otherwise entity-type-agnostic.
//
//   data-transform-no-scale     scale must stay unit
//   data-transform-yaw-only     rotation must stay about Y alone
//   data-transform-no-reparent  the entity may not change parent (reordering
//                               WITHIN its current parent is still allowed —
//                               the layers panel does that through the same
//                               reparent command)
//
// The related, much more widely used `data-no-transform` is a different kind of
// thing: it is UI-only. It suppresses the properties panel's transform rows and
// the transform gizmo, and is NOT enforced at the command layer — so an AI-chat
// or scripted command can still transform an entity carrying it. The three
// markers above are the command-layer family.
//
// What this covers is every COMMAND route: the properties panel, the AI chat,
// the transform gizmo and layers-panel reparenting all go through
// Inspector.execute. A direct setAttribute — from scene load, from generator
// code, or from an animation component — bypasses it, as does a scene authored
// before the markers existed.

// A scale within this of 1, or a rotation within this many degrees of 0, is
// treated as unchanged. Both guard against float noise in a round-trip through
// the panel's string values rather than expressing a tolerance anyone should
// rely on.
const UNIT_EPS = 1e-3;

// Refuse a repeat notice for the same entity and reason within this window: the
// panel's number fields are drag-scrubbers that fire a command per pointer
// move, so a refused scrub would otherwise stack dozens of toasts.
const NOTIFY_DEDUP_MS = 1500;

let lastRefusalKey = null;
let lastRefusalAt = 0;

// Read the axis values a transform write is asking for, in whichever of the
// three forms it arrives: a "x y z" string (the AI chat), a whole {x, y, z}
// object (the properties panel's vec3 rows), or a single axis named by
// `property`. Axes the write does not mention come back undefined.
function requestedAxes(payload) {
  const value = payload.value;
  if (payload.property) {
    return { [payload.property]: finite(value) };
  }
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s+/);
    return { x: finite(parts[0]), y: finite(parts[1]), z: finite(parts[2]) };
  }
  if (value && typeof value === 'object') {
    return { x: finite(value.x), y: finite(value.y), z: finite(value.z) };
  }
  return {};
}

function finite(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function departsFrom(axes, target, names) {
  return names.some(
    (axis) =>
      axes[axis] !== undefined && Math.abs(axes[axis] - target) > UNIT_EPS
  );
}

/**
 * Would this command violate one of the transform markers on its target?
 * Returns the reason to show the user, or null to let the command through.
 *
 * Ordered so the cheap discriminators run first: this runs for EVERY command
 * the editor executes, including the one a gizmo drag emits per frame.
 */
export function refuseGuardedTransform(commandType, payload) {
  // A multi command's payload is the list of [type, payload] tuples it will
  // run; refuse the whole batch if any member would be refused on its own,
  // since History pushes the batch as one entry.
  if (commandType === 'multi') {
    if (!Array.isArray(payload)) return null;
    for (const tuple of payload) {
      const reason = refuseGuardedTransform(tuple?.[0], tuple?.[1]);
      if (reason) return reason;
    }
    return null;
  }

  const entity = payload?.entity;
  if (!entity || !entity.hasAttribute) return null;

  if (commandType === 'entityupdate') {
    if (
      payload.component === 'scale' &&
      entity.hasAttribute('data-transform-no-scale') &&
      departsFrom(requestedAxes(payload), 1, ['x', 'y', 'z'])
    ) {
      return 'Scaling is not available for this element.';
    }
    if (
      payload.component === 'rotation' &&
      entity.hasAttribute('data-transform-yaw-only') &&
      departsFrom(requestedAxes(payload), 0, ['x', 'z'])
    ) {
      return 'This element can only be rotated about the vertical axis.';
    }
    return null;
  }

  if (
    commandType === 'entityreparent' &&
    entity.hasAttribute('data-transform-no-reparent') &&
    // payload.parentEl is the target parent's id. A same-parent reorder comes
    // through this command too, and must not be refused.
    payload.parentEl !== entity.parentNode?.id
  ) {
    return 'This element cannot be moved to a different parent.';
  }

  return null;
}

/**
 * Tell the user a command was refused, at most once per entity+reason per
 * NOTIFY_DEDUP_MS. The dedup state lives here rather than in the shared notify
 * layer, which other callers may legitimately want to repeat.
 *
 * Keying on the reason as well as the entity means a genuinely different
 * refusal still speaks. Two DIFFERENT refused actions that happen to share a
 * reason within the window produce one toast; that is accepted, because the
 * case the visibility requirement exists for — an AI turn reporting success for
 * an edit that did not happen — is covered unconditionally by the tool
 * dispatcher throwing, whether or not a toast was shown.
 */
export function notifyRefusal(entity, reason) {
  const now = Date.now();
  const key = `${entity?.id ?? ''}|${reason}`;
  if (key !== lastRefusalKey || now - lastRefusalAt > NOTIFY_DEDUP_MS) {
    // Reached through the global rather than an import: notify is an A-Frame
    // component that publishes itself there once the scene has it, and this can
    // run before that.
    globalThis.STREET?.notify?.warningMessage(reason);
    lastRefusalKey = key;
  }
  // Unconditional, so a continuing scrub keeps the window open and produces one
  // toast for the whole gesture rather than one per NOTIFY_DEDUP_MS.
  lastRefusalAt = now;
}

// Returned by Inspector.execute instead of running a refused command. Callers
// that need to react — the AI tool dispatcher, which must not report success —
// test for this rather than for a falsy return, since the method returns
// undefined on the success path.
export const TRANSFORM_REFUSED = Symbol('transform refused');
