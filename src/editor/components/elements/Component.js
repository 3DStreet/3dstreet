import Collapsible from '../Collapsible';
import Events from '../../lib/Events';
import PropTypes from 'prop-types';
import PropertyRow from './PropertyRow';
import React from 'react';
import { shouldShowProperty } from '../../lib/utils';
import { TrashIcon } from '../../icons';

const isSingleProperty = AFRAME.schema.isSingleProperty;

/**
 * Single component.
 */
export default class Component extends React.Component {
  static propTypes = {
    component: PropTypes.any,
    entity: PropTypes.object,
    isCollapsed: PropTypes.bool,
    name: PropTypes.string
  };

  constructor(props) {
    super(props);
    this.state = {
      entity: this.props.entity,
      name: this.props.name
    };
  }

  onEntityUpdate = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    if (detail.component === this.props.name) {
      this.forceUpdate();
    }
  };

  componentDidMount() {
    Events.on('entityupdate', this.onEntityUpdate);
  }

  componentWillUnmount() {
    Events.off('entityupdate', this.onEntityUpdate);
  }

  static getDerivedStateFromProps(props, state) {
    if (state.entity !== props.entity) {
      return { entity: props.entity };
    }
    if (state.name !== props.name) {
      return { name: props.name };
    }
    return null;
  }

  removeComponent = (event) => {
    var componentName = this.props.name;
    event.stopPropagation();
    if (
      confirm(
        'Do you really want to remove component `' +
          componentName +
          '`? This may cause problems or corrupt your scene, please use component removal with caution.'
      )
    ) {
      AFRAME.INSPECTOR.execute('componentremove', {
        entity: this.props.entity,
        component: componentName
      });
    }
  };

  /**
   * Render propert(ies) of the component.
   */
  renderPropertyRows = () => {
    const componentData = this.props.component;

    if (isSingleProperty(componentData.schema)) {
      const componentName = this.props.name;
      const schema = AFRAME.components[componentName.split('__')[0]].schema;
      return (
        <PropertyRow
          key={componentName}
          name={componentName}
          schema={schema}
          data={componentData.data}
          componentname={componentName}
          isSingle={true}
          entity={this.props.entity}
        />
      );
    }

    return Object.keys(componentData.schema)
      .sort()
      .filter((propertyName) => {
        return shouldShowProperty(propertyName, componentData);
      })
      .map((propertyName) => (
        <div className="detailed" key={propertyName}>
          <PropertyRow
            name={propertyName}
            schema={componentData.schema[propertyName]}
            data={componentData.data[propertyName]}
            componentname={this.props.name}
            isSingle={false}
            entity={this.props.entity}
          />
        </div>
      ));
  };

  render() {
    const componentName = this.props.name;

    return (
      <Collapsible collapsed={this.props.isCollapsed}>
        <div className="componentHeader collapsible-header">
          <span className="componentTitle" title={componentName}>
            <span>{componentName}</span>
          </span>
          <div className="componentHeaderActions">
            <a
              title="Remove component"
              className="button remove-button"
              onClick={this.removeComponent}
            >
              <TrashIcon />
            </a>
          </div>
        </div>
        <div className="collapsible-content">{this.renderPropertyRows()}</div>
      </Collapsible>
    );
  }
}
