import PropTypes from 'prop-types';
import PropertyRow from './PropertyRow';
import useStore from '@/store';

const MeasureLineSidebar = ({ entity }) => {
  const componentName = 'measure-line';
  const component = entity?.components?.[componentName];
  const { unitsPreference } = useStore();

  // Helper function to calculate and display the distance
  const calculateDistance = (start, end) => {
    if (!start || !end) return { value: 0, unit: 'm' };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const meters = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (unitsPreference === 'imperial') {
      const feet = meters * 3.28084;
      return { value: feet, unit: 'ft' };
    } else {
      return { value: meters, unit: 'm' };
    }
  };

  return (
    <div className="measure-line-sidebar">
      <div className="measure-line-controls">
        <div className="details">
          {component && component.schema && component.data && (
            <>
              {/* Display current distance as read-only info */}
              <div className="propertyRow">
                <div className="fakePropertyRowLabel">Distance</div>
                <div className="fakePropertyRowValue">
                  <span className="text-lg font-bold text-green-600">
                    {(() => {
                      const distance = calculateDistance(
                        component.data.start,
                        component.data.end
                      );
                      return `${distance.value.toFixed(2)}${distance.unit}`;
                    })()}
                  </span>
                </div>
              </div>

              {/* Start point controls */}
              <PropertyRow
                key="start"
                name="start"
                label="Start Point"
                schema={component.schema['start']}
                data={component.data['start']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />

              {/* End point controls */}
              <PropertyRow
                key="end"
                name="end"
                label="End Point"
                schema={component.schema['end']}
                data={component.data['end']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />

              {/* Additional info section */}
              <div className="propertyRow">
                <div className="rounded bg-blue-50 p-2 text-sm text-gray-600">
                  <div className="mb-1 font-semibold">💡 Tips:</div>
                  <ul className="space-y-1 text-xs">
                    <li>• Green sphere marks the start point</li>
                    <li>• Red sphere marks the end point</li>
                    <li>• Use this line as a camera path in Viewer Mode</li>
                    <li>• Drag endpoints with transform tools</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

MeasureLineSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default MeasureLineSidebar;
