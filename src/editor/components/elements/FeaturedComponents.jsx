import PropTypes from 'prop-types';
import Component from './Component';
import MaterialControls from './MaterialControls';
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

function getHiddenProps(name, component) {
  if (name === 'geometry') {
    return getHiddenGeometryProps(component);
  }
  // geo-flatten's mode (own mesh vs auto footprint proxy) is picked correctly
  // by whatever attaches the component (mesh for primitives, auto for models
  // and streets); exposing it invites switching a street to mesh, which
  // raycasts every model triangle and snaps terrain to vehicle/tree tops.
  if (name === 'geo-flatten') {
    return ['mode'];
  }
  return undefined;
}

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
              hideProperties={getHiddenProps(name, components[name])}
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
