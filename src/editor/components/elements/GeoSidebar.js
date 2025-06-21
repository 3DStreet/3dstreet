import PropTypes from 'prop-types';
import { Button } from '../elements';
import { useAuthContext } from '@/editor/contexts/index.js';
import AdvancedComponents from './AdvancedComponents';
import PropertyRow from './PropertyRow';
import posthog from 'posthog-js';
import useStore from '@/store';
import { useState, useEffect } from 'react';
import Events from '../../lib/Events';

const FlatteningShapeSelector = ({
  entity,
  componentName,
  shapeEntities,
  currentValue
}) => {
  const handleShapeChange = (event) => {
    const value = event.target.value;
    // Use AFRAME inspector to properly update the entity and trigger re-renders
    if (window.AFRAME && window.AFRAME.INSPECTOR) {
      AFRAME.INSPECTOR.execute('entityupdate', {
        entity: entity,
        component: componentName,
        property: 'flatteningShape',
        value: value
      });
    }
  };

  const handleCreateShape = () => {
    // Check if a flattening shape already exists
    const existingShape = document.querySelector(
      '[data-layer-name="Geo Flattening Shape"]'
    );
    if (existingShape) {
      console.log(
        'Flattening shape already exists, using existing shape:',
        existingShape.id
      );
      // Select the existing shape and update component
      if (AFRAME.INSPECTOR) {
        AFRAME.INSPECTOR.selectEntity(existingShape);
      }
      if (window.AFRAME && window.AFRAME.INSPECTOR) {
        AFRAME.INSPECTOR.execute('entityupdate', {
          entity: entity,
          component: componentName,
          property: 'flatteningShape',
          value: existingShape.id
        });
      }
      return;
    }

    // Generate a unique ID
    const shapeId = 'flattening-shape-' + Date.now();

    // Create the default flattening shape using inspector command
    const definition = {
      id: shapeId,
      element: 'a-box',
      'data-layer-name': 'Geo Flattening Shape',
      class: 'flattening shape',
      components: {
        scale: '20 5 40',
        material: 'transparent: true; opacity: 0.3; color: purple'
      }
    };

    // Use inspector's entitycreate command which handles selection automatically
    AFRAME.INSPECTOR.execute('entitycreate', definition);

    // Wait for the DOM element to be created before setting the property
    setTimeout(() => {
      if (window.AFRAME && window.AFRAME.INSPECTOR) {
        AFRAME.INSPECTOR.execute('entityupdate', {
          entity: entity,
          component: componentName,
          property: 'flatteningShape',
          value: shapeId
        });
      }
    }, 100);
  };

  return (
    <>
      <div className="propertyRow">
        <div className="fakePropertyRowLabel">Flattening Shape</div>
        <div className="fakePropertyRowValue">
          {shapeEntities.length > 0 ? (
            <select
              value={currentValue || ''}
              onChange={handleShapeChange}
              className="input-style"
              style={{
                width: '100%',
                color: currentValue ? 'white' : 'inherit'
              }}
            >
              <option value="">Select a shape...</option>
              {shapeEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-center text-sm">No shapes found in scene.</div>
          )}
        </div>
      </div>
      {shapeEntities.length === 0 && (
        <div className="propertyRow">
          <div className="fakePropertyRowLabel"></div>
          <div className="fakePropertyRowValue">
            <Button variant="toolbtn" onClick={handleCreateShape}>
              Create Flattening Shape
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

FlatteningShapeSelector.propTypes = {
  entity: PropTypes.object.isRequired,
  componentName: PropTypes.string.isRequired,
  shapeEntities: PropTypes.array.isRequired,
  currentValue: PropTypes.string
};

const GeoSidebar = ({ entity }) => {
  const setModal = useStore((state) => state.setModal);
  const { currentUser } = useAuthContext();

  // Force re-render when entity updates
  const [, forceUpdate] = useState({});

  useEffect(() => {
    if (!entity) return;

    const handleEntityUpdate = (detail) => {
      if (detail.entity === entity && detail.component === 'street-geo') {
        // Force a re-render when the street-geo component changes
        forceUpdate({});
      }
    };

    // Subscribe to entity update events
    Events.on('entityupdate', handleEntityUpdate);

    return () => {
      Events.off('entityupdate', handleEntityUpdate);
    };
  }, [entity]);

  const getShapeEntities = () => {
    const entities = Array.from(document.querySelectorAll('[class*="shape"]'));
    return entities.map((entity) => ({
      id: entity.id || `shape-${entities.indexOf(entity)}`,
      name:
        entity.getAttribute('data-layer-name') ||
        entity.id ||
        `Shape ${entities.indexOf(entity) + 1}`
    }));
  };

  const openGeoModal = () => {
    posthog.capture('openGeoModalFromSidebar');
    posthog.capture('geo_panel_clicked');
    if (!currentUser) {
      setModal('signin');
    } else if (currentUser.isPro) {
      setModal('geo');
    } else {
      setModal('payment');
    }
  };

  // Check if entity and its components exist
  const component = entity?.components?.['street-geo'];

  return (
    <div className="geo-sidebar">
      <div className="geo-controls">
        <div className="details">
          <div className="propertyRow">
            {entity && entity.components ? (
              <>
                <Button variant="toolbtn" onClick={openGeoModal}>
                  Change Location
                </Button>
              </>
            ) : (
              <div>
                <Button variant="toolbtn" onClick={openGeoModal}>
                  Set Location
                </Button>
              </div>
            )}
          </div>
          {component && component.schema && component.data && (
            <>
              <PropertyRow
                key="maps"
                name="maps"
                label="Map Source"
                schema={component.schema['maps']}
                data={component.data['maps']}
                componentname="street-geo"
                isSingle={false}
                entity={entity}
              />
              {/* only show this if google3d is selected */}
              {component.data['maps'] === 'google3d' && (
                <div className="collapsible component">
                  <div className="static">
                    <div className="componentHeader collapsible-header">
                      <span className="componentTitle" title="Surface">
                        <span>Blending & Flattening</span>
                      </span>
                    </div>
                  </div>
                  <div className="content">
                    <div className="collapsible-content">
                      <PropertyRow
                        key="blendingEnabled"
                        name="blendingEnabled"
                        label="Blending"
                        schema={component.schema['blendingEnabled']}
                        data={component.data['blendingEnabled']}
                        componentname="street-geo"
                        isSingle={false}
                        entity={entity}
                      />
                      {component.data['blendingEnabled'] && (
                        <PropertyRow
                          key="blendMode"
                          name="blendMode"
                          label="Blend Mode"
                          schema={component.schema['blendMode']}
                          data={component.data['blendMode']}
                          componentname="street-geo"
                          isSingle={false}
                          entity={entity}
                        />
                      )}
                      <PropertyRow
                        key="enableFlattening"
                        name="enableFlattening"
                        label="Terrain Flattening"
                        schema={component.schema['enableFlattening']}
                        data={component.data['enableFlattening']}
                        componentname="street-geo"
                        isSingle={false}
                        entity={entity}
                      />
                      {component.data['enableFlattening'] && (
                        <FlatteningShapeSelector
                          entity={entity}
                          componentName="street-geo"
                          shapeEntities={getShapeEntities()}
                          currentValue={component.data['flatteningShape']}
                        />
                      )}
                    </div>
                  </div>
                </div>
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

GeoSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default GeoSidebar;
