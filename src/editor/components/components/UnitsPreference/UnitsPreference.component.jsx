import useStore from '../../../../store.js';
import styles from './UnitsPreference.module.scss';

export const UnitsPreference = () => {
  const unitsPreference = useStore((state) => state.unitsPreference);
  const setUnitsPreference = useStore((state) => state.setUnitsPreference);

  const handleToggleUnits = () => {
    const newPreference = unitsPreference === 'metric' ? 'imperial' : 'metric';
    setUnitsPreference(newPreference);
  };

  return (
    <button
      className={styles.unitsToggle}
      onClick={handleToggleUnits}
      title={`Switch to ${unitsPreference === 'metric' ? 'imperial' : 'metric'} units`}
    >
      {unitsPreference === 'metric' ? 'Metric' : 'Imperial'}
    </button>
  );
};
