import PropTypes from 'prop-types';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button } from '../elements';
import { useAuthContext } from '@/editor/contexts/index.js';
import PropertyRow from './PropertyRow';
import NumberWidget from '../widgets/NumberWidget';
import { Magnifier20Icon, SunIcon } from '@shared/icons';
import { geoSourcePhrase } from '@shared/constants/geoSources.js';
import posthog from 'posthog-js';
import useStore from '@/store';
import { useState, useEffect } from 'react';
import Events from '../../lib/Events';
import { Tooltip } from 'radix-ui';
import { commonMessages } from '@/editor/i18n/commonMessages';

const TooltipWrapper = ({ children, content, side = 'bottom', ...props }) => {
  return (
    <Tooltip.Root delayDuration={0}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={5}
          style={{
            backgroundColor: '#2d2d2d',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            border: '1px solid #4b4b4b',
            zIndex: 1000
          }}
          {...props}
        >
          {content}
          <Tooltip.Arrow style={{ fill: '#2d2d2d' }} />
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
  const intl = useIntl();
  const handleShapeChange = (event) => {
    const value = event.target.value;
    // Use AFRAME inspector to properly update the entity and trigger re-renders
    if (window.AFRAME && window.AFRAME.INSPECTOR) {
      AFRAME.INSPECTOR.execute('entityupdate', {
        entity: entity,
        component: componentName,
        property: 'flatteningShape',
        value: value,
        noSelectEntity: true
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
          value: existingShape.id,
          noSelectEntity: true
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
          value: shapeId,
          noSelectEntity: true
        });
      }
    }, 100);
  };

  return (
    <>
      <div className="propertyRow">
        <div className="fakePropertyRowLabel">
          <FormattedMessage
            id="geoSidebar.flatteningShape"
            defaultMessage="Flattening Shape"
          />
        </div>
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
              <option value="">
                {intl.formatMessage({
                  id: 'geoSidebar.selectShape',
                  defaultMessage: 'Select a shape...'
                })}
              </option>
              {shapeEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-center text-sm">
              <FormattedMessage
                id="geoSidebar.noShapesFound"
                defaultMessage="No shapes found in scene."
              />
            </div>
          )}
        </div>
      </div>
      {shapeEntities.length === 0 && (
        <div className="propertyRow">
          <div className="fakePropertyRowLabel"></div>
          <div className="fakePropertyRowValue">
            <Button variant="toolbtn" onClick={handleCreateShape}>
              <FormattedMessage
                id="geoSidebar.createFlatteningShape"
                defaultMessage="Create Flattening Shape"
              />
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

// Slider + number input for street-geo opacity (#1738). The slider (same
// pattern as MaterialControls' opacity row, #1741) gives coarse control;
// the NumberWidget keeps exact typing and click-drag fine tuning. Both
// write the same entityupdate, so consecutive drags collapse into one
// undo step and the two inputs stay in sync via the sidebar's
// entityupdate re-render.
const MapOpacityRow = ({ entity, opacity }) => {
  const intl = useIntl();
  const setOpacity = (value) => {
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: 'street-geo',
      property: 'opacity',
      value,
      noSelectEntity: true
    });
  };
  return (
    <div className="propertyRow opacity-row">
      <label
        className="text"
        htmlFor="street-geo-opacity"
        style={{ textTransform: 'none' }}
      >
        {intl.formatMessage({
          id: 'geoSidebar.mapOpacity',
          defaultMessage: 'Map Opacity (%)'
        })}
      </label>
      <div className="opacity-slider">
        <input
          id="street-geo-opacity"
          type="range"
          min="0"
          max="100"
          step="1"
          value={opacity}
          onChange={(e) => setOpacity(parseInt(e.target.value, 10))}
        />
        <NumberWidget
          id="street-geo-opacity-number"
          name="opacity"
          min={0}
          max={100}
          precision={0}
          value={opacity}
          onChange={(name, value) => setOpacity(value)}
        />
      </div>
    </div>
  );
};

