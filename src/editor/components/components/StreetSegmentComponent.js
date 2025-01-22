import Clipboard from 'clipboard';
import Collapsible from '../Collapsible';
import Events from '../../lib/Events';
import PropTypes from 'prop-types';
import PropertyRow from './PropertyRow';
import React from 'react';
import { getComponentClipboardRepresentation } from '../../lib/entity';
import { ClonedTreesIcon, StencilsIcon, StripingIcon } from '../../icons';

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
    var clipboard = new Clipboard(
      '[data-action="copy-component-to-clipboard"]',
      {
        text: (trigger) => {
          var componentName = trigger
            .getAttribute('data-component')
            .toLowerCase();
          return getComponentClipboardRepresentation(
            this.state.entity,
            componentName
          );
        }
      }
    );
    clipboard.on('error', (e) => {
      // @todo Show the error in the UI
      console.error(e);
    });

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
      confirm('Do you really want to remove component `' + componentName + '`?')
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
      .map((propertyName, idx) => (
        <div className="detailed" key={idx}>
          <PropertyRow
            key={propertyName}
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

  getIcon = () => {
    const componentName = this.props.name;
    if (componentName.startsWith('street-generated-clones')) {
      return <ClonedTreesIcon />;
    } else if (componentName.startsWith('street-generated-stencil')) {
      return <StencilsIcon />;
    } else if (componentName.startsWith('street-generated-striping')) {
      return <StripingIcon />;
    }
    return <></>;
  };

  getDisplayName(componentName) {
    // Prefix mapping configuration
    const PREFIX_MAPPING = {
      'street-generated-clones': 'Clones',
      'street-generated-striping': 'Striping',
      'street-generated-stencil': 'Stencils'
    };
    // First check if any prefix mapping matches
    for (const [prefix, displayName] of Object.entries(PREFIX_MAPPING)) {
      if (componentName.startsWith(prefix)) {
        // Get the suffix part (after __) if it exists
        const suffixPart = componentName.split('__')[1];
        // Only add suffix if it's not '1'
        return suffixPart && suffixPart !== '1'
          ? `${displayName} ${suffixPart}`
          : displayName;
      }
    }

    // If no prefix mapping matches, fall back to the original __ splitting behavior
    const parts = componentName.split('__');
    return parts[1] && parts[1] !== '1' ? `${parts[0]} ${parts[1]}` : parts[0];
  }

  render() {
    const componentName = this.props.name;
    const componentDisplayName = this.getDisplayName(componentName);

    return (
      <Collapsible collapsed={this.props.isCollapsed}>
        <div className="componentHeader collapsible-header">
          <span className="componentTitle" title={componentDisplayName}>
            {this.getIcon()}
            <span>{componentDisplayName}</span>
          </span>
          <div className="componentHeaderActions">
            <a
              title="Copy to clipboard"
              data-action="copy-component-to-clipboard"
              data-component={componentName}
              className="button fa fa-clipboard"
            />
            <a
              title="Remove component"
              className="button fa fa-trash-o"
              onClick={this.removeComponent}
            />
          </div>
        </div>
        <div className="collapsible-content">{this.renderPropertyRows()}</div>
      </Collapsible>
    );
  }
}
