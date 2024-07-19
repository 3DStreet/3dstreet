import GeoImg from '../../../../../ui_assets/geo.png';
import styles from './GeoPanel.module.scss';
import Events from '../../../lib/Events';
import { useAuthContext, useGeoContext } from '../../../contexts/index.js';
import posthog from 'posthog-js';
/**
 * GeoPanel component.
 *
 * @author Rostyslav Nahornyi
 * @category Components.
 */
const GeoPanel = () => {
  const { currentUser } = useAuthContext();
  const onClick = () => {
    posthog.capture('geo_panel_clicked');
    if (currentUser.isPro) {
      Events.emit('opengeomodal');
    } else {
      Events.emit('openpaymentmodal');
    }
  };

  const streetGeo = useGeoContext();
  let coordinateInfo = null;

  if (streetGeo) {
    coordinateInfo = `Latitude: ${streetGeo.latitude}, Longitude: ${streetGeo.longitude}, Elevation: ${streetGeo.elevation}m`;
  }

  return (
    <div className={styles.geo}>
      <>
        <img src={GeoImg} onClick={onClick} alt="geo" />
        {coordinateInfo ? (
          <a onClick={onClick}>{coordinateInfo}</a>
        ) : (
          <a onClick={onClick}>Click to set location</a>
        )}
      </>
      )
    </div>
  );
};
export { GeoPanel };
