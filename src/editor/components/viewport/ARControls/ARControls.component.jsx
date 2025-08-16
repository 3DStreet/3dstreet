import { useState } from 'react';
import styles from './ARControls.module.scss';

const ARControls = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [rotationValue, setRotationValue] = useState(0);
  const [positionX, setPositionX] = useState(0);
  const [positionZ, setPositionZ] = useState(0);
  const [height, setHeight] = useState(0);

  const updateStreetContainer = (rotation, x, z, y) => {
    const streetContainer = document.getElementById('street-container');
    if (streetContainer) {
      streetContainer.setAttribute('rotation', `0 ${rotation} 0`);
      streetContainer.setAttribute('position', `${x} ${y} ${z}`);
    } else {
      console.log('street-container element not found');
    }
  };

  const handleRotationChange = (event) => {
    const newRotation = parseFloat(event.target.value);
    setRotationValue(newRotation);
    updateStreetContainer(newRotation, positionX, positionZ, height);
  };

  const handlePositionXChange = (event) => {
    const newX = parseFloat(event.target.value);
    setPositionX(newX);
    updateStreetContainer(rotationValue, newX, positionZ, height);
  };

  const handlePositionZChange = (event) => {
    const newZ = parseFloat(event.target.value);
    setPositionZ(newZ);
    updateStreetContainer(rotationValue, positionX, newZ, height);
  };

  const handleHeightChange = (event) => {
    const newHeight = parseFloat(event.target.value);
    setHeight(newHeight);
    updateStreetContainer(rotationValue, positionX, positionZ, newHeight);
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  if (!isExpanded) {
    return (
      <button
        className={styles.toggleButton}
        onClick={toggleExpanded}
        title="AR Scene Adjustments"
      >
        🎯
      </button>
    );
  }

  return (
    <div className={styles.arControls}>
      <div className={styles.header}>
        <span className={styles.title}>AR Scene Adjustments</span>
        <button
          className={styles.closeButton}
          onClick={toggleExpanded}
          title="Collapse"
        >
          ✕
        </button>
      </div>

      <div className={styles.controlGroup}>
        <label className={styles.label}>Rotation: {rotationValue}°</label>
        <input
          type="range"
          min="-180"
          max="180"
          step="5"
          value={rotationValue}
          onInput={handleRotationChange}
          className={styles.slider}
        />
      </div>

      <div className={styles.controlGroup}>
        <label className={styles.label}>Position X: {positionX}m</label>
        <input
          type="range"
          min="-50"
          max="50"
          step="1"
          value={positionX}
          onInput={handlePositionXChange}
          className={styles.slider}
        />
      </div>

      <div className={styles.controlGroup}>
        <label className={styles.label}>Position Z: {positionZ}m</label>
        <input
          type="range"
          min="-50"
          max="50"
          step="1"
          value={positionZ}
          onInput={handlePositionZChange}
          className={styles.slider}
        />
      </div>

      <div className={styles.controlGroup}>
        <label className={styles.label}>Height: {height}m</label>
        <input
          type="range"
          min="-5"
          max="5"
          step="0.1"
          value={height}
          onInput={handleHeightChange}
          className={styles.slider}
        />
      </div>
    </div>
  );
};

export default ARControls;
