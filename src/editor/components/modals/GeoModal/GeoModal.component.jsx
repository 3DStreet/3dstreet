import { useState, useCallback, useEffect } from 'react';

import styles from './GeoModal.module.scss';
import { Mangnifier20Icon } from '../../../icons';

import Modal from '../Modal.jsx';
import { Button, Input } from '../../components/index.js';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { DownloadIcon } from '../../../icons/icons.jsx';
import GeoImg from '../../../../../ui_assets/geo.png';

const GeoModal = ({ isOpen, onClose }) => {
  const [markerPosition, setMarkerPosition] = useState({
    lat: 37.7637072, // lat: 37.76370724481858, lng: -122.41517686259827
    lng: -122.4151768,
    elevation: 0
  });

  const roundCoord = (num) => {
    return Math.round(num * 1e7) / 1e7;
  };

  useEffect(() => {
    // get coordinate data in this format: {latitude: ..., longitude: ..., elevation: ...}
    const coord = AFRAME.scenes[0].getAttribute('metadata')['coord'];
    if (coord) {
      const lat = roundCoord(parseFloat(coord.latitude));
      const lng = roundCoord(parseFloat(coord.longitude));
      const elevation = parseFloat(coord.elevation) || 0;

      if (!isNaN(lat) && !isNaN(lng)) {
        setMarkerPosition({ lat, lng, elevation });
      }
    }
  }, []);

  const onMapClick = useCallback((event) => {
    setMarkerPosition((prev) => ({
      ...prev,
      lat: roundCoord(event.latLng.lat()),
      lng: roundCoord(event.latLng.lng())
    }));
  }, []);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.FIREBASE_API_KEY
  });

  const onSaveHandler = () => {
    const latitude = markerPosition.lat;
    const longitude = markerPosition.lng;
    const elevation = markerPosition.elevation;
    AFRAME.scenes[0].setAttribute('metadata', 'coord', {
      latitude: latitude,
      longitude: longitude,
      elevation: elevation
    });
    const geoLayer = document.getElementById('reference-layers');
    geoLayer.setAttribute(
      'street-geo',
      `latitude: ${latitude}; longitude: ${longitude}; elevation: ${elevation}`
    );
    // this line needs to update 3D tiles from the Editor. Need to delete after updating aframe-loaders-3dtiles-component
    geoLayer.play();

    onClose();
  };

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={isOpen}
      onClose={onClose}
      extraCloseKeyCode={72}
    >
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <img src={GeoImg} alt="geo" style={{ objectFit: 'contain' }} />
          <h3>Scene Location</h3>
        </div>
        <Input
          leadingIcon={<Mangnifier20Icon />}
          placeholder="Search for a location"
        ></Input>
        {isLoaded && (
          <GoogleMap
            mapContainerStyle={{
              width: '100%',
              minHeight: '350px',
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
        )}

        <div className={styles.sceneGeo}>
          <div>
            <p>Centerpoint</p>
            <Input
              leadingIcon={<p className={styles.iconGeo}>Lat, Long</p>}
              value={`${markerPosition.lat}, ${markerPosition.lng}`}
              placeholder="None"
            ></Input>
          </div>
        </div>

        <div className={styles.controlButtons}>
          <Button variant={'ghost'} onClick={onClose}>
            Cancel
          </Button>
          <Button
            leadingicon={<DownloadIcon />}
            variant={'filled'}
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
