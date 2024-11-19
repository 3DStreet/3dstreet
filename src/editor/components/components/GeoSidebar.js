import PropTypes from 'prop-types';
import { Button } from '../components';
import { useAuthContext } from '@/editor/contexts/index.js';
import AdvancedComponents from './AdvancedComponents';
import PropertyRow from './PropertyRow';
import posthog from 'posthog-js';
import useStore from '@/store';

const GeoSidebar = ({ entity }) => {
  const setModal = useStore((state) => state.setModal);
  const { currentUser } = useAuthContext();

  const openGeoModal = () => {
    posthog.capture('openGeoModalFromSidebar');
    posthog.capture('geo_panel_clicked');
    if (!currentUser) {
      setModal('signin');
    } else if (currentUser.isPro) {
      setModal('geo');
    } else {
      setModal('payment');
    }
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
