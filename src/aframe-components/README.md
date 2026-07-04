# Docs for custom A-Frame components used with 3DStreet

## Street-geo component

The components accept longitude, latitude, elevation and an array of map types to indicate which child maps to spawn. Possible values for maps array: 'mapbox2d', 'google3d'.

The component assigns the class 'autocreated' to its child elements. All attribute values can be changed at runtime and the component will update the child elements (map entities) and their corresponding parameters. The 'elevation' attribute is only used for the 'google3d' tiles element for now.

To add support for a new map type, you need to take the following steps:

- add map name to this.mapTypes variable
- add creating function with name: `<mapName>Create`
- add update function with name: `<mapName>Update`

It is assumed that the appropriate libraries for all map types are loaded in advance.

## Managed Street — segment lifecycle and event flow

How `managed-street` and its child segments are wired together: what
initializes when, which components emit which events, and who listens to
them.

### Components

| Component                                                                       | Lives on                                                    | Role                                                                                     |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `managed-street`                                                                | the parent entity                                           | Owns layout. Loads from streetmix-url / streetplan-url / json-blob.                      |
| `street-segment`                                                                | each segment entity                                         | Source of truth for `width` and `length`.                                                |
| `street-generated-clones` / `-stencil` / `-striping` / `-rail` / `-pedestrians` | same segment entity as `street-segment`                     | Render visual content (vehicles, road markings, lane stripes, rail tracks, pedestrians). |
| `street-align` / `street-ground` / `street-label`                               | the managed-street entity (auto-attached by managed-street) | Handle re-alignment, ground patch, and the on-canvas label.                              |

### Events

| Event              | Emitter                                                        | Payload                                                                                                                                   | Bubbles |
| ------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `segment-changed`  | `street-segment.update`, only when `width` or `length` changed | `{ widthChanged, lengthChanged, oldWidth, newWidth, oldLength, newLength }`                                                               | yes     |
| `segments-changed` | `managed-street`                                               | `{ changeType: 'structure', added, removed }` or `{ changeType: 'property', property: 'width' \| 'length' \| 'showBuildings' \| 'showGround' \| 'visible', segment, oldValue, newValue }` (`segment` is `null` for length/showBuildings/showGround changes, since the change is at the managed-street level) | yes     |

#### Listener wiring

- Each `street-generated-*` component listens for `segment-changed` on
  **its own entity** (the segment).
- `managed-street` listens for `segment-changed` on **its own entity** —
  one bubble listener catches the event from any descendant segment.
- `street-align`, `street-ground`, `street-label` listen for
  `segments-changed` on the managed-street entity.

### A-Frame load order

When an entity is connected to the DOM, A-Frame waits for its children
to finish loading before initializing the parent's own components. So
when a managed-street entity and its segment children enter the DOM in
the same batch (e.g., loading a saved scene), the segments init **before**
managed-street's own init runs.

### Flow A — programmatic creation

Triggered when the editor adds a new managed-street with `synchronize: true`
(json-blob, streetmix-url, or streetplan-url). No segments yet at the
moment managed-street mounts.

1. `<a-entity managed-street="…; synchronize: true">` is appended to the
   scene.
2. A-Frame's load() has no children to wait for, so it proceeds to the
   parent's components.
3. **managed-street.init**:
   - Sets up a `MutationObserver` on `this.el` watching `childList`. On
     adds/removes of `[street-segment]` children it emits a
     `segments-changed` structural event.
   - Attaches a single `segment-changed` bubble listener on `this.el`.
4. **managed-street.update**: sees `synchronize: true`, flips it back to
   `false`, calls `refreshFromSource()` → `parseStreetObject(streetObject)`
   (or one of the URL loaders).
5. **parseStreetObject**: clears existing segments via
   `clearManagedEntities()`, then for each segment in the input:
   - Creates the entity, appends it to `this.el` (now mounted).
   - `setAttribute('street-segment', {…})`.
   - `addEventListener('loaded', …)` to call
     `generateComponentsFromSegmentObject(segment)` once street-segment
     finishes loading.
