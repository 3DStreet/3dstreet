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
  const metadata = AFRAME.scenes[0].getAttribute('metadata');
  let coordinateInfo;
  if (metadata && metadata['coord']) {
    const coord = metadata['coord'];
    coordinateInfo = `Latitude: ${coord.latitude}, longitude: ${coord.longitude}, elevation: ${coord.elevation}`;
  }

  return (
    <div className={styles.geo}>
      <img src={GeoImg} onClick={onClick} alt="geo" />
      {coordinateInfo ? (
        <p>{coordinateInfo}</p>
      ) : (
        <a onClick={onClick}>Click to set location</a>
      )}
    </div>
  );
};
export { GeoPanel };
