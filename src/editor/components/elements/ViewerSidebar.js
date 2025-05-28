import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';
import PropertyRow from './PropertyRow';
import AdvancedComponents from './AdvancedComponents';
import Events from '../../lib/Events';

// Helper function to determine if a property should be shown based on schema conditions
function shouldShowProperty(propertyName, component) {
  if (!component.schema[propertyName].if) {
    return true;
  }

  let showProperty = true;
  for (const [conditionKey, conditionValue] of Object.entries(
    component.schema[propertyName].if
  )) {
    if (Array.isArray(conditionValue)) {
      if (conditionValue.indexOf(component.data[conditionKey]) === -1) {
        showProperty = false;
        break;
      }
    } else {
      if (conditionValue !== component.data[conditionKey]) {
        showProperty = false;
        break;
      }
    }
  }
  return showProperty;
}

const ViewerSidebar = ({ entity }) => {
  const componentName = 'viewer-mode';
  // Use state to force re-renders
  const [, forceUpdate] = useState({});

  // Set up event listener to detect component changes
  useEffect(() => {
    if (!entity) return;

    const handleEntityUpdate = (detail) => {
      if (detail.entity === entity && detail.component === componentName) {
        // Force a re-render when the component changes
        forceUpdate({});
      }
    };

    // Subscribe to entity update events
    Events.on('entityupdate', handleEntityUpdate);

    // Clean up when component unmounts
    return () => {
      Events.off('entityupdate', handleEntityUpdate);
    };
  }, [entity]);

  // Check if entity and its components exist
  const component = entity?.components?.[componentName];

  return (
    <div className="viewer-sidebar">
      <div className="viewer-controls">
        <div className="details">
          {component && component.schema && component.data && (
            <>
              <PropertyRow
                key="preset"
                name="preset"
                label="Viewing Mode"
                schema={component.schema['preset']}
                data={component.data['preset']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />
              {/* Use the shouldShowProperty function to determine if cameraPath should be shown */}
              {shouldShowProperty('cameraPath', component) && (
                <PropertyRow
                  key="cameraPath"
                  name="cameraPath"
                  label="Camera Path Style"
                  schema={component.schema['cameraPath']}
                  data={component.data['cameraPath']}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
              )}
            </>
          )}
          {entity && entity.components && (
            <div className="propertyRow">
              <AdvancedComponents entity={entity} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

ViewerSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default ViewerSidebar;
