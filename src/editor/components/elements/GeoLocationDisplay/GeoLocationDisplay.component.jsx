import { useState, useEffect } from 'react';
import styles from './GeoLocationDisplay.module.scss';
import useStore from '@/store';
import { getLocationDisplayString } from '../../../lib/geo-utils.js';

const GeoLocationDisplay = () => {
  const [isHovered, setIsHovered] = useState(false);
  const [locationDisplay, setLocationDisplay] = useState('Location');
  const locationString = useStore((state) => state.locationString);
  const geoData = useStore((state) => state.geoData);
  const setModal = useStore((state) => state.setModal);

  // Check if we have lat/lon but no ellipsoidalHeight (incomplete geo data)
  const hasIncompleteGeoData =
    geoData.latitude &&
    geoData.longitude &&
    !geoData.ellipsoidalHeight &&
    !locationString;

  // Fetch location display string when geoData changes
  useEffect(() => {
    const fetchLocationDisplay = async () => {
      if (geoData.latitude && geoData.longitude && hasIncompleteGeoData) {
        const displayString = await getLocationDisplayString(
          geoData.latitude,
          geoData.longitude
        );
        setLocationDisplay(displayString);
      } else {
        setLocationDisplay('Location');
      }
    };

    fetchLocationDisplay();
  }, [geoData.latitude, geoData.longitude, hasIncompleteGeoData]);

  // Don't show anything if we have no location data at all
  if (!locationString && !hasIncompleteGeoData) {
    return null;
  }

  const displayText = hasIncompleteGeoData
    ? `Add Map Layer for ${locationDisplay}`
    : locationString;

  const isCtaMode = hasIncompleteGeoData;

  return (
    <div
      className={`${styles.geoLocationDisplay} ${isCtaMode ? styles.ctaMode : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => setModal('geo')}
    >
      <div
        className={`${styles.content} ${isHovered ? styles.hovered : ''} ${isCtaMode ? styles.cta : ''}`}
      >
        <span className={styles.locationText}>{displayText}</span>
      </div>
    </div>
  );
};

export default GeoLocationDisplay;
