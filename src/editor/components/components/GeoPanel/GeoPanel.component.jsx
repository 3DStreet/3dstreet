import GeoImg from '../../../../../ui_assets/geo.png';
import styles from './GeoPanel.module.scss';
import Events from '../../../lib/Events';

/**
 * GeoPanel component.
 *
 * @author Rostyslav Nahornyi
 * @category Components.
 */
const GeoPanel = () => {
  const onClick = () => Events.emit('opengeomodal');

  return (
    <div className={styles.geo}>
      <img src={GeoImg} onClick={onClick} alt="geo" />
      <p>San Francisco, California at Market and Van Ness Streets</p>
    </div>
  );
};
export { GeoPanel };
