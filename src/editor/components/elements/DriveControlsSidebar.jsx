import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import PropertyRow from './PropertyRow';
import Events from '../../lib/Events';

// Primary drive-controls fields surfaced inline so the user can tune a
// driveable vehicle without clicking "Show Advanced". Anything not
// listed here still appears under AdvancedComponents (rendered by the
// shared Sidebar). The set is intentionally tight — preset + the
// three numbers a player will actually want to feel; chassis size,
// wheel layout, mesh offset, etc. stay in Advanced for less-common
// tuning.
const fieldLabels = defineMessages({
  preset: { id: 'driveControls.preset', defaultMessage: 'Vehicle Preset' },
  accelerateForce: {
    id: 'driveControls.engineForce',
    defaultMessage: 'Engine Force'
  },
  brakeForce: { id: 'driveControls.brakeForce', defaultMessage: 'Brake Force' },
  steerAngle: {
    id: 'driveControls.steerAngle',
    defaultMessage: 'Steer Angle (rad)'
  }
});

const PRIMARY_FIELDS = [
  { name: 'preset' },
  { name: 'accelerateForce' },
  { name: 'brakeForce' },
  { name: 'steerAngle' }
];

const DriveControlsSidebar = ({ entity }) => {
  const intl = useIntl();
  const [, setUpdateTrigger] = useState(0);
  const componentName = 'drive-controls';
  const component = entity?.components?.[componentName];

  useEffect(() => {
    const onEntityUpdate = (detail) => {
      if (detail.entity !== entity) return;
      if (detail.component === componentName) {
        setUpdateTrigger((p) => p + 1);
      }
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  if (!component || !component.schema || !component.data) return null;

  return (
    <div className="drive-controls-sidebar">
      <div className="details">
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
        <div className="propertyRow">
          <div className="rounded bg-blue-50 p-2 text-gray-600">
            <div className="mb-1 font-semibold uppercase">
              <FormattedMessage
                id="driveControls.tipsHeading"
                defaultMessage="💡 Drive tips"
              />
            </div>
            <ul className="space-y-1">
              <li>
                •{' '}
                <FormattedMessage
                  id="driveControls.tipStart"
                  defaultMessage="Press Start, then drive with WASD / arrows"
                />
              </li>
              <li>
                •{' '}
                <FormattedMessage
                  id="driveControls.tipKeys"
                  defaultMessage="Space = brake · R = reset · C = camera mode"
                />
              </li>
              <li>
                •{' '}
                <FormattedMessage
                  id="driveControls.tipPreset"
                  defaultMessage="Pick a preset to swap mesh + physics in one shot, or hand-tune fields below"
                />
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

DriveControlsSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default DriveControlsSidebar;
