import { useState, useCallback, useEffect } from 'react';
import { SavingModal } from '../SavingModal';
import styles from './GeoModal.module.scss';
import { Mangnifier20Icon, Save24Icon } from '../../../icons';
import { firebaseConfig } from '../../../services/firebase.js';
import Modal from '../Modal.jsx';
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

const GeoModal = () => {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: firebaseConfig.apiKey
  });

  const [markerPosition, setMarkerPosition] = useState({
    lat: 37.7637072, // lat: 37.76370724481858, lng: -122.41517686259827
    lng: -122.4151768
  });
  const [autocomplete, setAutocomplete] = useState(null);
  const [isWorking, setIsWorking] = useState(false);
  const returnToPreviousModal = useStore(
    (state) => state.returnToPreviousModal
  );
  const isOpen = useStore((state) => state.modal === 'geo');

  const onClose = () => {
    returnToPreviousModal();
  };

  useEffect(() => {
    if (isOpen) {
      const streetGeo = document
        .getElementById('reference-layers')
        ?.getAttribute('street-geo');

      if (streetGeo && streetGeo['latitude'] && streetGeo['longitude']) {
        const lat = roundCoord(parseFloat(streetGeo['latitude']));
        const lng = roundCoord(parseFloat(streetGeo['longitude']));

        if (!isNaN(lat) && !isNaN(lng)) {
          setMarkerPosition({ lat, lng });
        }
      }
    }
  }, [isOpen]);

  const setMarkerPositionAndElevation = useCallback((lat, lng) => {
    if (!isNaN(lat) && !isNaN(lng)) {
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
    // do not close geoModal when clicking on a list with suggestions for addresses
    const autocompleteContatiner = document.querySelector('.pac-container');
    if (autocompleteContatiner.children.length === 0) {
      onClose();
    }
  };

  const onSaveHandler = async () => {
    setIsWorking(true);
    const latitude = markerPosition.lat;
    const longitude = markerPosition.lng;

    // Use the shared utility function to set the scene location
    const result = await setSceneLocation(latitude, longitude);

    if (result.success && result.data) {
      const data = result.data;

      // Log the new location information
      console.log('Location data:', data.location);
      console.log('Location source:', data.locationSource);

      // Log the new intersection information
      console.log('Nearest intersection:', data.nearestIntersection);
      console.log('Intersection source:', data.nearestIntersectionSource);
    }

    setIsWorking(false);
    onClose();
  };

  return (
    <>
      <Modal
        className={styles.modalWrapper}
        isOpen={isOpen}
        onClose={onCloseCheck}
      >
        <div className={styles.wrapper}>
          <div className={styles.header}>
            <img src={GeoImg} alt="geo" style={{ objectFit: 'contain' }} />
            <h3>Scene Location</h3>
            <p className={styles.badge}>Pro</p>
          </div>
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
          <Autocomplete
            onLoad={onAutocompleteLoad}
            onPlaceChanged={onPlaceChanged}
          >
            <Input
              leadingIcon={<Mangnifier20Icon />}
              placeholder="Search for a location"
              onChange={(value) => {}}
            />
          </Autocomplete>
          <div className={styles.sceneGeo}>
            <div>
              <p>Centerpoint</p>
              <Input
                leadingIcon={<p className={styles.iconGeo}>Lat, Long</p>}
                value={`${markerPosition.lat}, ${markerPosition.lng}`}
                placeholder="None"
                onChange={handleCoordinateChange}
              ></Input>
            </div>
          </div>

          <div className="propertyRow">
            <div className="rounded bg-blue-50 p-2 text-gray-600">
              <div className="mb-1 font-semibold uppercase">
                💡 Geospatial Tips
              </div>
              <ul className="space-y-1">
                <li>
                  • The red marker sets the geospatial location for the
                  centerpoint origin of the scene
                </li>
                <li>
                  • Click on the map to change the location of the red marker
                  point
                </li>
                <li>
                  • Choose a point that is easy to identify visually from aerial
                  view such as utility pole, road marking, crosswalk ramp, or
                  other landmark
                </li>
                <li>
                  • Zoom in as much as possible when placing point to ensure
                  accurate scene alignment
                </li>
              </ul>
            </div>
          </div>

          <div className={styles.controlButtons}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              leadingIcon={<Save24Icon />}
              variant="filled"
              onClick={onSaveHandler}
            >
              Update Scene Location
            </Button>
          </div>
        </div>
      </Modal>
      {isWorking && <SavingModal action="Working" />}
    </>
  );
};

export { GeoModal };
