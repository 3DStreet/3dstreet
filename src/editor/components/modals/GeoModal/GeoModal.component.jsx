import { useState, useCallback, useEffect } from 'react';

import styles from './GeoModal.module.scss';
import { Copy32Icon, Mangnifier20Icon } from '../../../icons';

import Modal from '../Modal.jsx';
import { Button, Input } from '../../components/index.js';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { DownloadIcon } from '../../../icons/icons.jsx';
import GeoImg from '../../../../../ui_assets/geo.png';

const GeoModal = ({ isOpen, onClose }) => {
  const [markerPosition, setMarkerPosition] = useState({
    lat: 0,
    lng: 0,
    elevation: 0
  });

  const roundToSix = (num) => {
    return Math.round(num * 1e6) / 1e6;
  };

  useEffect(() => {
    // get coordinate data in this format: {latitude: ..., longitude: ..., elevation: ...}
    const coord = AFRAME.scenes[0].getAttribute('metadata')['coord'];
    if (coord) {
      const lat = roundToSix(parseFloat(coord.latitude));
      const lng = roundToSix(parseFloat(coord.longitude));
      const elevation = parseFloat(coord.elevation) || 0;

      if (!isNaN(lat) && !isNaN(lng)) {
        setMarkerPosition({ lat, lng, elevation });
      }
    }
  }, []);

  const onMapClick = useCallback((event) => {
    setMarkerPosition((prev) => ({
      ...prev,
      lat: roundToSix(event.latLng.lat()),
      lng: roundToSix(event.latLng.lng())
    }));
  }, []);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: 'AIzaSyCwldpJKOZ1yh_FT8NrUPuPeMedEy1R2jw'
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
          <img src={GeoImg} alt="geo" />
          <p>Scene Location</p>
          <p className={styles.badge}>Pro</p>
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
            zoom={1}
            onClick={onMapClick}
          >
            <Marker
              position={{ lat: markerPosition.lat, lng: markerPosition.lng }}
            />
          </GoogleMap>
        )}

        <div className={styles.sceneGeo}>
          <div>
            <p>Current Centerpoint</p>
            <Input
              leadingIcon={<p className={styles.iconGeo}>Lat, Long</p>}
              tailingIcon={<Copy32Icon className={styles.copyIcon} />}
              value={`${markerPosition.lat}, ${markerPosition.lng}`}
              placeholder="None"
            ></Input>
          </div>
          <div>
            <p>New Centerpoint</p>
            <Input
              leadingIcon={<p className={styles.iconGeo}>Lat, Long</p>}
              tailingIcon={<Copy32Icon className={styles.copyIcon} />}
              placeholder="0, 0"
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
