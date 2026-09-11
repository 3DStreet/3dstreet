import { useState } from 'react';
import PropTypes from 'prop-types';
import { defineMessages, useIntl } from 'react-intl';
import PropertyRow from './PropertyRow';
import GeoLocationRow, { useEntityGeo } from './GeoLocationRow';
import {
  getPositionDisplayMode,
  setPositionDisplayMode
} from '../../lib/panelPrefs';

const messages = defineMessages({
  switchToGeoloc: {
    id: 'sidebar.positionSwitchToGeoloc',
    defaultMessage: 'Click to show geolocated position (lat/lon) instead.'
  }
});

/**
 * The transform section's position row (#1979): three.js coordinates by
 * default; on geospatial scenes, clicking the label swaps in the read-only
 * geolocated readout (and back), and the choice is remembered per device.
 * Without a live geo layer the position row always shows and the label is a
 * plain label.
 */
export default function PositionRow({ entity }) {
  const intl = useIntl();
  const geo = useEntityGeo(entity);
  const [mode, setMode] = useState(getPositionDisplayMode);

  const showGeo = !!geo && mode === 'geoloc';
  const toggle = () => {
    const next = showGeo ? 'position' : 'geoloc';
    setPositionDisplayMode(next);
    setMode(next);
  };

  if (showGeo) {
    return <GeoLocationRow entity={entity} onLabelClick={toggle} />;
  }
  return (
    <PropertyRow
      name="position"
      schema={AFRAME.components.position.schema}
      data={entity.object3D.position}
      isSingle={true}
      componentname="position"
      entity={entity}
      onLabelClick={geo ? toggle : undefined}
      labelTitle={geo ? intl.formatMessage(messages.switchToGeoloc) : undefined}
    />
  );
}

PositionRow.propTypes = {
  entity: PropTypes.object.isRequired
};
