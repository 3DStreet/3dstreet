/* eslint-disable no-unused-vars, react/no-danger */
import classNames from 'classnames';
import debounce from 'lodash-es/debounce';
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
      initiallyExpandedEntities: [],
      secondLvlEntitiesExpanded: true,
      firstLevelEntities: []
    };

    this.rebuildEntityOptions = debounce(
      this.rebuildEntityOptions.bind(this),
      1000
    );
    this.updateFilteredEntities = debounce(
      this.updateFilteredEntities.bind(this),
      500
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

    function treeIterate(element, depth) {
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

        treeIterate(entity, depth);
      }
    }
    treeIterate(this.props.scene, 0);

    this.setState({
      entities: entities,
      filteredEntities: this.getFilteredEntities(this.state.filter, entities)
    });
  };

  selectIndex = (index) => {
    if (index >= 0 && index < this.state.entities.length) {
      this.selectEntity(this.state.entities[index].entity);
    }
  };

  onFilterKeyUp = (event) => {
    if (event.keyCode === 27) {
      this.clearFilter();
    }
  };

  onKeyDown = (event) => {
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
    if (this.props.selectedEntity === null) {
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

  onChangeFilter = (evt) => {
    const filter = evt.target.value;
    this.setState({ filter: filter });
    this.updateFilteredEntities(filter);
  };

  updateFilteredEntities(filter) {
    this.setState({
      filteredEntities: this.getFilteredEntities(filter)
    });
  }

  clearFilter = () => {
    this.setState({ filter: '' });
    this.updateFilteredEntities('');
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
    return resultEntities;
  };

  render() {
    // To hide the SceneGraph we have to hide its parent too (#left-sidebar).
    if (!this.props.visible) {
      return null;
    }

    // Outliner class names.
    const className = classNames({
      outliner: true,
      hide: this.state.leftBarHide
    });

    const clearFilter = this.state.filter ? (
      <a onClick={this.clearFilter} className="button fa fa-times" />
    ) : null;

    return (
      <div id="scenegraph" className="scenegraph">
        <div className="scenegraph-toolbar">
          <ToolbarWrapper />
          <div className="search">
            <input
              id="filter"
              placeholder="Search..."
              onChange={this.onChangeFilter}
              onKeyUp={this.onFilterKeyUp}
              value={this.state.filter}
            />
            {clearFilter}
            {!this.state.filter && <span className="fa fa-search" />}
          </div>
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
          <div className="layers">{this.renderEntities()}</div>
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
