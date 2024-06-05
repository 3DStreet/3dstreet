import { useState, useCallback, useEffect } from 'react';

import styles from './GeoModal.module.scss';
import { Mangnifier20Icon, Save24Icon } from '../../../icons';

import { firebaseConfig } from '../../../services/firebase.js';
import Modal from '../Modal.jsx';
import { Button, Input } from '../../components/index.js';
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Autocomplete
} from '@react-google-maps/api';
import GeoImg from '../../../../../ui_assets/geo.png';
import { roundCoord } from '../../../../../src/utils.js';

const GeoModal = ({ isOpen, onClose }) => {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: firebaseConfig.apiKey
  });

  const [markerPosition, setMarkerPosition] = useState({
    lat: 37.7637072, // lat: 37.76370724481858, lng: -122.41517686259827
    lng: -122.4151768
  });
  const [elevation, setElevation] = useState(10);
  const [autocomplete, setAutocomplete] = useState(null);

  useEffect(() => {
    if (isOpen) {
      const streetGeo = document
        .getElementById('reference-layers')
        ?.getAttribute('street-geo');

      if (streetGeo && streetGeo['latitude'] && streetGeo['longitude']) {
        const lat = roundCoord(parseFloat(streetGeo['latitude']));
        const lng = roundCoord(parseFloat(streetGeo['longitude']));
        const elevation = parseFloat(streetGeo['elevation']) || 0;

        if (!isNaN(lat) && !isNaN(lng)) {
          setMarkerPosition({ lat, lng });
        }
        if (!isNaN(elevation)) {
          setElevation(elevation);
        }
      }
    }
  }, [isOpen]);

  const onMapClick = useCallback((event) => {
    setMarkerPosition({
      lat: roundCoord(event.latLng.lat()),
      lng: roundCoord(event.latLng.lng())
    });
  }, []);

  const handleCoordinateChange = (value) => {
    const [newLat, newLng] = value
      .split(',')
      .map((coord) => parseFloat(coord.trim()));

    if (!isNaN(newLat) && !isNaN(newLng)) {
      setMarkerPosition({
        lat: roundCoord(newLat),
        lng: roundCoord(newLng)
      });
    }
  };

  const handleElevationChange = (value) => {
    const newElevation = parseFloat(value) || 0;
    setElevation(newElevation);
  };

  const onAutocompleteLoad = useCallback((autocompleteInstance) => {
    setAutocomplete(autocompleteInstance);
  }, []);

  const onPlaceChanged = useCallback(() => {
    if (autocomplete !== null) {
      const place = autocomplete.getPlace();
      if (place && place.geometry) {
        const location = {
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng()
        };
        setMarkerPosition(location);
      }
    } else {
      console.log('Autocomplete is not loaded yet!');
    }
  }, [autocomplete]);

  const onCloseCheck = (evt) => {
    // do not close geoModal when clicking on a list with suggestions for addresses
    const autocompleteContatiner = document.querySelector('.pac-container');
    if (autocompleteContatiner.children.length === 0) {
      onClose();
    }
  };

  const onSaveHandler = () => {
    const latitude = markerPosition.lat;
    const longitude = markerPosition.lng;
    const geoLayer = document.getElementById('reference-layers');
    geoLayer.setAttribute(
      'street-geo',
      `latitude: ${latitude}; longitude: ${longitude}; elevation: ${elevation}`
    );

    onClose();
  };

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={isOpen}
      onClose={onCloseCheck}
      extraCloseKeyCode={72}
    >
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <img src={GeoImg} alt="geo" style={{ objectFit: 'contain' }} />
          <h3>Scene Location</h3>
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
                position={{ lat: markerPosition.lat, lng: markerPosition.lng }}
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
          <div>
            <p>Elevation</p>
            <Input
              leadingIcon={<p className={styles.iconGeo}>Height</p>}
              value={elevation}
              placeholder="None"
              onChange={handleElevationChange}
            ></Input>
          </div>
        </div>

        <div className={styles.controlButtons}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            leadingicon={<Save24Icon />}
            variant="filled"
            onClick={onSaveHandler}
          >
            Update Scene Location
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export { GeoModal };
