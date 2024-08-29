import PropTypes from 'prop-types';
import { Button } from '../components';
import Events from '../../lib/Events';
import AdvancedComponents from './AdvancedComponents';
import PropertyRow from './PropertyRow';

const GeoSidebar = ({ entity }) => {
  const openGeoModal = () => {
    Events.emit('opengeomodal', { entity });
  };

  // Check if entity and its components exist
  const component = entity?.components?.['street-geo'];

  return (
    <div className="geo-sidebar">
      <div className="geo-controls">
        <div className="details">
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
          <div className="propertyRow">
            {entity && entity.components && entity.components['street-geo'] ? (
              <>
                <Button variant="toolbtn" onClick={openGeoModal}>
                  Change Location
                </Button>
                <AdvancedComponents entity={entity} />
              </>
            ) : (
              <div>
                <Button variant="toolbtn" onClick={openGeoModal}>
                  Set Location
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

GeoSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default GeoSidebar;
