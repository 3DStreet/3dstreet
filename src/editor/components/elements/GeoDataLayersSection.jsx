import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import posthog from 'posthog-js';
import Collapsible from '../Collapsible';
import BooleanWidget from '../widgets/BooleanWidget';
import OpacitySliderRow from '../widgets/OpacitySliderRow';
import Events from '../../lib/Events';
import {
  GEO_DATA_SOURCES,
  getDataSource,
  sourcesForLocation
} from '../../../tested/geo-data-sources.js';

// Data layers (#2090): Geospatial Data Sources drawn over the base map, each
// a `geo-layer` entity under the street-geo entity (#reference-layers). This
// section is a shortcut for adding and removing them; once added, a layer is
// an ordinary entity in the scene graph (select, hide, rename, delete). The
// list shows every registry source that covers the scene's location, plus any
// layer the scene already has, so one left behind by a location change can
// still be removed. Every change goes through Inspector.execute, so it is
// undoable and saved with the scene. Doc: docs/geo-data-layers.md.

const layerEntities = (geoEl) =>
  Array.from(geoEl.children).filter((child) =>
    child.hasAttribute?.('geo-layer')
  );

const DataLayerRow = ({ geoEl, source, layerEl, covers }) => {
  const intl = useIntl();
  const enabled = Boolean(layerEl);

  const toggle = () => {
    if (enabled) {
      posthog.capture('geo_data_layer_removed', { source: source.id });
      AFRAME.INSPECTOR.execute('entityremove', layerEl);
    } else {
      posthog.capture('geo_data_layer_added', { source: source.id });
      AFRAME.INSPECTOR.execute('entitycreate', {
        parentEl: geoEl,
        'data-layer-name': source.name,
        components: { 'geo-layer': `source: ${source.id}` },
        noSelectEntity: true
      });
    }
  };

  const setOpacity = (value) => {
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity: layerEl,
      component: 'geo-layer',
      property: 'opacity',
      value,
      noSelectEntity: true
    });
  };

  return (
    <div className="geo-data-layer" style={{ marginBottom: '12px' }}>
      <div className="propertyRow">
        {enabled ? (
          // The layer is an entity: selecting it opens its own properties
          // panel (radius, water, creeks, rename, delete).
          <button
            type="button"
            className="text"
            style={{
              textTransform: 'none',
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'inherit',
              textAlign: 'left',
              textDecoration: 'underline dotted',
              cursor: 'pointer'
            }}
            title={source.description}
            onClick={() => AFRAME.INSPECTOR.selectEntity(layerEl)}
          >
            {source.name}
          </button>
        ) : (
          <label
            className="text"
            htmlFor={`geo-data-layer-${source.id}`}
            style={{ textTransform: 'none' }}
            title={source.description}
          >
            {source.name}
          </label>
        )}
        <BooleanWidget
          id={`geo-data-layer-${source.id}`}
          name={source.id}
          value={enabled}
          onChange={toggle}
        />
      </div>
      {enabled && (
        <OpacitySliderRow
          id={`geo-data-layer-${source.id}-opacity`}
          label={intl.formatMessage({
            id: 'geoDataLayers.opacity',
            defaultMessage: 'Layer Opacity (%)'
          })}
          min={0}
          max={100}
          step={1}
          value={layerEl.getAttribute('geo-layer').opacity}
          onCommit={setOpacity}
          showNumberInput
        />
      )}
      <div
        className="geo-data-layer-notes"
        style={{
          fontSize: '11px',
          color: '#aaa',
          lineHeight: '15px',
          padding: '0 15px'
        }}
      >
        {!covers && (
          <div style={{ color: '#e0b060' }}>
            <FormattedMessage
              id="geoDataLayers.outsideCoverage"
              defaultMessage="This scene's location is outside this layer's coverage."
            />
          </div>
        )}
        {source.caveat && <div>{source.caveat}</div>}
        <div>
          <a
            href={source.homepage || source.sourceRepository}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 'inherit' }}
          >
            <FormattedMessage
              id="geoDataLayers.sourceLink"
              defaultMessage="About this source"
            />
          </a>
          {' · '}
          <a
            href={source.licenseUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 'inherit' }}
          >
            {source.license}
          </a>
        </div>
      </div>
    </div>
  );
};

DataLayerRow.propTypes = {
  geoEl: PropTypes.object.isRequired,
  source: PropTypes.object.isRequired,
  layerEl: PropTypes.object,
  covers: PropTypes.bool.isRequired
};

const GeoDataLayersSection = ({ entity, latitude, longitude }) => {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const isLayer = (el) =>
      el?.parentNode === entity && el.hasAttribute?.('geo-layer');
    const onUpdate = (detail) => {
      if (isLayer(detail?.entity)) forceUpdate({});
    };
    // entitycreated fires before the new child is attached in some paths,
    // and entityremoved after it is gone: re-render on either regardless.
    const onAddRemove = () => forceUpdate({});
    Events.on('entityupdate', onUpdate);
    Events.on('entitycreated', onAddRemove);
    Events.on('entityremoved', onAddRemove);
    return () => {
      Events.off('entityupdate', onUpdate);
      Events.off('entitycreated', onAddRemove);
      Events.off('entityremoved', onAddRemove);
    };
  }, [entity]);

  const covering = sourcesForLocation(longitude, latitude);
  const layers = layerEntities(entity);
  const layerFor = (id) =>
    layers.find((el) => el.getAttribute('geo-layer')?.source === id);
  const sources = GEO_DATA_SOURCES.filter(
    (s) => covering.includes(s) || (getDataSource(s.id) && layerFor(s.id))
  );

  return (
    <Collapsible sectionKey="geo-data-layers">
      <div className="componentHeader collapsible-header">
        <span className="componentTitle">
          <span>
            <FormattedMessage
              id="geoDataLayers.title"
              defaultMessage="Data Layers"
            />
          </span>
        </span>
      </div>
      <div className="collapsible-content">
        {sources.length === 0 ? (
          <div style={{ fontSize: '12px', color: '#aaa' }}>
            <FormattedMessage
              id="geoDataLayers.none"
              defaultMessage="No data layers cover this location yet."
            />
          </div>
        ) : (
          sources.map((source) => (
            <DataLayerRow
              key={source.id}
              geoEl={entity}
              source={source}
              layerEl={layerFor(source.id)}
              covers={covering.includes(source)}
            />
          ))
        )}
      </div>
    </Collapsible>
  );
};

GeoDataLayersSection.propTypes = {
  entity: PropTypes.object.isRequired,
  latitude: PropTypes.number,
  longitude: PropTypes.number
};

export default GeoDataLayersSection;
