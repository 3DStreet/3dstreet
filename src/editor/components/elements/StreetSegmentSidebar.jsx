import { useState } from 'react';
import PropTypes from 'prop-types';
import { useIntl } from 'react-intl';
import { Tooltip } from 'radix-ui';
import Component from './StreetSegmentComponent';
import PropertyRow from './PropertyRow';
import StreetCrossSectionStrip from './StreetCrossSectionStrip';
import AddGeneratorComponent from './AddGeneratorComponent';
import AdvancedComponents from './AdvancedComponents';
import NumberWidget from '../widgets/NumberWidget';
import SelectWidget from '../widgets/SelectWidget';
import BooleanWidget from '../widgets/BooleanWidget';
import { toDisplay, toMetres } from './LengthPropertyRow';
import useStore from '@/store.js';
import {
  canRenameEntity,
  cloneEntity,
  removeSelectedEntity,
  reorderEntityRelativeTo,
  getEntityDisplayName
} from '../../lib/entity';
import EntityLabel from '../scenegraph/EntityLabel';
import EntityActionButtons, {
  ActionTooltip,
  IconButton
} from './EntityActionButtons';
import { getTravelledWaySegments } from '@/aframe-components/street-layout-utils';
import {
  StreetSurfaceIcon,
  ArrowLeftIcon,
  ArrowRightIcon
} from '@shared/icons';
import { commonMessages } from '@/editor/i18n/commonMessages';
import { isGeneratorComponent } from '../../lib/featuredComponents';
import { captureSegmentEdit, SEGMENT_OPS } from '../../lib/segmentAnalytics';
import {
  executeSegmentUpdate,
  WIDTH_PRESETS,
  SURFACE_TEXTURE_IDS,
  getFlatSwatchColor
} from '../../lib/segmentPanel';

// Condensed street-segment sidebar (#1753, design option 2a): cross-section
// strip on top, icon-button header, compact Type/Width/Direction block,
// Surface section with paired rows and a dedicated slope state, then the
// generator sections (see StreetSegmentComponent) and an Add generator /
// Advanced footer. Every edit still flows through the inspector's undoable
// entityupdate path.

const componentName = 'street-segment';

