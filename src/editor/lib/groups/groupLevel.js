// Keeping a group level at the command layer: a user group always has scale 1
// and no X/Z rotation (see tested/migrate-group-pose.js for data being loaded,
// pasted or created).

/**
 * The class list an `entityupdate` of `class` leaves on the entity, as the
 * editor's updateEntity and the DOM apply it: a null value removes the
 * attribute; any other value is stringified (an array becomes "a,b", one
 * token) and split on whitespace. With a `property`, the DOM receives the
 * property as the value.
 */
export function classAfterUpdate(payload) {
  const raw = payload.property ? payload.property : payload.value;
  if (payload.value === null || payload.value === undefined) return [];
  return String(raw).split(/\s+/).filter(Boolean);
}
