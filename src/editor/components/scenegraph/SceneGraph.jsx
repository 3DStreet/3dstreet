/* eslint-disable no-unused-vars */
import classNames from 'classnames';
import debounce from 'lodash-es/debounce';
import PropTypes from 'prop-types';
import React from 'react';
import { FormattedMessage, defineMessages, injectIntl } from 'react-intl';
import Events from '../../lib/Events';
import Entity, { isContainer } from './Entity';
import { ToolbarWrapper } from './ToolbarWrapper';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { Plus20Circle } from '@shared/icons';
import {
  createUniqueId,
  getEntityDisplayName,
  reorderEntityRelativeTo
} from '../../lib/entity';
import {
  USER_GROUP_CLASS,
  canReparent,
  isUserGroup
} from '../../lib/groups/groupModel.js';
import { isReparentInFlight } from '../../lib/commands/EntityReparentCommand.js';
import { nestedGroupPlacement } from '../../lib/groups/groupPlacement.js';
import {
  groupGapLevels,
  isNoOpDrop,
  levelAtX,
  lineIndentPx,
  pickLevel
} from './dropLevels.js';
import { isEditableTarget } from '@shared/utils/dom.js';
import posthog from 'posthog-js';
import AssetsPanel from './AssetsPanel';
import PanelLoadSheen from './PanelLoadSheen';
import GeoSidebar from '../elements/GeoSidebar';
import AppMenu from './AppMenu';
import { AppSwitcher } from '@shared/navigation/components';
import { SceneEditTitle } from '../elements/SceneEditTitle';
import { Save } from '../elements/Save';
import { Tabs } from '../elements';
import useStore from '@/store';
import { AuthContext } from '@/editor/contexts';
import { commonMessages } from '@/editor/i18n/commonMessages';
const HIDDEN_CLASSES = ['teleportRay', 'hitEntity', 'hideFromSceneGraph'];
const HIDDEN_IDS = ['dropPlane', 'previewEntity'];

const messages = defineMessages({
  newGroup: {
    id: 'sceneGraph.newGroup',
    defaultMessage: 'New group'
  }
});

// `insertionInfo.host` of a drop over the strip after the last row.
const DROP_STRIP = 'drop-strip';

// A drop line between rows: 2 px centred on the boundary at `gapY` (kept
// inside the list at its top edge), placed absolutely so showing it moves
// nothing. A drop that lands in a group starts at that level's indent, with a
// chevron for "inside"; any other runs the full width.
function DropLine({ gapY, indentPx }) {
  const atLevel = indentPx != null;
  return (
    <span
      className={classNames('drop-line', { 'at-level': atLevel })}
      style={{
        top: `${Math.max(0, gapY - 1)}px`,
        left: `${atLevel ? indentPx : 0}px`
      }}
      aria-hidden="true"
    >
      {atLevel && <AwesomeIcon icon={faChevronRight} size={8} />}
    </span>
  );
}
DropLine.propTypes = {
  gapY: PropTypes.number,
  indentPx: PropTypes.number
};

// The move command and the layer's own undo look parents up by id.
function ensureId(el) {
  if (el && !el.id) el.setAttribute('id', createUniqueId());
}

class SceneGraph extends React.Component {
  static contextType = AuthContext;
  static propTypes = {
    intl: PropTypes.object,
    scene: PropTypes.object,
    selectedEntity: PropTypes.object
  };

  static defaultProps = {
    selectedEntity: ''
  };

  constructor(props) {
    super(props);
    this.state = {
      entities: [],
      expandedElements: new WeakMap([[props.scene, true]]),
      panelsVisible: useStore.getState().panelsVisible,
      activeTab: 'layers',
      selectedIndex: -1,
      // Drag and drop state
      draggedEntity: null,
      hoveredDropTarget: null,
      insertionInfo: null,
      // Row whose label is in inline-rename mode (context menu Rename)
      renamingEntity: null
    };
    // Ids of expanded rows whose element a move has just discarded, so the
    // element that replaces it (same id) opens expanded too.
    this.expandedIdsInTransit = new Set();

    this.rebuildEntityOptions = debounce(
      this.rebuildEntityOptions.bind(this),
      0
    );
  }

