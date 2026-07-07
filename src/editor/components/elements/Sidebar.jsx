import {
  cloneEntity,
  removeSelectedEntity,
  setFocusCameraPose
} from '../../lib/entity';
import { Button } from '../elements';
import ComponentsContainer from './ComponentsContainer';
import Events from '../../lib/Events';
import Mixins from '../widgets/Mixins';
import PropTypes from 'prop-types';
import React from 'react';
import { FormattedMessage } from 'react-intl';
import AddGeneratorComponent from './AddGeneratorComponent';
import {
  Object24IconCyan,
  ArrowLeftHookIcon,
  TrashIcon,
  Copy32Icon,
  ArrowsPointingInwardIcon
} from '@shared/icons';
import IntersectionSidebar from './IntersectionSidebar';
import StreetSegmentSidebar from './StreetSegmentSidebar';
import ManagedStreetSidebar from './ManagedStreetSidebar';
import MeasureLineSidebar from './MeasureLineSidebar';
import DriveControlsSidebar from './DriveControlsSidebar';
import StreetTrafficReplaySidebar from './StreetTrafficReplaySidebar';
import UserLayersSidebar from './UserLayersSidebar';
import AdvancedComponents from './AdvancedComponents';
import AssetInfoPanel from './AssetInfoPanel';
import EntityLabel from '../scenegraph/EntityLabel';
import { commonMessages } from '@/editor/i18n/commonMessages';
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

  fireParentComponentDetach = (entity) => {
    const componentName = entity.getAttribute('data-parent-component');
    const parentEntity = entity.parentElement;
    parentEntity.components[componentName].detach();
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
          <FormattedMessage
            id="sidebar.selectObject"
            defaultMessage="Select an object to edit properties."
          />
        </div>
      );
    }

    // The fixed pseudo-layers (environment, reference layers, user layers)
    // and no-transform entities never had a rename affordance; everything
    // else gets the inline rename on the title label.
    const canRename =
      !['reference-layers', 'environment', 'street-container'].includes(
        entity.id
      ) && !entity.hasAttribute('data-no-transform');

    return (
      <div className="properties-panel" tabIndex="0">
        <div id="layers-title">
          <div className="layersBlock">
            <EntityLabel entity={entity} editable={canRename} />
          </div>
        </div>
        <div className="scroll">
          {entity.id !== 'reference-layers' &&
          entity.id !== 'environment' &&
          entity.id !== 'street-container' &&
          !entity.getAttribute('street-segment') ? (
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
                        <Button
                          variant={'toolbtn'}
                          onClick={() => this.fireParentComponentDetach(entity)}
                        >
                          <Object24IconCyan />
                          <FormattedMessage
                            id="sidebar.detach"
                            defaultMessage="Detach"
                          />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="sidepanelContent">
                <AssetInfoPanel entity={entity} />
                {entity.hasAttribute('data-no-transform') ? (
                  <></>
                ) : (
                  <div className="sidebar-buttons-small">
                    <Button
                      variant={'toolbtn'}
                      onClick={() =>
                        Events.emit('objectfocus', entity.object3D)
                      }
                      onLongPress={() => setFocusCameraPose(entity)}
                      longPressDelay={1500} // Optional, defaults to 2000ms
                      leadingIcon={<ArrowsPointingInwardIcon />}
                    >
                      <FormattedMessage {...commonMessages.focus} />
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
                  </div>
                )}
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
              {entity.getAttribute('managed-street') && (
                <ManagedStreetSidebar entity={entity} />
              )}
              {entity.getAttribute('measure-line') && (
                <>
                  <MeasureLineSidebar entity={entity} />
                  <div className="propertyRow">
                    <AdvancedComponents entity={entity} />
                  </div>
                </>
              )}
              {entity.getAttribute('drive-controls') && (
                <>
                  <DriveControlsSidebar entity={entity} />
                  <div className="propertyRow">
                    <AdvancedComponents entity={entity} />
                  </div>
                </>
              )}
              {entity.getAttribute('street-traffic-replay') && (
                <>
                  <StreetTrafficReplaySidebar entity={entity} />
                  <div className="propertyRow">
                    <AdvancedComponents entity={entity} />
                  </div>
                </>
              )}
              {!entity.getAttribute('measure-line') &&
                !entity.getAttribute('drive-controls') &&
                !entity.getAttribute('street-traffic-replay') && (
                  <ComponentsContainer entity={entity} />
                )}
            </>
          ) : (
            <>
              {entity.getAttribute('street-segment') && (
                <>
                  <StreetSegmentSidebar entity={entity} />
                  <hr />
                  <AddGeneratorComponent entity={entity} />
                  <hr />
                  <div className="advancedComponentsContainer">
                    <AdvancedComponents entity={entity} />
                  </div>
                </>
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
