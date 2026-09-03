import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { defineMessages, useIntl } from 'react-intl';
import Events from '../../lib/Events';
import { GeoFrameError, describeEntityGeo } from '../../lib/geo/geoFrame.js';
import { formatBearing, formatLatLon } from '../../lib/geo/geoLabel.js';

const messages = defineMessages({
  location: {
    id: 'sidebar.geoLocation',
    defaultMessage: 'location'
  },
  heading: {
    id: 'sidebar.geoHeading',
    defaultMessage: 'heading'
  },
  title: {
    id: 'sidebar.geoLocationTitle',
    defaultMessage:
      'Latitude, longitude of this entity and the compass bearing of its local +Z axis (a managed street runs along +Z). Computed from the Google 3D Tiles frame; edit position/rotation to change it.'
  }
});

// Returns null (no geo layer, or still loading) or the entity's geo readout.
function readGeo(entity) {
  try {
    return describeEntityGeo(entity);
  } catch (err) {
    if (err instanceof GeoFrameError) return null;
    throw err;
  }
}

/**
 * Read-only lat/lon + heading row under the transform rows. Same numbers the
 * getGeoContext tool reports, so a person and an agent read one truth; it is
 * deliberately not an input — moving an entity is done with position/rotation.
 */
export default function GeoLocationRow({ entity }) {
  const intl = useIntl();
  const [geo, setGeo] = useState(() => readGeo(entity));

  useEffect(() => {
    setGeo(readGeo(entity));
    const onEntityUpdate = (detail) => {
      if (detail.entity === entity) setGeo(readGeo(entity));
    };
    // The geo layer arriving/leaving is an update on #reference-layers.
    const onGeoUpdate = (detail) => {
      if (detail.component === 'street-geo') setGeo(readGeo(entity));
    };
    Events.on('entityupdate', onEntityUpdate);
    Events.on('entityupdate', onGeoUpdate);
    return () => {
      Events.off('entityupdate', onEntityUpdate);
      Events.off('entityupdate', onGeoUpdate);
    };
  }, [entity]);

  if (!geo) return null;
  const heading = geo.managedStreet
    ? geo.managedStreet.centerlineBearingDeg
    : geo.headingDeg;
  const title = intl.formatMessage(messages.title);
  return (
    <>
      <div className="propertyRow">
        <label className="text" title={title}>
          {intl.formatMessage(messages.location)}
        </label>
        <span className="geoReadoutValue" title={title}>
          {formatLatLon(geo.latitude, geo.longitude)}
        </span>
      </div>
      <div className="propertyRow">
        <label className="text" title={title}>
          {intl.formatMessage(messages.heading)}
        </label>
        <span className="geoReadoutValue" title={title}>
          {formatBearing(heading)}
        </span>
      </div>
    </>
  );
}

GeoLocationRow.propTypes = {
  entity: PropTypes.object.isRequired
};
