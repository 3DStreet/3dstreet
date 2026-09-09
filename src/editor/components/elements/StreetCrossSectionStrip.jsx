import { useEffect, useReducer } from 'react';
import PropTypes from 'prop-types';
import { useIntl } from 'react-intl';
import Events from '../../lib/Events';
import useStore from '@/store.js';
import { getEntityDisplayName } from '../../lib/entity';
import {
  getStripSegments,
  getSegmentBarColor,
  getBarInkColor,
  getSegmentTurns
} from '../../lib/segmentPanel';
import { toDisplay } from './LengthPropertyRow';

// Live cross-section strip at the top of the segment sidebar (#1753): one bar
// per segment of the parent managed street, drawn from live data (flex width
// = segment width, fill = surface/color, taller = raised, glyph = direction).
// Clicking a bar selects that segment through the same code path as the scene
// graph, keeping the panel mounted; double-click frames it (same objectfocus
// event as the scene graph / canvas); hovering a bar drives the viewport's
// hover highlight through the same events the canvas raycaster emits, so the
// strip and the 3D view read as one control. "Edit street" selects the
// parent street.

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

// Turn-movement glyph mirroring the lane's arrow stencils: a stem with a
// head per painted movement (straight / left / right). Drawn for a driver
// heading up the strip (outbound, −z); inbound rotates it 180°, which also
// puts the driver's left on the strip's right, matching the scene.
const TurnArrow = ({ turns, down, ink }) => {
  const head = (x, y, dx, dy) => {
    // arrowhead at (x, y) pointing along (dx, dy); (−dy, dx) is its normal
    const s = 3.5;
    return (
      <path
        d={`M${x - dx * s - dy * s} ${y - dy * s + dx * s}L${x} ${y}L${x - dx * s + dy * s} ${y - dy * s - dx * s}`}
      />
    );
  };
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={ink}
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={down ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path d={`M12 21V${turns.straight ? 4 : 12}`} />
      {turns.straight && head(12, 4, 0, -1)}
      {turns.left && (
        <>
          <path d="M12 12H4" />
          {head(4, 12, -1, 0)}
        </>
      )}
      {turns.right && (
        <>
          <path d="M12 12H20" />
          {head(20, 12, 1, 0)}
        </>
      )}
    </svg>
  );
};

TurnArrow.propTypes = {
  turns: PropTypes.object.isRequired,
  down: PropTypes.bool,
  ink: PropTypes.string
};

// The importers name streets "Managed Street • <name>" (StreetPlan/JSON) or
// "Street • <name>" (Streetmix); the caption wants just the name (same
// convention as managed-street.js's exporter).
const STREET_NAME_PREFIX = /^(Managed )?Street • /;
const streetDisplayName = (streetEl) =>
  getEntityDisplayName(streetEl).replace(STREET_NAME_PREFIX, '');

// `entity` may be a street-segment (segment panel: selected bar highlighted,
// footnote with the street name + "Edit street") or the managed-street itself
// (street panel, variant="street": no selection highlight, footnote is the
// "tap a lane" hint). Both panels put the strip below the entity header.
const StreetCrossSectionStrip = ({ entity, variant = 'segment' }) => {
  const intl = useIntl();
  const units = useStore((s) => s.unitsPreference) || 'metric';
  const [, forceRender] = useReducer((t) => t + 1, 0);

  const streetEl = entity?.components?.['managed-street']
    ? entity
    : entity?.parentNode;
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

  const summary = intl.formatMessage(
    {
      id: 'segmentSidebar.stripSummary',
      defaultMessage: '{count, plural, one {# segment} other {# segments}}'
    },
    { count: segments.length }
  );

  return (
    <div className="cross-section">
      <div className="cross-section-strip">
        {segments.map((el, i) => {
          const data = el.getAttribute('street-segment') || {};
          const width = data.width || 0;
          const raised = data.slope
            ? Math.max(data.slopeStart || 0, data.slopeEnd || 0) > 0
            : (data.elevation || 0) > 0;
          const bg = getSegmentBarColor(data);
          const selected = el === entity;
          // Boundaries carry a direction in data (their clones' yaw is
          // derived from it) but it isn't a travel direction, and the
          // sidebar hides the control for them; hide the arrow too.
          const hasArrow =
            data.type !== 'boundary' &&
            (data.direction === 'inbound' || data.direction === 'outbound');
          const turns = hasArrow ? getSegmentTurns(el) : null;
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
              onDoubleClick={() => Events.emit('objectfocus', el.object3D)}
              onMouseEnter={() => Events.emit('raycastermouseenter', el)}
              onMouseLeave={() => Events.emit('raycastermouseleave', null)}
            >
              {hasArrow && (
                <span className="cross-section-glyph">
                  {turns ? (
                    <TurnArrow
                      turns={turns}
                      down={data.direction === 'inbound'}
                      ink={getBarInkColor(bg)}
                    />
                  ) : (
                    <BarArrow
                      down={data.direction === 'inbound'}
                      ink={getBarInkColor(bg)}
                    />
                  )}
                </span>
              )}
              {selected && <div className="cross-section-pointer" />}
            </div>
          );
        })}
      </div>
      {variant === 'segment' && (
        <div className="cross-section-footnote">
          <span className="cross-section-summary">
            {streetDisplayName(streetEl)} · {summary} ·{' '}
            {formatLength(totalWidth)}
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
      )}
      {variant === 'street' && (
        <div className="cross-section-footnote">
          <span className="cross-section-footnote-stats">
            {summary} · {formatLength(totalWidth)}
          </span>{' '}
          ·{' '}
          {intl.formatMessage({
            id: 'managedStreetSidebar.tapLane',
            defaultMessage: 'Tap a lane to edit it'
          })}
        </div>
      )}
    </div>
  );
};

StreetCrossSectionStrip.propTypes = {
  entity: PropTypes.object.isRequired,
  variant: PropTypes.oneOf(['segment', 'street'])
};

export default StreetCrossSectionStrip;