6. The mutation observer fires once with all added segments and emits
   `segments-changed` structural. **street-align**, **street-ground**, and
   **street-label** react.
7. For each newly-mounted segment, A-Frame initializes street-segment.
   Its first `update(oldData={})` runs with all keys "changed", so it
   emits `segment-changed { widthChanged: true, lengthChanged: true }`.
   - The event bubbles to managed-street.
   - **managed-street.onSegmentChanged**: when `widthChanged` is true,
     emits `segments-changed` property/width and refreshes
     `this.managedEntities`. street-align re-aligns.
   - At this point no `street-generated-*` components exist on the segment
     yet, so they don't see this first event.
8. The segment fires its own `loaded` event after street-segment's init
   completes.
9. The `loaded` listener from step 5 runs
   `generateComponentsFromSegmentObject(segment)`, which calls
   `setAttribute('street-generated-clones__1', …)` (and equivalents for
   stencil/striping/rail/pedestrians).
10. Each newly-attached `street-generated-*`:
    - `init`: attaches a `segment-changed` listener on its own entity.
    - `update`: reads `this.el.components['street-segment']?.data` to get
      `length` and `width`, calls `clearEntities()`, then generates clones.

### Flow B — loading a saved scene

The HTML / JSON has managed-street and its segment children pre-baked.

1. A-Frame mounts the whole subtree. Per the load order, **children's
   components init first**.
2. Each `street-segment.update` fires `segment-changed`. managed-street's
   listener doesn't exist yet, so these initial events aren't seen on the
   managed-street side. Each segment still self-renders correctly because
   its own street-generated-\* siblings react fine.
3. **managed-street.init** runs — observer and bubble listener attached.
4. **managed-street.update** runs. `synchronize` is `false` in a saved
   scene, so `refreshFromSource()` is not called.
5. Sibling components on managed-street (street-align, etc.) init around
   the same time and start listening for `segments-changed`. They don't
   depend on those missed initial `segment-changed` events: each one
   schedules a `setTimeout(0)` in its own `init` that queries the DOM
   for existing segments and runs an initial alignment / dirt patch /
   label render from the loaded state.

### Subsequent edits

#### User changes a segment's width

1. Editor calls `setAttribute('street-segment', 'width', newWidth)` on the
   segment entity.
2. **street-segment.update** detects the change and emits
   `segment-changed { widthChanged: true, … }`.
3. On the segment entity, every `street-generated-*` listener fires →
   `update()` reads the parent's component data → `clearEntities()` →
   re-renders.
4. The event bubbles to managed-street.
5. **managed-street.onSegmentChanged**: emits `segments-changed`
   property/width → street-align re-positions every segment laterally.
6. `refreshManagedEntities()` keeps `this.managedEntities` in sync.

#### User changes a segment's length

Same as width except `lengthChanged: true`. `managed-street.onSegmentChanged`
short-circuits when only `lengthChanged` is set (length doesn't move
segments laterally — only their own visual content changes).

#### User adds or removes a segment

1. DOM mutation.
2. The `MutationObserver` in managed-street fires and emits
   `segments-changed` structural.
3. street-align / street-ground / street-label react.

### Component teardown pattern

Both `managed-street` and each `street-generated-*` split entity teardown
from listener teardown:

- `clearManagedEntities()` (managed-street) and `clearEntities()`
  (street-generated-\*) only clean up child entities. Used by `update()`
  before regenerating, and by helpers like `parseStreetObject` /
  `loadAndParseStreetmixURL` before re-populating.
- `remove()` is the A-Frame lifecycle hook. It calls the clear helper
  **and** removes event listeners / disconnects the observer.

`update()` must not call `remove()` directly, because that would detach
the live event listeners while the component is still active.
