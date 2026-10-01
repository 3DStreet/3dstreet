import Events from './Events';
import { isStreetLevelNav } from './nav-experimental/flag.js';
import { captureNavDiscovery } from './navAnalytics.js';
import { resolveClickSelection } from './cascadingSelection.js';
import { hoverTargetOf } from './groups/groupScope.js';
import { isUserGroup } from './groups/groupModel.js';
import useStore from '@/store';

// OSM click-to-upgrade (#1930): an empty-space click in osm3d mode probes
// the streamed street ways under the cursor's ground point and surfaces an
// upgrade candidate for the OsmUpgradeChip. Pure read — the actual upgrade
// runs from the chip through osm-streets' upgradeWayAt.
function osmStreetsComponent() {
  const streetsEl = document.querySelector('[osm-streets]');
  return (streetsEl && streetsEl.components['osm-streets']) || null;
}

function probeOsmWayAtCursor(mouseCursor) {
  const comp = osmStreetsComponent();
  if (!comp) return null;
  const ray = mouseCursor.components.raycaster?.raycaster?.ray;
  if (!ray || ray.direction.y >= 0) return null;
  const t = -ray.origin.y / ray.direction.y;
  if (!Number.isFinite(t) || t < 0 || t > 10000) return null;
  const worldPoint = {
    x: ray.origin.x + ray.direction.x * t,
    y: 0,
    z: ray.origin.z + ray.direction.z * t
  };
  const hit = comp.wayAtPoint(worldPoint);
  if (!hit || hit.alreadyUpgraded) return null;
  return {
    wayId: hit.way.wayId,
    class: hit.way.class,
    distance: hit.distance,
    worldPoint
  };
}

