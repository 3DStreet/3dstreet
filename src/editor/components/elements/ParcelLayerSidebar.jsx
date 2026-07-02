import { useEffect, useReducer } from 'react';
import PropTypes from 'prop-types';

// Sidebar panel for the parcel-data-layer POC. A pinned parcel is a "pseudo
// entity" — the real selected entity is the layer itself — so we render the
// parcel's metadata as read-only rows here instead of transform controls.
// The component emits `parcelpinnedchanged` on its entity whenever the pin
// changes; that event drives re-renders.

const Row = ({ label, value }) => (
  <div className="propertyRow">
    <label className="text">{label}</label>
    <input
      className="string"
      type="text"
      value={value === null || value === undefined ? '—' : String(value)}
      readOnly
    />
  </div>
);

Row.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.any
};

const ParcelLayerSidebar = ({ entity }) => {
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    entity.addEventListener('parcelpinnedchanged', forceUpdate);
    return () => entity.removeEventListener('parcelpinnedchanged', forceUpdate);
  }, [entity]);

  const comp = entity.components['parcel-data-layer'];
  const parcel = comp?.pinned;
  const p = parcel?.props;
  const geo = comp?.pinnedLatLon;
  const sims = comp?.pinnedSims || [];

  return (
    <div className="sidepanelContent">
      {!p ? (
        <div style={{ padding: '8px 0', color: '#999', fontSize: '13px' }}>
          Hover the map to inspect parcels; click a parcel to pin its details
          here.
        </div>
      ) : (
        <div className="collapsible-content">
          <Row label="Parcel ID" value={p.parcel_id} />
          <Row label="Zoning" value={p.current_zoning} />
          <Row
            label="Height limit"
            value={
              p.current_height_limit != null
                ? `${p.current_height_limit} ft`
                : null
            }
          />
          <Row
            label="Current height"
            value={p.current_height != null ? `${p.current_height} ft` : null}
          />
          <Row label="Current use" value={p.current_use} />
          <Row
            label="Lot size"
            value={p.lot_sqft != null ? `${Math.round(p.lot_sqft)} sqft` : null}
          />
          <Row
            label="P(redevelop 10yr)"
            value={
              p.pdev_10yr != null ? `${(p.pdev_10yr * 100).toFixed(2)}%` : null
            }
          />
          {geo && (
            <Row
              label="Lat, Lon"
              value={`${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`}
            />
          )}
          {sims.map((sim, i) => (
            <div key={i} style={{ marginTop: '10px' }}>
              <div
                style={{
                  fontSize: '12px',
                  color: '#ffb366',
                  padding: '2px 0'
                }}
              >
                ▲ {sim.layerName}
              </div>
              <Row label="Scenario" value={sim.props.scenario} />
              <Row
                label="Develops"
                value={
                  sim.props.developed
                    ? `year ${sim.props.year_built}`
                    : 'no (in this run)'
                }
              />
              <Row
                label="Simulated height"
                value={
                  sim.props.height_feet != null
                    ? `${sim.props.height_feet} ft`
                    : null
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

ParcelLayerSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default ParcelLayerSidebar;
