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
} from '@shared/icons';
import ModelsArrayWidget from '../widgets/ModelsArrayWidget';
import NumberWidget from '../widgets/NumberWidget';
import SelectWidget from '../widgets/SelectWidget';
import BooleanWidget from '../widgets/BooleanWidget';
import {
  executeSegmentUpdate,
  isMoreOpen,
  setMoreOpen
} from '../../lib/segmentPanel';

const isSingleProperty = AFRAME.schema.isSingleProperty;

// Compact generator section for the condensed segment sidebar (#1753):
// header carries the icon, an uppercase label, a per-generator "more"
// disclosure for rare props, and the remove action; frequently-edited props
// pair up on single rows. Every edit still flows through the inspector's
// undoable entityupdate path (executeSegmentUpdate).

const MoreChevron = ({ up }) => (
  <svg
    width="9"
    height="6"
    viewBox="0 0 12 7"
    fill="none"
    style={up ? { transform: 'rotate(180deg)' } : undefined}
  >
    <path
      d="M10.17 1.5L6 5.67 1.83 1.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
MoreChevron.propTypes = { up: PropTypes.bool };

/**
 * Single street-generated-* component rendered as a condensed section.
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
      name: this.props.name,
      moreOpen: isMoreOpen(this.props.name)
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
      // Re-read the session-remembered disclosure state for the new generator.
      return { name: props.name, moreOpen: isMoreOpen(props.name) };
    }
    return null;
  }

  toggleMore = () => {
    const moreOpen = !this.state.moreOpen;
    setMoreOpen(this.props.name, moreOpen);
    this.setState({ moreOpen });
  };

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

  update = (property, value) => {
    executeSegmentUpdate(this.props.entity, this.props.name, property, value);
  };

  // A compact numeric cell (32px box, optional in-field prefix and unit).
  numberCell = (
    property,
    {
      prefix,
      unit,
      precision = 2,
      schema,
      title,
      allowEmpty,
      emptyValue,
      placeholder
    } = {}
  ) => {
    const componentData = this.props.component;
    const propSchema =
      schema ||
      AFRAME.components[this.props.name.split('__')[0]].schema[property] ||
      {};
    return (
      <NumberWidget
        key={property}
        id={`${this.props.name}:${property}`}
        name={property}
        value={
          typeof componentData.data[property] === 'number'
            ? componentData.data[property]
            : 0
        }
        min={propSchema.min !== undefined ? propSchema.min : -Infinity}
        max={propSchema.max !== undefined ? propSchema.max : Infinity}
        prefix={prefix}
        unit={unit}
        title={title}
        allowEmpty={allowEmpty}
        emptyValue={emptyValue}
        placeholder={placeholder}
        precision={precision}
        onChange={(name, value) => this.update(name, value)}
      />
    );
  };

  selectCell = (property) => {
    const componentData = this.props.component;
    const schema =
      AFRAME.components[this.props.name.split('__')[0]].schema[property];
    return (
      <SelectWidget
        key={property}
        id={`${this.props.name}:${property}`}
        name={property}
        value={componentData.data[property]}
        options={schema.oneOf}
        onChange={(name, value) => this.update(name, value)}
      />
    );
  };

  toggleCell = (property, label) => {
    const componentData = this.props.component;
    return (
      <div className="inline-toggle" key={property}>
        <label htmlFor={`${this.props.name}:${property}`}>{label}</label>
        <BooleanWidget
          id={`${this.props.name}:${property}`}
          name={property}
          value={!!componentData.data[property]}
          onChange={(name, value) => this.update(name, value)}
        />
      </div>
    );
  };

  row = (label, cells, extraClass = '') => (
    <div className={`compact-row ${extraClass}`.trim()}>
      <label className="compact-label">{label}</label>
      {cells}
    </div>
  );

  moreInset = (cells) => (
    <div className="compact-row">
      <label className="compact-label" />
      <div className="more-inset">{cells}</div>
    </div>
  );

  renderClones() {
    const componentData = this.props.component;
    const mode = componentData.data.mode;
    const placeCells = [this.selectCell('mode')];
    if (mode === 'fixed') {
      placeCells.push(this.numberCell('spacing', { unit: 'm' }));
    } else if (mode === 'random') {
      placeCells.push(
        this.numberCell('count', { prefix: 'N', precision: 0 }),
        this.numberCell('spacing', { unit: 'm' })
      );
    } else if (mode === 'single') {
      placeCells.push(
        this.selectCell('justify'),
        this.numberCell('padding', { prefix: 'PAD' })
      );
    } else if (mode === 'fit') {
      placeCells.push(
        this.numberCell('spacing', { unit: 'm' }),
        this.selectCell('justifyWidth')
      );
    }

    return (
      <>
        <ModelsArrayWidget
          entity={this.props.entity}
          componentname={this.props.name}
          modelsArray={componentData.data['modelsArray']}
          maxChips={3}
        />
        {this.row('Place', placeCells, 'place-row')}
        {this.state.moreOpen &&
          this.moreInset(
            <>
              {this.numberCell('positionX', { prefix: 'X', unit: 'm' })}
              {this.numberCell('positionY', { prefix: 'Y', unit: 'm' })}
              {this.numberCell('facing', { prefix: 'FACING', unit: '°' })}
              {mode === 'fixed' &&
                this.numberCell('cycleOffset', { prefix: 'OFFSET' })}
              {this.toggleCell('randomFacing', 'Random facing')}
            </>
          )}
      </>
    );
  }

  renderStencil() {
    const componentData = this.props.component;
    const componentName = this.props.name;
    const schema = AFRAME.components[componentName.split('__')[0]].schema;
    return (
      <>
        <PropertyRow
          key="modelsArray"
          name="modelsArray"
          label="Models"
          schema={schema['modelsArray']}
          data={componentData.data['modelsArray']}
          componentname={componentName}
          entity={this.props.entity}
          isSingle={false}
        />
        {this.row('Spacing', [
          this.numberCell('spacing', { unit: 'm' }),
          this.numberCell('padding', {
            prefix: 'PAD',
            title:
              'Padding: distance between stencils within a group — only has an effect when more than one stencil model is selected'
          })
        ])}
        {this.state.moreOpen &&
          this.moreInset(
            <>
              {this.numberCell('positionX', { prefix: 'X', unit: 'm' })}
              {this.numberCell('positionY', { prefix: 'Y', unit: 'm' })}
              {/* stencilHeight overrides the stencil plane's length in
                  metres; 0 is the schema sentinel for "use the model's own
                  size" (street-generated-stencil only writes geometry when
                  > 0), so the field reads "auto" until a value is set and
                  clearing it restores auto. */}
              {this.numberCell('stencilHeight', {
                prefix: 'HEIGHT',
                unit: 'm',
                allowEmpty: true,
                placeholder: 'auto',
                title:
                  "Stencil height: overrides the stencil's printed length in meters. Leave on auto to keep each model's own size."
              })}
              {this.numberCell('cycleOffset', { prefix: 'OFFSET' })}
              {this.numberCell('facing', { prefix: 'FACING', unit: '°' })}
            </>
          )}
      </>
    );
  }

  renderStriping() {
    return this.row('Striping', [
      this.selectCell('striping'),
      this.selectCell('side')
    ]);
  }

  renderPedestrians() {
    return this.row('Density', [this.selectCell('density')]);
  }

  renderRail() {
    return this.row('Gauge', [
      this.numberCell('gauge', { unit: 'mm', precision: 0 })
    ]);
  }

  /**
   * Render propert(ies) of the component.
   */
  renderPropertyRows = () => {
    const componentData = this.props.component;
    const componentName = this.props.name;
    const schema = AFRAME.components[componentName.split('__')[0]].schema;

    // Safety check: if component data is not available, show refresh link
    if (!componentData || !componentData.data) {
      return (
        <div
          className="detailed"
          style={{ textAlign: 'center', padding: '10px' }}
        >
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              // Re-select the current entity to refresh the inspector panel
              const currentEntity = AFRAME.INSPECTOR.selectedEntity;
              if (currentEntity) {
                AFRAME.INSPECTOR.selectEntity(currentEntity);
              }
            }}
            style={{ color: '#1faaf2', textDecoration: 'underline' }}
          >
            Component data changed, click to refresh
          </a>
        </div>
      );
    }

    if (componentName.startsWith('street-generated-clones')) {
      return this.renderClones();
    } else if (componentName.startsWith('street-generated-stencil')) {
      return this.renderStencil();
    } else if (componentName.startsWith('street-generated-striping')) {
      return this.renderStriping();
    } else if (componentName.startsWith('street-generated-pedestrians')) {
      return this.renderPedestrians();
    } else if (componentName.startsWith('street-generated-rail')) {
      return this.renderRail();
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

  // Only generators with rarely-used props carry the "more" disclosure.
  hasMoreProps = () => {
    const componentName = this.props.name;
    return (
      componentName.startsWith('street-generated-clones') ||
      componentName.startsWith('street-generated-stencil')
    );
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
    const moreOpen = this.state.moreOpen;

    return (
      <div className="generator-section">
        <div className="generator-header">
          {this.getIcon()}
          <span className="generator-title" title={componentDisplayName}>
            {componentDisplayName}
          </span>
          {this.hasMoreProps() && (
            <button
              type="button"
              className={'more-toggle' + (moreOpen ? ' is-open' : '')}
              onClick={this.toggleMore}
            >
              {moreOpen ? 'less' : 'more'}
              <MoreChevron up={moreOpen} />
            </button>
          )}
          <a
            title="Remove component"
            className="generator-remove"
            onClick={this.removeComponent}
          >
            <TrashIcon />
          </a>
        </div>
        {this.renderPropertyRows()}
      </div>
    );
  }
}
