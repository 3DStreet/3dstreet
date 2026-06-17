import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';
import PropertyRow from './PropertyRow';
import Events from '../../lib/Events';

// Primary drive-controls fields surfaced inline so the user can tune a
// driveable vehicle without clicking "Show Advanced". Anything not
// listed here still appears under AdvancedComponents (rendered by the
// shared Sidebar). The set is intentionally tight — preset + the
// three numbers a player will actually want to feel; chassis size,
// wheel layout, mesh offset, etc. stay in Advanced for less-common
// tuning.
const PRIMARY_FIELDS = [
  { name: 'preset', label: 'Vehicle Preset' },
  { name: 'accelerateForce', label: 'Engine Force' },
  { name: 'brakeForce', label: 'Brake Force' },
  { name: 'steerAngle', label: 'Steer Angle (rad)' }
];

const DriveControlsSidebar = ({ entity }) => {
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
              label={f.label}
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
            <div className="mb-1 font-semibold uppercase">💡 Drive tips</div>
            <ul className="space-y-1">
              <li>• Press Play, then drive with WASD / arrows</li>
              <li>• Space = brake · R = reset · C = camera mode</li>
              <li>
                • Pick a preset to swap mesh + physics in one shot, or hand-tune
                fields below
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
