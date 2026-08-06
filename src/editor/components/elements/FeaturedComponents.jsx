import PropTypes from 'prop-types';
import Component from './Component';
import MaterialControls from './MaterialControls';
import OpacitySliderRow from '../widgets/OpacitySliderRow';
import { getFeaturedComponentNames } from '../../lib/featuredComponents';

// Low-level geometry props that are too advanced for the first-class section.
// They stay reachable under Advanced Components. `segments*` (tessellation) props
// are also hidden via the prefix check below.
const HIDDEN_GEOMETRY_PROPS = ['buffer', 'skipCache'];

function getHiddenGeometryProps(component) {
  const schema = component?.schema || {};
  return Object.keys(schema).filter(
    (name) =>
      HIDDEN_GEOMETRY_PROPS.includes(name) || name.startsWith('segments')
  );
}

// A shape's fill opacity is stored as an integer percent, so it gets the same
// slider-plus-number treatment as the map layer's opacity rather than a bare
// number field: the unit is the whole question ("40" alone reads equally well
// as 40% or as a 0..1 opacity typed wrong), and a fill is a value users scrub
// to taste rather than type. The label carries the unit, as the map layer's
// does.
const SHAPE_PROPERTY_RENDERERS = {
  fillOpacity: ({ entity, value }) => (
    <OpacitySliderRow
      id="shape-fillOpacity"
      label="Fill Opacity (%)"
      min={0}
      max={100}
      step={1}
      value={typeof value === 'number' ? value : 0}
      onCommit={(newValue) =>
        AFRAME.INSPECTOR.execute('entityupdate', {
          entity,
          component: 'shape',
          property: 'fillOpacity',
          value: newValue,
          noSelectEntity: true
        })
      }
      showNumberInput
    />
  )
};

// Renders the first-class "featured" controls (geometry, material, and any
// street-generated-* generator) expanded at the top of the properties sidebar,
// above Advanced Components. Geometry and generators reuse the generic
// schema-driven Component widget; material gets a curated panel (MaterialControls).
const FeaturedComponents = ({ entity }) => {
  const components = entity ? entity.components : {};
  const featured = getFeaturedComponentNames(entity);

  if (featured.length === 0) {
    return null;
  }

  return (
    <div className="featured-components">
      {featured.map((name) => {
        if (name === 'material') {
          return <MaterialControls key={name} entity={entity} />;
        }
        return (
          <div key={name} className="details">
            <Component
              isCollapsed={false}
              component={components[name]}
              entity={entity}
              name={name}
              hideProperties={
                name === 'geometry'
                  ? getHiddenGeometryProps(components[name])
                  : undefined
              }
              propertyRenderers={
                name === 'shape' ? SHAPE_PROPERTY_RENDERERS : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
};

FeaturedComponents.propTypes = {
  // entity can be null (e.g. no selection) — the component renders nothing.
  entity: PropTypes.object
};

export default FeaturedComponents;
