import GeoImg from '../../../../../ui_assets/geo.png';
import styles from './GeoPanel.module.scss';
import Events from '../../../lib/Events';
import { useAuthContext, useGeoContext } from '../../../contexts/index.js';

/**
 * GeoPanel component.
 *
 * @author Rostyslav Nahornyi
 * @category Components.
 */
const GeoPanel = () => {
  const onClick = () => Events.emit('opengeomodal');
  const { currentUser } = useAuthContext();
  const streetGeo = useGeoContext();
  let coordinateInfo = null;

  if (streetGeo) {
    coordinateInfo = `Latitude: ${streetGeo.latitude}, Longitude: ${streetGeo.longitude}, Elevation: ${streetGeo.elevation}m`;
  }

  return (
    <div className={styles.geo}>
      {currentUser?.isPro ? (
        <>
          <img src={GeoImg} onClick={onClick} alt="geo" />
          {coordinateInfo ? (
            <a onClick={onClick}>{coordinateInfo}</a>
          ) : (
            <a onClick={onClick}>Click to set location</a>
          )}
        </>
      ) : (
        <></>
      )}
    </div>
  );
};
export { GeoPanel };
