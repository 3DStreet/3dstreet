import PropTypes from 'prop-types';
import { FormattedMessage } from 'react-intl';
import AdvancedComponents from './AdvancedComponents';

const UserLayersSidebar = ({ entity }) => {
  return (
    <div className="user-layers-sidebar">
      <div className="user-layers-controls">
        <div className="details">
          {/* User Layers Tips */}
          <div className="propertyRow">
            <div className="rounded bg-blue-50 p-2 text-gray-600">
              <div className="mb-1 font-semibold uppercase">
                💡{' '}
                <FormattedMessage
                  id="userLayers.tipsHeading"
                  defaultMessage="Tips"
                />
              </div>
              <ul className="space-y-1">
                <li>
                  •{' '}
                  <FormattedMessage
                    id="userLayers.tipContain"
                    defaultMessage="User Layers contain all objects you add to your scene"
                  />
                </li>
                <li>
                  •{' '}
                  <FormattedMessage
                    id="userLayers.tipVisibility"
                    defaultMessage="Toggle layer visibility by using the switch on the left on each row of the layers panel"
                  />
                </li>
                <li>
                  •{' '}
                  <FormattedMessage
                    id="userLayers.tipRename"
                    defaultMessage="Rename layers by clicking on the layer, then the Rename button in the right-hand properties panel"
                  />
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
