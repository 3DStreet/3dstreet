/* global AFRAME */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { defineMessages, useIntl } from 'react-intl';
import { Tooltip } from 'radix-ui';
import PropertyRow from './PropertyRow';
import Collapsible from '../Collapsible';
import SurfaceSwatchOption from './SurfaceSwatchOption';
import { toDisplay, toMetres } from './LengthPropertyRow';
import ColorWidget from '../widgets/ColorWidget';
import NumberWidget from '../widgets/NumberWidget';
import SelectWidget from '../widgets/SelectWidget';
import OpacitySliderRow from '../widgets/OpacitySliderRow';
import Events from '../../lib/Events';
import useStore from '@/store.js';
import {
  FILL_MATERIALS,
  FILL_MATERIAL_IDS,
  FILL_PATTERNS,
  resolveFillMaterial,
  resolveFillPattern
} from '@/tested/shape-fill.js';
import styles from './PrimaryToolbar/PrimaryToolbar.module.scss';

const COMPONENT = 'shape';

const lineLabels = defineMessages({
  closed: { id: 'shapeSidebar.closed', defaultMessage: 'Closed' },
  lineColor: { id: 'shapeSidebar.lineColor', defaultMessage: 'Line color' },
  lineWidth: { id: 'shapeSidebar.lineWidth', defaultMessage: 'Line width' }
});

const messages = defineMessages({
  fill: { id: 'shapeSidebar.fill', defaultMessage: 'Fill' },
  fillWhenOpen: {
    id: 'shapeSidebar.fillWhenOpen',
    defaultMessage: 'Fill (applies when closed)'
  },
  material: {
    id: 'shapeSidebar.fillMaterial',
    defaultMessage: 'Fill material'
  },
  materialHelp: {
    id: 'shapeSidebar.fillMaterialHelp',
    defaultMessage: 'The surface of the shape.'
  },
  materialOpacity: {
    id: 'shapeSidebar.materialOpacity',
    defaultMessage: 'Material opacity (%)'
  },
  materialOpacityHelp: {
    id: 'shapeSidebar.materialOpacityHelp',
    defaultMessage:
      'How solid the surface is. 0% hides it; any pattern still shows.'
  },
  color: { id: 'shapeSidebar.fillColor', defaultMessage: 'Color' },
  tint: { id: 'shapeSidebar.fillTint', defaultMessage: 'Tint' },
  tintHelp: {
    id: 'shapeSidebar.fillTintHelp',
    defaultMessage: 'Colors the texture. White shows it as it is.'
  },
  pattern: { id: 'shapeSidebar.fillPattern', defaultMessage: 'Fill pattern' },
  patternHelp: {
    id: 'shapeSidebar.fillPatternHelp',
    defaultMessage: 'Paint on top of the material.'
  },
  patternOpacity: {
    id: 'shapeSidebar.patternOpacity',
    defaultMessage: 'Pattern opacity (%)'
  },
  patternOpacityHelp: {
    id: 'shapeSidebar.patternOpacityHelp',
    defaultMessage: 'How solid the pattern is.'
  },
  patternColor: {
    id: 'shapeSidebar.patternColor',
    defaultMessage: 'Pattern color'
  },
  patternColorHelp: {
    id: 'shapeSidebar.patternColorHelp',
    defaultMessage: 'Color of the stripes, squares or dots.'
  },
  spacing: { id: 'shapeSidebar.patternSpacing', defaultMessage: 'Spacing' },
  spacingHelp: {
    id: 'shapeSidebar.patternSpacingHelp',
    defaultMessage:
      'Distance between the centers of neighboring stripes or dots.'
  },
  squareSize: { id: 'shapeSidebar.squareSize', defaultMessage: 'Square size' },
  squareSizeHelp: {
    id: 'shapeSidebar.squareSizeHelp',
    defaultMessage: 'Width of one square.'
  },
  stripeWidth: {
    id: 'shapeSidebar.stripeWidth',
    defaultMessage: 'Stripe width'
  },
  stripeWidthHelp: {
    id: 'shapeSidebar.stripeWidthHelp',
    defaultMessage: 'Width of each stripe.'
  },
  dotDiameter: {
    id: 'shapeSidebar.dotDiameter',
    defaultMessage: 'Dot diameter'
  },
  dotDiameterHelp: {
    id: 'shapeSidebar.dotDiameterHelp',
    defaultMessage: 'Width of each dot.'
  },
  angle: { id: 'shapeSidebar.fillAngle', defaultMessage: 'Angle' },
  angleHelp: {
    id: 'shapeSidebar.fillAngleHelp',
    defaultMessage:
      "Direction of the pattern and texture. Set from the shape's first side when it was drawn; turns with the shape. Stripes and crosshatch run diagonally to it."
  },
  offsetAlong: {
    id: 'shapeSidebar.fillOffsetAlong',
    defaultMessage: 'Offset along'
  },
  offsetAcross: {
    id: 'shapeSidebar.fillOffsetAcross',
    defaultMessage: 'Offset across'
  },
  offsetHelp: {
    id: 'shapeSidebar.fillOffsetHelp',
    defaultMessage:
      'Slides the pattern and texture along and across their direction.'
  }
});

