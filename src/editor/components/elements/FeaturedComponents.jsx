import PropTypes from 'prop-types';
import { defineMessages, useIntl } from 'react-intl';
import Component from './Component';
import MaterialControls from './MaterialControls';
import OpacitySliderRow from '../widgets/OpacitySliderRow';
import { ShapeSectionControls } from './ShapeSidebar';
import { FocusHotspotSectionControls } from './FocusHotspotSidebar';
import { ViewerStartSectionControls } from './ViewerStartSidebar';
import { AwesomeIcon } from './AwesomeIcon';
import { faBullseye } from '@fortawesome/free-solid-svg-icons';
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
  // The shape section's first-class rows are closed + fill/line appearance
  // (which the alphabetical row sort already orders as closed, fillColor,
  // fillOpacity, lineColor, lineWidth). curveType/filletRadius are replaced by
  // the curated ShapeSectionControls at the top of the section; selectInside is
  // an escape valve. All stay reachable under Advanced Components.
  if (name === 'shape') {
    return ['selectInside', 'curveType', 'filletRadius'];
  }
  // The hotspot section renders every property through its own curated
  // controls (labelled rows, a real textarea for the description, the
  // focus-view buttons), so the generic rows are all hidden.
  if (name === 'focus-hotspot') {
    return Object.keys(component?.schema || {});
  }
  return undefined;
}

function getSectionChildren(name, entity) {
  if (name === 'shape') return <ShapeSectionControls entity={entity} />;
  if (name === 'focus-hotspot') {
    return <FocusHotspotSectionControls entity={entity} />;
  }
  if (name === 'viewer-start') {
    return <ViewerStartSectionControls entity={entity} />;
  }
  return undefined;
}

// Role components get their badge/type icon in the bar header and a
// removal prompt in the user's terms; other featured components keep the
// generic "may corrupt your scene" prompt.
const ROLE_SECTIONS = {
  'focus-hotspot': {
    icon: faBullseye,
    removeConfirmMessage: defineMessages({
      m: {
        id: 'focusHotspot.removeConfirm',
        defaultMessage:
          'Remove the focus hotspot from this entity? It will no longer be clickable in view mode.'
      }
    }).m
  },
  'viewer-start': {
    // No header icon: the layers-list type icon already says what it is.
    removeConfirmMessage: defineMessages({
      m: {
        id: 'viewerStart.removeConfirm',
        defaultMessage:
          'Remove the Starting View? Visitors will open the scene at the default view instead.'
      }
    }).m
  }
};

// Renders the first-class "featured" controls (geometry, material, and any
// street-generated-* generator) expanded at the top of the properties sidebar,
// above Advanced Components. Geometry and generators reuse the generic
// schema-driven Component widget; material gets a curated panel (MaterialControls).
const FeaturedComponents = ({ entity }) => {
  const intl = useIntl();
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
              propertyRenderers={
                name === 'shape' ? SHAPE_PROPERTY_RENDERERS : undefined
              }
              icon={
                ROLE_SECTIONS[name]?.icon ? (
                  <AwesomeIcon icon={ROLE_SECTIONS[name].icon} size={12} />
                ) : undefined
              }
              removeConfirmMessage={
                ROLE_SECTIONS[name]
                  ? intl.formatMessage(ROLE_SECTIONS[name].removeConfirmMessage)
                  : undefined
              }
            >
              {getSectionChildren(name, entity)}
            </Component>
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
