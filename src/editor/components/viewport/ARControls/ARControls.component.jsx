import { useState } from 'react';
import styles from './ARControls.module.scss';

const ARControls = () => {
  const [rotationValue, setRotationValue] = useState(0);

  const handleRotationChange = (event) => {
    const newRotation = parseFloat(event.target.value);
    setRotationValue(newRotation);

    // Update the street-container rotation in real-time
    const streetContainer = document.getElementById('street-container');
    if (streetContainer) {
      streetContainer.setAttribute('rotation', `0 ${newRotation} 0`);
    } else {
      console.log('street-container element not found');
    }
  };

  return (
    <div className={styles.arControls}>
      {/* <div className={styles.title}>AR Controls</div> */}

      <div className={styles.controlGroup}>
        <label className={styles.label}>Rotation: {rotationValue}°</label>
        <input
          type="range"
          min="-180"
          max="180"
          value={rotationValue}
          onInput={handleRotationChange}
          className={styles.slider}
        />
      </div>
    </div>
  );
};

export default ARControls;
