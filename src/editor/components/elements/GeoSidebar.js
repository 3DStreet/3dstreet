import PropTypes from 'prop-types';
import { Button } from '../elements';
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
            {entity && entity.components ? (
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
            <>
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
              {/* only show this if google3d is selected */}
              {component.data['maps'] === 'google3d' && (
                <div className="collapsible component">
                  <div className="static">
                    <div className="componentHeader collapsible-header">
                      <span className="componentTitle" title="Surface">
                        <span>Blending & Clipping</span>
                      </span>
                    </div>
                  </div>
                  <div className="content">
                    <div className="collapsible-content">
                      <PropertyRow
                        key="blendingEnabled"
                        name="blendingEnabled"
                        label="Blending"
                        schema={component.schema['blendingEnabled']}
                        data={component.data['blendingEnabled']}
                        componentname="street-geo"
                        isSingle={false}
                        entity={entity}
                      />
                      {component.data['blendingEnabled'] && (
                        <PropertyRow
                          key="blendMode"
                          name="blendMode"
                          label="Blend Mode"
                          schema={component.schema['blendMode']}
                          data={component.data['blendMode']}
                          componentname="street-geo"
                          isSingle={false}
                          entity={entity}
                        />
                      )}
                      <PropertyRow
                        key="enableClipping"
                        name="enableClipping"
                        label="Street Clipping"
                        schema={component.schema['enableClipping']}
                        data={component.data['enableClipping']}
                        componentname="street-geo"
                        isSingle={false}
                        entity={entity}
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

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

GeoSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default GeoSidebar;
