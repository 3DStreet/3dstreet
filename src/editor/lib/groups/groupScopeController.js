// Which user groups are open for editing ("the scope"), kept consistent with
// the selection and the scene.
//
// The open groups are a stack of ids, outermost first. It is state of the
// editor session only: never stored on an entity, so nothing about it is saved
// and a group recreated by a move (same id) stays open.
//
// The layer panel and the canvas both select through the same event, so the
// scope is derived from the selection rather than from where a click came
// from: selecting anything opens the groups that contain it, and a selected
// group stays open only if it already was. Opening a group, leaving one level
// and closing everything are the explicit transitions. Removal, hiding, scene
// replacement and leaving the editor prune the stack; they never add to it.
//
// Published read-only as `inspector.groupScope`.

import Events from '../Events';
import useStore from '@/store';
import { FRAME_ORDER, PER_ITEM_PASS_MAX_THROWS } from '../editorFrame.js';
import { createUniqueId } from '../entity';
import { isReparentInFlight } from '../commands/EntityReparentCommand.js';
import { GroupAffordances } from './groupAffordances.js';
import { ScopeFade } from './scopeFade.js';
import { ScopePresentation } from './scopePresentation.js';
import {
  isHiddenInHierarchy,
  isUserGroup,
  userGroupAncestors
} from './groupModel.js';
import {
  hoverTargetOf,
  isDrill,
  isSelectedClosedGroup,
  resolveCanvasClick
} from './groupScope.js';

const NO_GROUPS = Object.freeze([]);

// The scope refers to groups by id. A group made by the editor always has
// one; a group written by hand into a scene file may not, and is given one
// here, which the scene then saves.
function ensureGroupId(groupEl) {
  if (!groupEl.id) groupEl.id = createUniqueId();
  return groupEl.id;
}

/**
 * Ids of the shown user groups enclosing `el`, outermost first; an id-less
 * group is given an id (see ensureGroupId).
 */
function ensureEnclosingGroupIds(el) {
  const ids = [];
  for (const groupEl of userGroupAncestors(el)) {
    // Hiding is inherited, so every group inside a hidden one is hidden too.
    if (isHiddenInHierarchy(groupEl)) break;
    ids.push(ensureGroupId(groupEl));
  }
  return ids;
}