const materialNames = defineMessages({
  solid: { id: 'shapeSidebar.material.solid', defaultMessage: 'Solid color' },
  concrete: {
    id: 'shapeSidebar.material.concrete',
    defaultMessage: 'Concrete'
  },
  grass: { id: 'shapeSidebar.material.grass', defaultMessage: 'Grass' },
  sidewalk: {
    id: 'shapeSidebar.material.sidewalk',
    defaultMessage: 'Sidewalk'
  },
  gravel: { id: 'shapeSidebar.material.gravel', defaultMessage: 'Gravel' },
  sand: { id: 'shapeSidebar.material.sand', defaultMessage: 'Sand' },
  'cracked-asphalt': {
    id: 'shapeSidebar.material.crackedAsphalt',
    defaultMessage: 'Cracked asphalt'
  },
  'parking-lot': {
    id: 'shapeSidebar.material.parkingLot',
    defaultMessage: 'Parking lot'
  }
});

const patternNames = defineMessages({
  none: { id: 'shapeSidebar.pattern.none', defaultMessage: 'None' },
  stripes: { id: 'shapeSidebar.pattern.stripes', defaultMessage: 'Stripes' },
  crosshatch: {
    id: 'shapeSidebar.pattern.crosshatch',
    defaultMessage: 'Crosshatch'
  },
  checkerboard: {
    id: 'shapeSidebar.pattern.checkerboard',
    defaultMessage: 'Checkerboard'
  },
  dots: { id: 'shapeSidebar.pattern.dots', defaultMessage: 'Dots' }
});

// A small picture of each pattern for its dropdown option, drawn in the
// swatch's 20 px box (`.surface-swatch`): white ink on a mid grey.
const SWATCH_BACKGROUND = '#555';
const SWATCH_INK = '#fff';
// The chip for a texture whose image is not in the scene, as the segment
// picker shows for a surface without a texture.
const MISSING_TEXTURE_CHIP = '#dddddd';

