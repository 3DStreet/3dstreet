/* eslint-disable no-unused-vars */
import classNames from 'classnames';
import debounce from 'lodash-es/debounce';
import PropTypes from 'prop-types';
import React from 'react';
import { FormattedMessage, injectIntl } from 'react-intl';
import Events from '../../lib/Events';
import Entity, { isContainer } from './Entity';
import { ToolbarWrapper } from './ToolbarWrapper';
import { Plus20Circle } from '@shared/icons';
import {
  getEntityDisplayName,
  reorderEntityRelativeTo
} from '../../lib/entity';
import { isEditableTarget } from '@shared/utils/dom.js';
import posthog from 'posthog-js';
import AssetsPanel from './AssetsPanel';
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
      insertionInfo: null
    };

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
    Events.on('openassetspanel', this.showAssetsPanel);
    document.addEventListener('child-attached', this.onChildAttachedDetached);
    document.addEventListener('child-detached', this.onChildAttachedDetached);
    this.unsubscribePanels = useStore.subscribe(
      (state) => state.panelsVisible,
      (panelsVisible) => this.setState({ panelsVisible })
    );
  }

  componentWillUnmount() {
    Events.off('entityupdate', this.onEntityUpdate);
    Events.off('openassetspanel', this.showAssetsPanel);
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
    return !isContainer(entity) && !entity.classList.contains('autocreated');
  };

  canBeDropTarget = (entity, draggedEntity) => {
    // Segments only accept other segments (reorder within their managed
    // street, which relayouts via its childList observer); dropping anything
    // else into a street is still disallowed.
    if (
      !draggedEntity ||
      draggedEntity === entity ||
      entity.id === 'reference-layers' ||
      entity.id === 'environment' ||
      entity.id === 'cameraRig' ||
      (entity.hasAttribute('street-segment') &&
        !draggedEntity.hasAttribute('street-segment'))
    ) {
      return false;
    }

    // Only allow reordering within the same parent for now.
    // To re-enable reparenting, replace this check with the descendant-walk check:
    //   let current = entity.parentNode;
    //   while (current && current.isEntity) {
    //     if (current === draggedEntity) return false;
    //     current = current.parentNode;
    //   }
    // and re-enable the "child" drop position in Entity.js onDragOver.
    if (entity.parentNode !== draggedEntity.parentNode) {
      return false;
    }

    return true;
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

    this.setState({ entities });
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
    let curr = x.parentNode;
    while (curr !== undefined && curr.isEntity) {
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
          onReparentEntity={this.onReparentEntity}
          canBeDragged={this.canBeDragged}
          canBeDropTarget={this.canBeDropTarget}
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
                    <div>{this.renderEntities()}</div>
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
