import PropTypes from 'prop-types';
import { FormattedMessage, useIntl } from 'react-intl';
// import Component from './Component';
import Component from './StreetSegmentComponent';
import PropertyRow from './PropertyRow';
import {
  cloneEntity,
  removeSelectedEntity,
  reorderEntityRelativeTo,
  setFocusCameraPose
} from '../../lib/entity';
import { getTravelledWaySegments } from '@/aframe-components/street-layout-utils';
import {
  StreetSurfaceIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsPointingInwardIcon,
  Copy32Icon,
  TrashIcon
} from '@shared/icons';
import { Button } from '../elements';
import Events from '../../lib/Events';
import { commonMessages } from '@/editor/i18n/commonMessages';
import { isGeneratorComponent } from '../../lib/featuredComponents';
import { captureSegmentEdit, SEGMENT_OPS } from '../../lib/segmentAnalytics';

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
    ? getTravelledWaySegments(parentEl)
    : [];
  const segmentPos = travelledWaySiblings.indexOf(entity);

  const moveSegment = (offset) => {
    // Re-resolve by id: a move destroys and recreates the element, and this
    // sidebar re-renders only after the new entity finishes loading, so on a
    // quick second click the render-time `entity` is already detached. The
    // recreated element keeps the same id.
    const liveEntity =
      (entity.id && document.getElementById(entity.id)) || entity;
    const streetEl = liveEntity.parentNode;
    if (!streetEl?.components?.['managed-street']) return;
    const siblings = getTravelledWaySegments(streetEl);
    const pos = siblings.indexOf(liveEntity);
    if (pos === -1) return;
    const target = siblings[pos + offset];
    if (!target) return;
    // insert before the target when moving left, after it when moving right
    reorderEntityRelativeTo(
      liveEntity,
      target,
      offset > 0 ? 'after' : 'before'
    );
  };

  return (
    <div className="segment-sidebar">
      <div className="segment-controls">
        <div className="details">
          {component && component.schema && component.data && (
            <>
              <div className="sidepanelContent">
                <div className="sidebar-buttons-small">
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
                    onClick={() => {
                      captureSegmentEdit(SEGMENT_OPS.DUPLICATED, {
                        segment_type: component.data['type']
                      });
                      cloneEntity(entity);
                    }}
                    leadingIcon={<Copy32Icon />}
                  >
                    <FormattedMessage {...commonMessages.duplicate} />
                  </Button>
                  <Button
                    variant={'toolbtn'}
                    onClick={() => {
                      captureSegmentEdit(SEGMENT_OPS.REMOVED, {
                        segment_type: component.data['type']
                      });
                      removeSelectedEntity();
                    }}
                    leadingIcon={<TrashIcon />}
                  >
                    <FormattedMessage {...commonMessages.delete} />
                  </Button>
                </div>
                {segmentPos !== -1 && (
                  <div className="sidebar-buttons-small">
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
                      disabled={segmentPos === travelledWaySiblings.length - 1}
                      onClick={() => moveSegment(1)}
                      leadingIcon={<ArrowRightIcon />}
                    >
                      {intl.formatMessage({
                        id: 'segmentSidebar.moveRight',
                        defaultMessage: 'Move Right'
                      })}
                    </Button>
                  </div>
                )}
              </div>
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
                onValueChange={(name, value) =>
                  captureSegmentEdit(SEGMENT_OPS.TYPE_CHANGED, {
                    segment_type: value
                  })
                }
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
                    onValueChange={(name, value) =>
                      captureSegmentEdit(SEGMENT_OPS.VARIANT_CHANGED, {
                        variant: value
                      })
                    }
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
                      key="slope"
                      name="slope"
                      label={intl.formatMessage({
                        id: 'segmentSidebar.slope',
                        defaultMessage: 'Slope'
                      })}
                      schema={component.schema['slope']}
                      data={component.data['slope']}
                      componentname={componentName}
                      isSingle={false}
                      entity={entity}
                    />
                    {/* sloped surfaces interpolate between the two edge
                        elevations and ignore the flat elevation, so show
                        one set of controls or the other */}
                    {component.data['slope'] ? (
                      <>
                        <PropertyRow
                          key="slopeStart"
                          name="slopeStart"
                          label={intl.formatMessage({
                            id: 'segmentSidebar.slopeStart',
                            defaultMessage: 'Start Edge (m)'
                          })}
                          schema={component.schema['slopeStart']}
                          data={component.data['slopeStart']}
                          componentname={componentName}
                          isSingle={false}
                          entity={entity}
                        />
                        <PropertyRow
                          key="slopeEnd"
                          name="slopeEnd"
                          label={intl.formatMessage({
                            id: 'segmentSidebar.slopeEnd',
                            defaultMessage: 'End Edge (m)'
                          })}
                          schema={component.schema['slopeEnd']}
                          data={component.data['slopeEnd']}
                          componentname={componentName}
                          isSingle={false}
                          entity={entity}
                        />
                      </>
                    ) : (
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
                    )}
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
