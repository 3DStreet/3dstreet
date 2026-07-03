import PropTypes from 'prop-types';
import PropertyRow from './PropertyRow';

const ManagedStreetSidebar = ({ entity }) => {
  const componentName = 'managed-street';
  const labelComponentName = 'street-label';
  // Check if entity and its components exist
  const component = entity?.components?.[componentName];
  const labelComponent = entity?.components?.[labelComponentName];

  return (
    <div className="managed-street-sidebar">
      <div className="street-controls">
        <div className="details">
          {component &&
            component.schema &&
            component.data &&
            labelComponent &&
            labelComponent.schema &&
            labelComponent.data && (
              <>
                <PropertyRow
                  key="length"
                  name="length"
                  label="Street Length"
                  schema={component.schema.length}
                  data={component.data.length}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
                <PropertyRow
                  key="showBuildings"
                  name="showBuildings"
                  label="Buildings"
                  schema={component.schema.showBuildings}
                  data={component.data.showBuildings}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
                <PropertyRow
                  key="showGround"
                  name="showGround"
                  label="Ground"
                  schema={component.schema.showGround}
                  data={component.data.showGround}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
                <PropertyRow
                  key="showStriping"
                  name="showStriping"
                  label="Striping"
                  schema={component.schema.showStriping}
                  data={component.data.showStriping}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
                <PropertyRow
                  key="showVehicles"
                  name="showVehicles"
                  label="Vehicles"
                  schema={component.schema.showVehicles}
                  data={component.data.showVehicles}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
                <PropertyRow
                  key="enabled"
                  name="enabled"
                  label="Labels"
                  schema={labelComponent.schema.enabled}
                  data={labelComponent.data.enabled}
                  componentname={labelComponentName}
                  isSingle={false}
                  entity={entity}
                />
              </>
            )}
        </div>
      </div>
    </div>
  );
};

ManagedStreetSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default ManagedStreetSidebar;