  onEntityUpdate = (detail) => {
    if (
      detail.component === 'id' ||
      detail.component === 'class' ||
      detail.component === 'mixin' ||
      detail.component === 'visible' ||
      detail.component === 'data-layer-name'
    ) {
      this.rebuildEntityOptions();
    }
  };

  onChildAttachedDetached = (event) => {
    if (this.includeInSceneGraph(event.detail.el)) {
      this.rebuildEntityOptions();
    }
  };

  componentDidMount() {
    this.rebuildEntityOptions();
    Events.on('entityupdate', this.onEntityUpdate);
    // Row badges (getEntityBadges) reflect role components, so a component
    // added or removed on an entity re-renders the rows.
    Events.on('componentadd', this.rebuildEntityOptions);
    Events.on('componentremove', this.rebuildEntityOptions);
    Events.on('openassetspanel', this.showAssetsPanel);
    Events.on('entityremoved', this.onEntityRemoved);
    Events.on('entitycreated', this.onEntityCreated);
    document.addEventListener('child-attached', this.onChildAttachedDetached);
    document.addEventListener('child-detached', this.onChildAttachedDetached);
    this.unsubscribePanels = useStore.subscribe(
      (state) => state.panelsVisible,
      (panelsVisible) => this.setState({ panelsVisible })
    );
  }

  componentWillUnmount() {
    Events.off('entityupdate', this.onEntityUpdate);
    Events.off('componentadd', this.rebuildEntityOptions);
    Events.off('componentremove', this.rebuildEntityOptions);
    Events.off('openassetspanel', this.showAssetsPanel);
    Events.off('entityremoved', this.onEntityRemoved);
    Events.off('entitycreated', this.onEntityCreated);
    document.removeEventListener(
      'child-attached',
      this.onChildAttachedDetached
    );
    document.removeEventListener(
      'child-detached',
      this.onChildAttachedDetached
    );
    this.unsubscribePanels?.();
  }

  // Expand state is keyed by element, and a move replaces the moved subtree's
  // elements with new ones carrying the same ids.
  onEntityRemoved = (entity) => {
    for (const el of [entity, ...entity.querySelectorAll('[id]')]) {
      if (el.id && this.isExpanded(el)) this.expandedIdsInTransit.add(el.id);
    }
  };

  onEntityCreated = (entity) => {
    if (this.expandedIdsInTransit.size) {
      for (const el of [entity, ...entity.querySelectorAll('[id]')]) {
        if (this.expandedIdsInTransit.delete(el.id)) {
          this.state.expandedElements.set(el, true);
        }
      }
    }
    // Also re-renders rows whose move has just settled, so they can be
    // dragged again.
    this.setState({ expandedElements: this.state.expandedElements });
  };

  /**
   * Selected entity updated from somewhere else in the app.
   */
  componentDidUpdate(prevProps) {
    if (prevProps.selectedEntity !== this.props.selectedEntity) {
      this.selectEntity(this.props.selectedEntity);
    }
  }

  selectEntity = (entity) => {
    let found = false;
    for (let i = 0; i < this.state.entities.length; i++) {
      const entityOption = this.state.entities[i];
      if (entityOption.entity === entity) {
        this.setState({ selectedIndex: i });
        setTimeout(() => {
          // wait 100ms to allow React to update the UI and create the node we're interested in
          const node = document.getElementById('sgnode' + i);
          const scrollableContainer = document.querySelector(
            '#scenegraph .layers'
          );
          if (!node || !scrollableContainer) return;
          const containerRect = scrollableContainer.getBoundingClientRect();
          const nodeRect = node.getBoundingClientRect();
          const isVisible =
            nodeRect.top >= containerRect.top &&
            nodeRect.bottom <= containerRect.bottom;
          if (!isVisible) {
            node.scrollIntoView({ behavior: 'smooth' });
          }
        }, 100);
        // Make sure selected value is visible in scenegraph
        this.expandToRoot(entity);
        posthog.capture('entity_selected', {
          entity: getEntityDisplayName(entity)
        });
        Events.emit('entityselect', entity);
        found = true;
        break;
      }
    }

    if (!found) {
      this.setState({ selectedIndex: -1 });
    }
  };

