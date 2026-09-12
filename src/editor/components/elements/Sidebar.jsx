import { canRenameEntity } from '../../lib/entity';
import { Button } from '../elements';
import ComponentsContainer from './ComponentsContainer';
import EntityActionButtons from './EntityActionButtons';
import Events from '../../lib/Events';
import Mixins from '../widgets/Mixins';
import PropTypes from 'prop-types';
import React from 'react';
import { FormattedMessage } from 'react-intl';
import { ArrowLeftHookIcon } from '@shared/icons';
import IntersectionSidebar from './IntersectionSidebar';
import StreetSegmentSidebar from './StreetSegmentSidebar';
import ManagedStreetSidebar from './ManagedStreetSidebar';
import ShapeSidebar, { ShapeDrawInstructions } from './ShapeSidebar';
import DriveControlsSidebar from './DriveControlsSidebar';
import FlyControlsSidebar from './FlyControlsSidebar';
import StreetTrafficReplaySidebar from './StreetTrafficReplaySidebar';
import UserLayersSidebar from './UserLayersSidebar';
import PanelFooter from './PanelFooter';
import AssetInfoPanel from './AssetInfoPanel';
import EntityLabel from '../scenegraph/EntityLabel';
export default class Sidebar extends React.Component {
  static propTypes = {
    entity: PropTypes.object
  };

  getParentComponentName = (entity) => {
    const componentName = entity.getAttribute('data-parent-component');
    const parentEntity = entity.parentElement;
    return componentName
      ? `${parentEntity.getAttribute('data-layer-name') || 'Entity'}:${componentName}`
      : 'Unknown';
  };

  hasParentComponent = (entity) => {
    return entity.getAttribute('data-parent-component');
  };

  selectParentEntity = (entity) => {
    AFRAME.INSPECTOR.selectEntity(entity.parentElement);
  };

  onEntityUpdate = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    if (
      detail.component === 'mixin' ||
      detail.component === 'data-layer-name' ||
      detail.component === 'street-segment'
    ) {
      this.forceUpdate();
    }
  };

  onComponentRemove = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    this.forceUpdate();
  };

  onComponentAdd = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    this.forceUpdate();
  };

  componentDidMount() {
    Events.on('entityupdate', this.onEntityUpdate);
    Events.on('componentremove', this.onComponentRemove);
    Events.on('componentadd', this.onComponentAdd);
  }

  componentWillUnmount() {
    Events.off('entityupdate', this.onEntityUpdate);
    Events.off('componentremove', this.onComponentRemove);
    Events.off('componentadd', this.onComponentAdd);
  }

  render() {
    const entity = this.props.entity;
    if (!entity) {
      return (
        <div className="properties-empty-state">
          <ShapeDrawInstructions />
          <FormattedMessage
            id="sidebar.selectObject"
            defaultMessage="Select an object to edit properties."
          />
        </div>
      );
    }

    // Everything except the fixed pseudo-layers and no-transform entities
    // gets the inline rename on the title label (see canRenameEntity).
    const canRename = canRenameEntity(entity);

    // The condensed segment and managed-street panels (#1753) carry the
    // entity label inside their own sticky header rows, so the panel-level
    // title would duplicate it.
    const isStreetSegment = !!entity.getAttribute('street-segment');
    const hasOwnHeader =
      isStreetSegment || !!entity.getAttribute('managed-street');

    // Focus/Duplicate/Delete inline in the title row (the managed-street
    // header treatment), for real entities only: the fixed pseudo-layers
    // aren't clonable/deletable, and no-transform entities keep the old
    // gating.
    const isPseudoLayer =
      entity.id === 'reference-layers' ||
      entity.id === 'environment' ||
      entity.id === 'street-container';
    const showEntityActions =
      !hasOwnHeader &&
      !isPseudoLayer &&
      entity.tagName !== 'A-SCENE' &&
      !entity.hasAttribute('data-no-transform');

    return (
      <div className="properties-panel" tabIndex="0">
        <ShapeDrawInstructions />
        {!hasOwnHeader && (
          <div id="layers-title">
            <div className="layersBlock">
              <EntityLabel entity={entity} editable={canRename} />
            </div>
            {showEntityActions && <EntityActionButtons entity={entity} />}
          </div>
        )}
        {/* Sticky panel headers (the entity title row, and the segment /
            street panels' strip+header) must stick to the panel's real
            scroll pane (RightPanel's tab pane), so this inner .scroll
            wrapper must never be a scrollport of its own. */}
        <div className="scroll scroll-passthrough">
          {entity.id !== 'reference-layers' &&
          entity.id !== 'environment' &&
          entity.id !== 'street-container' &&
          !hasOwnHeader ? (
            <>
              {entity.classList.contains('autocreated') && (
                <div className="sidepanelContent">
                  <div className="flex items-center gap-2">
                    <FormattedMessage
                      id="sidebar.autocreatedEntity"
                      defaultMessage="Autocreated Entity"
                    />
                  </div>
                  {this.hasParentComponent(entity) && (
                    <>
                      <div className="collapsible-content">
                        <div className="propertyRow">
                          <label className="text">
                            <FormattedMessage
                              id="sidebar.managedBy"
                              defaultMessage="Managed by"
                            />
                          </label>
                          <input
                            className="string"
                            type="text"
                            value={this.getParentComponentName(entity)}
                            readOnly
                          />
                        </div>
                      </div>
                      <div id="sidebar-buttons">
                        <Button
                          variant={'toolbtn'}
                          onClick={() => this.selectParentEntity(entity)}
                        >
                          <ArrowLeftHookIcon />{' '}
                          <FormattedMessage
                            id="sidebar.editCloneSettings"
                            defaultMessage="Edit Clone Settings"
                          />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="sidepanelContent">
                <AssetInfoPanel entity={entity} />
                {!!entity.mixinEls.length &&
                  !entity.classList.contains('autocreated') && (
                    <div className="details">
                      <Mixins entity={entity} />
                    </div>
                  )}
              </div>

              {entity.getAttribute('intersection') && (
                <IntersectionSidebar entity={entity} />
              )}
              {entity.getAttribute('drive-controls') && (
                <>
                  <DriveControlsSidebar entity={entity} />
                  <PanelFooter entity={entity} />
                </>
              )}
              {entity.getAttribute('fly-controls') && (
                <>
                  <FlyControlsSidebar entity={entity} />
                  <PanelFooter entity={entity} />
                </>
              )}
              {entity.getAttribute('street-traffic-replay') && (
                <>
                  <StreetTrafficReplaySidebar entity={entity} />
                  <PanelFooter entity={entity} />
                </>
              )}
              {entity.getAttribute('shape') && <ShapeSidebar entity={entity} />}
              {!entity.getAttribute('drive-controls') &&
                !entity.getAttribute('fly-controls') &&
                !entity.getAttribute('street-traffic-replay') && (
                  <ComponentsContainer entity={entity} />
                )}
            </>
          ) : (
            <>
              {/* The condensed segment and managed-street panels (#1753)
                  carry their own header, actions and Advanced footer. */}
              {entity.getAttribute('street-segment') && (
                <StreetSegmentSidebar entity={entity} />
              )}
              {entity.getAttribute('managed-street') && (
                <ManagedStreetSidebar
                  key={entity.object3D.uuid}
                  entity={entity}
                />
              )}
              {entity.id === 'street-container' && (
                <UserLayersSidebar entity={entity} />
              )}
            </>
          )}
        </div>
      </div>
    );
  }
}
