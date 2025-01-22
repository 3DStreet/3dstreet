import PropTypes from 'prop-types';
import Component from './Component';
import PropertyRow from './PropertyRow';
import { StreetSurfaceIcon } from '../../icons';

// Define featured component prefixes that should be shown in their own section
const FEATURED_COMPONENT_PREFIXES = ['street-generated-'];

const StreetSegmentSidebar = ({ entity }) => {
  const componentName = 'street-segment';
  const component = entity?.components?.[componentName];
  const components = entity ? entity.components : {};

  // Filter for featured components that exist on this entity
  const featuredComponents = Object.keys(components).filter((key) =>
    FEATURED_COMPONENT_PREFIXES.some((prefix) => key.startsWith(prefix))
  );

  console.log('featuredComponents', featuredComponents);

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
              <PropertyRow
                key="direction"
                name="direction"
                label="Direction"
                schema={component.schema['direction']}
                data={component.data['direction']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />
              {/* props for street-segment but formatted as a fake 'surface' component */}
              <div className="collapsible component">
                <div className="static">
                  <div className="componentHeader collapsible-header">
                    <span className="componentTitle" title="Surface">
                      <StreetSurfaceIcon />
                      <span>Surface</span>
                    </span>
                  </div>
                </div>
                <div className="content">
                  <div className="collapsible-content">
                    <PropertyRow
                      key="surface"
                      name="surface"
                      label="Surface"
                      schema={component.schema['surface']}
                      data={component.data['surface']}
                      componentname={componentName}
                      isSingle={false}
                      entity={entity}
                    />
                    <PropertyRow
                      key="color"
                      name="color"
                      label="Color"
                      schema={component.schema['color']}
                      data={component.data['color']}
                      componentname={componentName}
                      isSingle={false}
                      entity={entity}
                    />
                    <PropertyRow
                      key="level"
                      name="level"
                      label="Curb Level"
                      schema={component.schema['level']}
                      data={component.data['level']}
                      componentname={componentName}
                      isSingle={false}
                      entity={entity}
                    />
                  </div>
                </div>
              </div>

              {/* Featured Components section */}
              {featuredComponents.length > 0 && (
                <div className="collapsible component">
                  <div className="content">
                    <div className="collapsible-content">
                      {featuredComponents.map((key) => (
                        <Component
                          key={key}
                          isCollapsed={false}
                          component={components[key]}
                          entity={entity}
                          name={key}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
