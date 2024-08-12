/* eslint-disable no-unused-vars, react/no-danger */
import classNames from 'classnames';
import { cloneDeep, debounce } from 'lodash-es';
import PropTypes from 'prop-types';
import React from 'react';
import Events from '../../lib/Events';
import Entity from './Entity';
import { ToolbarWrapper } from './ToolbarWrapper';
import { LayersIcon, ArrowLeftIcon } from '../../icons';
import posthog from 'posthog-js';

export default class SceneGraph extends React.Component {
  static propTypes = {
    id: PropTypes.string,
    onChange: PropTypes.func,
    scene: PropTypes.object,
    selectedEntity: PropTypes.object,
    visible: PropTypes.bool
  };

  static defaultProps = {
    selectedEntity: '',
    index: -1,
    id: 'left-sidebar'
  };

  constructor(props) {
    super(props);
    this.state = {
      entities: [],
      expandedElements: new WeakMap([[props.scene, true]]),
      filter: '',
      filteredEntities: [],
      selectedIndex: -1,
      leftBarHide: false,
      secondLvlEntitiesExpanded: true,
      firstLevelEntities: [],
      scene: props.scene
    };

    this.rebuildEntityOptions = debounce(
      this.rebuildEntityOptions.bind(this),
      1000
    );
  }

  componentDidMount() {
    this.setFirstLevelEntities();
    this.rebuildEntityOptions();
    Events.on('updatescenegraph', this.rebuildEntityOptions);
    Events.on('entityidchange', this.rebuildEntityOptions);
    Events.on('entitycreated', this.rebuildEntityOptions);
    Events.on('entityclone', this.rebuildEntityOptions);
    Events.on('entityupdate', (detail) => {
      if (detail.component === 'mixin') {
        this.rebuildEntityOptions();
      }
    });
  }

  /**
   * Selected entity updated from somewhere else in the app.
   */

  componentDidUpdate(prevProps) {
    if (prevProps.selectedEntity !== this.props.selectedEntity) {
      this.selectEntity(this.props.selectedEntity);
    }
  }

  setFirstLevelEntities = () => {
    for (
      let i = 0;
      i < document.querySelector('a-scene').childNodes.length;
      i++
    ) {
      if (
        document.querySelector('a-scene').childNodes[i].localName ===
          'a-entity' &&
        document.querySelector('a-scene').childNodes[i].id !== ''
      ) {
        this.setState((prevState) => ({
          firstLevelEntities: [
            ...prevState.firstLevelEntities,
            document.querySelector('a-scene').childNodes[i].id
          ]
        }));
      }
    }
  };

  selectEntity = (entity) => {
    let found = false;
    for (let i = 0; i < this.state.filteredEntities.length; i++) {
      const entityOption = this.state.filteredEntities[i];
      if (entityOption.entity === entity) {
        this.setState({ selectedEntity: entity, selectedIndex: i });
        // Make sure selected value is visible in scenegraph
        this.expandToRoot(entity);
        if (this.props.onChange) {
          this.props.onChange(entity);
        }
        posthog.capture('entity_selected', {
          entity: entity.getAttribute('mixin')
        });
        Events.emit('entityselect', entity, true);
        found = true;
      }
    }

    if (!found) {
      this.setState({ selectedEntity: null, selectedIndex: -1 });
    }
  };

  rebuildEntityOptions = () => {
    const entities = [{ depth: 0, entity: this.props.scene }];

    function treeIterate(element, parent, depth) {
      if (!element) {
        return;
      }
      depth += 1;

      for (let i = 0; i < element.children.length; i++) {
        let entity = element.children[i];

        if (
          entity.dataset.isInspector ||
          !entity.isEntity ||
          entity.isInspector ||
          'aframeInspector' in entity.dataset
        ) {
          continue;
        }

        entities.push({ entity: entity, depth: depth });

        treeIterate(entity, element, depth);
      }
    }

    treeIterate(this.props.scene, null, 0);

    console.log(entities);
    this.setState({
      scene: this.props.scene,
      entities: entities,
      filteredEntities: this.getFilteredEntities(this.state.filter, entities)
    });
  };

  selectIndex = (index) => {
    if (index >= 0 && index < this.state.entities.length) {
      this.selectEntity(this.state.entities[index].entity);
    }
  };

  getFilteredEntities(filter, entities) {
    entities = entities || this.state.entities;
    if (!filter) {
      return entities;
    }
    return entities.filter((entityOption) => {
      return filterEntity(entityOption.entity, filter || this.state.filter);
    });
  }

  isVisibleInSceneGraph = (x) => {
    let curr = x.parentNode;
    if (!curr) {
      return false;
    }
    while (curr !== undefined && curr?.isEntity) {
      if (!this.isExpanded(curr)) {
        return false;
      }
      curr = curr.parentNode;
    }
    return true;
  };

  isExpanded = (x) => this.state.expandedElements.get(x) === true;

