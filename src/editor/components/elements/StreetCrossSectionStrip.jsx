import { useEffect, useReducer } from 'react';
import PropTypes from 'prop-types';
import { useIntl } from 'react-intl';
import Events from '../../lib/Events';
import useStore from '@/store.js';
import { getEntityDisplayName } from '../../lib/entity';
import {
  getStripSegments,
  getSegmentBarColor,
  getBarInkColor
} from '../../lib/segmentPanel';
import { toDisplay } from './LengthPropertyRow';

// Live cross-section strip at the top of the segment sidebar (#1753): one bar
// per segment of the parent managed street, drawn from live data (flex width
// = segment width, fill = surface/color, taller = raised, glyph = direction).
// Clicking a bar selects that segment through the same code path as the scene
// graph, keeping the panel mounted; "Edit street" selects the parent street.

// Inline SVG arrows (not text glyphs) so the direction marker renders
// identically regardless of the platform's emoji/arrow font coverage.
const BarArrow = ({ down, ink }) => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke={ink}
    strokeWidth="3"
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

BarArrow.propTypes = { down: PropTypes.bool, ink: PropTypes.string };

// The importers name streets "Managed Street • <name>"; the caption wants
// just the name (same convention as managed-street.js's exporter).
const STREET_NAME_PREFIX = 'Managed Street • ';
const streetDisplayName = (streetEl) => {
  const name = getEntityDisplayName(streetEl);
  return name.startsWith(STREET_NAME_PREFIX)
    ? name.slice(STREET_NAME_PREFIX.length)
    : name;
};

const StreetCrossSectionStrip = ({ entity }) => {
  const intl = useIntl();
  const units = useStore((s) => s.unitsPreference) || 'metric';
  const [, forceRender] = useReducer((t) => t + 1, 0);

  const streetEl = entity?.parentNode;
  const isManagedStreetChild = !!streetEl?.components?.['managed-street'];

  // The strip mirrors the whole street, so it must repaint on any segment
  // change (width, color, direction, …) and on add/remove/reorder — not just
  // edits to the selected entity (the only ones the parent Sidebar refreshes
  // for).
  useEffect(() => {
    if (!isManagedStreetChild) return;
    const onEntityUpdate = (detail) => {
      if (
        detail.entity === streetEl ||
        detail.entity?.parentNode === streetEl
      ) {
        forceRender();
      }
    };
    const onSegmentsChanged = () => forceRender();
    Events.on('entityupdate', onEntityUpdate);
    streetEl.addEventListener('segments-changed', onSegmentsChanged);
    return () => {
      Events.off('entityupdate', onEntityUpdate);
      streetEl.removeEventListener('segments-changed', onSegmentsChanged);
    };
  }, [streetEl, isManagedStreetChild]);

  if (!isManagedStreetChild) return null;

  const segments = getStripSegments(streetEl);
  if (segments.length === 0) return null;

  const totalWidth = segments.reduce(
    (sum, el) => sum + (el.getAttribute('street-segment')?.width || 0),
    0
  );
  const unitLabel = units === 'imperial' ? 'ft' : 'm';
  const formatLength = (m) => `${toDisplay(m, units).toFixed(1)} ${unitLabel}`;

  const selectSegment = (el) => {
    if (el !== entity) AFRAME.INSPECTOR.selectEntity(el);
  };

  return (
    <div className="cross-section">
      <div className="cross-section-caption">
        <span className="cross-section-summary">
          {streetDisplayName(streetEl)} ·{' '}
          {intl.formatMessage(
            {
              id: 'segmentSidebar.stripSummary',
              defaultMessage:
                '{count, plural, one {# segment} other {# segments}}'
            },
            { count: segments.length }
          )}{' '}
          · {formatLength(totalWidth)}
        </span>
        <button
          type="button"
          className="cross-section-edit-street"
          onClick={() => AFRAME.INSPECTOR.selectEntity(streetEl)}
        >
          {intl.formatMessage({
            id: 'segmentSidebar.editStreet',
            defaultMessage: 'Edit street'
          })}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </button>
      </div>
      <div className="cross-section-strip">
        {segments.map((el, i) => {
          const data = el.getAttribute('street-segment') || {};
          const width = data.width || 0;
          const raised = data.slope
            ? Math.max(data.slopeStart || 0, data.slopeEnd || 0) > 0
            : (data.elevation || 0) > 0;
          const bg = getSegmentBarColor(data);
          const selected = el === entity;
          const hasArrow =
            data.direction === 'inbound' || data.direction === 'outbound';
          return (
            <div
              key={el.id || i}
              className={'cross-section-bar' + (selected ? ' is-selected' : '')}
              style={{
                flexGrow: width || 0.1,
                height: raised ? 40 : 32,
                background: bg
              }}
              title={`${getEntityDisplayName(el)} · ${formatLength(width)}`}
              onClick={() => selectSegment(el)}
            >
              {hasArrow && (
                <span className="cross-section-glyph">
                  <BarArrow
                    down={data.direction === 'inbound'}
                    ink={getBarInkColor(bg)}
                  />
                </span>
              )}
              {selected && <div className="cross-section-pointer" />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

StreetCrossSectionStrip.propTypes = {
  entity: PropTypes.object.isRequired
};

export default StreetCrossSectionStrip;
