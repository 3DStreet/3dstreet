import PropTypes from 'prop-types';
// import Component from './Component';
import Component from './StreetSegmentComponent';
import PropertyRow from './PropertyRow';
import {
  cloneEntity,
  removeSelectedEntity,
  renameEntity,
  setFocusCameraPose
} from '../../lib/entity';
import {
  StreetSurfaceIcon,
  ArrowsPointingInwardIcon,
  Copy32Icon,
  Edit24Icon,
  TrashIcon
} from '../../icons';
import { Button } from '../components';
import Events from '../../lib/Events';

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
              <div className="sidepanelContent">
                <div id="sidebar-buttons-small">
                  <Button
                    variant={'toolbtn'}
                    onClick={() => Events.emit('objectfocus', entity.object3D)}
                    onLongPress={() => setFocusCameraPose(entity)}
                    longPressDelay={1500} // Optional, defaults to 2000ms
                    leadingIcon={<ArrowsPointingInwardIcon />}
                  >
                    Focus
                  </Button>
                  <Button
                    variant={'toolbtn'}
                    onClick={() => renameEntity(entity)}
                    leadingIcon={<Edit24Icon />}
                  >
                    Rename
                  </Button>
                  <Button
                    variant={'toolbtn'}
                    onClick={() => cloneEntity(entity)}
                    leadingIcon={<Copy32Icon />}
                  >
                    Duplicate
                  </Button>
                  <Button
                    variant={'toolbtn'}
                    onClick={() => removeSelectedEntity()}
                    leadingIcon={<TrashIcon />}
                  >
                    Delete
                  </Button>
                </div>
              </div>
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
                <>
                  {featuredComponents.map((key) => (
                    <div key={key} className={'details'}>
                      <Component
                        key={key}
                        isCollapsed={false}
                        component={components[key]}
                        entity={entity}
                        name={key}
                      />
                    </div>
                  ))}
                </>
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