export function initRaycaster(inspector) {
  // Use cursor="rayOrigin: mouse".
  const mouseCursor = document.createElement('a-entity');
  mouseCursor.setAttribute('id', 'aframeInspectorMouseCursor');
  mouseCursor.setAttribute('raycaster', {
    interval: 100,
    objects:
      'a-scene :not([data-aframe-inspector]):not([data-ignore-raycaster])'
  });
  mouseCursor.setAttribute('cursor', 'rayOrigin', 'mouse');
  mouseCursor.setAttribute('data-aframe-inspector', 'true');

  // Only visible objects.
  const raycaster = mouseCursor.components.raycaster;
  const refreshObjects = raycaster.refreshObjects;
  const overrideRefresh = () => {
    refreshObjects.call(raycaster);
    const objects = raycaster.objects;
    raycaster.objects = objects.filter((node) => {
      while (node) {
        if (!node.visible) {
          return false;
        }
        node = node.parent;
      }
      return true;
    });
  };
  raycaster.refreshObjects = overrideRefresh;
  // A-Frame refreshes the list only when it is marked dirty (a DOM change in
  // the scene, or an object3D set or removed), and a visibility change is
  // neither. So mark it here: otherwise a hidden entity stays clickable, and
  // one shown again stays unclickable, until something unrelated refreshes it.
  Events.on('entityupdate', (detail) => {
    if (detail.component === 'visible') raycaster.setDirty();
  });

  inspector.sceneEl.appendChild(mouseCursor);
  inspector.cursor = mouseCursor;

  // The entity an intersection belongs to: batched and placeholder hits are
  // remapped to the entity whose instance was hit (see getBatchedIntersectedEl).
  function entityOfIntersection(intersection) {
    const object = intersection.object;
    if (object?.isBatchedMesh) {
      const map = object._batchIdToEl;
      return map ? map[intersection.batchId] || null : null;
    }
    if (object?._placeholderEls) {
      return object._placeholderEls[intersection.instanceId] || null;
    }
    return object?.el || null;
  }

  function getBatchedIntersectedEl() {
    // BatchedMeshes are hosted on a dedicated batch-models-root a-entity via setObject3D,
    // so A-Frame's raycaster keeps the intersection (it has .el). The closest intersection
    // may be a BatchedMesh — remap it to the real entity via _batchIdToEl[batchId]. The
    // model-placeholder ghost boxes (#2009) are one InstancedMesh on their own root entity
    // in the same way; its instanceId indexes _placeholderEls.
    const intersections = mouseCursor.components.raycaster.intersections;
    if (!intersections || intersections.length === 0) return undefined;
    const closest = intersections[0];
    if (closest.object?.isBatchedMesh) {
      const map = closest.object._batchIdToEl;
      return map ? map[closest.batchId] || null : null;
    }
    if (closest.object?._placeholderEls) {
      return closest.object._placeholderEls[closest.instanceId] || null;
    }
    return undefined;
  }

  function getIntersectedEl() {
    const batched = getBatchedIntersectedEl();
    const intersectedEl =
      batched !== undefined
        ? batched
        : mouseCursor.components.cursor.intersectedEl;
    // Figma-style cascading selection (epic #1720): resolve one step down
    // the intersected entity's ancestor chain per click — street, then
    // segment, then child — see cascadingSelection.js. Hover previews the
    // same resolution, so the hover box always shows what a click selects.
    // A click never reaches into a closed user group: it selects the group.
    const openGroups = inspector.groupScope.openElements();
    return resolveClickSelection(
      intersectedEl,
      inspector.selectedEntity,
      openGroups.length ? new Set(openGroups) : undefined
    );
  }

  // With user groups in play a click is decided from EVERY target along the
  // cursor ray, not just the nearest: a click inside an open group must reach
  // its member behind a nearer outside object, and a selected group's box and
  // the groups' center markers are pick targets the scene raycast cannot see.
  function groupHits(
    intersections = raycaster.intersections || [],
    ray = raycaster.raycaster?.ray
  ) {
    const hits = [];
    for (let i = 0; i < intersections.length; i++) {
      const el = entityOfIntersection(intersections[i]);
      if (el) {
        hits.push({ el, distance: intersections[i].distance, kind: 'entity' });
      }
    }
    if (ray) {
      inspector.groupScope.affordances.collectHits(ray, inspector.camera, hits);
    }
    // Nearest first; at equal distance a group's own target before an entity,
    // so a box face flush with a member still opens the group.
    return hits.sort(
      (a, b) =>
        a.distance - b.distance || (a.kind === 'entity') - (b.kind === 'entity')
    );
  }

  // Are the canvas's clicks and hover resolved with the group rules? While
  // there are group pick targets, unless a tool that takes the canvas (the
  // shape tool) has paused the cursor: its clicks are the tool's, and the
  // group rules keep out of them.
  function groupRulesResolveClicks() {
    return (
      mouseCursor.isPlaying !== false &&
      inspector.groupScope.hasGroupPickTargets()
    );
  }

  // The group pick targets at a client point, cast afresh from the camera: a
  // press a gizmo held back is resolved where it went down, which the
  // cursor's polled intersections need not describe any more.
  const pointRaycaster = new THREE.Raycaster();
  const pointNdc = new THREE.Vector2();
  function groupHitsAt(clientX, clientY) {
    const rect = inspector.container.getBoundingClientRect();
    if (!rect.width || !rect.height) return [];
    pointNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const cursorRaycaster = raycaster.raycaster;
    pointRaycaster.near = cursorRaycaster.near;
    pointRaycaster.far = cursorRaycaster.far;
    pointRaycaster.setFromCamera(pointNdc, inspector.camera);
    // As the cursor's own raycaster: its (visible) objects, and only hits on
    // something that belongs to an entity.
    const intersections = pointRaycaster
      .intersectObjects(raycaster.objects, true)
      .filter((intersection) => intersection.object.el);
    return groupHits(intersections, pointRaycaster.ray);
  }

  // The OSM street-upgrade offer (#1930) under the cursor, for a hover or an
  // empty-space click. None while a group is open: the streets are not part of
  // any group, so inside or outside the open one there is nothing to offer.
  function osmOfferAtCursor() {
    if (inspector.groupScope.openElements().length > 0) return null;
    return probeOsmWayAtCursor(mouseCursor);
  }

  // Poll the raycaster's closest intersection each check and fire hover events when the
  // RESOLVED entity changes. Cursor-based mouseenter/mouseleave compare `el` references
  // and miss transitions within a BatchedMesh (both hits have the same batchRootEl).
  let lastHoveredEl = null;
  // Whether a click at the hovered spot would open the (selected) group: the
  // same target previews differently when it would.
  let lastHoverOpens = null;
  const origCheckIntersections = raycaster.checkIntersections.bind(raycaster);
  raycaster.checkIntersections = function () {
    origCheckIntersections();
    let resolved;
    // A click that steps out of an open group only leaves it, so hovering
    // there previews nothing (and no OSM street is offered while a group is
    // open).
    if (groupRulesResolveClicks()) {
      const hits = groupHits();
      const result = inspector.groupScope.decide(hits);
      inspector.groupScope.noteHover(result, hits);
      resolved = hoverTargetOf(result);
    } else {
      inspector.groupScope.clearHover();
      resolved = getIntersectedEl();
    }
    const opens = inspector.groupScope.hoverOpens || null;
    if (resolved !== lastHoveredEl || opens !== lastHoverOpens) {
      if (lastHoveredEl) Events.emit('raycastermouseleave', lastHoveredEl);
      if (resolved) Events.emit('raycastermouseenter', resolved);
      lastHoveredEl = resolved;
      lastHoverOpens = opens;
    }
    updateOsmHover(resolved ? null : osmOfferAtCursor());
  };

  // What a click on the same spot does can change without the cursor moving:
  // selecting a group makes its box an entry target, and opening or leaving a
  // group changes what is inside. Forget the hovered target so the next poll
  // announces it afresh.
  function rearmHover() {
    if (lastHoveredEl) Events.emit('raycastermouseleave', lastHoveredEl);
    lastHoveredEl = null;
  }
  Events.on('groupscopechanged', rearmHover);
  Events.on('objectselect', () => {
    if (isUserGroup(inspector.selectedEntity)) rearmHover();
  });
  // Losing the window ends a group's hover preview; the next poll restores it
  // once the pointer is back.
  window.addEventListener('blur', () => {
    if (inspector.groupScope.groupSelectedOrOpen()) rearmHover();
  });

  // Hover-to-highlight for OSM street ways (#1930), matching the hover box
  // entities get: while the cursor is over empty ground near a streamed
  // way, the stretch a click would generate is drawn in translucent red.
  // The clicked way (the chip's candidate) is drawn in cyan by the chip
  // and stays put; hovering any OTHER way still shows red on top of it.
  // Hovering the selected way itself draws nothing extra.
  let osmHover = null; // { wayId, worldPoint } currently highlighted
  const OSM_HOVER_REBUILD_M = 2;
  function updateOsmHover(hit) {
    const comp = osmStreetsComponent();
    if (!comp) {
      osmHover = null;
      return;
    }
    const candidate = useStore.getState().osmWayCandidate;
    if (hit && candidate && candidate.wayId === hit.wayId) hit = null;
    if (!hit) {
      if (osmHover) {
        comp.clearHighlight('hover');
        osmHover = null;
      }
      return;
    }
    const moved =
      !osmHover ||
      osmHover.wayId !== hit.wayId ||
      Math.hypot(
        osmHover.worldPoint.x - hit.worldPoint.x,
        osmHover.worldPoint.z - hit.worldPoint.z
      ) > OSM_HOVER_REBUILD_M;
    if (!moved) return;
    comp.highlightWayAt(hit.worldPoint, { kind: 'hover' });
    osmHover = { wayId: hit.wayId, worldPoint: hit.worldPoint };
  }

  mouseCursor.addEventListener('click', handleClick);
  inspector.container.addEventListener('mousedown', onMouseDown);
  inspector.container.addEventListener('mouseup', onMouseUp);
  inspector.container.addEventListener('dblclick', onDoubleClick);

  inspector.sceneEl.canvas.addEventListener('mouseleave', () => {
    setTimeout(() => {
      Events.emit('raycastermouseleave', null);
      updateOsmHover(null);
    });
  });

  // Raw clientX/Y (viewport pixels), NOT container-normalized coords:
  // layout shifts between Viewer and editor presentations move the
  // container's bounding rect between mousedown and mouseup, which made
  // normalized positions drift for a physically stationary click. Client
  // coordinates are viewport-absolute and immune to that.
  const onDownPosition = new THREE.Vector2();
  const onUpPosition = new THREE.Vector2();
  // 0 = exact main-parity strictness: any down->up movement at all is
  // treated as a drag, not a click. (A small value like 2 would rescue
  // clicks with 1-2px of hand jitter, common on trackpads — revisit if
  // dead clicks get reported.)
  const CLICK_MAX_DRAG_PX = 0;
  // The end of a mouse press reaches two listeners on the canvas: the
  // container's mouseup below, and the cursor's own mouseup, which emits its
  // click when the press began and ended on one entity. They run in the order
  // they were added, and that order changes: pausing and playing the cursor
  // (the editor opening, a tool taking the canvas) re-adds the cursor's, and
  // enable() re-adds the container's. So neither may assume it runs first:
  // whichever resolves the press marks it, and the other then leaves it
  // alone. A touch tap reaches only the cursor (it cancels the touch, so no
  // mouse events follow), which is why the cursor's mousedown also starts a
  // press.
  let pressResolved = false;
  mouseCursor.addEventListener('mousedown', () => {
    pressResolved = false;
  });
  // The container's mouseup acts only on a press the container saw begin: a
  // press begun elsewhere (on a panel) and released over the canvas resolves
  // nothing.
  let pressSeen = false;

  // Decide and apply a click with the group rules (see groups/groupScope.js),
  // keeping the side effects of an ordinary click.
  function resolveGroupClick(count) {
    const controller = inspector.groupScope;
    const result = controller.decide(groupHits());
    if (result.action === 'select' || result.action === 'close') {
      if (result.el) captureNavDiscovery('select');
      useStore
        .getState()
        .setOsmWayCandidate(result.el ? null : osmOfferAtCursor());
    }
    controller.applyClick(result, count);
  }

  function handleClick(evt) {
    if (pressResolved) {
      // The container's mouseup ran first and resolved this press.
      mouseCursor.components.cursor.clearCurrentIntersection(false);
      return;
    }
    pressResolved = true;
    // Compute up position from the click event's source mouseup rather
    // than the side-state onUpPosition, which the container's mouseup may
    // not have written yet (see pressResolved). evt.detail.mouseEvent is
    // the originating mouseup; reading from it is order-independent.
    const upEvt = evt && evt.detail && evt.detail.mouseEvent;
    // MouseEvent.detail is the browser's click count: 1 for a fresh click,
    // 2+ for the later clicks of a double/triple-click. Only the first click
    // cascades the selection one level; the second click of a dblclick is
    // the user asking to focus what that first click selected, not to drill
    // further (see onDoubleClick). Entering groups is the exception: select a
    // group, open it, select inside it is a quick run of clicks, and each one
    // counts. A touch tap's click has no mouse event of its own: A-Frame's
    // cursor reuses one detail object, so after any mouse input it still
    // carries the last mouseup, whose count and position the tap is then
    // judged by (as before groups existed).
    const count = upEvt ? upEvt.detail : 1;
    if (count > 1 && !inspector.groupScope.groupSelectedOrOpen()) {
      return;
    }
    const up = upEvt
      ? new THREE.Vector2(upEvt.clientX, upEvt.clientY)
      : onUpPosition;
    if (onDownPosition.distanceTo(up) <= CLICK_MAX_DRAG_PX) {
      if (groupRulesResolveClicks()) {
        resolveGroupClick(count);
        mouseCursor.components.cursor.clearCurrentIntersection(false);
        return;
      }
      const intersectedEl = getIntersectedEl();
      // Feature-discovery: count a viewport click that actually selects an
      // entity (a click on empty space deselects — not a "select").
      if (intersectedEl) captureNavDiscovery('select');
      // Empty-space click: offer OSM street upgrade when the ground point
      // under the cursor lands near a streamed way (#1930); a click that
      // selects an entity clears any pending offer.
      useStore
        .getState()
        .setOsmWayCandidate(intersectedEl ? null : osmOfferAtCursor());
      inspector.selectEntity(intersectedEl);
      // Force the cursor component to trigger again an intersection to show hover box on the original intersected el inside the street-segment.
      mouseCursor.components.cursor.clearCurrentIntersection(false);
    }
  }

  function onMouseDown(event) {
    if (event instanceof CustomEvent) {
      return;
    }
    event.preventDefault();
    onDownPosition.set(event.clientX, event.clientY);
    pressSeen = true;
    pressResolved = false;
  }

  function onMouseUp(event) {
    if (event instanceof CustomEvent) {
      return;
    }
    event.preventDefault();
    onUpPosition.set(event.clientX, event.clientY);
    const gizmoCaptured = inspector.gizmoCapturedPress;
    inspector.gizmoCapturedPress = false;
    const seen = pressSeen;
    pressSeen = false;
    if (seen && !pressResolved) handleEmptySpaceClick(event, gizmoCaptured);
  }

  // Empty-space clicks never reach handleClick — the cursor component only
  // emits `click` when the press and release both landed on the same
  // intersected entity — so the miss case is caught here, on the container
  // mouseup. Two things happen on a miss:
  //   - deselect (#1992)
  //   - probe for an OSM street way under the cursor's ground point and
  //     offer it for upgrade (#1930); osm3d ground layers are
  //     raycaster-ignored, so this is the only place a miss is seen. Entity
  //     clicks are handled (and the offer cleared) in handleClick.
  // A press that grabbed a viewport gizmo handle (transform gizmo, shape
  // vertex, street node/width bar) sets inspector.gizmoCapturedPress
  // (viewport.js): those helpers are invisible to the entity raycaster, so
  // without the flag a zero-movement click on a handle would read as empty
  // space and deselect the entity being manipulated.
  function handleEmptySpaceClick(event, gizmoCaptured) {
    // Left button only, and only the first click of a multi-click — same
    // rule as handleClick (the dblclick handler owns the second click; while
    // entering groups every click counts). Right/middle mouseups (context
    // menu, orbit/pan) are not "clicks".
    const multiClick =
      event.detail > 1 && !inspector.groupScope.groupSelectedOrOpen();
    if (event.button !== 0 || multiClick || gizmoCaptured) {
      return;
    }
    if (onDownPosition.distanceTo(onUpPosition) > CLICK_MAX_DRAG_PX) {
      return;
    }
    // With groups in play every press is resolved with the group rules,
    // whether or not it hit an entity: empty space as far as the scene is
    // concerned, but inside an open group or on a group's box or marker it
    // still counts.
    if (groupRulesResolveClicks()) {
      pressResolved = true;
      resolveGroupClick(event.detail || 1);
      return;
    }
    // A click on an entity is the cursor's to resolve (handleClick), before
    // or after this — nothing to do here.
    if (getIntersectedEl()) {
      return;
    }
    pressResolved = true;
    useStore.getState().setOsmWayCandidate(osmOfferAtCursor());
    if (inspector.selectedEntity) {
      inspector.selectEntity(null);
    }
  }

  /**
   * Focus on double click.
   *
   * TASK-012 Phase 4: with the street-level flag on, the canvas
   * double-click NAVIGATES (a cursor-aware camera teleport) instead of
   * framing the entity. Emit a new event carrying the cursor coords; the
   * controls classify what's under the cursor from the live cursor raycast
   * (incl. empty-space → Category D), so we must NOT early-return on a missing
   * intersect when the flag is on. Flag-off keeps the objectfocus path.
   * Only this canvas dblclick reroutes — F-key / scene-tree / sidebar
   * objectfocus callers still run the frame-this-entity animation.
   *
   * The teleport ships with the street-level featureset (?streetview=on);
   * gated off, double-click keeps the frame-the-entity behaviour.
   */
  function onDoubleClick(event) {
    // The clicks of this double-click selected or opened a group: that was
    // the whole gesture, so the camera stays where it is.
    if (inspector.groupScope.consumeDoubleClick()) {
      return;
    }
    if (isStreetLevelNav()) {
      Events.emit('nav-experimental:doubleclick', {
        clientX: event.clientX,
        clientY: event.clientY
      });
      return;
    }
    // The first click of this dblclick already cascaded the selection one
    // level (street → segment → child); the second click was ignored by
    // handleClick. Focus the entity that first click selected, so a quick
    // double-click on a street frames the street rather than drilling into
    // whatever sits under the cursor.
    const selected = inspector.selectedEntity;
    if (!selected) {
      return;
    }
    Events.emit('objectfocus', selected.object3D);
  }

  return {
    el: mouseCursor,
    groupHitsAt,
    enable: () => {
      mouseCursor.setAttribute('raycaster', 'enabled', true);
      inspector.container.addEventListener('mousedown', onMouseDown);
      inspector.container.addEventListener('mouseup', onMouseUp);
      inspector.container.addEventListener('dblclick', onDoubleClick);
    },
    disable: () => {
      mouseCursor.setAttribute('raycaster', 'enabled', false);
      inspector.container.removeEventListener('mousedown', onMouseDown);
      inspector.container.removeEventListener('mouseup', onMouseUp);
      inspector.container.removeEventListener('dblclick', onDoubleClick);
    }
  };
}
