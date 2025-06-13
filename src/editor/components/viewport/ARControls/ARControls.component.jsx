import { useState } from 'react';
import styles from './ARControls.module.scss';

const ARControls = () => {
  const [sliderValue, setSliderValue] = useState(50);

  const handleSliderChange = (event) => {
    setSliderValue(event.target.value);
  };

  const handleButtonClick = () => {
    console.log('AR Control Button clicked!', { sliderValue });
  };

  return (
    <div className={styles.arControls}>
      <div className={styles.title}>AR Controls</div>

      <div className={styles.controlGroup}>
        <label className={styles.label}>Adjustment: {sliderValue}</label>
        <input
          type="range"
          min="0"
          max="100"
          value={sliderValue}
          onChange={handleSliderChange}
          className={styles.slider}
        />
      </div>

      <button onClick={handleButtonClick} className={styles.actionButton}>
        Apply Changes
      </button>
    </div>
  );
};

export default ARControls;
