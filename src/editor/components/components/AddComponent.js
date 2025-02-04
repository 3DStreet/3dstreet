import React from 'react';
import PropTypes from 'prop-types';
import Select from 'react-select';

export default class AddComponent extends React.Component {
  static propTypes = {
    entity: PropTypes.object
  };

  constructor(props) {
    super(props);
    this.state = { value: null };
  }

  /**
   * Add blank component.
   * If component is instanced, generate an ID.
   */
  addComponent = (value) => {
    this.setState({ value: null });

    let componentName = value.value;

    var entity = this.props.entity;

    if (AFRAME.components[componentName].multiple) {
      const id = prompt(
        `Provide an ID for this component (e.g., 'foo' for ${componentName}__foo).`
      );
      componentName = id ? `${componentName}__${id}` : componentName;
    }

    AFRAME.INSPECTOR.execute('componentadd', {
      entity,
      component: componentName,
      value: ''
    });
  };

  /**
   * Component dropdown options.
   */
  getComponentsOptions() {
    const usedComponents = Object.keys(this.props.entity.components);
    var commonOptions = Object.keys(AFRAME.components)
      .filter(function (componentName) {
        return (
          componentName.startsWith('street-generated-') && // Added filter for street-generated- prefix
          (AFRAME.components[componentName].multiple ||
            usedComponents.indexOf(componentName) === -1)
        );
      })
      .sort()
      .map(function (value) {
        return { value: value, label: value, origin: 'loaded' };
      });

    this.options = commonOptions;
    this.options = this.options.sort(function (a, b) {
      return a.label === b.label ? 0 : a.label < b.label ? -1 : 1;
    });
  }

  renderOption(option) {
    var bullet = (
      <span title="Component already loaded in the scene">&#9679;</span>
    );
    return (
      <strong className="option">
        {option.label} {option.origin === 'loaded' ? bullet : ''}
      </strong>
    );
  }

  render() {
    const entity = this.props.entity;
    if (!entity) {
      return <div />;
    }

    this.getComponentsOptions();

    return (
      <div id="addComponentContainer">
        <p id="addComponentHeader">COMPONENTS</p>
        <Select
          id="addComponent"
          className="addComponent"
          classNamePrefix="select"
          options={this.options}
          isClearable={false}
          isSearchable
          placeholder="Add component..."
          noOptionsMessage={() => 'No components found'}
          onChange={this.addComponent}
          optionRenderer={this.renderOption}
          value={this.state.value}
        />
      </div>
    );
  }
}
