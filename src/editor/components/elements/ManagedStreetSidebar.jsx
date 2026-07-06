import PropTypes from 'prop-types';
import { useIntl } from 'react-intl';
import PropertyRow from './PropertyRow';
import { Button } from './Button';

const sourceLabels = {
  'streetmix-url': 'Streetmix',
  'streetplan-url': 'StreetPlan'
};

const ManagedStreetSidebar = ({ entity }) => {
  const intl = useIntl();
  const componentName = 'managed-street';
  const labelComponentName = 'street-label';
  // Check if entity and its components exist
  const component = entity?.components?.[componentName];
  const labelComponent = entity?.components?.[labelComponentName];
  const sourceLabel = sourceLabels[component?.data?.sourceType];

  const reloadFromSource = () => {
    // Replaces all segments (and local edits) with the source; runs as a
    // command so the pre-reload street is restorable via undo.
    if (
      window.confirm(
        intl.formatMessage(
          {
            id: 'managedStreetSidebar.reloadConfirm',
            defaultMessage:
              'Reload this street from {source}? Local segment edits will be lost.'
          },
          { source: sourceLabel }
        )
      )
    ) {
      AFRAME.INSPECTOR.execute('streetreload', { entity });
    }
  };

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
                  key="showBoundaries"
                  name="showBoundaries"
                  label="Boundaries"
                  schema={component.schema.showBoundaries}
                  data={component.data.showBoundaries}
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
                {sourceLabel && (
                  <Button variant="toolbtn" onClick={reloadFromSource}>
                    {intl.formatMessage(
                      {
                        id: 'managedStreetSidebar.reloadFromSource',
                        defaultMessage: 'Reload from {source}'
                      },
                      { source: sourceLabel }
                    )}
                  </Button>
                )}
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
