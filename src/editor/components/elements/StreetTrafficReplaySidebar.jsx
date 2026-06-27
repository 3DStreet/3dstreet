import PropTypes from 'prop-types';
import { useState, useEffect, useMemo } from 'react';
import PropertyRow from './PropertyRow';
import Events from '../../lib/Events';
import { Button, Dropdown } from '../elements';
import { createUniqueId } from '../../lib/entity';
import * as defaultStreetObjects from './AddLayerPanel/defaultStreets.js';

// Fields surfaced inline (the rest of the component's props stay internal).
const PRIMARY_FIELDS = [
  { name: 'timeScale', label: 'Playback speed (×)' },
  { name: 'loop', label: 'Loop' },
  { name: 'suppressSyntheticTraffic', label: 'Hide synthetic traffic' }
];

/**
 * Sidebar for a "Traffic Replay" layer (a `street-traffic-replay` entity).
 * Import a manifest, link the managed-street to animate onto (or create one),
 * tune playback, and optionally place the scene at the sensor's location.
 */
const StreetTrafficReplaySidebar = ({ entity }) => {
  const [, setTick] = useState(0);
  const componentName = 'street-traffic-replay';
  const component = entity?.components?.[componentName];
  const manifestData = component?.data?.manifestData || '';

  useEffect(() => {
    const onEntityUpdate = (detail) => {
      if (detail.entity !== entity) return;
      if (detail.component === componentName) setTick((p) => p + 1);
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  const manifest = useMemo(() => {
    if (!manifestData) return null;
    try {
      return JSON.parse(manifestData);
    } catch {
      return null;
    }
  }, [manifestData]);

  if (!component || !component.schema || !component.data) return null;

  const setProp = (property, value) =>
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: componentName,
      property,
      value,
      noSelectEntity: true
    });

  // --- manifest import (replace) ---
  const importManifest = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        window.STREET?.notify?.errorMessage?.(
          'Could not parse that JSON file.'
        );
        return;
      }
      if (!parsed || !Array.isArray(parsed.agents) || !parsed.agents.length) {
        window.STREET?.notify?.errorMessage?.(
          'That JSON is not a replay manifest (no "agents" array).'
        );
        return;
      }
      setProp('manifestData', JSON.stringify(parsed));
    };
    input.click();
  };

  // --- target managed-street selection ---
  const streetEls = Array.from(
    document.querySelectorAll('[managed-street]')
  ).filter((el) => el.id);
  const targetOptions = [
    { value: '', label: 'Auto (first managed street)' },
    ...streetEls.map((el) => ({
      value: el.id,
      label: el.getAttribute('data-layer-name') || el.id
    }))
  ];

  const createStreet = () => {
    const id = createUniqueId();
    AFRAME.INSPECTOR.execute('entitycreate', {
      id,
      'data-layer-name': 'Street',
      components: {
        position: '0 0 0',
        'managed-street': {
          sourceType: 'json-blob',
          sourceValue: JSON.stringify(defaultStreetObjects.stroad60ftROW),
          showStriping: true,
          showVehicles: false,
          synchronize: true
        }
      }
    });
    setProp('target', id);
    // entitycreate selects the new street; jump back to this replay layer.
    Events.emit('entityselect', entity);
  };

  // --- place scene at the sensor's real-world location ---
  const dep = manifest?.meta?.deployment;
  const placeAtSensor = () => {
    if (!dep) return;
    const geoLayer = document.getElementById('reference-layers');
    if (!geoLayer) return;
    geoLayer.setAttribute('street-geo', {
      latitude: dep.lat,
      longitude: dep.lon,
      maps: 'mapbox2d'
    });
    Events.emit('entityupdate', {
      entity: geoLayer,
      component: 'street-geo'
    });
    window.STREET?.notify?.successMessage?.(
      `Placed scene at ${dep.lat}, ${dep.lon}.`
    );
  };

  const counts = manifest?.meta?.countsByMode;
  const windowLabel = manifest?.meta?.window?.label;

  return (
    <div className="street-traffic-replay-sidebar">
      <div className="details">
        {/* Manifest summary + import */}
        <div className="propertyRow">
          <div className="w-full rounded bg-blue-50 p-2 text-gray-600">
            {manifest ? (
              <>
                <div className="mb-1 font-semibold uppercase">
                  📊 {manifest.agents.length} street users
                  {windowLabel ? ` · ${windowLabel}` : ''}
                </div>
                {counts && (
                  <div className="text-xs">
                    {Object.entries(counts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, v]) => `${k} ${v}`)
                      .join(' · ')}
                  </div>
                )}
              </>
            ) : (
              <div>No manifest loaded — import a replay JSON.</div>
            )}
          </div>
        </div>
        <div className="propertyRow">
          <Button variant="toolbtn" onClick={importManifest}>
            {manifest ? 'Replace manifest…' : 'Import manifest…'}
          </Button>
        </div>

        {/* Linked street */}
        <div className="propertyRow">
          <div className="fakePropertyRowLabel">Linked street</div>
          <div className="fakePropertyRowValue">
            <Dropdown
              placeholder="Link a street"
              options={targetOptions}
              selectedOptionValue={component.data.target || ''}
              onSelect={(value) => setProp('target', value)}
            />
          </div>
        </div>
        <div className="propertyRow">
          <Button variant="toolbtn" onClick={createStreet}>
            Create a street to replay onto
          </Button>
        </div>

        {/* Playback fields */}
        {PRIMARY_FIELDS.map((f) =>
          component.schema[f.name] ? (
            <PropertyRow
              key={f.name}
              name={f.name}
              label={f.label}
              schema={component.schema[f.name]}
              data={component.data[f.name]}
              componentname={componentName}
              isSingle={false}
              entity={entity}
            />
          ) : null
        )}

        {/* Geo placement */}
        {dep && (
          <div className="propertyRow">
            <Button variant="toolbtn" onClick={placeAtSensor}>
              Place scene at sensor location
            </Button>
          </div>
        )}

        <div className="propertyRow">
          <div className="rounded bg-blue-50 p-2 text-gray-600">
            <div className="mb-1 font-semibold uppercase">💡 Replay</div>
            <ul className="space-y-1">
              <li>• Link a managed street (or create one), then press Play</li>
              <li>• Only mode is shown — the data is anonymized</li>
              <li>• Saves with the scene; shareable via the scene link</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

StreetTrafficReplaySidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default StreetTrafficReplaySidebar;