MapOpacityRow.propTypes = {
  entity: PropTypes.object.isRequired,
  opacity: PropTypes.number.isRequired
};

const EnvironmentSection = () => {
  const intl = useIntl();
  const envEntity = document.getElementById('environment');
  const [, forceUpdate] = useState({});

  useEffect(() => {
    if (!envEntity) return;
    const handle = (detail) => {
      if (
        detail.entity === envEntity &&
        detail.component === 'street-environment'
      ) {
        forceUpdate({});
      }
    };
    Events.on('entityupdate', handle);
    return () => Events.off('entityupdate', handle);
  }, [envEntity]);

  if (!envEntity) return null;
  const component = envEntity.components?.['street-environment'];
  if (!component || !component.schema || !component.data) return null;

  return (
    <div className="collapsible component">
      <div className="static">
        <div className="componentHeader collapsible-header">
          <span
            className="componentTitle"
            title={intl.formatMessage({
              id: 'geoSidebar.environment',
              defaultMessage: 'Environment'
            })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <SunIcon />
            <span>
              <FormattedMessage
                id="geoSidebar.environment"
                defaultMessage="Environment"
              />
            </span>
          </span>
        </div>
      </div>
      <div className="content">
        <div className="collapsible-content">
          <PropertyRow
            key="preset"
            name="preset"
            label={intl.formatMessage({
              id: 'geoSidebar.preset',
              defaultMessage: 'Preset'
            })}
            schema={component.schema['preset']}
            data={component.data['preset']}
            componentname="street-environment"
            isSingle={false}
            entity={envEntity}
            noSelectEntity={true}
          />
          <PropertyRow
            key="backgroundColor"
            name="backgroundColor"
            label={intl.formatMessage({
              id: 'geoSidebar.background',
              defaultMessage: 'Background'
            })}
            schema={component.schema['backgroundColor']}
            data={component.data['backgroundColor']}
            componentname="street-environment"
            isSingle={false}
            entity={envEntity}
            noSelectEntity={true}
          />
        </div>
      </div>
    </div>
  );
};

// Empty / not-activated hero (#1654 redesign). Until a scene has an activated
// geospatial location, the map-type / location / blending controls are inert,
// so we hide them (see GeoSidebar) and foreground a single honest CTA. The
// copy names the action ("Add Geo Layer"), the payoff (real-world maps), and
// the cost (one geo token) so the token economy is legible at the point of
// spend. Plan/token state only changes the CTA, not the layout. The saved
// location's provenance copy comes from geoSourcePhrase (@shared/constants).
const GeoHero = ({
  hasLocation,
  isPro,
  geoToken,
  source,
  onAdd,
  onUpgrade
}) => {
  const intl = useIntl();
  const outOfTokens = !isPro && geoToken === 0;
  const sourcePhrase = geoSourcePhrase(source);
  const savedLocationCopy = sourcePhrase
    ? intl.formatMessage(
        {
          id: 'geoSidebar.savedLocationWithSource',
          defaultMessage:
            'This scene has a saved location {sourcePhrase}. Add the geo layer to load 3D buildings, terrain, and satellite imagery.'
        },
        { sourcePhrase }
      )
    : intl.formatMessage({
        id: 'geoSidebar.savedLocation',
        defaultMessage:
          'This scene has a saved location. Add the geo layer to load 3D buildings, terrain, and satellite imagery.'
      });
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '8px',
        margin: '4px 12px 16px',
        padding: '18px 16px',
        borderRadius: '10px',
        background: 'rgba(119, 77, 238, 0.08)',
        border: '1px solid rgba(119, 77, 238, 0.35)'
      }}
    >
      <div style={{ fontSize: '30px', lineHeight: 1 }}>🌍</div>
      <div style={{ fontWeight: 600, color: '#fff', fontSize: '14px' }}>
        {hasLocation
          ? intl.formatMessage({
              id: 'geoSidebar.mapNotLoaded',
              defaultMessage: 'Map not loaded yet'
            })
          : intl.formatMessage({
              id: 'geoSidebar.addRealWorldLocation',
              defaultMessage: 'Add a real-world location'
            })}
      </div>
      <div style={{ fontSize: '12px', lineHeight: 1.45, color: '#b8b8b8' }}>
        {hasLocation
          ? savedLocationCopy
          : intl.formatMessage({
              id: 'geoSidebar.dropSceneCopy',
              defaultMessage:
                'Drop your scene onto real-world maps with 3D buildings, terrain, and satellite imagery.'
            })}
      </div>
      <Button
        variant={outOfTokens ? 'upgrade' : 'toolbtn'}
        style={{
          width: '100%',
          justifyContent: 'center',
          marginTop: '4px',
          fontSize: '13px',
          padding: '10px 16px',
          ...(outOfTokens
            ? {}
            : {
                background: '#774dee',
                border: 'none',
                color: 'white',
                fontWeight: 600
              })
        }}
        onClick={outOfTokens ? onUpgrade : onAdd}
      >
        {outOfTokens
          ? intl.formatMessage(commonMessages.upgradeToPro)
          : intl.formatMessage({
              id: 'geoSidebar.addGeoLayer',
              defaultMessage: 'Add Geo Layer'
            })}
      </Button>
      {!isPro && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            fontSize: '11px',
            color: '#9ca3af'
          }}
        >
          <img
            src="/ui_assets/token-geo.png"
            alt={intl.formatMessage({
              id: 'geoSidebar.geoTokenAlt',
              defaultMessage: 'Geo Token'
            })}
            style={{ width: '16px', height: '16px', verticalAlign: 'middle' }}
          />
          <span>
            {outOfTokens
              ? intl.formatMessage({
                  id: 'geoSidebar.outOfTokens',
                  defaultMessage: "You're out of free geo tokens."
                })
              : intl.formatMessage(
                  {
                    id: 'geoSidebar.usesFreeTokens',
                    defaultMessage:
                      'Uses 1 of {geoToken} free geo tokens to add real-world map data.'
                  },
                  { geoToken }
                )}
          </span>
        </div>
      )}
    </div>
  );
};