// Width in metres with the user's units preference, plus per-type preset
// pills. The pills are curated design values per unit system (see
// WIDTH_PRESETS in lib/segmentPanel.js for the NACTO sources): imperial
// shows the round foot values, metric the decimetre-rounded ones — not
// conversions of each other. A typed value always wins; no pill highlights
// when the width is off-preset.
const WidthRow = ({ entity, data, schema }) => {
  const intl = useIntl();
  const units = useStore((s) => s.unitsPreference) || 'metric';
  const value = typeof data.width === 'number' ? data.width : 0;
  const imperial = units === 'imperial';
  const presets =
    WIDTH_PRESETS[imperial ? 'imperial' : 'metric'][data.type] || [];

  const commitMetres = (metres) =>
    executeSegmentUpdate(entity, componentName, 'width', metres);

  // Presets are stored in display units (ft or m); compare in display units
  // so a pill lights up for the exact width it commits.
  const presetMetres = (preset) =>
    parseFloat(toMetres(preset, units).toFixed(4));
  const isPresetActive = (preset) =>
    Math.abs(toDisplay(value, units) - preset) < 0.01;

  return (
    <div className="compact-row">
      <label className="compact-label">
        {intl.formatMessage({
          id: 'segmentSidebar.width',
          defaultMessage: 'Width'
        })}
      </label>
      <div className="width-controls">
        <NumberWidget
          id={`${componentName}:width`}
          name="width"
          value={toDisplay(value, units)}
          min={
            schema.min !== undefined ? toDisplay(schema.min, units) : -Infinity
          }
          precision={2}
          unit={imperial ? 'ft' : 'm'}
          onChange={(_name, displayValue) =>
            commitMetres(parseFloat(toMetres(displayValue, units).toFixed(4)))
          }
        />
        {presets.length > 0 && (
          <div className="segmented-group width-presets">
            {presets.map((preset) => (
              <button
                type="button"
                key={preset}
                className={
                  'segmented-option' +
                  (isPresetActive(preset) ? ' is-selected' : '')
                }
                title={`${preset} ${imperial ? 'ft' : 'm'}`}
                onClick={() => commitMetres(presetMetres(preset))}
              >
                {imperial ? preset : preset.toFixed(1)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

WidthRow.propTypes = {
  entity: PropTypes.object.isRequired,
  data: PropTypes.object.isRequired,
  schema: PropTypes.object.isRequired
};

const DirectionArrow = ({ down }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {down ? (
      <path d="M12 5v14M5 12l7 7 7-7" />
    ) : (
      <path d="M12 19V5M5 12l7-7 7 7" />
    )}
  </svg>
);

DirectionArrow.propTypes = { down: PropTypes.bool };

// Three-way segmented control; the strip echoes the same arrow glyph.
const DirectionRow = ({ entity, data }) => {
  const intl = useIntl();
  const setDirection = (value) => {
    if (value === data.direction) return;
    executeSegmentUpdate(entity, componentName, 'direction', value);
  };
  const optionClass = (value) =>
    'segmented-option' + (data.direction === value ? ' is-selected' : '');
  return (
    <div className="compact-row">
      <label className="compact-label">
        {intl.formatMessage({
          id: 'segmentSidebar.direction',
          defaultMessage: 'Direction'
        })}
      </label>
      <div className="segmented-group direction-control">
        <button
          type="button"
          className={optionClass('inbound')}
          onClick={() => setDirection('inbound')}
        >
          <DirectionArrow down />
          {intl.formatMessage({
            id: 'segmentSidebar.inbound',
            defaultMessage: 'inbound'
          })}
        </button>
        <button
          type="button"
          className={optionClass('outbound')}
          onClick={() => setDirection('outbound')}
        >
          <DirectionArrow />
          {intl.formatMessage({
            id: 'segmentSidebar.outbound',
            defaultMessage: 'outbound'
          })}
        </button>
        <button
          type="button"
          className={optionClass('none') + ' direction-none'}
          onClick={() => setDirection('none')}
        >
          {intl.formatMessage({
            id: 'segmentSidebar.directionNone',
            defaultMessage: 'none'
          })}
        </button>
      </div>
    </div>
  );
};

DirectionRow.propTypes = {
  entity: PropTypes.object.isRequired,
  data: PropTypes.object.isRequired
};

// 88px swatch + hex field (hex shown without '#').
const ColorField = ({ entity, value }) => {
  const [draft, setDraft] = useState(null);
  const hex = (() => {
    try {
      return '#' + new THREE.Color(value || '#ffffff').getHexString();
    } catch {
      return '#ffffff';
    }
  })();
  const commit = (v) => {
    // Nothing typed (click in, tab out): no command, no undo entry.
    if (draft === null) return;
    setDraft(null);
    const cleaned = v.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(cleaned)) {
      executeSegmentUpdate(entity, componentName, 'color', '#' + cleaned);
    }
  };
  return (
    <div className="color-field">
      <input
        type="color"
        className="color-field-swatch"
        value={hex}
        onChange={(e) =>
          executeSegmentUpdate(entity, componentName, 'color', e.target.value)
        }
      />
      <input
        type="text"
        className="color-field-hex"
        value={draft !== null ? draft : hex.replace('#', '')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.target.blur();
        }}
        spellCheck={false}
      />
    </div>
  );
};

ColorField.propTypes = {
  entity: PropTypes.object.isRequired,
  value: PropTypes.string
};

// Slope profile glyph: cyan line tilted toward the lower edge over a dashed
// baseline.
const SlopeGlyph = ({ startHigher }) => (
  <svg width="44" height="22" viewBox="0 0 44 22" fill="none">
    <path
      d={startHigher ? 'M2 4 L42 18' : 'M2 18 L42 4'}
      stroke="#00FFFF"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path d="M2 20H42" stroke="#555" strokeDasharray="2 3" />
  </svg>
);

SlopeGlyph.propTypes = { startHigher: PropTypes.bool };

// Material dropdown option: texture swatch + name. The swatch reads the same
// A-Frame <img> texture asset the segment mesh uses (SURFACE_TEXTURE_IDS),
// so it always matches what renders; textureless surfaces (none, solid,
// water) get a flat chip.
const formatSurfaceOption = (option) => {
  const surface = option.value;
  const textureSrc = document.getElementById(SURFACE_TEXTURE_IDS[surface])?.src;
  return (
    <span className="surface-option">
      {textureSrc ? (
        <img className="surface-swatch" src={textureSrc} alt="" />
      ) : (
        <span
          className="surface-swatch"
          style={{ background: getFlatSwatchColor(surface) }}
        />
      )}
      {option.label}
    </span>
  );
};

// Surface section: Material | Color, Elevation | Slope toggle, and when slope
// is on an L / glyph / R row that maps to slopeStart / slopeEnd. Toggling
// slope off keeps the edge values, it only writes slope: false.
const SurfaceSection = ({ entity, component }) => {
  const intl = useIntl();
  const units = useStore((s) => s.unitsPreference) || 'metric';
  const data = component.data;
  const schema = component.schema;
  const unit = units === 'imperial' ? 'ft' : 'm';

  const commitLength = (property) => (_name, displayValue) => {
    const metres = parseFloat(toMetres(displayValue, units).toFixed(4));
    executeSegmentUpdate(entity, componentName, property, metres);
  };

  const slopeMean = ((data.slopeStart || 0) + (data.slopeEnd || 0)) / 2;

  return (
    <>
      <div className="generator-header surface-header">
        <StreetSurfaceIcon />
        <span className="generator-title">
          {intl.formatMessage(commonMessages.surface)}
        </span>
      </div>
      <div className="compact-row has-color">
        <label className="compact-label">
          {intl.formatMessage({
            id: 'segmentSidebar.material',
            defaultMessage: 'Material'
          })}
        </label>
        <SelectWidget
          id={`${componentName}:surface`}
          name="surface"
          value={data.surface}
          options={schema.surface.oneOf}
          formatOptionLabel={formatSurfaceOption}
          onChange={(_name, value) =>
            executeSegmentUpdate(entity, componentName, 'surface', value)
          }
        />
        <ColorField entity={entity} value={data.color} />
      </div>
      <div className="compact-row two-col">
        <label className="compact-label">
          {intl.formatMessage({
            id: 'segmentSidebar.elevation',
            defaultMessage: 'Elevation'
          })}
        </label>
        {data.slope ? (
          <div
            className="inputBlock has-unit elevation-avg"
            title={intl.formatMessage({
              id: 'segmentSidebar.elevationMeanTitle',
              defaultMessage: 'Mean of the two slope edges'
            })}
          >
            <span className="avg-value">
              {intl.formatMessage(
                {
                  id: 'segmentSidebar.elevationMean',
                  defaultMessage: 'avg {value}'
                },
                { value: toDisplay(slopeMean, units).toFixed(2) }
              )}
            </span>
            <span className="unit">{unit}</span>
          </div>
        ) : (
          <NumberWidget
            id={`${componentName}:elevation`}
            name="elevation"
            value={toDisplay(data.elevation || 0, units)}
            min={
              schema.elevation.min !== undefined
                ? toDisplay(schema.elevation.min, units)
                : -Infinity
            }
            precision={2}
            unit={unit}
            onChange={commitLength('elevation')}
          />
        )}
        <div className="inline-toggle">
          <label htmlFor={`${componentName}:slope`}>
            {intl.formatMessage({
              id: 'segmentSidebar.slope',
              defaultMessage: 'Slope'
            })}
          </label>
          <BooleanWidget
            id={`${componentName}:slope`}
            name="slope"
            value={!!data.slope}
            onChange={(_name, value) =>
              executeSegmentUpdate(entity, componentName, 'slope', value)
            }
          />
        </div>
      </div>
      {data.slope && (
        <div className="compact-row">
          <label className="compact-label" />
          <div className="slope-edges">
            <NumberWidget
              id={`${componentName}:slopeStart`}
              name="slopeStart"
              prefix="L"
              value={toDisplay(data.slopeStart || 0, units)}
              min={0}
              precision={2}
              unit={unit}
              onChange={commitLength('slopeStart')}
            />
            <SlopeGlyph
              startHigher={(data.slopeStart || 0) >= (data.slopeEnd || 0)}
            />
            <NumberWidget
              id={`${componentName}:slopeEnd`}
              name="slopeEnd"
              prefix="R"
              value={toDisplay(data.slopeEnd || 0, units)}
              min={0}
              precision={2}
              unit={unit}
              onChange={commitLength('slopeEnd')}
            />
          </div>
        </div>
      )}
    </>
  );
};

SurfaceSection.propTypes = {
  entity: PropTypes.object.isRequired,
  component: PropTypes.object.isRequired
};

const StreetSegmentSidebar = ({ entity }) => {
  const intl = useIntl();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const component = entity?.components?.[componentName];
  const components = entity ? entity.components : {};

  // Featured generator components on this entity (street-generated-*), same
  // generalized prefix list as before (lib/featuredComponents.js).
  const featuredComponents =
    Object.keys(components).filter(isGeneratorComponent);

  // Move left/right reorders this segment among the travelled-way segments of
  // its managed street (#1751). Boundaries are excluded: street-align places
  // them by `side`, not index, so reordering past one is a visual no-op.
  const parentEl = entity?.parentNode;
  const isManagedStreetChild = !!parentEl?.components?.['managed-street'];
  const travelledWaySiblings = isManagedStreetChild
    ? getTravelledWaySegments(parentEl)
    : [];
  const segmentPos = travelledWaySiblings.indexOf(entity);

  const moveSegment = (offset) => {
    // Re-resolve by id: a move destroys and recreates the element, and this
    // sidebar re-renders only after the new entity finishes loading, so on a
    // quick second click the render-time `entity` is already detached. The
    // recreated element keeps the same id.
    const liveEntity =
      (entity.id && document.getElementById(entity.id)) || entity;
    const streetEl = liveEntity.parentNode;
    if (!streetEl?.components?.['managed-street']) return;
    const siblings = getTravelledWaySegments(streetEl);
    const pos = siblings.indexOf(liveEntity);
    if (pos === -1) return;
    const target = siblings[pos + offset];
    if (!target) return;
    // insert before the target when moving left, after it when moving right
    reorderEntityRelativeTo(
      liveEntity,
      target,
      offset > 0 ? 'after' : 'before'
    );
  };

  if (!component || !component.schema || !component.data) {
    return <div className="segment-panel" />;
  }
  const data = component.data;

  return (
    <div className="segment-panel">
      {/* Strip + header stay pinned while the block below scrolls. */}
      <div className="segment-sticky">
        <div className="segment-header">
          {/* EntityLabel replaces the panel-level title (hidden for segments
            in Sidebar.jsx) and keeps the inline rename affordance. */}
          <span className="segment-title" title={getEntityDisplayName(entity)}>
            <EntityLabel entity={entity} editable={canRenameEntity(entity)} />
          </span>
          <div className="segment-actions">
            {segmentPos !== -1 && (
              <Tooltip.Provider>
                <ActionTooltip
                  label={intl.formatMessage({
                    id: 'segmentSidebar.moveLeft',
                    defaultMessage: 'Move Left'
                  })}
                >
                  <IconButton
                    disabled={segmentPos === 0}
                    onClick={() => moveSegment(-1)}
                  >
                    <ArrowLeftIcon />
                  </IconButton>
                </ActionTooltip>
                <ActionTooltip
                  label={intl.formatMessage({
                    id: 'segmentSidebar.moveRight',
                    defaultMessage: 'Move Right'
                  })}
                >
                  <IconButton
                    disabled={segmentPos === travelledWaySiblings.length - 1}
                    onClick={() => moveSegment(1)}
                  >
                    <ArrowRightIcon />
                  </IconButton>
                </ActionTooltip>
                <div className="segment-actions-divider" />
              </Tooltip.Provider>
            )}
            <EntityActionButtons
              entity={entity}
              onDuplicate={() => {
                captureSegmentEdit(SEGMENT_OPS.DUPLICATED, {
                  segment_type: data.type
                });
                cloneEntity(entity);
              }}
              onDelete={() => {
                captureSegmentEdit(SEGMENT_OPS.REMOVED, {
                  segment_type: data.type
                });
                removeSelectedEntity();
              }}
            />
          </div>
        </div>
        <StreetCrossSectionStrip entity={entity} />
      </div>
      <div className="segment-block">
        <PropertyRow
          key="type"
          name="type"
          label={intl.formatMessage({
            id: 'segmentSidebar.type',
            defaultMessage: 'Type'
          })}
          schema={component.schema['type']}
          data={data['type']}
          componentname={componentName}
          isSingle={false}
          entity={entity}
          onValueChange={(name, value) =>
            captureSegmentEdit(SEGMENT_OPS.TYPE_CHANGED, {
              segment_type: value
            })
          }
        />
        {data['type'] === 'boundary' && (
          <>
            <PropertyRow
              key="variant"
              name="variant"
              label={intl.formatMessage({
                id: 'segmentSidebar.variant',
                defaultMessage: 'Variant'
              })}
              schema={component.schema['variant']}
              data={data['variant']}
              componentname={componentName}
              isSingle={false}
              entity={entity}
              onValueChange={(name, value) =>
                captureSegmentEdit(SEGMENT_OPS.VARIANT_CHANGED, {
                  variant: value
                })
              }
            />
            <PropertyRow
              key="side"
              name="side"
              label={intl.formatMessage({
                id: 'segmentSidebar.side',
                defaultMessage: 'Side'
              })}
              schema={component.schema['side']}
              data={data['side']}
              componentname={componentName}
              isSingle={false}
              entity={entity}
            />
          </>
        )}
        <WidthRow
          entity={entity}
          data={data}
          schema={component.schema['width']}
        />
        {data['type'] !== 'boundary' && (
          <DirectionRow entity={entity} data={data} />
        )}
        <SurfaceSection entity={entity} component={component} />
        {featuredComponents.map((key) => (
          <Component
            key={key}
            isCollapsed={false}
            component={components[key]}
            entity={entity}
            name={key}
          />
        ))}
        <div className="panel-footer">
          {/* The Add Component select sits directly in the footer — one
              click opens the component list, no intermediate button. */}
          <AddGeneratorComponent entity={entity} />
          <button
            type="button"
            className={'advanced-btn' + (showAdvanced ? ' is-open' : '')}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {intl.formatMessage({
              id: 'segmentSidebar.advanced',
              defaultMessage: 'Advanced'
            })}
          </button>
        </div>
      </div>
      {showAdvanced && (
        <div className="advancedComponentsContainer">
          <AdvancedComponents entity={entity} />
        </div>
      )}
    </div>
  );
};

StreetSegmentSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default StreetSegmentSidebar;
