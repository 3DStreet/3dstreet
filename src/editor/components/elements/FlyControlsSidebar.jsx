import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import PropertyRow from './PropertyRow';
import Events from '../../lib/Events';

// All four fly-controls levers surfaced inline (the set is already
// tight — lift, cyclic authority, yaw authority, auto-level strength).
// Anything future lands in AdvancedComponents via the shared Sidebar.
const fieldLabels = defineMessages({
  liftPower: {
    id: 'flyControls.liftPower',
    defaultMessage: 'Rotor Power (× gravity)'
  },
  agility: { id: 'flyControls.agility', defaultMessage: 'Cyclic Agility' },
  yawRate: { id: 'flyControls.yawRate', defaultMessage: 'Yaw Rate' },
  stability: {
    id: 'flyControls.stability',
    defaultMessage: 'Stability Assist'
  }
});

const PRIMARY_FIELDS = [
  { name: 'liftPower' },
  { name: 'agility' },
  { name: 'yawRate' },
  { name: 'stability' }
];

const FlyControlsSidebar = ({ entity }) => {
  const intl = useIntl();
  const [, setUpdateTrigger] = useState(0);
  const componentName = 'fly-controls';
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
    <div className="fly-controls-sidebar">
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
                id="flyControls.tipsHeading"
                defaultMessage="🚁 Flight tips"
              />
            </div>
            <ul className="space-y-1">
              <li>
                •{' '}
                <FormattedMessage
                  id="flyControls.tipStart"
                  defaultMessage="Press Start, hold W to spool up and climb — release to hover"
                />
              </li>
              <li>
                •{' '}
                <FormattedMessage
                  id="flyControls.tipKeys"
                  defaultMessage="W/S climb/descend · A/D yaw · arrows tilt · Space auto-hover"
                />
              </li>
              <li>
                •{' '}
                <FormattedMessage
                  id="flyControls.tipMisc"
                  defaultMessage="R = reset · C = camera · tilt forward to build speed"
                />
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

FlyControlsSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default FlyControlsSidebar;