GeoHero.propTypes = {
  hasLocation: PropTypes.bool,
  isPro: PropTypes.bool,
  geoToken: PropTypes.number,
  source: PropTypes.string,
  onAdd: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired
};

const GeoSidebar = ({ entity }) => {
  const intl = useIntl();
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

  // Geo activation state (#1654). The scene can carry a suggested lat/lon
  // (e.g. from the mobile app) without the elevation service ever having run,
  // in which case the activation gate in street-geo suppresses all map tiles.
  // Use the component's own predicates as the single source of truth so this
  // panel can't drift from the gate's definition of "located" / "activated".
  // Until activated, the geo-specific controls (map type, location details,
  // blending) are inert, so we hide them and show GeoHero instead — one honest
  // CTA per state. Environment is general scene config (separate #environment
  // entity) and stays visible throughout.
  const geoData = component?.data;
  const hasLocation = !!component && component.hasSuggestedLocation();
  const isActivated = !!component && component.isGeospatialActivated();

  const activateFromCallout = () => {
    posthog.capture('geo_activation_callout_clicked');
    openGeoModal();
  };

  return (
    <Tooltip.Provider>
      <div className="geo-sidebar">
        <div className="geo-controls">
          <div className="details">
            {/* Empty / not-activated: single honest CTA, geo controls hidden */}
            {!isActivated && (
              <GeoHero
                hasLocation={hasLocation}
                isPro={!!currentUser?.isPro}
                geoToken={tokenProfile?.geoToken ?? 0}
                source={geoData?.source}
                onAdd={hasLocation ? activateFromCallout : openGeoModal}
                onUpgrade={() => startCheckout('geo')}
              />
            )}
            {/* Map Source Selection */}
            {isActivated && component && component.schema && component.data && (
              <div className="propertyRow" style={{ marginBottom: '16px' }}>
                <div className="fakePropertyRowLabel">
                  <FormattedMessage
                    id="geoSidebar.mapType"
                    defaultMessage="Map Type"
                  />
                </div>
                <div
                  style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
                >
                  {['none', 'google3d', 'mapbox2d', 'osm3d'].map((mapType) => (
                    <TooltipWrapper
                      key={mapType}
                      content={
                        mapType === 'google3d'
                          ? intl.formatMessage({
                              id: 'geoSidebar.mapGoogle3d',
                              defaultMessage: 'Google 3D Map Tiles'
                            })
                          : mapType === 'mapbox2d'
                            ? intl.formatMessage({
                                id: 'geoSidebar.mapMapbox2d',
                                defaultMessage: 'Mapbox 2D Satellite'
                              })
                            : mapType === 'osm3d'
                              ? intl.formatMessage({
                                  id: 'geoSidebar.mapOsm3d',
                                  defaultMessage:
                                    'Open Street Map 2.5D Buildings'
                                })
                              : intl.formatMessage({
                                  id: 'geoSidebar.mapNone',
                                  defaultMessage: 'No Map'
                                })
                      }
                    >
                      <button
                        onClick={() => {
                          if (window.AFRAME && window.AFRAME.INSPECTOR) {
                            AFRAME.INSPECTOR.execute('entityupdate', {
                              entity: entity,
                              component: 'street-geo',
                              property: 'maps',
                              value: mapType,
                              noSelectEntity: true
                            });
                          }
                        }}
                        style={{
                          width: '50px',
                          height: '40px',
                          border:
                            component.data['maps'] === mapType
                              ? '2px solid #774dee'
                              : '1px solid #4b4b4b',
                          borderRadius: '6px',
                          background:
                            component.data['maps'] === mapType
                              ? '#4c1d95'
                              : '#2d2d2d',
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
                              alt={intl.formatMessage({
                                id: 'geoSidebar.mapGoogle3dAlt',
                                defaultMessage: 'Google 3D'
                              })}
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
                              alt={intl.formatMessage({
                                id: 'geoSidebar.mapMapbox2dAlt',
                                defaultMessage: 'Mapbox 2D'
                              })}
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
                              alt={intl.formatMessage({
                                id: 'geoSidebar.mapOsm3dAlt',
                                defaultMessage: 'OSM 3D'
                              })}
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

            {/* Activated: location status + change-location entry point */}
            {isActivated && (
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
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <TooltipWrapper
                      content={intl.formatMessage(
                        {
                          id: 'geoSidebar.centerpointTooltip',
                          defaultMessage:
                            "This scene's centerpoint is {latitude}, {longitude}"
                        },
                        {
                          latitude: geoData.latitude,
                          longitude: geoData.longitude
                        }
                      )}
                    >
                      <span
                        className="success-badge"
                        style={{
                          background: '#2d2d2d',
                          border: '1px solid #10b981',
                          color: 'white',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: '500'
                        }}
                      >
                        ✅{' '}
                        <FormattedMessage
                          id="geoSidebar.locationSet"
                          defaultMessage="Location Set"
                        />
                      </span>
                    </TooltipWrapper>
                    {!currentUser?.isPro && tokenProfile && (
                      <TooltipWrapper
                        content={intl.formatMessage(
                          commonMessages.useGeoTokensTooltip
                        )}
                      >
                        <span
                          className="token-badge"
                          style={{
                            background: '#2d2d2d',
                            color: '#9ca3af',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '10px'
                          }}
                        >
                          <img
                            src="/ui_assets/token-geo.png"
                            alt={intl.formatMessage({
                              id: 'geoSidebar.geoTokenAlt',
                              defaultMessage: 'Geo Token'
                            })}
                            style={{
                              width: '20px',
                              height: '20px',
                              marginRight: '3px',
                              display: 'inline-block',
                              verticalAlign: 'middle'
                            }}
                          />
                          <FormattedMessage
                            id="geoSidebar.tokensFree"
                            defaultMessage="{geoToken, plural, one {# free} other {# free}}"
                            values={{ geoToken: tokenProfile.geoToken }}
                          />
                        </span>
                      </TooltipWrapper>
                    )}
                  </div>
                  <Button variant="toolbtn" onClick={openGeoModal}>
                    <Magnifier20Icon />
                    <FormattedMessage
                      id="geoSidebar.changeLocation"
                      defaultMessage="Change Location"
                    />
                  </Button>
                </div>
              </div>
            )}

            {/* Upgrade prompt for activated scenes whose free user is out of
                tokens (so they can still change location). Not-activated
                scenes get the upsell inside GeoHero instead. */}
            {isActivated &&
              !currentUser?.isPro &&
              tokenProfile?.geoToken === 0 && (
                <div
                  className="propertyRow"
                  style={{ marginTop: '8px', paddingRight: '12px' }}
                >
                  <Button
                    variant="upgrade"
                    style={{
                      width: '100%',
                      fontSize: '12px',
                      padding: '12px 16px',
                      borderRadius: '8px'
                    }}
                    onClick={() => startCheckout('geo')}
                  >
                    <FormattedMessage
                      id="geoSidebar.upgradeForLookups"
                      defaultMessage="Upgrade to Pro for unlimited geo lookups"
                    />
                  </Button>
                </div>
              )}

            {/* Location details using standard label/value format. Gated on
                isActivated so a located-but-not-activated scene shows only the
                GeoHero, not an orphaned details block with no status badge. */}
            {isActivated &&
              component &&
              component.data &&
              component.data.locationString && (
                <>
                  <div className="propertyRow">
                    <div className="fakePropertyRowLabel">
                      <FormattedMessage
                        id="geoSidebar.location"
                        defaultMessage="Location"
                      />
                    </div>
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
                        <FormattedMessage
                          id="geoSidebar.nearestIntersection"
                          defaultMessage="Nearest<br></br> Intersection"
                          values={{ br: () => <br /> }}
                        />
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
                      <div className="fakePropertyRowLabel">
                        <FormattedMessage
                          id="geoSidebar.elevation"
                          defaultMessage="Elevation"
                        />
                      </div>
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

            <EnvironmentSection />

            {isActivated && component && component.schema && component.data && (
              <>
                {/* Opacity applies to google3d tiles and the mapbox2d plane;
                    flattening remains google3d-only. */}
                {['google3d', 'mapbox2d'].includes(component.data['maps']) && (
                  <div className="collapsible component">
                    <div className="static">
                      <div className="componentHeader collapsible-header">
                        <span
                          className="componentTitle"
                          title={intl.formatMessage(commonMessages.surface)}
                        >
                          <span>
                            <FormattedMessage
                              id="geoSidebar.opacityFlattening"
                              defaultMessage="Opacity & Flattening"
                            />
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="content">
                      <div className="collapsible-content">
                        <MapOpacityRow
                          entity={entity}
                          opacity={component.data['opacity']}
                        />
                        {component.data['maps'] === 'google3d' && (
                          <>
                            <PropertyRow
                              key="enableFlattening"
                              name="enableFlattening"
                              label={intl.formatMessage({
                                id: 'geoSidebar.terrainFlattening',
                                defaultMessage: 'Terrain Flattening'
                              })}
                              schema={component.schema['enableFlattening']}
                              data={component.data['enableFlattening']}
                              componentname="street-geo"
                              isSingle={false}
                              entity={entity}
                              noSelectEntity={true}
                            />
                            {component.data['enableFlattening'] && (
                              <FlatteningShapeSelector
                                entity={entity}
                                componentName="street-geo"
                                shapeEntities={getShapeEntities()}
                                currentValue={component.data['flatteningShape']}
                              />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
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
