import PropTypes from 'prop-types';
import PropertyRow from './PropertyRow';

const EnviroSidebar = ({ entity }) => {
  const componentName = 'street-environment';
  // Check if entity and its components exist
  const component = entity?.components?.[componentName];

  return (
    <div className="enviro-sidebar">
      <div className="enviro-controls">
        <div className="details">
          {component && component.schema && component.data && (
            <>
              <PropertyRow
                key="preset"
                name="preset"
                label="Preset"
                schema={component.schema['preset']}
                data={component.data['preset']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />
              <PropertyRow
                key="backgroundColor"
                name="backgroundColor"
                label="Background Color"
                schema={component.schema['backgroundColor']}
                data={component.data['backgroundColor']}
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

EnviroSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default EnviroSidebar;
