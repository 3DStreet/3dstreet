import PropTypes from 'prop-types';
import { useIntl } from 'react-intl';
import classNames from 'classnames';
import useStore from '@/store';
import Collapsible from '../Collapsible';
import BooleanWidget from '../widgets/BooleanWidget';
import {
  SHAPE_TOOL_SETTINGS_ATTR,
  SNAP_OFF,
  SNAP_STEPS
} from '../../lib/shapeToolPrefs.js';

// Controls for the shape tool's per-device preferences (shapeToolPrefs.js).
// Every value lives in the store, so the same preference shown in two places
// — this section and a selected shape's panel — is one value, and changing
// either repaints both at once. None of them is a scene change or an undo
// step.

// A checkbox row whose label runs the panel's full width: these labels are
// sentences, too long for the label column of a property row.
const PrefRow = ({ id, label, value, onChange, disabled = false, title }) => (
  <div
    className={classNames('propertyRow', 'shape-tool-row', {
      'shape-tool-row--disabled': disabled
    })}
    title={title}
    // BooleanWidget flips its own state on click, so a disabled row has to
    // stop the click before it gets there.
    onClickCapture={disabled ? (e) => e.stopPropagation() : undefined}
  >
    <BooleanWidget
      id={id}
      name={id}
      value={value}
      onChange={(_, next) => onChange(next)}
    />
    <span className="shape-tool-panel-label">{label}</span>
  </div>
);

PrefRow.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  title: PropTypes.string
};

// What the canvas shows on shapes: shown in the Shape Tool section and in a
// selected shape's "Shape" section. The heading says these apply to every
// shape, not the one beside them.
export const ShapeDisplayPrefControls = () => {
  const intl = useIntl();
  const settings = useStore((s) => s.shapeToolSettings);
  const setSetting = useStore((s) => s.setShapeToolSetting);
  return (
    <div className="shape-display-prefs">
      <div className="propertyRow">
        <span className="shape-tool-panel-label">
          {intl.formatMessage({
            id: 'shapeTool.displayHeading',
            defaultMessage: 'Show on canvas (all shapes)'
          })}
        </span>
      </div>
      <PrefRow
        id="shape-pref-measurements"
        label={intl.formatMessage({
          id: 'shapeTool.showMeasurements',
          defaultMessage: 'Measurements'
        })}
        value={settings.showMeasurements}
        onChange={(v) => setSetting('showMeasurements', v)}
      />
      <PrefRow
        id="shape-pref-angles"
        label={intl.formatMessage({
          id: 'shapeTool.showAngles',
          defaultMessage: 'Angles'
        })}
        value={settings.showAngles}
        onChange={(v) => setSetting('showAngles', v)}
      />
    </div>
  );
};

// The right-panel section shown while the shape tool is active. Always
// arrives expanded: it carries no section key, so no remembered collapse and
// no collapse-all applies to it — the panel opens to make these reachable.
export const ShapeToolSection = () => {
  const intl = useIntl();
  const active = useStore((s) => s.shapeDrawActive);
  const settings = useStore((s) => s.shapeToolSettings);
  const setSetting = useStore((s) => s.setShapeToolSetting);
  if (!active) return null;
  const snapOn = settings.snapStep !== SNAP_OFF;
  return (
    <div
      className="shape-tool-section details"
      {...{ [SHAPE_TOOL_SETTINGS_ATTR]: '' }}
    >
      <Collapsible>
        <div className="componentHeader collapsible-header">
          <span className="componentTitle">
            <span>
              {intl.formatMessage({
                id: 'shapeTool.title',
                defaultMessage: 'Shape Tool'
              })}
            </span>
          </span>
        </div>
        <div className="collapsible-content">
          <ShapeDisplayPrefControls />
          <div className="propertyRow">
            <div className="fakePropertyRowLabel">
              {intl.formatMessage({
                id: 'shapeTool.snap',
                defaultMessage: 'Angle snap'
              })}
            </div>
            <div className="fakePropertyRowValue">
              <select
                value={settings.snapStep}
                onChange={(e) => {
                  setSetting('snapStep', Number(e.target.value));
                  // Hand the keys straight back to the drawing: a dropdown
                  // keeps focus after a pick, and while it has it Enter,
                  // Backspace and Escape do not reach the draw tool.
                  e.target.blur();
                }}
              >
                <option value={SNAP_OFF}>
                  {intl.formatMessage({
                    id: 'shapeTool.snapOff',
                    defaultMessage: 'Off'
                  })}
                </option>
                {SNAP_STEPS.map((step) => (
                  <option key={step} value={step}>
                    {intl.formatMessage(
                      { id: 'shapeTool.snapStep', defaultMessage: '{step}°' },
                      { step }
                    )}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <PrefRow
            id="shape-pref-align"
            label={intl.formatMessage({
              id: 'shapeTool.alignToAxes',
              defaultMessage: 'Align first side to axes'
            })}
            title={intl.formatMessage({
              id: 'shapeTool.alignToAxesHint',
              defaultMessage:
                "The scene's axes, or the open group's when you draw into a group"
            })}
            value={settings.alignToAxes}
            disabled={!snapOn}
            onChange={(v) => setSetting('alignToAxes', v)}
          />
          <PrefRow
            id="shape-pref-open-panel"
            label={intl.formatMessage({
              id: 'shapeTool.openPanelOnSelect',
              defaultMessage: 'Open this panel when the Shape Tool is selected'
            })}
            value={settings.openPanelOnSelect}
            onChange={(v) => setSetting('openPanelOnSelect', v)}
          />
        </div>
      </Collapsible>
    </div>
  );
};

export default ShapeToolSection;
