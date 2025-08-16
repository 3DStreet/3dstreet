import PropTypes from 'prop-types';
import { Button } from '../elements/Button';
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
                  key="enabled"
                  name="enabled"
                  label="Labels"
                  schema={labelComponent.schema.enabled}
                  data={labelComponent.data.enabled}
                  componentname={labelComponentName}
                  isSingle={false}
                  entity={entity}
                />
                <div className="propertyRow">
                  <label className="text">Accent Colors</label>
                  <Button
                    variant="toolbtn"
                    onClick={component?.randomizeColors}
                  >
                    Random
                  </Button>
                  <Button
                    variant="toolbtn"
                    onClick={component?.neutralAutoColors}
                  >
                    Neutral
                  </Button>
                  <Button variant="toolbtn" onClick={component?.resetColors}>
                    Reset
                  </Button>
                </div>
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
