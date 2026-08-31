import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import PropertyRow from './PropertyRow';
import BooleanWidget from '../widgets/BooleanWidget';

/**
 * Managed Intersection sidebar: surfaces the managed-intersection component
 * properties directly (crosswalk / traffic control / curb radius / trimming
 * / snap radius) so users never need the Advanced Components toggle, plus a
 * live connected-streets readout. Follows the ManagedStreetSidebar pattern:
 * schema-driven PropertyRows writing through the undoable entityupdate
 * command.
 */
const ManagedIntersectionSidebar = ({ entity }) => {
  const intl = useIntl();
  const componentName = 'managed-intersection';
  const component = entity?.components?.[componentName];
  // Attached automatically in init (mode: auto), same as managed-street.
  const geoFlattenComponent = entity?.components?.['geo-flatten'];

  // Re-render on every rebuild so the connected-arms readout stays live
  // while streets are dragged in and out of the snap radius.
  const [, setRefreshTick] = useState(0);
  useEffect(() => {
    const onRefreshed = () => setRefreshTick((t) => t + 1);
    entity.addEventListener('intersection-refreshed', onRefreshed);
    return () =>
      entity.removeEventListener('intersection-refreshed', onRefreshed);
  }, [entity]);

  if (!component || !component.schema || !component.data) {
    return null;
  }

  const armCount = component.lastGeometry
    ? component.lastGeometry.mouths.length
    : 0;
  const connectionStatus =
    armCount >= 2
      ? intl.formatMessage(
          {
            id: 'managedIntersectionSidebar.connectedStreets',
            defaultMessage:
              '{count, plural, one {# connected street} other {# connected streets}}'
          },
          { count: armCount }
        )
      : intl.formatMessage({
          id: 'managedIntersectionSidebar.awaitingStreets',
          defaultMessage:
            'No streets connected yet — move managed street ends within the snap radius.'
        });

  const row = (name, label) => (
    <PropertyRow
      key={name}
      name={name}
      label={label}
      schema={component.schema[name]}
      data={component.data[name]}
      componentname={componentName}
      isSingle={false}
      entity={entity}
    />
  );

  return (
    <div className="managed-intersection-sidebar">
      <div className="details">
        <div className="propertyRow" key="connectionStatus">
          <div className="rounded bg-blue-50 p-2 text-gray-600">
            {connectionStatus}
          </div>
        </div>
        {row('crosswalk', 'Crosswalk')}
        {row('trafficControl', 'Traffic Control')}
        {row('curbRadius', 'Curb Radius')}
        {row('showSidewalkCorners', 'Sidewalk Corners')}
        {row('snapStreets', 'Snap Streets')}
        {row('snapRadius', 'Snap Radius')}
        {geoFlattenComponent ? (
          <PropertyRow
            key="flattenTerrain"
            name="enabled"
            label="Flatten Terrain"
            schema={geoFlattenComponent.schema.enabled}
            data={geoFlattenComponent.data.enabled}
            componentname="geo-flatten"
            isSingle={false}
            entity={entity}
          />
        ) : (
          // Removed via Advanced Components; keep the toggle so flattening
          // never dead-ends — checking it re-adds the footprint volume.
          <div className="propertyRow" key="flattenTerrain">
            <label
              htmlFor="geo-flatten:add"
              className="text"
              style={{ textTransform: 'none' }}
            >
              Flatten Terrain
            </label>
            <BooleanWidget
              id="geo-flatten:add"
              name="enabled"
              value={false}
              onChange={() =>
                AFRAME.INSPECTOR.execute('componentadd', {
                  entity,
                  component: 'geo-flatten',
                  value: 'mode: auto'
                })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
};

ManagedIntersectionSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default ManagedIntersectionSidebar;
