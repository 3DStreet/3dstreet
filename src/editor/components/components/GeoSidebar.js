import PropTypes from 'prop-types';
import { Button } from '../components';
import Events from '../../lib/Events';
import AdvancedComponents from './AdvancedComponents';
import PropertyRow from './PropertyRow';
import posthog from 'posthog-js';

const GeoSidebar = ({ entity }) => {
  const openGeoModal = () => {
    posthog.capture('openGeoModalFromSidebar');
    Events.emit('opengeomodal', { entity });
  };

  // Check if entity and its components exist
  const component = entity?.components?.['street-geo'];

  return (
    <div className="geo-sidebar">
      <div className="geo-controls">
        <div className="details">
          <div className="propertyRow">
            {entity && entity.components && entity.components['street-geo'] ? (
              <>
                <Button variant="toolbtn" onClick={openGeoModal}>
                  Change Location
                </Button>
              </>
            ) : (
              <div>
                <Button variant="toolbtn" onClick={openGeoModal}>
                  Set Location
                </Button>
              </div>
            )}
          </div>
          {component && component.schema && component.data && (
            <PropertyRow
              key="maps"
              name="maps"
              label="Map Source"
              schema={component.schema['maps']}
              data={component.data['maps']}
              componentname="street-geo"
              isSingle={false}
              entity={entity}
            />
          )}
          {entity && entity.components && entity.components['street-geo'] && (
            <div className="propertyRow">
              <AdvancedComponents entity={entity} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

GeoSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default GeoSidebar;
