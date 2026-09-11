import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { defineMessages, useIntl } from 'react-intl';
import Events from '../../lib/Events';
import {
  GeoFrameError,
  describeEntityGeo,
  isGeospatialActive
} from '../../lib/geo/geoFrame.js';
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
  },
  switchToPosition: {
    id: 'sidebar.geolocSwitchToPosition',
    defaultMessage: 'Click to show position instead.'
  }
});

// Returns null (no geo layer, or still loading) or the entity's geo readout.
function readGeo(entity) {
  // Cheap attribute check first: on non-geo scenes this runs per entityupdate
  // (every frame of a gizmo drag) for a row that never renders.
  if (!isGeospatialActive()) return null;
  try {
    return describeEntityGeo(entity);
  } catch (err) {
    if (err instanceof GeoFrameError) return null;
    throw err;
  }
}

/**
 * The entity's live geo readout, kept fresh across entity moves and geo-layer
 * changes; null while no geo layer is active. Shared by the GeoLoc row and
 * the position/geoloc toggle (#1979), which needs to know geo availability
 * even while showing the position row.
 */
export function useEntityGeo(entity) {
  const [geo, setGeo] = useState(() => readGeo(entity));

  useEffect(() => {
    // entityupdate fires per frame during a gizmo drag and per mousemove
    // during a number scrub; coalesce to one geo conversion per frame.
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setGeo(readGeo(entity));
      });
    };
    schedule();
    const onEntityUpdate = (detail) => {
      // This entity moved, or the geo layer (#reference-layers) changed.
      if (detail.entity === entity || detail.component === 'street-geo') {
        schedule();
      }
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => {
      Events.off('entityupdate', onEntityUpdate);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [entity]);

  return geo;
}

/**
 * Read-only "geoloc" row: lat, lon, true bearing. Same numbers the
 * getGeoContext tool reports, so a person and an agent read one truth;
 * deliberately not an input — moving an entity is done with
 * position/rotation. With `onLabelClick` the label doubles as the toggle
 * back to the three.js position row (#1979).
 */
export default function GeoLocationRow({ entity, onLabelClick }) {
  const intl = useIntl();
  const liveGeo = useEntityGeo(entity);

  if (!liveGeo) return null;
  const bearing = liveGeo.managedStreet
    ? liveGeo.managedStreet.centerlineBearingDeg
    : liveGeo.headingDeg;
  let title = intl.formatMessage(messages.title);
  if (onLabelClick) {
    title += '\n' + intl.formatMessage(messages.switchToPosition);
  }
  return (
    <div className="propertyRow">
      <label
        className={'text' + (onLabelClick ? ' label-toggle' : '')}
        title={title}
        style={{ textTransform: 'none' }}
        onClick={onLabelClick}
      >
        {intl.formatMessage(messages.geoloc)}
      </label>
      <span className="geoReadoutValue" title={title}>
        {formatGeoLoc(liveGeo.latitude, liveGeo.longitude, bearing)}
      </span>
    </div>
  );
}

GeoLocationRow.propTypes = {
  entity: PropTypes.object.isRequired,
  onLabelClick: PropTypes.func
};
