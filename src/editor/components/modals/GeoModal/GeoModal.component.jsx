import { useState, useCallback, useEffect, useRef } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { SavingModal } from '../SavingModal';
import styles from './GeoModal.module.scss';
import { Magnifier20Icon } from '@shared/icons';
import { firebaseConfig } from '@shared/services/firebase';
import Modal from '@shared/components/Modal/Modal.jsx';
import { Button, Input } from '../../elements/index.js';
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Autocomplete
} from '@react-google-maps/api';
import GeoImg from '../../../../../ui_assets/geo.png';
import { roundCoord } from '../../../../../src/utils.js';
import { setSceneLocation } from '../../../lib/utils.js';
import useStore from '@/store.js';
import { useAuthContext } from '../../../contexts/index.js';
import { canUseGeoFeature } from '@shared/utils/tokens';
import { GEO_SOURCES } from '@shared/constants/geoSources.js';
import posthog from 'posthog-js';
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

const GeoModal = () => {
  const intl = useIntl();
  const { currentUser, tokenProfile, refreshTokenProfile } = useAuthContext();
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: firebaseConfig.apiKey
  });

  const [markerPosition, setMarkerPosition] = useState({
    lat: 37.7637072, // lat: 37.76370724481858, lng: -122.41517686259827
    lng: -122.4151768
  });
  const [autocomplete, setAutocomplete] = useState(null);
  const [isWorking, setIsWorking] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [wasOpenedFromGeojson, setWasOpenedFromGeojson] = useState(false);
  const [currentLocationString, setCurrentLocationString] = useState('');
  // True once the user actively picks a new spot (map click, search, manual
  // coordinates) this session, as opposed to the prefill from the scene's
  // existing location. Drives provenance: a deliberate change stamps source
  // 'manual', while just activating the prefilled location keeps its origin.
  const userChangedLocationRef = useRef(false);
  const returnToPreviousModal = useStore(
    (state) => state.returnToPreviousModal
  );
  const isOpen = useStore((state) => state.modal === 'geo');
  const startCheckout = useStore((state) => state.startCheckout);
  const geojsonImportData = useStore((state) => state.geojsonImportData);
  const setGeojsonImportData = useStore((state) => state.setGeojsonImportData);
  const geoModalFromActivationGate = useStore(
    (state) => state.geoModalFromActivationGate
  );
  const setGeoModalFromActivationGate = useStore(
    (state) => state.setGeoModalFromActivationGate
  );

  const onClose = () => {
    // Dead-end recovery (#1654): the activation gate auto-opened this modal
    // and the user is dismissing without activating. The location is
    // preserved and the Geospatial panel's status badge surfaces the
    // "Location not activated" state with an Activate Map action, so no toast
    // is needed here — we just record the decline. Successful activation
    // clears the flag before closing, so this only fires on a real decline.
    if (geoModalFromActivationGate) {
      setGeoModalFromActivationGate(false);
      posthog.capture('geo_activation_prompt_dismissed', {
        latitude: markerPosition.lat,
        longitude: markerPosition.lng,
        is_pro_user: currentUser?.isPro || false,
        tokens_available: tokenProfile?.geoToken || 0,
        scene_id: STREET.utils.getCurrentSceneId()
      });
    }
    returnToPreviousModal();
  };

  useEffect(() => {
    if (isOpen) {
      // Fresh open: nothing the user touched yet, so the prefill below isn't a
      // "change". Marker interactions flip this back to true.
      userChangedLocationRef.current = false;
      // Check if we have GeoJSON import data first (takes priority)
      if (geojsonImportData && geojsonImportData.lat && geojsonImportData.lon) {
        const lat = roundCoord(geojsonImportData.lat);
        const lng = roundCoord(geojsonImportData.lon);

        if (!isNaN(lat) && !isNaN(lng)) {
          setMarkerPosition({ lat, lng });
        }

        // Set flag to show context-aware tips
        setWasOpenedFromGeojson(true);

        // Clear the import data after using it
        setGeojsonImportData(null);
      } else {
        // Fall back to existing scene location if no import data
        const streetGeo = document
          .getElementById('reference-layers')
          ?.getAttribute('street-geo');

        // Use a real lat/lng prefill even at the equator / prime meridian — a
        // 0 coordinate is valid, so test for presence, not truthiness.
        const hasCoords =
          streetGeo &&
          streetGeo['latitude'] != null &&
          streetGeo['longitude'] != null &&
          (streetGeo['latitude'] !== 0 || streetGeo['longitude'] !== 0);
        if (hasCoords) {
          const lat = roundCoord(parseFloat(streetGeo['latitude']));
          const lng = roundCoord(parseFloat(streetGeo['longitude']));

          if (!isNaN(lat) && !isNaN(lng)) {
            setMarkerPosition({ lat, lng });
          }

          // Set the current location string if available
          if (streetGeo.locationString) {
            setCurrentLocationString(streetGeo.locationString);
          }
        }
      }
    }
  }, [isOpen, geojsonImportData, setGeojsonImportData]);

  // Safety net for the activation-gate flag (#1654). onClose consumes it for
  // the dismissal event and clears it, and a successful save clears it too —
  // but other exits bypass onClose entirely (e.g. the 0-token Save that
  // switches to the checkout modal). Clear it on any close so the flag can't
  // leak into a later, unrelated open and mis-fire geo_activation_prompt_dismissed.
  useEffect(() => {
    if (!isOpen) {
      setGeoModalFromActivationGate(false);
    }
  }, [isOpen, setGeoModalFromActivationGate]);

  const setMarkerPositionAndElevation = useCallback((lat, lng) => {
    if (!isNaN(lat) && !isNaN(lng)) {
      // A user-driven pick (map click, search, manual coords) — provenance
      // becomes 'manual' on save.
      userChangedLocationRef.current = true;
      setMarkerPosition({
        lat: roundCoord(lat),
        lng: roundCoord(lng)
      });
    }
  }, []);

  const onMapClick = useCallback((event) => {
    setMarkerPositionAndElevation(event.latLng.lat(), event.latLng.lng());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCoordinateChange = (value) => {
    const [newLat, newLng] = value
      .split(',')
      .map((coord) => parseFloat(coord.trim()));

    setMarkerPositionAndElevation(newLat, newLng);
  };

  const onAutocompleteLoad = useCallback((autocompleteInstance) => {
    setAutocomplete(autocompleteInstance);
  }, []);

  const onPlaceChanged = useCallback(() => {
    if (autocomplete !== null) {
      const place = autocomplete.getPlace();
      if (place && place.geometry) {
        setMarkerPositionAndElevation(
          place.geometry.location.lat(),
          place.geometry.location.lng()
        );
      }
    } else {
      console.log('Autocomplete is not loaded yet!');
    }
  }, [autocomplete]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCloseCheck = (evt) => {
    // do not close geoModal when clicking on a list with suggestions for
    // addresses. The .pac-container is injected by Google Places only once
    // Autocomplete mounts, so it can be absent (geojson mode, API not loaded)
    // — treat "no container" as "no open suggestions" and allow the close.
    const autocompleteContainer = document.querySelector('.pac-container');
    if (!autocompleteContainer || autocompleteContainer.children.length === 0) {
      onClose();
    }
  };

  const onSaveHandler = async () => {
    // Skip auth check if opened from GeoJSON import (free during beta)
    if (!wasOpenedFromGeojson) {
      // Check if user can use geo feature (pro OR has tokens)
      const canUse = await canUseGeoFeature(currentUser);
      if (!canUse) {
        startCheckout('geo');
        return;
      }
    }

    setIsWorking(true);
    const latitude = markerPosition.lat;
    const longitude = markerPosition.lng;

    // Track geo location setting attempt
    posthog.capture('geo_location_set_attempt', {
      latitude: latitude,
      longitude: longitude,
      is_pro_user: currentUser?.isPro || false,
      tokens_available: tokenProfile?.geoToken || 0
    });

    // Use the shared utility function to set the scene location. A deliberate
    // change of location stamps 'manual' provenance; just activating the
    // prefilled location (or a geojson import) leaves the source resolution to
    // setSceneLocation so the original origin is preserved.
    const result = await setSceneLocation(latitude, longitude, {
      fromGeojsonImport: wasOpenedFromGeojson,
      ...(userChangedLocationRef.current && !wasOpenedFromGeojson
        ? { source: GEO_SOURCES.MANUAL }
        : {})
    });

    if (result.success && result.data) {
      const data = result.data;

      // Activation succeeded — the gate's offer was taken, so the dismissal
      // handling in onClose must not fire when the success overlay closes.
      setGeoModalFromActivationGate(false);

      // Refresh token profile to get updated count after successful save
      const previousTokenCount = tokenProfile?.geoToken || 0;
      await refreshTokenProfile();

      // Track successful geo location setting and token consumption
      posthog.capture('geo_location_set_success', {
        latitude: latitude,
        longitude: longitude,
        location_string: data.location?.locationString || '',
        intersection_string: data.nearestIntersection?.intersectionString || '',
        elevation: data.orthometricHeight || null,
        is_pro_user: currentUser?.isPro || false,
        tokens_consumed: currentUser?.isPro ? 0 : 1,
        tokens_remaining_before: previousTokenCount,
        scene_id: STREET.utils.getCurrentSceneId()
      });

      // Funnel event: geo_feature_used (standardized event for conversion funnel)
      posthog.capture('geo_feature_used', {
        token_type: 'geo',
        is_pro_user: currentUser?.isPro || false,
        scene_id: STREET.utils.getCurrentSceneId()
      });

      // Track if user just used their last geotoken
      if (!currentUser?.isPro && previousTokenCount === 1) {
        posthog.capture('geo_last_token_used', {
          latitude: latitude,
          longitude: longitude,
          location_string: data.location?.locationString || '',
          scene_id: STREET.utils.getCurrentSceneId(),
          tokens_remaining_after: 0
        });

        // Funnel event: token_limit_reached (for conversion funnel analysis)
        posthog.capture('token_limit_reached', {
          token_type: 'geo',
          scene_id: STREET.utils.getCurrentSceneId()
        });
      }

      // Show success overlay instead of immediately closing
      setSuccessData(data);
      setShowSuccessOverlay(true);
      setIsWorking(false);

      // Auto-dismiss after 4 seconds
      setTimeout(() => {
        setShowSuccessOverlay(false);
        setSuccessData(null);
        // Reset GeoJSON import state after overlay is dismissed
        setWasOpenedFromGeojson(false);
        onClose();
      }, 4000);
    } else {
      // Track failed geo location setting
      posthog.capture('geo_location_set_failed', {
        latitude: latitude,
        longitude: longitude,
        error_message: result.message || 'Unknown error',
        is_pro_user: currentUser?.isPro || false,
        tokens_available: tokenProfile?.geoToken || 0,
        scene_id: STREET.utils.getCurrentSceneId()
      });

      // Show error notification
      STREET.notify.errorMessage(
        result.message ||
          intl.formatMessage({
            id: 'geoModal.setLocationFailed',
            defaultMessage: 'Failed to set scene location. Please try again.'
          })
      );
      setIsWorking(false);
      onClose();
    }
  };

  return (
    <Tooltip.Provider>
      <Modal
        className={styles.modalWrapper}
        isOpen={isOpen}
        onClose={onCloseCheck}
        titleElement={
          <div className="flex items-center pr-4 pt-5">
            <img
              src={GeoImg}
              alt="geo"
              style={{ width: '27px', height: '32px', marginRight: '8px' }}
            />
            <div className="font-large text-center text-2xl">
              <FormattedMessage
                id="geoModal.setSceneLocation"
                defaultMessage="Set Scene Location"
              />
            </div>
          </div>
        }
      >
        <div className={styles.wrapper}>
          {isLoaded && (
            <>
              <GoogleMap
                mapContainerStyle={{
                  width: '100%',
                  minHeight: '200px',
                  borderRadius: 4,
                  border: '1px solid #8965EF'
                }}
                center={{ lat: markerPosition.lat, lng: markerPosition.lng }}
                zoom={20}
                onClick={onMapClick}
                options={{ streetViewControl: false, mapTypeId: 'satellite' }}
                tilt={0}
              >
                <Marker
                  position={{
                    lat: markerPosition.lat,
                    lng: markerPosition.lng
                  }}
                />
              </GoogleMap>
            </>
          )}
          {!wasOpenedFromGeojson && (
            <Autocomplete
              onLoad={onAutocompleteLoad}
              onPlaceChanged={onPlaceChanged}
            >
              <Input
                leadingIcon={<Magnifier20Icon />}
                placeholder={
                  currentLocationString ||
                  intl.formatMessage({
                    id: 'geoModal.searchForLocation',
                    defaultMessage: 'Search for a location'
                  })
                }
                onChange={(value) => {}}
              />
            </Autocomplete>
          )}
          <div className={styles.sceneGeo}>
            <div>
              <p>
                <FormattedMessage
                  id="geoModal.centerpoint"
                  defaultMessage="Centerpoint"
                />
              </p>
              <Input
                leadingIcon={
                  <p className={styles.iconGeo}>
                    <FormattedMessage
                      id="geoModal.latLong"
                      defaultMessage="Lat, Long"
                    />
                  </p>
                }
                value={`${markerPosition.lat}, ${markerPosition.lng}`}
                placeholder={intl.formatMessage({
                  id: 'geoModal.none',
                  defaultMessage: 'None'
                })}
                onChange={handleCoordinateChange}
              ></Input>
            </div>
          </div>

          <div className="propertyRow">
            {!currentUser?.isPro && tokenProfile?.geoToken === 0 ? (
              <div className="rounded bg-red-50 p-2 text-red-600">
                <div className="mb-1 font-semibold uppercase">
                  <FormattedMessage
                    id="geoModal.outOfGeoTokensTitle"
                    defaultMessage="🚀 Out of Geo Tokens"
                  />
                </div>
                <ul className="space-y-1">
                  <li>
                    •{' '}
                    <FormattedMessage
                      id="geoModal.outOfTokensUsedAll"
                      defaultMessage="You've used all your free geo tokens"
                    />
                  </li>
                  <li>
                    •{' '}
                    <FormattedMessage
                      id="geoModal.outOfTokensUpgrade"
                      defaultMessage="Upgrade to 3DStreet Pro for unlimited geospatial features"
                    />
                  </li>
                  <li>
                    •{' '}
                    <FormattedMessage
                      id="geoModal.outOfTokensProIncludes"
                      defaultMessage="Pro includes unlimited geo lookups, map access, and more"
                    />
                  </li>
                  <li>
                    •{' '}
                    <FormattedMessage
                      id="geoModal.outOfTokensSetChange"
                      defaultMessage="Set and change scene locations as often as you need"
                    />
                  </li>
                </ul>
              </div>
            ) : (
              <div className="rounded bg-blue-50 p-2 text-gray-600">
                <div className="mb-1 font-semibold uppercase">
                  {wasOpenedFromGeojson ? (
                    <FormattedMessage
                      id="geoModal.geojsonImportDetected"
                      defaultMessage="🗂️ GeoJSON Import Detected"
                    />
                  ) : (
                    <FormattedMessage
                      id="geoModal.geospatialTips"
                      defaultMessage="💡 Geospatial Tips"
                    />
                  )}
                </div>
                <ul className="space-y-1">
                  {wasOpenedFromGeojson ? (
                    <>
                      <li>
                        •{' '}
                        <FormattedMessage
                          id="geoModal.geojsonTipDetected"
                          defaultMessage="We've detected geographic coordinates from your imported GeoJSON data"
                        />
                      </li>
                      <li>
                        •{' '}
                        <FormattedMessage
                          id="geoModal.geojsonTipMarker"
                          defaultMessage="The red marker shows the calculated center of your imported buildings"
                        />
                      </li>
                      <li>
                        •{' '}
                        <FormattedMessage
                          id="geoModal.geojsonTipSetLocation"
                          defaultMessage="Click 'Set Location' to position your scene at this location"
                        />
                      </li>
                      <li>
                        •{' '}
                        <FormattedMessage
                          id="geoModal.geojsonTipBeta"
                          defaultMessage="This feature is in beta please join our {discordLink} to provide feedback"
                          values={{
                            discordLink: (
                              <a
                                href="https://discord.gg/zNFMhTwKSd"
                                rel="noreferrer"
                                target="_blank"
                              >
                                <FormattedMessage
                                  id="geoModal.discord"
                                  defaultMessage="Discord"
                                />
                              </a>
                            )
                          }}
                        />
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        •{' '}
                        <FormattedMessage
                          id="geoModal.tipMarkerOrigin"
                          defaultMessage="The red marker sets the geospatial location for the centerpoint origin of the scene"
                        />
                      </li>
                      <li>
                        •{' '}
                        <FormattedMessage
                          id="geoModal.tipClickMap"
                          defaultMessage="Click on the map to change the location of the red marker point"
                        />
                      </li>
                      <li>
                        •{' '}
                        <FormattedMessage
                          id="geoModal.tipChoosePoint"
                          defaultMessage="Choose a point that is easy to identify visually from aerial view such as utility pole, road marking, crosswalk ramp, or other landmark"
                        />
                      </li>
                      <li>
                        •{' '}
                        <FormattedMessage
                          id="geoModal.tipZoomIn"
                          defaultMessage="Zoom in as much as possible when placing point to ensure accurate scene alignment"
                        />
                      </li>
                    </>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className={styles.controlButtons}>
            <Button
              variant="ghost"
              onClick={onClose}
              style={{
                background: 'transparent',
                color: '#9ca3af',
                border: '1px solid #404040',
                borderRadius: '8px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#404040';
                e.target.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'transparent';
                e.target.style.color = '#9ca3af';
              }}
            >
              <FormattedMessage id="geoModal.cancel" defaultMessage="Cancel" />
            </Button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {wasOpenedFromGeojson && (
                <div className={styles.betaPill}>
                  <FormattedMessage
                    id="geoModal.freeDuringBeta"
                    defaultMessage="Free During Beta"
                  />
                </div>
              )}
              {!currentUser?.isPro && tokenProfile && !wasOpenedFromGeojson && (
                <TooltipWrapper
                  content={intl.formatMessage({
                    id: 'geoModal.geoTokenTooltip',
                    defaultMessage:
                      'Use geo tokens to set or change a geolocation for your scene.'
                  })}
                >
                  <span
                    style={{
                      background: '#374151',
                      color: '#9ca3af',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                  >
                    <img
                      src="/ui_assets/token-geo.png"
                      alt="Geo Token"
                      style={{
                        width: '28px',
                        height: '28px',
                        marginRight: '4px',
                        display: 'inline-block',
                        verticalAlign: 'middle'
                      }}
                    />
                    <FormattedMessage
                      id="geoModal.freeTokens"
                      defaultMessage="{count} free tokens"
                      values={{ count: tokenProfile.geoToken }}
                    />
                  </span>
                </TooltipWrapper>
              )}
              <Button
                variant="filled"
                onClick={onSaveHandler}
                style={{
                  backgroundColor: '#22c55e',
                  borderColor: '#22c55e',
                  fontSize: '16px',
                  padding: '12px 24px',
                  height: 'auto'
                }}
              >
                {wasOpenedFromGeojson ||
                currentUser?.isPro ||
                tokenProfile?.geoToken > 0 ? (
                  <FormattedMessage
                    id="geoModal.setLocation"
                    defaultMessage="Set Location →"
                  />
                ) : (
                  <FormattedMessage
                    id="geoModal.upgradeToChangeLocation"
                    defaultMessage="Upgrade to Pro to Change Location"
                  />
                )}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
      {isWorking && (
        <SavingModal
          action={intl.formatMessage({
            id: 'geoModal.working',
            defaultMessage: 'Working'
          })}
        />
      )}

      {/* Success Overlay */}
      {showSuccessOverlay && successData && (
        <div className={styles.successOverlay}>
          <div className={styles.successContent}>
            <div className={styles.successHeader}>
              <span className={styles.successIcon}>✨</span>
              <h3>
                <FormattedMessage
                  id="geoModal.locationSetSuccess"
                  defaultMessage="Location Set Successfully!"
                />
              </h3>
            </div>

            <div className={styles.valueDemo}>
              {successData.location?.locationString && (
                <div className={styles.dataItem}>
                  <span className={styles.icon}>📍</span>
                  <div className={styles.dataContent}>
                    <span className={styles.label}>
                      <FormattedMessage
                        id="geoModal.locationLabel"
                        defaultMessage="Location:"
                      />
                    </span>
                    <span className={styles.value}>
                      {successData.location.locationString}
                    </span>
                  </div>
                </div>
              )}

              {successData.nearestIntersection?.intersectionString && (
                <div className={styles.dataItem}>
                  <span className={styles.icon}>🛣️</span>
                  <div className={styles.dataContent}>
                    <span className={styles.label}>
                      <FormattedMessage
                        id="geoModal.nearestIntersectionLabel"
                        defaultMessage="Nearest Intersection:"
                      />
                    </span>
                    <span className={styles.value}>
                      {successData.nearestIntersection.intersectionString}
                    </span>
                  </div>
                </div>
              )}

              {successData.orthometricHeight && (
                <div className={styles.dataItem}>
                  <span className={styles.icon}>📐</span>
                  <div className={styles.dataContent}>
                    <span className={styles.label}>
                      <FormattedMessage
                        id="geoModal.elevationLabel"
                        defaultMessage="Elevation:"
                      />
                    </span>
                    <span className={styles.value}>
                      {Math.round(successData.orthometricHeight)}m
                    </span>
                  </div>
                </div>
              )}
            </div>

            {successData.tokenInfo &&
              !successData.tokenInfo.isProUser &&
              !wasOpenedFromGeojson && (
                <div className={styles.tokenStatus}>
                  <img
                    src="/ui_assets/token-geo.png"
                    alt="Geo Token"
                    className={styles.tokenIcon}
                    style={{
                      width: '32px',
                      height: '32px',
                      display: 'inline-block',
                      verticalAlign: 'middle'
                    }}
                  />
                  <span className={styles.tokenText}>
                    <FormattedMessage
                      id="geoModal.geoTokensRemaining"
                      defaultMessage="{count} geo tokens remaining"
                      values={{
                        count: successData.tokenInfo.remainingTokens
                      }}
                    />
                  </span>
                  {successData.tokenInfo.remainingTokens === 0 && (
                    <span className={styles.upgradeHint}>
                      <FormattedMessage
                        id="geoModal.upgradeUnlimitedAccess"
                        defaultMessage="Upgrade to Pro for unlimited access"
                      />
                    </span>
                  )}
                </div>
              )}
          </div>
        </div>
      )}
    </Tooltip.Provider>
  );
};

export { GeoModal };
