import { useIntl } from 'react-intl';
import useStore from '../../../../store.js';
import styles from './UnitsPreference.module.scss';

export const UnitsPreference = () => {
  const intl = useIntl();
  const unitsPreference = useStore((state) => state.unitsPreference);
  const setUnitsPreference = useStore((state) => state.setUnitsPreference);

  const handleToggleUnits = () => {
    const newPreference = unitsPreference === 'metric' ? 'imperial' : 'metric';
    setUnitsPreference(newPreference);
  };

  const isMetric = unitsPreference === 'metric';
  const targetLabel = isMetric
    ? intl.formatMessage({ id: 'units.imperial', defaultMessage: 'imperial' })
    : intl.formatMessage({ id: 'units.metric', defaultMessage: 'metric' });

  return (
    <button
      className={styles.unitsToggle}
      onClick={handleToggleUnits}
      title={intl.formatMessage(
        {
          id: 'units.switchTo',
          defaultMessage: 'Switch to {units} units'
        },
        { units: targetLabel }
      )}
    >
      {isMetric
        ? intl.formatMessage({
            id: 'units.metricLabel',
            defaultMessage: 'Metric'
          })
        : intl.formatMessage({
            id: 'units.imperialLabel',
            defaultMessage: 'Imperial'
          })}
    </button>
  );
};