  toggleExpandedCollapsed = (x) => {
    if (this.state.firstLevelEntities.includes(x.id)) {
      this.setState({
        expandedElements: this.state.expandedElements.set(
          x,
          !this.isExpanded(x)
        )
      });
    } else {
      this.setState({
        secondLvlEntitiesExpanded: !this.state.secondLvlEntitiesExpanded
      });
      this.setState({
        expandedElements: this.state.expandedElements.set(
          x,
          this.state.secondLvlEntitiesExpanded
        )
      });
    }
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

  toggleLeftBar = () => {
    this.setState({ leftBarHide: !this.state.leftBarHide });
  };

  renderEntities = () => {
    let entityOptions = this.state.filteredEntities.filter((entityOption) => {
      if (
        !this.isVisibleInSceneGraph(entityOption.entity) &&
        !this.state.filter
      ) {
        return false;
      } else {
        return true;
      }
    });

    // wrap entities of layer level 1 in <div class="layer">
    let layerEntities = [];
    let resultEntities = [];
    // let activeLayer = false;
    console.log(entityOptions);
    for (let i = 1; i < entityOptions.length; i++) {
      const entityOption = entityOptions[i];
      const entity = (
        <Entity
          {...entityOption}
          key={i}
          isFiltering={!!this.state.filter}
          isExpanded={this.isExpanded(entityOption.entity)}
          isSelected={this.props.selectedEntity === entityOption.entity}
          selectEntity={this.selectEntity}
          toggleExpandedCollapsed={this.toggleExpandedCollapsed}
          isInitiallyExpanded={this.state.initiallyExpandedEntities.some(
            (item) => item === entityOption.entity.id
          )}
          initiallyExpandEntity={() => {
            this.toggleExpandedCollapsed(entityOption.entity);
            this.setState((prevState) => ({
              ...prevState,
              initiallyExpandedEntities: [
                ...prevState.initiallyExpandedEntities.filter(
                  (item) => item !== entityOption.entity.id
                ),
                entityOption.entity.id
              ]
            }));
          }}
        />
      );
      layerEntities.push(entity);
      if (i === entityOptions.length - 1 || entityOptions[i + 1].depth === 1) {
        const className = classNames({
          layer: true,
          active: layerEntities[0].props.isSelected
        });
        resultEntities.push(
          <div className={className} key={i}>
            {layerEntities}
          </div>
        );
        layerEntities = [];
      }
    }
    console.log(resultEntities);
    return resultEntities;
  };

  shouldRenderEntity = (entity) => {
    return filterEntity(entity, this.state.filter);
  };

  renderSceneNodes = (node, depth = 0) => {
    if (!node) return null;
    if (
      node.dataset.isInspector ||
      !node.isEntity ||
      node.isInspector ||
      'aframeInspector' in node.dataset
    ) {
      return null;
    }
    const children = node.children || [];
    const renderedChildren = [];

    for (let i = 0; i < children.length; i++) {
      renderedChildren.push(this.renderSceneNodes(children[i], depth + 1));
    }

    return (
      <div key={node.id} className={`node depth-${depth}`}>
        <div>
          <Entity
            entity={node}
            depth={depth}
            isFiltering={!!this.state.filter}
            isExpanded={this.isExpanded(node)}
            isSelected={this.props.selectedEntity === node}
            selectEntity={this.selectEntity}
            toggleExpandedCollapsed={this.toggleExpandedCollapsed}
          >
            <div className="node-children">{renderedChildren}</div>
          </Entity>
        </div>
      </div>
    );
  };

  render() {
    console.log('rerender');
    // To hide the SceneGraph we have to hide its parent too (#left-sidebar).
    if (!this.props.visible) {
      return null;
    }

    // Outliner class names.
    const className = classNames({
      outliner: true,
      hide: this.state.leftBarHide
    });

    return (
      <div id="scenegraph" className="scenegraph">
        <div className="scenegraph-toolbar">
          <ToolbarWrapper />
        </div>
        <div
          className={className}
          tabIndex="0"
          onKeyDown={this.onKeyDown}
          onKeyUp={this.onKeyUp}
        >
          <div
            className={'layersBlock'}
            id="layers-title"
            onClick={this.toggleLeftBar}
          >
            <div id="toggle-leftbar">
              <ArrowLeftIcon />
            </div>
            <div className={'layersBlock'}>
              <LayersIcon />
              <span>Layers</span>
            </div>
          </div>
          <div className="layers">
            {this.renderSceneNodes(this.state.scene)}
          </div>
        </div>
      </div>
    );
  }
}

function filterEntity(entity, filter) {
  if (!filter) {
    return true;
  }

  // Check if the ID, tagName, class, selector includes the filter.
  if (
    entity.id.toUpperCase().indexOf(filter.toUpperCase()) !== -1 ||
    entity.tagName.toUpperCase().indexOf(filter.toUpperCase()) !== -1 ||
    entity.classList.contains(filter) ||
    entity.matches(filter)
  ) {
    return true;
  }

  return false;
}
