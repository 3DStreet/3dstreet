import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { defineMessages, useIntl } from 'react-intl';
import Events from '../../lib/Events';
import { GeoFrameError, describeEntityGeo } from '../../lib/geo/geoFrame.js';
import { formatGeoLoc } from '../../lib/geo/geoLabel.js';

const messages = defineMessages({
  geoloc: {
    id: 'sidebar.geoloc',
    defaultMessage: 'GeoLoc'
  },
  title: {
    id: 'sidebar.geolocTitle',
    defaultMessage:
      'Latitude, longitude, true bearing (degrees clockwise from true north, “T”). Read-only: edit position and rotation to change it.'
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
 * Read-only "geoloc" row under the transform rows: lat, lon, true bearing.
 * Same numbers the getGeoContext tool reports, so a person and an agent read
 * one truth; deliberately not an input — moving an entity is done with
 * position/rotation.
 */
export default function GeoLocationRow({ entity }) {
  const intl = useIntl();
  const [geo, setGeo] = useState(() => readGeo(entity));

  useEffect(() => {
    setGeo(readGeo(entity));
    const onEntityUpdate = (detail) => {
      // This entity moved, or the geo layer (#reference-layers) changed.
      if (detail.entity === entity || detail.component === 'street-geo') {
        setGeo(readGeo(entity));
      }
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  if (!geo) return null;
  const bearing = geo.managedStreet
    ? geo.managedStreet.centerlineBearingDeg
    : geo.headingDeg;
  const title = intl.formatMessage(messages.title);
  return (
    <div className="propertyRow">
      <label className="text" title={title} style={{ textTransform: 'none' }}>
        {intl.formatMessage(messages.geoloc)}
      </label>
      <span className="geoReadoutValue" title={title}>
        {formatGeoLoc(geo.latitude, geo.longitude, bearing)}
      </span>
    </div>
  );
}

GeoLocationRow.propTypes = {
  entity: PropTypes.object.isRequired
};