const STRIPES_PATH = 'M-2 8 L8 -2 M-2 16 L16 -2 M4 22 L22 4 M12 22 L22 12';
const PATTERN_SWATCHES = {
  none: null,
  stripes: (
    <path d={STRIPES_PATH} stroke={SWATCH_INK} strokeWidth="2" fill="none" />
  ),
  crosshatch: (
    <path
      d={`${STRIPES_PATH} M12 -2 L22 8 M4 -2 L22 16 M-2 4 L16 22 M-2 12 L8 22`}
      stroke={SWATCH_INK}
      strokeWidth="2"
      fill="none"
    />
  ),
  checkerboard: (
    <path
      d="M0 0 H5 V5 H0 Z M10 0 H15 V5 H10 Z M5 5 H10 V10 H5 Z M15 5 H20 V10 H15 Z M0 10 H5 V15 H0 Z M10 10 H15 V15 H10 Z M5 15 H10 V20 H5 Z M15 15 H20 V20 H15 Z"
      fill={SWATCH_INK}
    />
  ),
  dots: (
    <g fill={SWATCH_INK}>
      <circle cx="5" cy="5" r="2.5" />
      <circle cx="15" cy="5" r="2.5" />
      <circle cx="5" cy="15" r="2.5" />
      <circle cx="15" cy="15" r="2.5" />
    </g>
  )
};

const PatternSwatch = ({ pattern }) => (
  <svg
    className="surface-swatch"
    viewBox="0 0 20 20"
    aria-hidden="true"
    style={{ background: SWATCH_BACKGROUND }}
  >
    {PATTERN_SWATCHES[pattern]}
  </svg>
);

PatternSwatch.propTypes = { pattern: PropTypes.string.isRequired };

// The label text is the pointer target for the row's help: hovering it (and
// resting ~0.4 s) opens the sentence beside the panel. The trigger is a plain
// span, so it adds no tab stop; keyboard and screen-reader users get the same
// sentence from the row's control (see FillRow).
const HelpTooltip = ({ help, children }) => (
  <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <span className="fill-help-trigger">{children}</span>
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content side="left" sideOffset={6} className={styles.tooltip}>
        {help}
        <Tooltip.Arrow className={styles.tooltipArrow} />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
);

HelpTooltip.propTypes = {
  help: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired
};

const helpIdFor = (id) => `${id}-help`;

// One Fill row: label (with its help tooltip) and control, plus the help once
// more, visually hidden, as the control's description. The shared widgets do
// not forward aria attributes, so the description is attached to the row's
// inputs after each render.
const FillRow = ({ id, label, help, children }) => {
  const rowRef = useRef(null);
  useLayoutEffect(() => {
    if (!help || !rowRef.current) return;
    rowRef.current
      .querySelectorAll('input, select, textarea')
      .forEach((el) => el.setAttribute('aria-describedby', helpIdFor(id)));
  });
  return (
    <div className="propertyRow" ref={rowRef}>
      <label className="text" htmlFor={id} style={{ textTransform: 'none' }}>
        {help ? <HelpTooltip help={help}>{label}</HelpTooltip> : label}
      </label>
      {children}
      {help && (
        <span id={helpIdFor(id)} className="sr-only">
          {help}
        </span>
      )}
    </div>
  );
};

FillRow.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  help: PropTypes.string,
  children: PropTypes.node.isRequired
};

/**
 * Body of a shape's Style section (rendered by FeaturedComponents inside the
 * section's collapsible header): the line rows, then a Fill group whose rows
 * follow the choices made in it - Color for a solid material and Tint for a
 * texture, the pattern's rows only once a pattern is chosen, and Angle and
 * Offset once there is something for them to place. On an open polyline the
 * group starts collapsed under a heading that says it does nothing yet.
 *
 * Every write is one undoable entityupdate, except that choosing a texture
 * when the material was Solid color also raises the material opacity to 100%
 * in the same undo step: the 40% that suits a translucent colour reads as a
 * faint smear on a surface. Only this dropdown does that; setting the
 * property any other way does not.
 */
