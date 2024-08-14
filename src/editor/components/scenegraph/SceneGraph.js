/* eslint-disable no-unused-vars, react/no-danger */
import classNames from 'classnames';
import { debounce } from 'lodash-es';
import PropTypes from 'prop-types';
import React from 'react';
import Events from '../../lib/Events';
import Entity from './Entity';
import { ToolbarWrapper } from './ToolbarWrapper';
import { LayersIcon, ArrowLeftIcon } from '../../icons';
import posthog from 'posthog-js';

const HIDDEN_CLASSES = ['teleportRay', 'hitEntity'];

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
    id: 'left-sidebar'
  };

  constructor(props) {
    super(props);
    this.state = {
      leftBarHide: false,
      scene: props.scene
    };

    this.rebuildEntityOptions = debounce(
      this.rebuildEntityOptions.bind(this),
      1000
    );
  }

  componentDidMount() {
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

  toggleLeftBar = () => {
    this.setState({ leftBarHide: !this.state.leftBarHide });
  };

  rebuildEntityOptions = () => {
    this.setState({
      scene: this.props.scene
    });
  };

  shouldRenderNode = (node) => {
    if (
      node.dataset.isInspector ||
      !node.isEntity ||
      node.isInspector ||
      HIDDEN_CLASSES.includes(node.className) ||
      'aframeInspector' in node.dataset
    ) {
      return false;
    }
    return true;
  };

  renderSceneNodes = (nodes, depth = 0) => {
    if (!nodes || nodes.length === 0) {
      return { renderedChildren: null, isExpanded: false };
    }

    const renderedNodes = [];
    let isExpanded = false;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (!this.shouldRenderNode(node)) {
        continue;
      }

      const children = node.children || [];
      const { renderedChildren, isExpanded: childIsExpanded } =
        this.renderSceneNodes(Array.from(children), depth + 1);

      const isSelected = node === this.props.selectedEntity;
      isExpanded = isExpanded || isSelected || childIsExpanded;
      renderedNodes.push(
        <div key={node.id} className={`node depth-${depth}`}>
          <div>
            <Entity
              entity={node}
              depth={depth}
              isExpanded={isExpanded}
              isSelected={isSelected}
            >
              <div className="node-children">{renderedChildren}</div>
            </Entity>
          </div>
        </div>
      );
    }

    return { renderedChildren: renderedNodes, isExpanded };
  };

  orderSceneGraph = (nodes) => {
    const orderedScene = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.id === 'reference-layers') {
        orderedScene.unshift(node);
      } else if (node.id === 'environment') {
        orderedScene.splice(1, 0, node);
      } else {
        orderedScene.push(node);
      }
    }

    return orderedScene;
  };

  render() {
    console.log(this.state.scene.children);
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
            {
              this.renderSceneNodes(
                this.orderSceneGraph(this.state.scene.children)
              ).renderedChildren
            }
          </div>
        </div>
      </div>
    );
  }
}
