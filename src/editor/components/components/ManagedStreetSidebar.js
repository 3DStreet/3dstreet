import PropTypes from 'prop-types';
import PropertyRow from './PropertyRow';

const ManagedStreetSidebar = ({ entity }) => {
  const componentName = 'managed-street';
  // Check if entity and its components exist
  const component = entity?.components?.[componentName];

  return (
    <div className="managed-street-sidebar">
      <div className="street-controls">
        <div className="details">
          {component && component.schema && component.data && (
            <>
              <PropertyRow
                key="length"
                name="length"
                label="Street Length"
                schema={component.schema['length']}
                data={component.data['length']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />
              <PropertyRow
                key="width"
                name="width"
                label="Street Width"
                schema={component.schema['width']}
                data={component.data['width']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />
              <div className="propertyRow">
                <div className="text">-----</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

ManagedStreetSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default ManagedStreetSidebar;