export const ShapeStyleSectionControls = ({ entity }) => {
  const intl = useIntl();
  const [, setUpdateTrigger] = useState(0);
  const units = useStore((s) => s.unitsPreference) || 'metric';
  const component = entity?.components?.[COMPONENT];

  // The rows arrive as the section's children, the same element each time
  // the section re-renders, so they listen for their own updates.
  useEffect(() => {
    const onEntityUpdate = (detail) => {
      if (detail.entity === entity && detail.component === COMPONENT) {
        setUpdateTrigger((p) => p + 1);
      }
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  if (!component || !component.schema || !component.data) return null;
  const { data, schema } = component;
  const t = (m) => intl.formatMessage(m);

  const update = (property, value) =>
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: COMPONENT,
      property,
      value
    });

  const material = resolveFillMaterial(data.fillMaterial);
  const pattern = resolveFillPattern(data.fillPattern);
  const textured = !!FILL_MATERIALS[material].textureId;
  const closed = !!data.closed;

  const onMaterialChange = (_name, value) => {
    if (material === 'solid' && value !== 'solid' && data.fillOpacity !== 100) {
      const write = (property, v) => [
        'entityupdate',
        { entity, component: COMPONENT, property, value: v }
      ];
      AFRAME.INSPECTOR.execute('multi', [
        write('fillMaterial', value),
        write('fillOpacity', 100)
      ]);
      return;
    }
    update('fillMaterial', value);
  };

  const unit = units === 'imperial' ? 'ft' : 'm';
  const lengthRow = (property, label, help) => {
    const id = `shape-fill-${property}`;
    const s = schema[property];
    const value = typeof data[property] === 'number' ? data[property] : 0;
    return (
      <FillRow key={property} id={id} label={label} help={help}>
        <NumberWidget
          id={id}
          name={property}
          value={toDisplay(value, units)}
          min={s.min !== undefined ? toDisplay(s.min, units) : -Infinity}
          max={s.max !== undefined ? toDisplay(s.max, units) : Infinity}
          precision={2}
          unit={unit}
          onChange={(_name, displayValue) =>
            // Round after converting, as LengthPropertyRow does, so a typed
            // "10 ft" stores 3.048 rather than float noise - which would also
            // make two identical-looking patterns different tiles.
            update(
              property,
              parseFloat(toMetres(displayValue, units).toFixed(4))
            )
          }
        />
      </FillRow>
    );
  };

  const colorRow = (property, label, help) => {
    const id = `shape-fill-${property}`;
    return (
      <FillRow key={property} id={id} label={label} help={help}>
        <ColorWidget
          id={id}
          name={property}
          value={data[property]}
          onChange={(_name, value) => update(property, value)}
        />
      </FillRow>
    );
  };

  const opacityRow = (property, label, help) => {
    const id = `shape-fill-${property}`;
    // OpacitySliderRow renders its own label around this node, so the help
    // trigger and the hidden sentence sit inside it.
    return (
      <OpacitySliderRow
        key={property}
        id={id}
        label={
          <>
            <HelpTooltip help={help}>{label}</HelpTooltip>
            <span id={helpIdFor(id)} className="sr-only">
              {help}
            </span>
          </>
        }
        min={0}
        max={100}
        step={1}
        value={typeof data[property] === 'number' ? data[property] : 0}
        onCommit={(value) => update(property, value)}
        showNumberInput
      />
    );
  };

  const fillRows = [
    <FillRow
      key="fillMaterial"
      id="shape-fill-fillMaterial"
      label={t(messages.material)}
      help={t(messages.materialHelp)}
    >
      <SelectWidget
        id="shape-fill-fillMaterial"
        name="fillMaterial"
        value={material}
        options={FILL_MATERIAL_IDS}
        formatOptionLabel={(option) => (
          <SurfaceSwatchOption
            label={t(materialNames[option.value])}
            textureId={FILL_MATERIALS[option.value].textureId || undefined}
            flatColor={
              option.value === 'solid' ? data.fillColor : MISSING_TEXTURE_CHIP
            }
          />
        )}
        onChange={onMaterialChange}
      />
    </FillRow>,
    opacityRow(
      'fillOpacity',
      t(messages.materialOpacity),
      t(messages.materialOpacityHelp)
    ),
    textured
      ? colorRow('fillTint', t(messages.tint), t(messages.tintHelp))
      : colorRow('fillColor', t(messages.color)),
    <FillRow
      key="fillPattern"
      id="shape-fill-fillPattern"
      label={t(messages.pattern)}
      help={t(messages.patternHelp)}
    >
      <SelectWidget
        id="shape-fill-fillPattern"
        name="fillPattern"
        value={pattern}
        options={FILL_PATTERNS}
        formatOptionLabel={(option) => (
          <span className="surface-option">
            <PatternSwatch pattern={option.value} />
            {t(patternNames[option.value])}
          </span>
        )}
        onChange={(_name, value) => update('fillPattern', value)}
      />
    </FillRow>
  ];

  if (pattern !== 'none') {
    fillRows.push(
      opacityRow(
        'fillPatternOpacity',
        t(messages.patternOpacity),
        t(messages.patternOpacityHelp)
      ),
      colorRow(
        'fillPatternColor',
        t(messages.patternColor),
        t(messages.patternColorHelp)
      )
    );
    if (pattern === 'checkerboard') {
      fillRows.push(
        lengthRow(
          'fillPatternSpacing',
          t(messages.squareSize),
          t(messages.squareSizeHelp)
        )
      );
    } else {
      fillRows.push(
        lengthRow(
          'fillPatternSpacing',
          t(messages.spacing),
          t(messages.spacingHelp)
        ),
        pattern === 'dots'
          ? lengthRow(
              'fillPatternWidth',
              t(messages.dotDiameter),
              t(messages.dotDiameterHelp)
            )
          : lengthRow(
              'fillPatternWidth',
              t(messages.stripeWidth),
              t(messages.stripeWidthHelp)
            )
      );
    }
  }

  if (textured || pattern !== 'none') {
    fillRows.push(
      <FillRow
        key="fillAngle"
        id="shape-fill-fillAngle"
        label={t(messages.angle)}
        help={t(messages.angleHelp)}
      >
        <NumberWidget
          id="shape-fill-fillAngle"
          name="fillAngle"
          value={typeof data.fillAngle === 'number' ? data.fillAngle : 0}
          precision={2}
          unit="°"
          onChange={(_name, value) => update('fillAngle', value)}
        />
      </FillRow>,
      lengthRow(
        'fillOffsetAlong',
        t(messages.offsetAlong),
        t(messages.offsetHelp)
      ),
      lengthRow(
        'fillOffsetAcross',
        t(messages.offsetAcross),
        t(messages.offsetHelp)
      )
    );
  }

  return (
    <div className="shape-style-controls">
      {['closed', 'lineColor', 'lineWidth'].map((name) =>
        schema[name] ? (
          <PropertyRow
            key={name}
            name={name}
            label={t(lineLabels[name])}
            schema={schema[name]}
            data={data[name]}
            componentname={COMPONENT}
            isSingle={false}
            entity={entity}
          />
        ) : null
      )}
      {/* Keyed on the shape and its closedness: Collapsible reads its
          starting state once, and an open polyline's group always starts
          collapsed, while a closed shape's remembers the panel preference. */}
      <Collapsible
        key={`${entity.object3D?.uuid}:${closed}`}
        className="fill-subsection"
        sectionKey={closed ? 'shape-fill' : undefined}
        collapsed={!closed}
      >
        <div className="componentHeader collapsible-header">
          <span className="componentTitle">
            <span>{t(closed ? messages.fill : messages.fillWhenOpen)}</span>
          </span>
        </div>
        <div>
          {/* Its own provider: the panel's default lets the next label open
              at once after the first, which in a column of labels means
              tooltips chase the pointer down the panel. */}
          <Tooltip.Provider delayDuration={400} skipDelayDuration={0}>
            {fillRows}
          </Tooltip.Provider>
        </div>
      </Collapsible>
    </div>
  );
};

ShapeStyleSectionControls.propTypes = {
  entity: PropTypes.object.isRequired
};
