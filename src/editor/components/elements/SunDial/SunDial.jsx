import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import {
  MIN_SUN_ELEVATION,
  dialPointFromSun,
  sunFromDialPoint
} from '../../../../tested/sun-direction.js';
import styles from './SunDial.module.scss';

const SIZE = 112;
const C = SIZE / 2;
const R = 44; // dial radius in px; the labels sit outside it

const messages = defineMessages({
  label: {
    id: 'sunDial.label',
    defaultMessage:
      'Sun position: drag the dot; the centre is overhead, the rim is near the horizon'
  },
  north: { id: 'sunDial.north', defaultMessage: 'N' },
  east: { id: 'sunDial.east', defaultMessage: 'E' },
  south: { id: 'sunDial.south', defaultMessage: 'S' },
  west: { id: 'sunDial.west', defaultMessage: 'W' }
});

function commitSun(entity, { azimuth, elevation }) {
  const update = (property, value) => [
    'entityupdate',
    {
      entity,
      component: 'street-environment',
      property,
      value,
      noSelectEntity: true
    }
  ];
  AFRAME.INSPECTOR.execute('multi', [
    update('sunCustom', true),
    update('sunAzimuth', azimuth),
    update('sunElevation', elevation)
  ]);
}

/**
 * Photoshop-style light-angle dial for the environment sun: a top-down
 * compass, north up. The dot is where the sun is: the centre is straight
 * overhead and the rim is the lowest sun allowed. Dragging previews on the
 * light directly and commits one undo step on release; Escape cancels.
 * Arrow keys nudge (left/right turn, up/down raise/lower) and commit.
 */
const SunDial = ({ entity }) => {
  const intl = useIntl();
  const component = entity.components['street-environment'];
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const svgRef = useRef(null);
  const sun = drag || component.getSunAngles();
  const custom = component.data.sunCustom;

  // Restore the committed sun if the panel unmounts mid-drag.
  useEffect(
    () => () => {
      if (dragRef.current) component.applySun();
    },
    [component]
  );

  const sunAt = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    const scale = rect.width / SIZE;
    const x = (event.clientX - rect.left) / scale - C;
    const y = (event.clientY - rect.top) / scale - C;
    return sunFromDialPoint(x / R, y / R);
  };

  const preview = (next) => {
    dragRef.current = next;
    setDrag(next);
    component.setSun(next.azimuth, next.elevation);
  };

  const endDrag = (commit) => {
    const last = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (commit && last) commitSun(entity, last);
    else component.applySun();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    preview(sunAt(event));
  };
  const onPointerMove = (event) => {
    if (dragRef.current) preview(sunAt(event));
  };
  const onPointerUp = () => {
    if (dragRef.current) endDrag(true);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && dragRef.current) {
      event.stopPropagation();
      endDrag(false);
      return;
    }
    const nudge = {
      ArrowLeft: [-5, 0],
      ArrowRight: [5, 0],
      ArrowUp: [0, 5],
      ArrowDown: [0, -5]
    }[event.key];
    if (!nudge || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    commitSun(entity, {
      azimuth: (((Math.round(sun.azimuth) + nudge[0]) % 360) + 360) % 360,
      elevation: Math.min(
        90,
        Math.max(MIN_SUN_ELEVATION, Math.round(sun.elevation) + nudge[1])
      )
    });
  };

  const resetToPreset = () => {
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: 'street-environment',
      property: 'sunCustom',
      value: false,
      noSelectEntity: true
    });
  };

  const point = dialPointFromSun(sun.azimuth, sun.elevation);
  const sx = C + point.x * R;
  const sy = C + point.y * R;
  const label = intl.formatMessage(messages.label);
  const cardinal = (message, x, y) => (
    <text className={styles.cardinal} x={x} y={y}>
      {intl.formatMessage(message)}
    </text>
  );

  return (
    <div className="propertyRow">
      <label className="text" style={{ textTransform: 'none' }}>
        <FormattedMessage id="sunDial.sun" defaultMessage="Sun" />
      </label>
      <div className={styles.row}>
        <svg
          ref={svgRef}
          className={styles.dial}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuetext={intl.formatMessage(
            {
              id: 'sunDial.valueText',
              defaultMessage: 'From {azimuth}°, {elevation}° above the horizon'
            },
            {
              azimuth: Math.round(sun.azimuth),
              elevation: Math.round(sun.elevation)
            }
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => endDrag(false)}
          onKeyDown={onKeyDown}
        >
          <title>{label}</title>
          <circle className={styles.face} cx={C} cy={C} r={R} />
          <line className={styles.guide} x1={C - R} y1={C} x2={C + R} y2={C} />
          <line className={styles.guide} x1={C} y1={C - R} x2={C} y2={C + R} />
          {cardinal(messages.north, C, C - R - 6)}
          {cardinal(messages.east, C + R + 6, C)}
          {cardinal(messages.south, C, C + R + 6)}
          {cardinal(messages.west, C - R - 6, C)}
          <line className={styles.ray} x1={C} y1={C} x2={sx} y2={sy} />
          <circle className={styles.centre} cx={C} cy={C} r={2} />
          <circle className={styles.sun} cx={sx} cy={sy} r={6} />
        </svg>
        <div className={styles.readout}>
          <span>
            <FormattedMessage
              id="sunDial.azimuth"
              defaultMessage="From {azimuth}°"
              values={{ azimuth: Math.round(sun.azimuth) }}
            />
          </span>
          <span>
            <FormattedMessage
              id="sunDial.elevation"
              defaultMessage="{elevation}° up"
              values={{ elevation: Math.round(sun.elevation) }}
            />
          </span>
          {custom && !drag && (
            <button
              type="button"
              className={styles.reset}
              onClick={resetToPreset}
            >
              <FormattedMessage
                id="sunDial.reset"
                defaultMessage="Reset to preset"
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

SunDial.propTypes = {
  entity: PropTypes.object.isRequired
};

export default SunDial;
