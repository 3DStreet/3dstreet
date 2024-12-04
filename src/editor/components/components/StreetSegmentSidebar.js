import PropTypes from 'prop-types';
import PropertyRow from './PropertyRow';

const StreetSegmentSidebar = ({ entity }) => {
  const componentName = 'street-segment';
  // Check if entity and its components exist
  const component = entity?.components?.[componentName];

  return (
    <div className="segment-sidebar">
      <div className="segment-controls">
        <div className="details">
          {component && component.schema && component.data && (
            <>
              <PropertyRow
                key="type"
                name="type"
                label="Segment Type"
                schema={component.schema['type']}
                data={component.data['type']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />
              <PropertyRow
                key="width"
                name="width"
                label="Width"
                schema={component.schema['width']}
                data={component.data['width']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

StreetSegmentSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default StreetSegmentSidebar;