  includeInSceneGraph = (element) => {
    return !(
      element.dataset.isInspector ||
      !element.isEntity ||
      element.isInspector ||
      'aframeInspector' in element.dataset ||
      element.id === 'batch-models-root' ||
      HIDDEN_CLASSES.includes(element.className) ||
      HIDDEN_IDS.includes(element.id)
    );
  };

  canBeDragged = (entity) => {
    return (
      !isContainer(entity) &&
      !entity.classList.contains('autocreated') &&
      // Pinned to the top of the list (see rebuildEntityOptions).
      !entity.hasAttribute('viewer-start') &&
      !isReparentInFlight(entity.id)
    );
  };

  /**
   * May `draggedEntity` be dropped at `position` ('before', 'after' or
   * 'child') of the row for `entity`?
   */
  canBeDropTarget = (entity, draggedEntity, position) => {
    // Segments only accept other segments (reorder within their managed
    // street, which relayouts via its childList observer); dropping anything
    // else into a street is still disallowed.
    if (
      !draggedEntity ||
      draggedEntity === entity ||
      entity.id === 'reference-layers' ||
      entity.id === 'environment' ||
      entity.id === 'cameraRig' ||
      entity.hasAttribute('viewer-start') ||
      (entity.hasAttribute('street-segment') &&
        !draggedEntity.hasAttribute('street-segment')) ||
      isReparentInFlight(draggedEntity.id) ||
      isReparentInFlight(entity.id)
    ) {
      return false;
    }

    if (position === 'child') {
      return isUserGroup(entity) && canReparent(draggedEntity, entity);
    }
    // A reorder within the current parent is allowed wherever it always was;
    // a move to another parent only where the group model allows it.
    const parent = entity.parentNode;
    return (
      parent === draggedEntity.parentNode || canReparent(draggedEntity, parent)
    );
  };

  // May the item drop at the end of the top level (the strip after the last
  // row, at its top level)? So an item can always leave a group, even when
  // that group is the last row.
  canDropAtEnd = (draggedEntity) => {
    const root = this.props.scene.querySelector('#street-container');
    if (!draggedEntity || !root || isReparentInFlight(draggedEntity.id)) {
      return false;
    }
    if (draggedEntity.parentNode === root) {
      // Already the last row: a drop would move nothing the list shows.
      return this.rowFollows(draggedEntity);
    }
    return canReparent(draggedEntity, root);
  };

  // Is a row listed below `entity` among its siblings? Children the list
  // leaves out (such as the batch root) and the Starting View, which is
  // listed first wherever it is, are not.
  rowFollows = (entity) => {
    for (let el = entity.nextElementSibling; el; el = el.nextElementSibling) {
      if (this.includeInSceneGraph(el) && !el.hasAttribute('viewer-start')) {
        return true;
      }
    }
    return false;
  };

  // May the dragged row land where `insertion` says?
  isDropLegal = (insertion, draggedEntity) =>
    insertion.position === 'end'
      ? this.canDropAtEnd(draggedEntity)
      : this.canBeDropTarget(insertion.ref, draggedEntity, insertion.position);

  /**
   * The drop at the gap between the listed rows `above` and `below` for a
   * pointer at `clientX` over a host whose left edge is `hostLeft`: the
   * legal level nearest the pointer's band, or null if no level is legal.
   * Undefined where no group level is involved, so the host's own zone
   * decides as it always has.
   */
  resolveGroupGap = (above, below, clientX, hostLeft) => {
    const levels = groupGapLevels(above, below);
    if (!levels) return undefined;
    const dragged = this.state.draggedEntity;
    const chosen = pickLevel(
      levels.filter(
        (c) => !isNoOpDrop(dragged, c) && this.isDropLegal(c, dragged)
      ),
      levelAtX(clientX, hostLeft)
    );
    if (!chosen) return null;
    const insideGroup = isUserGroup(chosen.parent);
    return {
      ref: chosen.ref,
      position: chosen.position,
      level: chosen.level,
      insideGroup,
      indentPx: insideGroup ? lineIndentPx(chosen.level) : null
    };
  };