function sameIds(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Create the scope controller for `inspector` and publish it as
 * `inspector.groupScope`; its markers, and the outline and scrim of the open
 * group, are placed in `editorFrame`'s window. `lines` are the viewport's
 * screen-space line helpers (see ScopePresentation).
 */
export function installGroupScope(inspector, editorFrame, { lines }) {
  const controller = new GroupScopeController(inspector);
  controller.unregisterFrame = editorFrame.register(
    (context) => controller.affordances.updateMarkers(context),
    // After the bounds, so a marker placed at a group's center uses this
    // frame's box. Placing catches nothing per item, so a persistent defect
    // is dropped after a few frames rather than on the first.
    {
      order: FRAME_ORDER.groupMarkers,
      maxConsecutiveThrows: PER_ITEM_PASS_MAX_THROWS
    }
  );
  controller.presentation = new ScopePresentation(
    inspector,
    controller,
    editorFrame,
    lines
  );
  controller.outsideFade = new ScopeFade({
    sceneEl: inspector.sceneEl,
    editorFrame,
    onFirstFadedFrame: (generation) =>
      controller.presentation.firstFadedFrame(generation)
  });
  controller.presentation.outsideFade = controller.outsideFade;
  inspector.groupScope = controller;
  return controller;
}

export class GroupScopeController {
  constructor(inspector) {
    this.inspector = inspector;
    this.stack = NO_GROUPS;
    this.scopeGeneration = 0;
    // Set by a click that entered a group (selected a closed group or opened
    // one): the double-click that such a click can be the first half of must
    // not also move the camera. See consumeDoubleClick().
    this.drillLatch = false;
    // Selections made by this controller's own click handling, which leave the
    // latch alone; any other selection (panel, commands) clears it.
    this.ownSelections = 0;
    // The group a click at the hovered spot would open, if any.
    this.hoverOpens = null;
    this.affordances = new GroupAffordances(inspector, this);

    const sceneEl = inspector.sceneEl;
    this.teardown = [];
    const on = (target, type, handler) => {
      target.addEventListener(type, handler);
      this.teardown.push(() => target.removeEventListener(type, handler));
    };
    const onEvent = (type, handler) => {
      Events.on(type, handler);
      this.teardown.push(() => Events.off(type, handler));
    };

    onEvent('objectselect', () => this.followSelection());
    const prune = () => this.prune();
    onEvent('historychanged', prune);
    onEvent('entityremoved', prune);
    onEvent('entityupdate', (detail) => {
      if (detail?.component === 'visible') this.prune();
    });
    on(sceneEl, 'child-detached', prune);
    on(sceneEl, 'newScene', () => this.setStack(NO_GROUPS));
    on(window, 'blur', () => {
      this.drillLatch = false;
    });
    this.teardown.push(
      useStore.subscribe(
        (state) => state.isInspectorEnabled,
        (enabled) => (enabled ? this.onEditorOpened() : this.onEditorClosed())
      )
    );
  }

  dispose() {
    this.teardown.forEach((undo) => undo?.());
    this.teardown = [];
    this.unregisterFrame?.();
    this.affordances.dispose();
    this.presentation?.dispose();
    this.outsideFade?.dispose();
  }

  // ------------------------------------------------------------ read-only state

  /** Ids of the open groups, outermost first. Frozen. */
  get openStack() {
    return this.stack;
  }

  /** Bumped on every change of the open groups. */
  get generation() {
    return this.scopeGeneration;
  }

  selected() {
    return this.inspector.selectedEntity || null;
  }

  /** The open groups as elements, outermost first. Do not modify it. */
  openElements() {
    if (this.stack.length === 0) return NO_GROUPS;
    const elements = [];
    for (const id of this.stack) {
      const el = document.getElementById(id);
      if (el?.isConnected) elements.push(el);
    }
    return elements;
  }

  /**
   * A user group is selected, or a group is open. While this holds, every
   * click of a quick run counts (entering a group is select, open, select
   * inside), not only the first.
   */
  groupSelectedOrOpen() {
    return this.stack.length > 0 || isUserGroup(this.selected());
  }

  /**
   * Must a click or hover consult the group pick targets? Whenever a group is
   * selected or open, and also with nothing selected while an empty group's
   * marker is on screen.
   */
  hasGroupPickTargets() {
    return this.groupSelectedOrOpen() || this.affordances.hasMarkers();
  }

  // ------------------------------------------------------------ transitions

  setStack(ids) {
    if (sameIds(ids, this.stack)) return;
    this.stack = Object.freeze([...ids]);
    this.scopeGeneration++;
    Events.emit('groupscopechanged', {
      openStack: this.stack,
      generation: this.scopeGeneration
    });
  }

  select(el) {
    if (!el && !this.selected()) return;
    this.ownSelections++;
    try {
      this.inspector.selectEntity(el || null);
    } finally {
      this.ownSelections--;
    }
  }

  /** Open `groupEl` (and the groups around it) for editing. */
  open(groupEl) {
    if (!isUserGroup(groupEl) || isHiddenInHierarchy(groupEl)) return;
    this.setStack([
      ...ensureEnclosingGroupIds(groupEl),
      ensureGroupId(groupEl)
    ]);
  }

  /** Close the innermost open group and select the one around it. */
  exitOneLevel() {
    if (this.stack.length < 2) {
      this.close(null);
      return;
    }
    const parentId = this.stack[this.stack.length - 2];
    this.setStack(this.stack.slice(0, -1));
    this.select(document.getElementById(parentId));
  }

  /** Close every open group, then select `el` (or nothing). */
  close(el) {
    this.setStack(NO_GROUPS);
    this.select(el);
  }

  /** Escape: leave one level. False when no group is open. */
  escape() {
    if (this.stack.length === 0) return false;
    this.drillLatch = false;
    this.exitOneLevel();
    return true;
  }

  // ------------------------------------------------------------ reconciling

  // Selecting something opens the groups around it; a selected group stays
  // open only if it already was. A null selection (a tool switch, undoing a
  // create) leaves the scope as it is.
  followSelection() {
    if (!this.ownSelections) this.drillLatch = false;
    const selected = this.selected();
    // A move replaces the element: the new one is selected once it has loaded.
    if (!selected || !selected.isConnected) return;
    const ids = ensureEnclosingGroupIds(selected);
    if (
      isUserGroup(selected) &&
      !isHiddenInHierarchy(selected) &&
      selected.id &&
      this.stack.includes(selected.id)
    ) {
      ids.push(selected.id);
    }
    this.setStack(ids);
  }

  // Drop every open group that is gone or hidden, and every group inside it.
  prune() {
    const kept = [];
    for (const id of this.stack) {
      const el = document.getElementById(id);
      if (!el) {
        // Moved: out of the scene until its replacement (same id) arrives.
        if (isReparentInFlight(id)) {
          kept.push(id);
          continue;
        }
        break;
      }
      if (!el.isConnected || !isUserGroup(el) || isHiddenInHierarchy(el)) {
        break;
      }
      kept.push(id);
    }
    this.setStack(kept);
  }

  onEditorClosed() {
    this.drillLatch = false;
    this.setStack(NO_GROUPS);
  }

  // Reopen closed, in a state a click could have produced: a selection inside
  // a group becomes that group's outermost group, selected and closed.
  onEditorOpened() {
    this.affordances.markDirty();
    const selected = this.selected();
    if (!selected?.isConnected) return;
    const outermost = userGroupAncestors(selected)[0];
    if (outermost) this.select(outermost);
  }

  // ------------------------------------------------------------ canvas input

  /** Decide a click on `hits` (see groupScope.js) without applying it. */
  decide(hits) {
    return resolveCanvasClick(hits, {
      selected: this.selected(),
      openGroups: this.openElements()
    });
  }

  /**
   * Apply a click decision. `count` is the click's count (2 for the second
   * click of a double-click); a fresh click clears the drill latch first.
   */
  applyClick(result, count) {
    if (count === 1) this.drillLatch = false;
    const drill = isDrill(result, this.openElements());
    switch (result.action) {
      case 'open':
        this.open(result.group);
        break;
      case 'select':
        this.select(result.el);
        break;
      case 'exit':
        this.exitOneLevel();
        break;
      case 'close':
        this.close(result.el);
        break;
    }
    if (drill) this.drillLatch = true;
  }

  /**
   * The selected closed group a still click on its transform handle, at the
   * spot whose pick targets are `hits`, would open: the handle overlaps the
   * group's box or marker there. Null otherwise.
   */
  handleClickOpens(hits) {
    const selected = this.selected();
    if (!isSelectedClosedGroup(selected, selected, this.openElements())) {
      return null;
    }
    const onGroup = hits.some(
      (hit) =>
        hit.el === selected && (hit.kind === 'proxy' || hit.kind === 'marker')
    );
    return onGroup ? selected : null;
  }

  /**
   * A still click on the selected group's transform handle, resolved at the
   * press point (`hits`, as for a canvas click). Over the group's box it opens
   * the group. On the handles of an open, selected group it falls through to
   * the click rules inside that group: the member beneath, or the group again
   * on empty space. Anything else does nothing; in particular a handle is
   * never a way out of a group, nor a way to select what lies under a closed
   * one.
   */
  applyHandleClick(hits, count) {
    if (count === 1) this.drillLatch = false;
    const groupToOpen = this.handleClickOpens(hits);
    if (groupToOpen) {
      this.applyClick({ action: 'open', group: groupToOpen }, count);
      return;
    }
    const openGroups = this.openElements();
    const selected = this.selected();
    if (!selected || selected !== openGroups[openGroups.length - 1]) return;
    const result = this.decide(hits);
    if (result.action === 'select') this.applyClick(result, count);
  }

  /**
   * A canvas double-click whose clicks entered a group is consumed: the
   * camera stays put. True when this one is, which also clears the latch.
   */
  consumeDoubleClick() {
    if (!this.drillLatch) return false;
    this.drillLatch = false;
    return true;
  }

  /** Record what hovering `hits` previews: an open, and a marker's emphasis. */
  noteHover(result, hits) {
    this.hoverOpens = result.action === 'open' ? result.group : null;
    const nearest = hits.find((hit) => hit.kind !== 'scope');
    const target = hoverTargetOf(result);
    this.affordances.setHoveredMarker(
      nearest?.kind === 'marker' && nearest.el === target ? target : null
    );
  }

  clearHover() {
    this.hoverOpens = null;
    this.affordances.setHoveredMarker(null);
  }
}
