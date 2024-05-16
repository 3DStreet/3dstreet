import AddComponent from './AddComponent';
import CommonComponents from './CommonComponents';
import Component from './Component';
import DEFAULT_COMPONENTS from './DefaultComponents';
import PropTypes from 'prop-types';
import React from 'react';
export default class ComponentsContainer extends React.Component {
  static propTypes = {
    entity: PropTypes.object
  };

  refresh = () => {
    this.forceUpdate();
  };

  render() {
    const entity = this.props.entity;
    const components = entity ? entity.components : {};
    const definedComponents = Object.keys(components).filter((key) => {
      return DEFAULT_COMPONENTS.indexOf(key) === -1;
    });
    const renderedComponents = definedComponents.sort().map((key, idx) => {
      return (
        <div key={key} className={'details'}>
          <Component
            isCollapsed={definedComponents.length > 2}
            component={components[key]}
            entity={entity}
            key={key}
            name={key}
          />
        </div>
      );
    });

    return (
      <div className="components">
        <CommonComponents entity={entity} />
        <AddComponent entity={entity} />
        {renderedComponents}
      </div>
    );
  }
}
