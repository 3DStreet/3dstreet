import PropTypes from 'prop-types';
import { Button } from '../elements';
import { useAuthContext } from '@/editor/contexts/index.js';
import AdvancedComponents from './AdvancedComponents';
import PropertyRow from './PropertyRow';
import { Mangnifier20Icon } from '../../icons';
import posthog from 'posthog-js';
import useStore from '@/store';
import { useState, useEffect } from 'react';
import Events from '../../lib/Events';
import { Tooltip } from 'radix-ui';

const TooltipWrapper = ({ children, content, side = 'bottom', ...props }) => {
  return (
    <Tooltip.Root delayDuration={0}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={5}
          style={{
            backgroundColor: '#1f2937',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            border: '1px solid #374151',
            zIndex: 1000
          }}
          {...props}
        >
          {content}
          <Tooltip.Arrow style={{ fill: '#1f2937' }} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};

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
  const { currentUser, tokenProfile } = useAuthContext();
  const startCheckout = useStore((state) => state.startCheckout);

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
    } else {
      setModal('geo');
    }
  };

  // Check if entity and its components exist
  const component = entity?.components?.['street-geo'];

  return (
    <Tooltip.Provider>
      <div className="geo-sidebar">
        <div className="geo-controls">
          <div className="details">
            {/* Map Source Selection */}
            {component && component.schema && component.data && (
              <div className="propertyRow" style={{ marginBottom: '16px' }}>
                <div className="fakePropertyRowLabel">Map Type</div>
                <div
                  style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
                >
                  {['none', 'google3d', 'mapbox2d', 'osm3d'].map((mapType) => (
                    <TooltipWrapper
                      key={mapType}
                      content={
                        mapType === 'google3d'
                          ? 'Google 3D Map Tiles'
                          : mapType === 'mapbox2d'
                            ? 'Mapbox 2D Satellite'
                            : mapType === 'osm3d'
                              ? 'Open Street Map 2.5D Buildings'
                              : 'No Map'
                      }
                    >
                      <button
                        onClick={() => {
                          if (window.AFRAME && window.AFRAME.INSPECTOR) {
                            AFRAME.INSPECTOR.execute('entityupdate', {
                              entity: entity,
                              component: 'street-geo',
                              property: 'maps',
                              value: mapType
                            });
                          }
                        }}
                        style={{
                          width: '50px',
                          height: '40px',
                          border:
                            component.data['maps'] === mapType
                              ? '2px solid #774dee'
                              : '1px solid #374151',
                          borderRadius: '6px',
                          background:
                            component.data['maps'] === mapType
                              ? '#4c1d95'
                              : '#1f2937',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '16px',
                          transition: 'all 0.2s',
                          position: 'relative'
                        }}
                      >
                        {/* Map icons */}
                        {mapType === 'google3d' && (
                          <>
                            <img
                              src="/ui_assets/map-icon1.jpg"
                              alt="Google 3D"
                              style={{
                                width: '24px',
                                height: '24px',
                                objectFit: 'cover',
                                borderRadius: '2px'
                              }}
                            />
                            <span
                              style={{
                                position: 'absolute',
                                bottom: '4px',
                                fontSize: '8px',
                                color: '#ffffff',
                                fontWeight: '600',
                                textShadow:
                                  '0 1px 2px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.6)',
                                pointerEvents: 'none'
                              }}
                            >
                              3D
                            </span>
                          </>
                        )}
                        {mapType === 'mapbox2d' && (
                          <>
                            <img
                              src="/ui_assets/map-icon2.jpg"
                              alt="Mapbox 2D"
                              style={{
                                width: '24px',
                                height: '24px',
                                objectFit: 'cover',
                                borderRadius: '2px'
                              }}
                            />
                            <span
                              style={{
                                position: 'absolute',
                                bottom: '4px',
                                fontSize: '8px',
                                color: '#ffffff',
                                fontWeight: '600',
                                textShadow:
                                  '0 1px 2px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.6)',
                                pointerEvents: 'none'
                              }}
                            >
                              2D
                            </span>
                          </>
                        )}
                        {mapType === 'osm3d' && (
                          <>
                            <img
                              src="/ui_assets/map-icon3.jpg"
                              alt="OSM 3D"
                              style={{
                                width: '24px',
                                height: '24px',
                                objectFit: 'cover',
                                borderRadius: '2px'
                              }}
                            />
                            <span
                              style={{
                                position: 'absolute',
                                bottom: '4px',
                                fontSize: '8px',
                                color: '#ffffff',
                                fontWeight: '600',
                                textShadow:
                                  '0 1px 2px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.6)',
                                pointerEvents: 'none'
                              }}
                            >
                              2.5D
                            </span>
                          </>
                        )}
                        {mapType === 'none' && '🚫'}
                      </button>
                    </TooltipWrapper>
                  ))}
                </div>
              </div>
            )}

            {/* Combined location header with button */}
            <div className="propertyRow" style={{ marginBottom: '12px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  paddingRight: '12px'
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <TooltipWrapper
                    content={
                      component && component.data && component.data.latitude
                        ? `This scene's centerpoint is ${component.data.latitude}, ${component.data.longitude}`
                        : 'This scene has a geolocation centerpoint defined.'
                    }
                  >
                    <span
                      className="success-badge"
                      style={{
                        background: '#374151',
                        border:
                          component && component.data && component.data.latitude
                            ? '1px solid #10b981'
                            : '1px solid #6b7280',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '500'
                      }}
                    >
                      {component && component.data && component.data.latitude
                        ? '✅ Location Set'
                        : '📍 No Location'}
                    </span>
                  </TooltipWrapper>
                  {!currentUser?.isPro && tokenProfile && (
                    <TooltipWrapper content="Use geo tokens to set or change a geolocation for your scene.">
                      <span
                        className="token-badge"
                        style={{
                          background: '#374151',
                          color: '#9ca3af',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '10px'
                        }}
                      >
                        <img
                          src="/ui_assets/token-geo.png"
                          alt="Geo Token"
                          style={{
                            width: '20px',
                            height: '20px',
                            marginRight: '3px',
                            display: 'inline-block',
                            verticalAlign: 'middle'
                          }}
                        />
                        {tokenProfile.geoToken} free
                      </span>
                    </TooltipWrapper>
                  )}
                </div>
                <Button variant="toolbtn" onClick={openGeoModal}>
                  <Mangnifier20Icon />
                  {entity && entity.components
                    ? 'Change Location'
                    : 'Set Location'}
                </Button>
              </div>
            </div>

            {/* Upgrade prompt for users with 0 tokens */}
            {!currentUser?.isPro && tokenProfile?.geoToken === 0 && (
              <div className="propertyRow" style={{ marginTop: '8px' }}>
                <div
                  className="upgrade-prompt"
                  style={{
                    padding: '12px',
                    background: '#1f2937',
                    borderRadius: '6px',
                    border: '1px solid #374151',
                    width: '100%'
                  }}
                >
                  <p
                    style={{
                      margin: '0 0 8px 0',
                      fontSize: '11px',
                      color: '#f3f4f6',
                      fontWeight: '500'
                    }}
                  >
                    🚀 Upgrade to Pro for unlimited geo lookups
                  </p>
                  <Button
                    variant="toolbtn"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                    onClick={() => startCheckout('geo')}
                  >
                    Upgrade Now
                  </Button>
                </div>
              </div>
            )}

            {/* Location details using standard label/value format */}
            {component && component.data && component.data.locationString && (
              <>
                <div className="propertyRow">
                  <div className="fakePropertyRowLabel">Location</div>
                  <div
                    className="fakePropertyRowValue"
                    style={{ fontSize: '12px', color: '#ccc' }}
                  >
                    {component.data.locationString}
                  </div>
                </div>

                {component.data.intersectionString && (
                  <div className="propertyRow">
                    <div className="fakePropertyRowLabel">
                      Nearest
                      <br /> Intersection
                    </div>
                    <div
                      className="fakePropertyRowValue"
                      style={{ fontSize: '12px', color: '#ccc' }}
                    >
                      {component.data.intersectionString}
                    </div>
                  </div>
                )}

                {component.data.orthometricHeight && (
                  <div className="propertyRow">
                    <div className="fakePropertyRowLabel">Elevation</div>
                    <div
                      className="fakePropertyRowValue"
                      style={{ fontSize: '12px', color: '#ccc' }}
                    >
                      {Math.round(component.data.orthometricHeight)}m
                    </div>
                  </div>
                )}
              </>
            )}
            {component && component.schema && component.data && (
              <>
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
    </Tooltip.Provider>
  );
};

GeoSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default GeoSidebar;
