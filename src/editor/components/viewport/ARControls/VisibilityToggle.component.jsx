import { useState } from 'react';
import styles from './VisibilityToggle.module.scss';

const VisibilityToggle = () => {
  const [isVisible, setIsVisible] = useState(true);

  const toggleVisibility = () => {
    const streetContainer = document.getElementById('street-container');
    if (streetContainer) {
      const newVisibility = !isVisible;
      streetContainer.setAttribute('visible', newVisibility.toString());
      setIsVisible(newVisibility);
    } else {
      console.log('street-container element not found');
    }
  };

  return (
    <button
      className={styles.visibilityToggleButton}
      onClick={toggleVisibility}
      title={`${isVisible ? 'Hide' : 'Show'} Scene`}
    >
      {isVisible ? '👁️' : '🙈'}
    </button>
  );
};

export default VisibilityToggle;
