import Collapsible from '../Collapsible';
import Events from '../../lib/Events';
import PropTypes from 'prop-types';
import PropertyRow from './PropertyRow';
import React from 'react';
import {
  ClonedTreesIcon,
  StencilsIcon,
  StripingIcon,
  PedestriansIcon,
  RailIcon,
  TrashIcon
} from '../../icons';
import ModelsArrayWidget from '../widgets/ModelsArrayWidget';

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
    const componentName = this.props.name;
    const schema = AFRAME.components[componentName.split('__')[0]].schema;

    if (componentName.startsWith('street-generated-clones')) {
      // Custom rendering for clones
      return (
        <>
          <ModelsArrayWidget
            entity={this.props.entity}
            componentname={componentName}
          />
          <PropertyRow
            key="mode"
            name="mode"
            label="Mode"
            schema={schema['mode']}
            data={componentData.data['mode']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          {componentData.data.mode === 'fixed' && (
            <>
              <PropertyRow
                key="spacing"
                name="spacing"
                label="Spacing"
                schema={schema['spacing']}
                data={componentData.data['spacing']}
                componentname={componentName}
                entity={this.props.entity}
                isSingle={false}
              />
              <PropertyRow
                key="cycleOffset"
                name="cycleOffset"
                label="Cycle Offset"
                schema={schema['cycleOffset']}
                data={componentData.data['cycleOffset']}
                componentname={componentName}
                entity={this.props.entity}
                isSingle={false}
              />
            </>
          )}
          {componentData.data.mode === 'random' && (
            <>
              <PropertyRow
                key="spacing"
                name="spacing"
                label="Spacing"
                schema={schema['spacing']}
                data={componentData.data['spacing']}
                componentname={componentName}
                entity={this.props.entity}
                isSingle={false}
              />
              <PropertyRow
                key="count"
                name="count"
                label="Count"
                schema={schema['count']}
                data={componentData.data['count']}
                componentname={componentName}
                entity={this.props.entity}
                isSingle={false}
              />
            </>
          )}
          {componentData.data.mode === 'single' && (
            <>
              <PropertyRow
                key="justify"
                name="justify"
                label="Justify"
                schema={schema['justify']}
                data={componentData.data['justify']}
                componentname={componentName}
                entity={this.props.entity}
                isSingle={false}
              />
              <PropertyRow
                key="padding"
                name="padding"
                label="Padding"
                schema={schema['padding']}
                data={componentData.data['padding']}
                componentname={componentName}
                entity={this.props.entity}
                isSingle={false}
              />
            </>
          )}
          {componentData.data.mode === 'fit' && (
            <>
              <PropertyRow
                key="spacing"
                name="spacing"
                label="Spacing"
                schema={schema['spacing']}
                data={componentData.data['spacing']}
                componentname={componentName}
                entity={this.props.entity}
                isSingle={false}
              />
            </>
          )}
          <hr></hr>
          <PropertyRow
            key="positionX"
            name="positionX"
            label="PositionX"
            schema={schema['positionX']}
            data={componentData.data['positionX']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="positionY"
            name="positionY"
            label="PositionY"
            schema={schema['positionY']}
            data={componentData.data['positionY']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="facing"
            name="facing"
            label="Facing"
            schema={schema['facing']}
            data={componentData.data['facing']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="randomFacing"
            name="randomFacing"
            label="Random Facing"
            schema={schema['randomFacing']}
            data={componentData.data['randomFacing']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
        </>
      );
    } else if (componentName.startsWith('street-generated-stencil')) {
      return (
        <>
          <PropertyRow
            key="modelsArray"
            name="modelsArray"
            label="Stencils"
            schema={schema['modelsArray']}
            data={componentData.data['modelsArray']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="spacing"
            name="spacing"
            label="Spacing"
            schema={schema['spacing']}
            data={componentData.data['spacing']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="padding"
            name="padding"
            label="Padding"
            schema={schema['padding']}
            data={componentData.data['padding']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="stencilHeight"
            name="stencilHeight"
            label="Stencil Height"
            schema={schema['stencilHeight']}
            data={componentData.data['stencilHeight']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <hr></hr>
          <PropertyRow
            key="positionX"
            name="positionX"
            label="Position X"
            schema={schema['positionX']}
            data={componentData.data['positionX']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="positionY"
            name="positionY"
            label="Position Y"
            schema={schema['positionY']}
            data={componentData.data['positionY']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="cycleOffset"
            name="cycleOffset"
            label="Cycle Offset"
            schema={schema['cycleOffset']}
            data={componentData.data['cycleOffset']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="facing"
            name="facing"
            label="Facing"
            schema={schema['facing']}
            data={componentData.data['facing']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
        </>
      );
    } else if (componentName.startsWith('street-generated-striping')) {
      return (
        <>
          <PropertyRow
            key="striping"
            name="striping"
            label="Striping"
            schema={schema['striping']}
            data={componentData.data['striping']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="positionY"
            name="positionY"
            label="Position Y"
            schema={schema['positionY']}
            data={componentData.data['positionY']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="side"
            name="side"
            label="Side"
            schema={schema['side']}
            data={componentData.data['side']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="facing"
            name="facing"
            label="Facing"
            schema={schema['facing']}
            data={componentData.data['facing']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
        </>
      );
    } else if (componentName.startsWith('street-generated-pedestrians')) {
      return (
        <>
          <PropertyRow
            key="density"
            name="density"
            label="Density"
            schema={schema['density']}
            data={componentData.data['density']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="direction"
            name="direction"
            label="Direction"
            schema={schema['direction']}
            data={componentData.data['direction']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
          <PropertyRow
            key="positionY"
            name="positionY"
            label="Position Y"
            schema={schema['positionY']}
            data={componentData.data['positionY']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
        </>
      );
    } else if (componentName.startsWith('street-generated-rail')) {
      return (
        <>
          <PropertyRow
            key="gauge"
            name="gauge"
            label="Gauge"
            schema={schema['gauge']}
            data={componentData.data['gauge']}
            componentname={componentName}
            entity={this.props.entity}
            isSingle={false}
          />
        </>
      );
    }
    if (isSingleProperty(schema)) {
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
    } else if (componentName.startsWith('street-generated-pedestrians')) {
      return <PedestriansIcon />;
    } else if (componentName.startsWith('street-generated-rail')) {
      return <RailIcon />;
    }
    return <></>;
  };

  getDisplayName(componentName) {
    // Prefix mapping configuration
    const PREFIX_MAPPING = {
      'street-generated-clones': 'Clones',
      'street-generated-striping': 'Striping',
      'street-generated-stencil': 'Stencils',
      'street-generated-pedestrians': 'Pedestrians',
      'street-generated-rail': 'Rail'
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
