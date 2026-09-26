/* global AFRAME */
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import PropertyRow from './PropertyRow';
import Events from '../../lib/Events';
import { getGroupedMixinOptions } from '../../lib/mixinUtils';
import {
  parsePalette,
  serializePalette
} from '../../../aframe-components/play/build-area-rules.js';

const fieldLabels = defineMessages({
  enabled: { id: 'buildArea.enabled', defaultMessage: 'Enabled' },
  maxObjects: { id: 'buildArea.maxObjects', defaultMessage: 'Max objects' },
  allowRotate: { id: 'buildArea.allowRotate', defaultMessage: 'Allow rotate' }
});

// Rendered through the standard PropertyRow widget; the palette gets a
// curated picker below.
const PRIMARY_FIELDS = [
  { name: 'enabled' },
  { name: 'maxObjects' },
  { name: 'allowRotate' }
];

/**
 * Body of the build-area component bar (rendered by FeaturedComponents
 * inside the standard collapsible Component header with icon + remove):
 * the toggles, the object cap and the palette picker, a grouped checkbox
 * list over the catalog mixins. Palette edits write the component's
 * `palette` string through an entityupdate command (undoable, autosaved).
 */
export const BuildAreaSectionControls = ({ entity }) => {
  const intl = useIntl();
  const [, setUpdateTrigger] = useState(0);
  const [filter, setFilter] = useState('');
  const componentName = 'build-area';
  const component = entity?.components?.[componentName];

  useEffect(() => {
    const onEntityUpdate = (detail) => {
      if (detail.entity !== entity) return;
      if (detail.component === componentName || detail.component === 'shape') {
        setUpdateTrigger((p) => p + 1);
      }
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  const groups = useMemo(() => getGroupedMixinOptions(true), []);

  if (!component || !component.schema || !component.data) return null;

  const selected = parsePalette(component.data.palette);
  const isClosed = !!entity.components?.shape?.data?.closed;
  const needle = filter.trim().toLowerCase();

  const setPalette = (ids) => {
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: componentName,
      property: 'palette',
      value: serializePalette(ids)
    });
  };
  const toggle = (mixinId) => {
    setPalette(
      selected.includes(mixinId)
        ? selected.filter((id) => id !== mixinId)
        : [...selected, mixinId]
    );
  };

  return (
    <>
      {PRIMARY_FIELDS.map((f) =>
        component.schema[f.name] ? (
          <PropertyRow
            key={f.name}
            name={f.name}
            label={intl.formatMessage(fieldLabels[f.name])}
            schema={component.schema[f.name]}
            data={component.data[f.name]}
            componentname={componentName}
            isSingle={false}
            entity={entity}
          />
        ) : null
      )}
      <div className="roleSectionBody">
        {!isClosed && (
          <div className="tip">
            <FormattedMessage
              id="buildArea.notClosedTip"
              defaultMessage="⚠️ Close this shape (Closed above) so it has an interior visitors can build on."
            />
          </div>
        )}
        <div className="text">
          <FormattedMessage
            id="buildArea.palette"
            defaultMessage="Palette ({count} selected)"
            values={{ count: selected.length }}
          />
        </div>
        <input
          type="text"
          className="buildAreaPaletteFilter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={intl.formatMessage({
            id: 'buildArea.paletteFilter',
            defaultMessage: 'Filter objects…'
          })}
        />
        <div className="buildAreaPalette">
          {groups.map((group) => {
            const options = group.options.filter(
              (o) =>
                !needle ||
                o.name.toLowerCase().includes(needle) ||
                o.mixinId.toLowerCase().includes(needle)
            );
            if (!options.length) return null;
            return (
              <details key={group.label} className="buildAreaPaletteGroup">
                <summary>
                  {group.label}
                  {(() => {
                    const n = group.options.filter((o) =>
                      selected.includes(o.mixinId)
                    ).length;
                    return n ? ` (${n})` : '';
                  })()}
                </summary>
                {options.map((option) => (
                  <label key={option.mixinId} className="buildAreaPaletteItem">
                    <input
                      type="checkbox"
                      checked={selected.includes(option.mixinId)}
                      onChange={() => toggle(option.mixinId)}
                    />
                    <span>{option.name}</span>
                  </label>
                ))}
              </details>
            );
          })}
        </div>
        <div className="tip">
          <FormattedMessage
            id="buildArea.tip"
            defaultMessage="💡 Visitors drag these objects onto this shape while playing. Press Start to try it; Stop clears what was placed. Nothing a visitor builds is saved to your scene: they keep their work with Open in 3DStreet."
          />
        </div>
      </div>
    </>
  );
};

BuildAreaSectionControls.propTypes = {
  entity: PropTypes.object.isRequired
};
