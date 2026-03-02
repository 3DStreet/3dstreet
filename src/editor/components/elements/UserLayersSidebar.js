import PropTypes from 'prop-types';
import AdvancedComponents from './AdvancedComponents';

const UserLayersSidebar = ({ entity }) => {
  return (
    <div className="user-layers-sidebar">
      <div className="user-layers-controls">
        <div className="details">
          {/* User Layers Tips */}
          <div className="propertyRow">
            <div className="rounded bg-blue-50 p-2 text-gray-600">
              <div className="mb-1 font-semibold uppercase">💡 Tips</div>
              <ul className="space-y-1">
                <li>• User Layers contain all objects you add to your scene</li>
                <li>
                  • Toggle layer visibility by using the switch on the left on
                  each row of the layers panel
                </li>
                <li>
                  • Rename layers by clicking on the layer, then the Rename
                  button in the right-hand properties panel
                </li>
              </ul>
            </div>
          </div>

          {entity && entity.components && (
            <div className="propertyRow">
              <AdvancedComponents entity={entity} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

UserLayersSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default UserLayersSidebar;
