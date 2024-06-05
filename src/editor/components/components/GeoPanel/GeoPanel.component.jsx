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

  let latitude = 0;
  let longitude = 0;
  let elevation = 0;
  let coordinateInfo = null;

  const streetGeo = document
    .getElementById('reference-layers')
    ?.getAttribute('street-geo');

  if (streetGeo && streetGeo['latitude'] && streetGeo['longitude']) {
    latitude = streetGeo['latitude'];
    longitude = streetGeo['longitude'];
    elevation = streetGeo['elevation'] || 0;
    coordinateInfo = `Latitude: ${latitude}, Longitude: ${longitude}, Elevation: ${elevation}m`;
  }

  return (
    <div className={styles.geo}>
      <img src={GeoImg} onClick={onClick} alt="geo" />
      {coordinateInfo ? (
        <a onClick={onClick}>{coordinateInfo}</a>
      ) : (
        <a onClick={onClick}>Click to set location</a>
      )}
    </div>
  );
};
export { GeoPanel };