  lastListedRow = () => {
    const rows = this.state.entities;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (this.isVisibleInSceneGraph(rows[i].entity)) return rows[i];
    }
    return null;
  };

  onDragOverEnd = (e) => {
    const draggedEntity = this.state.draggedEntity;
    if (!draggedEntity) return;
    const groupDrop = this.resolveGroupGap(
      this.lastListedRow(),
      null,
      e.clientX,
      e.currentTarget.getBoundingClientRect().left
    );
    const insertion =
      groupDrop === undefined
        ? this.canDropAtEnd(draggedEntity) && {
            ref: null,
            position: 'end',
            level: null
          }
        : groupDrop;
    if (!insertion) {
      if (this.state.insertionInfo?.host === DROP_STRIP) {
        this.setState({ insertionInfo: null });
      }
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const gapY = e.currentTarget.offsetTop;
    const current = this.state.insertionInfo;
    if (
      current?.host !== DROP_STRIP ||
      current.ref !== insertion.ref ||
      current.position !== insertion.position ||
      current.level !== insertion.level ||
      current.gapY !== gapY
    ) {
      this.setState({
        hoveredDropTarget: null,
        insertionInfo: { ...insertion, host: DROP_STRIP, gapY }
      });
    }
  };

  onDragLeaveEnd = () => {
    if (this.state.insertionInfo?.host === DROP_STRIP) {
      this.setState({ insertionInfo: null });
    }
  };

  onDropEnd = (e) => {
    e.preventDefault();
    const insertion = this.state.insertionInfo;
    this.setState({ hoveredDropTarget: null, insertionInfo: null });
    if (insertion?.host === DROP_STRIP) {
      this.dropAt(this.state.draggedEntity, insertion);
    }
  };

  // Carry out a drop the panel resolved, if it is still allowed.
  dropAt = (draggedEntity, insertion) => {
    if (
      !draggedEntity ||
      !insertion ||
      !this.isDropLegal(insertion, draggedEntity)
    ) {
      return;
    }
    if (insertion.position !== 'end') {
      this.onReparentEntity(draggedEntity, insertion.ref, insertion.position);
      return;
    }
    const root = this.props.scene.querySelector('#street-container');
    ensureId(draggedEntity.parentNode);
    AFRAME.INSPECTOR.execute('entityreparent', {
      entity: draggedEntity,
      parentEl: root.id,
      indexInParent: root.children.length
    });
  };

  // Drag and drop handlers
  setDraggedEntity = (entity) => {
    this.setState({ draggedEntity: entity });
  };

  setHoveredDropTarget = (entity) => {
    this.setState({ hoveredDropTarget: entity });
  };

  setInsertionInfo = (info) => {
    this.setState({ insertionInfo: info });
  };

  setRenamingEntity = (entity) => {
    this.setState({ renamingEntity: entity });
  };

  onReparentEntity = (draggedEntity, targetEntity, insertionMode = 'child') => {
    if (!draggedEntity || !targetEntity || draggedEntity === targetEntity) {
      return;
    }

    if (insertionMode !== 'child') {
      // Insert before or after targetEntity (same parent)
      reorderEntityRelativeTo(draggedEntity, targetEntity, insertionMode);
      return;
    }

    // Make draggedEntity a child of targetEntity, added at the end
    ensureId(targetEntity);
    ensureId(draggedEntity.parentNode);
    const parentEl = targetEntity.id;
    const indexInParent = targetEntity.children.length;

    // Expand the target entity in the UI
    this.state.expandedElements.set(targetEntity, true);
    this.setState({ expandedElements: this.state.expandedElements });

    AFRAME.INSPECTOR.execute('entityreparent', {
      entity: draggedEntity,
      parentEl,
      indexInParent
    });
  };

  rebuildEntityOptions = () => {
    const entities = [];

    const treeIterate = (element, depth) => {
      if (!element) {
        return;
      }
      depth += 1;

      for (let i = 0; i < element.children.length; i++) {
        let entity = element.children[i];

        if (!this.includeInSceneGraph(entity)) {
          continue;
        }

        entities.push({
          entity: entity,
          depth: depth,
          id: 'sgnode' + entities.length
        });

        treeIterate(entity, depth);
      }
    };

    const streetContainer = this.props.scene.querySelector('#street-container');
    if (streetContainer) {
      treeIterate(streetContainer, 0);
    }

    // The Viewer Start is a scene-level setting that happens to be an
    // entity (a pseudo-system, one per scene), so it sits at the top of the
    // list regardless of DOM order. It has no children, so moving its row
    // alone keeps every other subtree contiguous.
    const isStart = (o) =>
      o.depth === 1 && o.entity.hasAttribute('viewer-start');
    const ordered = [
      ...entities.filter(isStart),
      ...entities.filter((o) => !isStart(o))
    ];
    ordered.forEach((o, i) => {
      o.id = 'sgnode' + i;
    });

    this.setState({ entities: ordered });
  };

  selectIndex = (index) => {
    if (index >= 0 && index < this.state.entities.length) {
      this.selectEntity(this.state.entities[index].entity);
    }
  };

  onKeyDown = (event) => {
    // Events from modals rendered via React portals (e.g. the asset gallery's
    // detail modal) bubble up through the React tree to this handler even though
    // they live elsewhere in the DOM. Never swallow arrow keys while the user is
    // typing in a field, or the caret can't move / edits are blocked (#1735).
    if (isEditableTarget(event.target)) {
      return;
    }
    switch (event.keyCode) {
      case 37: // left
      case 38: // up
      case 39: // right
      case 40: // down
        event.preventDefault();
        event.stopPropagation();
        break;
    }
  };

  onKeyUp = (event) => {
    if (this.props.selectedEntity === null || isEditableTarget(event.target)) {
      return;
    }

    switch (event.keyCode) {
      case 37: // left
        if (this.isExpanded(this.props.selectedEntity)) {
          this.toggleExpandedCollapsed(this.props.selectedEntity);
        }
        break;
      case 38: // up
        this.selectIndex(
          this.previousExpandedIndexTo(this.state.selectedIndex)
        );
        break;
      case 39: // right
        if (!this.isExpanded(this.props.selectedEntity)) {
          this.toggleExpandedCollapsed(this.props.selectedEntity);
        }
        break;
      case 40: // down
        this.selectIndex(this.nextExpandedIndexTo(this.state.selectedIndex));
        break;
    }
  };

  isVisibleInSceneGraph = (x) => {
    let curr = x.parentNode;
    if (!curr) {
      return false;
    }
    // Stop at street-container — it's the implicit root of the tree and isn't
    // rendered, so its expanded state shouldn't gate visibility of its children.
    while (curr?.isEntity && curr.id !== 'street-container') {
      if (!this.isExpanded(curr)) {
        return false;
      }
      curr = curr.parentNode;
    }
    return true;
  };

  isExpanded = (x) => this.state.expandedElements.get(x) === true;

  toggleExpandedCollapsed = (x) => {
    this.setState({
      expandedElements: this.state.expandedElements.set(x, !this.isExpanded(x))
    });
  };

  expandToRoot = (x) => {
    // Expand element all the way to the scene element
    // `curr` is null (not undefined) for a detached entity — e.g. a street
    // segment that was removed between the delete and this update — so a
    // truthiness check is required, not `!== undefined`.
    let curr = x.parentNode;
    while (curr && curr.isEntity) {
      this.state.expandedElements.set(curr, true);
      curr = curr.parentNode;
    }
    this.setState({ expandedElements: this.state.expandedElements });
  };

  previousExpandedIndexTo = (i) => {
    for (let prevIter = i - 1; prevIter >= 0; prevIter--) {
      const prevEl = this.state.entities[prevIter].entity;
      if (this.isVisibleInSceneGraph(prevEl)) {
        return prevIter;
      }
    }
    return -1;
  };

  nextExpandedIndexTo = (i) => {
    for (
      let nextIter = i + 1;
      nextIter < this.state.entities.length;
      nextIter++
    ) {
      const nextEl = this.state.entities[nextIter].entity;
      if (this.isVisibleInSceneGraph(nextEl)) {
        return nextIter;
      }
    }
    return -1;
  };

  setActiveTab = (tab) => {
    this.setState({ activeTab: tab });
  };

  // Reveal the Assets tab when an asset upload starts elsewhere (e.g. the Add
  // Layer Panel's upload cards) so the user sees their upload progress.
  showAssetsPanel = () => {
    this.setActiveTab('assets');
  };

  openAddLayer = () => {
    useStore.getState().setModal('addlayer');
    posthog.capture('add_layer_panel_opened', { source: 'left_panel_plus' });
  };

  createGroup = () => {
    // Not 'custom-group': the Add Layer panel finds its own street-prop
    // holders by that class.
    const definition = {
      class: USER_GROUP_CLASS,
      'data-layer-name': 'Group',
      components: { position: '0 0 0' }
    };
    // With a group open, the new group goes inside it, at its center.
    const nested = nestedGroupPlacement();
    if (nested) {
      definition.parentEl = nested.parentEl;
      definition.requireParent = nested.requireParent;
      definition.components.position = nested.position;
    }
    AFRAME.INSPECTOR.execute('entitycreate', definition);
  };

  getEntityById = (id) => document.getElementById(id);

  selectGeoTab = () => {
    this.setState({ activeTab: 'geo' });
    posthog.capture('geo_layer_clicked', { source: 'left_panel_tab' });
    const currentUser = this.context?.currentUser;
    const entity = this.getEntityById('reference-layers');
    if (!currentUser) {
      useStore.getState().setModal('signin');
      return;
    }
    if (!entity?.hasAttribute?.('street-geo')) {
      useStore.getState().setModal('geo');
    }
  };

  renderEntities = () => {
    const renderedEntities = [];
    const entityOptions = this.state.entities.filter((entityOption) =>
      this.isVisibleInSceneGraph(entityOption.entity)
    );
    let children = [];
    for (let i = 0; i < entityOptions.length; i++) {
      const entityOption = entityOptions[i];
      const renderedEntity = (
        <Entity
          {...entityOption}
          key={i}
          aboveRow={entityOptions[i - 1] ?? null}
          belowRow={entityOptions[i + 1] ?? null}
          isFiltering={!!this.state.filter}
          isExpanded={this.isExpanded(entityOption.entity)}
          isSelected={this.props.selectedEntity === entityOption.entity}
          selectEntity={this.selectEntity}
          toggleExpandedCollapsed={this.toggleExpandedCollapsed}
          // Drag and drop props
          draggedEntity={this.state.draggedEntity}
          setDraggedEntity={this.setDraggedEntity}
          hoveredDropTarget={this.state.hoveredDropTarget}
          setHoveredDropTarget={this.setHoveredDropTarget}
          insertionInfo={this.state.insertionInfo}
          setInsertionInfo={this.setInsertionInfo}
          resolveGroupGap={this.resolveGroupGap}
          isDropLegal={this.isDropLegal}
          dropAt={this.dropAt}
          canBeDragged={this.canBeDragged}
          canBeDropTarget={this.canBeDropTarget}
          isMoving={isReparentInFlight(entityOption.entity.id)}
          // Context menu rename state
          renamingEntity={this.state.renamingEntity}
          setRenamingEntity={this.setRenamingEntity}
        />
      );
      children.push(renderedEntity);
      // wrap entities of depth 1 in <div class="layer">
      if (i === entityOptions.length - 1 || entityOptions[i + 1].depth === 1) {
        const className = classNames({
          layer: true,
          active: children[0].props.isSelected
        });
        renderedEntities.push(
          <div className={className} key={i}>
            {children}
          </div>
        );
        children = [];
      }
    }
    return renderedEntities;
  };

  // The strip after the last row: the gap below it, at the top level or, when
  // the last row is inside groups, at any of their levels.
  renderDropStrip = () => (
    <div
      className="layers-drop-end"
      onDragOver={this.onDragOverEnd}
      onDragLeave={this.onDragLeaveEnd}
      onDrop={this.onDropEnd}
    />
  );

  // The line of the drop the pointer means between two rows, drawn by the
  // list so that a gap has one line wherever in it the pointer is.
  renderDropLine = () => {
    const insertion = this.state.insertionInfo;
    if (insertion?.gapY == null) return null;
    if (
      insertion.host !== DROP_STRIP &&
      !this.isDropLegal(insertion, this.state.draggedEntity)
    ) {
      return null;
    }
    return <DropLine gapY={insertion.gapY} indentPx={insertion.indentPx} />;
  };

  render() {
    const { intl } = this.props;
    const isCollapsed = !this.state.panelsVisible;
    const className = classNames({
      'scenegraph-panel': true,
      hide: isCollapsed
    });

    const currentUser = this.context?.currentUser;

    return (
      <div id="scenegraph" className="scenegraph">
        <div
          className={className}
          tabIndex="0"
          onKeyDown={this.onKeyDown}
          onKeyUp={this.onKeyUp}
        >
          <div id="left-panel-header">
            <div className="left-panel-header-row">
              {isCollapsed && <PanelLoadSheen />}
              <AppSwitcher />
              {!isCollapsed && <AppMenu currentUser={currentUser} />}
              {isCollapsed && (
                <>
                  <div className="scene-title clickable truncate">
                    <SceneEditTitle />
                  </div>
                  <Save currentUser={currentUser} />
                </>
              )}
            </div>
            {!isCollapsed && (
              <div className="left-panel-title-row">
                {/* Ambient scene load sheen behind title + save (#2009). */}
                <PanelLoadSheen />
                <div className="scene-title clickable truncate">
                  <SceneEditTitle />
                </div>
                <Save currentUser={currentUser} />
              </div>
            )}
          </div>
          {!isCollapsed && (
            <>
              <div className="left-panel-tabs-row">
                <Tabs
                  tabs={[
                    {
                      label: intl.formatMessage({
                        id: 'sceneGraph.tabLayers',
                        defaultMessage: 'Layers'
                      }),
                      value: 'layers',
                      isSelected: this.state.activeTab === 'layers',
                      onClick: () => this.setActiveTab('layers')
                    },
                    {
                      label: intl.formatMessage({
                        id: 'sceneGraph.tabGeospatial',
                        defaultMessage: 'Geospatial'
                      }),
                      value: 'geo',
                      isSelected: this.state.activeTab === 'geo',
                      onClick: this.selectGeoTab
                    },
                    {
                      label: intl.formatMessage({
                        id: 'sceneGraph.tabAssets',
                        defaultMessage: 'Assets'
                      }),
                      value: 'assets',
                      isSelected: this.state.activeTab === 'assets',
                      onClick: () => this.setActiveTab('assets')
                    }
                  ]}
                />
                {this.state.activeTab === 'layers' && (
                  <button
                    type="button"
                    className="left-panel-add-layer"
                    onClick={this.openAddLayer}
                    aria-label={intl.formatMessage(commonMessages.addLayer)}
                    title={intl.formatMessage(commonMessages.addLayer)}
                  >
                    <Plus20Circle />
                  </button>
                )}
                {this.state.activeTab === 'layers' && (
                  <button
                    type="button"
                    className="left-panel-add-layer"
                    onClick={this.createGroup}
                    aria-label={intl.formatMessage(messages.newGroup)}
                    title={intl.formatMessage(messages.newGroup)}
                  >
                    <span className="left-panel-new-group">G+</span>
                  </button>
                )}
              </div>
              {this.state.activeTab === 'layers' && (
                <div className="layers">
                  {this.state.entities.length === 0 ? (
                    <div className="layers-empty-state">
                      <p>
                        <FormattedMessage
                          id="sceneGraph.emptyStateMessage"
                          defaultMessage="Add a new layer to get started."
                        />
                      </p>
                      <button
                        type="button"
                        className="layers-empty-state-button"
                        onClick={this.openAddLayer}
                      >
                        <Plus20Circle />
                        <span>
                          <FormattedMessage
                            id="sceneGraph.addLayerButton"
                            defaultMessage="Add Layer"
                          />
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div className="layers-list">
                      {this.renderEntities()}
                      {this.renderDropStrip()}
                      {this.renderDropLine()}
                    </div>
                  )}
                </div>
              )}
              {this.state.activeTab === 'assets' && <AssetsPanel />}
              {this.state.activeTab === 'geo' && (
                <div className="left-panel-geo-content">
                  <GeoSidebar entity={this.getEntityById('reference-layers')} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
}

export default injectIntl(SceneGraph);
