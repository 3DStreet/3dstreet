import PropTypes from 'prop-types';
import { FormattedMessage, useIntl } from 'react-intl';
// import Component from './Component';
import Component from './StreetSegmentComponent';
import PropertyRow from './PropertyRow';
import {
  cloneEntity,
  createUniqueId,
  removeSelectedEntity,
  renameEntity,
  setFocusCameraPose
} from '../../lib/entity';
import {
  StreetSurfaceIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsPointingInwardIcon,
  Copy32Icon,
  Edit24Icon,
  TrashIcon
} from '@shared/icons';
import { Button } from '../elements';
import Events from '../../lib/Events';
import { commonMessages } from '@/editor/i18n/commonMessages';
import { isGeneratorComponent } from '../../lib/featuredComponents';

const StreetSegmentSidebar = ({ entity }) => {
  const intl = useIntl();
  const componentName = 'street-segment';
  const component = entity?.components?.[componentName];
  const components = entity ? entity.components : {};

  // Filter for featured generator components that exist on this entity. Shares
  // the generalized prefix list (see lib/featuredComponents.js) so segments and
  // generic primitives surface street-generated-* the same way.
  const featuredComponents =
    Object.keys(components).filter(isGeneratorComponent);

  // Move left/right reorders this segment among the travelled-way segments of
  // its managed street (#1751). Boundaries are excluded: street-align places
  // them by `side`, not index, so reordering past one is a visual no-op.
  const parentEl = entity?.parentNode;
  const isManagedStreetChild = !!parentEl?.components?.['managed-street'];
  const travelledWaySiblings = isManagedStreetChild
    ? Array.from(parentEl.children).filter(
        (el) =>
          el.hasAttribute &&
          el.hasAttribute('street-segment') &&
          el.getAttribute('street-segment')?.type !== 'boundary'
      )
    : [];
  const segmentPos = travelledWaySiblings.indexOf(entity);

  const moveSegment = (offset) => {
    const target = travelledWaySiblings[segmentPos + offset];
    if (!target) return;
    if (!parentEl.id) {
      parentEl.setAttribute('id', createUniqueId());
    }
    // insert before the target when moving left, after it when moving right
    const indexInParent =
      Array.from(parentEl.children).indexOf(target) + (offset > 0 ? 1 : 0);
    AFRAME.INSPECTOR.execute('entityreparent', {
      entity,
      parentEl: parentEl.id,
      indexInParent
    });
  };

  return (
    <div className="segment-sidebar">
      <div className="segment-controls">
        <div className="details">
          {component && component.schema && component.data && (
            <>
              <PropertyRow
                key="type"
                name="type"
                label={intl.formatMessage({
                  id: 'segmentSidebar.segmentType',
                  defaultMessage: 'Segment Type'
                })}
                schema={component.schema['type']}
                data={component.data['type']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />
              {component.data['type'] === 'boundary' && (
                <>
                  <PropertyRow
                    key="variant"
                    name="variant"
                    label={intl.formatMessage({
                      id: 'segmentSidebar.boundaryVariant',
                      defaultMessage: 'Boundary Variant'
                    })}
                    schema={component.schema['variant']}
                    data={component.data['variant']}
                    componentname={componentName}
                    isSingle={false}
                    entity={entity}
                  />
                  <PropertyRow
                    key="side"
                    name="side"
                    label={intl.formatMessage({
                      id: 'segmentSidebar.side',
                      defaultMessage: 'Side'
                    })}
                    schema={component.schema['side']}
                    data={component.data['side']}
                    componentname={componentName}
                    isSingle={false}
                    entity={entity}
                  />
                </>
              )}
              <div className="sidepanelContent">
                <div id="sidebar-buttons-small">
                  <Button
                    variant={'toolbtn'}
                    onClick={() => Events.emit('objectfocus', entity.object3D)}
                    onLongPress={() => setFocusCameraPose(entity)}
                    longPressDelay={1500} // Optional, defaults to 2000ms
                    leadingIcon={<ArrowsPointingInwardIcon />}
                  >
                    <FormattedMessage {...commonMessages.focus} />
                  </Button>
                  <Button
                    variant={'toolbtn'}
                    onClick={() => renameEntity(entity)}
                    leadingIcon={<Edit24Icon />}
                  >
                    <FormattedMessage {...commonMessages.rename} />
                  </Button>
                  <Button
                    variant={'toolbtn'}
                    onClick={() => cloneEntity(entity)}
                    leadingIcon={<Copy32Icon />}
                  >
                    <FormattedMessage {...commonMessages.duplicate} />
                  </Button>
                  <Button
                    variant={'toolbtn'}
                    onClick={() => removeSelectedEntity()}
                    leadingIcon={<TrashIcon />}
                  >
                    <FormattedMessage {...commonMessages.delete} />
                  </Button>
                  {segmentPos !== -1 && (
                    <>
                      <Button
                        variant={'toolbtn'}
                        disabled={segmentPos === 0}
                        onClick={() => moveSegment(-1)}
                        leadingIcon={<ArrowLeftIcon />}
                      >
                        {intl.formatMessage({
                          id: 'segmentSidebar.moveLeft',
                          defaultMessage: 'Move Left'
                        })}
                      </Button>
                      <Button
                        variant={'toolbtn'}
                        disabled={
                          segmentPos === travelledWaySiblings.length - 1
                        }
                        onClick={() => moveSegment(1)}
                        leadingIcon={<ArrowRightIcon />}
                      >
                        {intl.formatMessage({
                          id: 'segmentSidebar.moveRight',
                          defaultMessage: 'Move Right'
                        })}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <PropertyRow
                key="width"
                name="width"
                label={intl.formatMessage({
                  id: 'segmentSidebar.width',
                  defaultMessage: 'Width'
                })}
                schema={component.schema['width']}
                data={component.data['width']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />
              {component.data['type'] !== 'boundary' && (
                <PropertyRow
                  key="direction"
                  name="direction"
                  label={intl.formatMessage({
                    id: 'segmentSidebar.direction',
                    defaultMessage: 'Direction'
                  })}
                  schema={component.schema['direction']}
                  data={component.data['direction']}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
              )}
              {/* props for street-segment but formatted as a fake 'surface' component */}
              <div className="collapsible component">
                <div className="static">
                  <div className="componentHeader collapsible-header">
                    <span
                      className="componentTitle"
                      title={intl.formatMessage(commonMessages.surface)}
                    >
                      <StreetSurfaceIcon />
                      <span>
                        <FormattedMessage {...commonMessages.surface} />
                      </span>
                    </span>
                  </div>
                </div>
                <div className="content">
                  <div className="collapsible-content">
                    <PropertyRow
                      key="surface"
                      name="surface"
                      label={intl.formatMessage(commonMessages.surface)}
                      schema={component.schema['surface']}
                      data={component.data['surface']}
                      componentname={componentName}
                      isSingle={false}
                      entity={entity}
                    />
                    <PropertyRow
                      key="color"
                      name="color"
                      label={intl.formatMessage({
                        id: 'segmentSidebar.color',
                        defaultMessage: 'Color'
                      })}
                      schema={component.schema['color']}
                      data={component.data['color']}
                      componentname={componentName}
                      isSingle={false}
                      entity={entity}
                    />
                    <PropertyRow
                      key="elevation"
                      name="elevation"
                      label={intl.formatMessage({
                        id: 'segmentSidebar.elevation',
                        defaultMessage: 'Elevation (m)'
                      })}
                      schema={component.schema['elevation']}
                      data={component.data['elevation']}
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
