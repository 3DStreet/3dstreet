import { useState } from 'react';
import styles from './GeoLocationDisplay.module.scss';
import useStore from '@/store';
import { Mangnifier20Icon } from '../../../icons';

const GeoLocationDisplay = () => {
  const [isHovered, setIsHovered] = useState(false);
  const locationString = useStore((state) => state.locationString);
  const setModal = useStore((state) => state.setModal);

  if (!locationString) {
    return null;
  }

  return (
    <div
      className={styles.geoLocationDisplay}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => setModal('geo')}
    >
      <div className={`${styles.content} ${isHovered ? styles.hovered : ''}`}>
        {isHovered && <Mangnifier20Icon className={styles.searchIcon} />}
        <span className={styles.locationText}>{locationString}</span>
      </div>
    </div>
  );
};

export default GeoLocationDisplay;
