import React from 'react';
import PropTypes from 'prop-types';
import Select from 'react-select';

export default class AddGeneratorComponent extends React.Component {
  static propTypes = {
    entity: PropTypes.object,
    // Optional approved-list mode: [{ value, label, attrValue? }]. When set,
    // the dropdown offers exactly these components (attrValue seeds the
    // component's initial attribute string) instead of scanning for
    // street-generated-*. Both modes share the singleton rule: a component
    // without `multiple: true` disappears from the list once present.
    components: PropTypes.array,
    placeholder: PropTypes.string
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
    this.setState({ value: '' });

    let componentName = value.value;

    const entity = this.props.entity;

    if (AFRAME.components[componentName].multiple) {
      // Auto-assign the lowest unused numeric modifier instead of prompting
      // the user to invent a name before they've defined the component (#1752).
      // The first instance uses the bare name (modifier index 1); subsequent
      // instances use __2, __3, … matching the managed-street `__n` convention.
      // Scanning for the lowest unused slot (rather than count + 1) keeps
      // modifiers collision-free even after intermediate instances are deleted.
      const existing = Object.keys(entity.components);
      if (existing.includes(componentName)) {
        let id = 2;
        while (existing.includes(`${componentName}__${id}`)) {
          id++;
        }
        componentName = `${componentName}__${id}`;
      }
    }

    AFRAME.INSPECTOR.execute('componentadd', {
      entity,
      component: componentName,
      value: value.attrValue || ''
    });
  };

  /**
   * Component dropdown options.
   */
  getComponentsOptions() {
    const PREFIX_MAPPING = {
      'street-generated-clones': 'Clones',
      'street-generated-striping': 'Striping',
      'street-generated-stencil': 'Stencils',
      'street-generated-pedestrians': 'Pedestrians',
      'street-generated-rail': 'Rail'
    };

    const usedComponents = Object.keys(this.props.entity.components);
    const isAddable = function (componentName) {
      return (
        AFRAME.components[componentName].multiple ||
        usedComponents.indexOf(componentName) === -1
      );
    };

    if (this.props.components) {
      return this.props.components.filter((option) => isAddable(option.value));
    }

    return Object.keys(AFRAME.components)
      .filter(function (componentName) {
        return (
          componentName.startsWith('street-generated-') && // Added filter for street-generated- prefix
          isAddable(componentName)
        );
      })
      .map(function (value) {
        // Prefix mapping configuration
        const displayName = PREFIX_MAPPING[value];
        if (displayName) {
          return { value: value, label: displayName };
        } else {
          return { value: value, label: value };
        }
      })
      .toSorted(function (a, b) {
        return a.label === b.label ? 0 : a.label < b.label ? -1 : 1;
      });
  }

  render() {
    const entity = this.props.entity;
    if (!entity) {
      return <div />;
    }

    const options = this.getComponentsOptions();

    return (
      <div id="addComponentContainer">
        <Select
          id="addComponent"
          className="addComponent"
          classNamePrefix="select"
          options={options}
          isClearable={false}
          isSearchable
          placeholder={this.props.placeholder || 'Add Component...'}
          noOptionsMessage={() => 'No components found'}
          onChange={this.addComponent}
          value={this.state.value}
          menuPosition="fixed"
          menuPlacement="auto"
          minMenuHeight={300}
        />
      </div>
    );
  }
}
